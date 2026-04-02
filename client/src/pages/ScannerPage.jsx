import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import api, { setAuthToken } from '../api';
import { useAuth } from '../AuthContext';
import Loader from '../components/Loader';
import ProductCard from '../components/ProductCard';
import { useScannerInput } from '../hooks/useScannerInput';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function isMeaningful(value) {
  return normalizeText(value) !== '';
}

function looksLikeBarcode(value) {
  const normalized = normalizeText(value).replace(/\s+/g, '');

  if (!normalized || normalized.length < 4) {
    return false;
  }

  return /^[A-Z0-9-]+$/i.test(normalized)
    && (/^\d{4,}$/.test(normalized) || (/[A-Za-z]/.test(normalized) && /\d/.test(normalized)));
}

function parseQuantityValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  let normalized = normalizeText(value).replace(/,/g, '');

  if (!normalized) {
    return null;
  }

  if (looksLikeBarcode(normalized) && !/[\s.,()]/.test(normalized)) {
    return null;
  }

  const wrappedNegative = normalized.match(/^\(([-\d.\s]+)\)$/);

  if (wrappedNegative) {
    normalized = `-${wrappedNegative[1].trim()}`;
  }

  const match = normalized.match(/-?\d+(?:\.\d+)?/);

  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function findColumnIndex(headers, patterns) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(normalizeText(header))));
}

function detectHeaderRow(rows) {
  let bestIndex = -1;
  let bestScore = 0;

  rows.slice(0, 10).forEach((row, index) => {
    const score = row.reduce((total, cell) => {
      const value = normalizeText(cell).toLowerCase();

      if (!value) {
        return total;
      }

      let next = total;

      if (/(barcode|sku|ean|upc|item\s*code|product\s*code|code)/i.test(value)) {
        next += 3;
      }

      if (/(name|product|item|description|title|location)/i.test(value)) {
        next += 2;
      }

      if (/(expected|quantity|qty|stock|count|balance|system|on\s*hand|soh|available|inventory|physical|current)/i.test(value)) {
        next += 3;
      }

      return next;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 3 ? bestIndex : -1;
}

function detectColumns(rows, headerIndex) {
  const headerRow = headerIndex >= 0 ? rows[headerIndex].map((cell) => normalizeText(cell)) : [];
  const dataRows = rows.filter((row, index) => row.some((cell) => isMeaningful(cell)) && index !== headerIndex);
  const columnCount = Math.max(headerRow.length, ...dataRows.map((row) => row.length), 0);

  let barcodeIndex = headerRow.length
    ? findColumnIndex(headerRow, [/(barcode|sku|ean|upc|item\s*code|product\s*code|code)/i])
    : -1;
  let nameIndex = headerRow.length
    ? findColumnIndex(headerRow, [/(name|product|item|description|title|location)/i])
    : -1;
  let quantityIndex = headerRow.length
    ? findColumnIndex(headerRow, [/(expected|quantity|qty|stock|count|balance|system|on\s*hand|soh|available|inventory|physical|current)/i])
    : -1;

  if (barcodeIndex === -1 || nameIndex === -1 || quantityIndex === -1) {
    const stats = Array.from({ length: columnCount }, () => ({ barcode: 0, text: 0, numeric: 0 }));

    dataRows.slice(0, 150).forEach((row) => {
      row.forEach((cell, index) => {
        const normalized = normalizeText(cell);

        if (!normalized) {
          return;
        }

        if (looksLikeBarcode(normalized)) {
          stats[index].barcode += 1;
          return;
        }

        if (parseQuantityValue(normalized) !== null) {
          stats[index].numeric += 1;
          return;
        }

        stats[index].text += 1;
      });
    });

    const pickBest = (key, excluded = []) => {
      let bestIndexForKey = -1;
      let bestScore = 0;

      stats.forEach((entry, index) => {
        if (excluded.includes(index) || entry[key] <= bestScore) {
          return;
        }

        bestScore = entry[key];
        bestIndexForKey = index;
      });

      return bestIndexForKey;
    };

    if (barcodeIndex === -1) {
      barcodeIndex = pickBest('barcode');
    }

    if (quantityIndex === -1) {
      quantityIndex = pickBest('numeric', barcodeIndex >= 0 ? [barcodeIndex] : []);
    }

    if (nameIndex === -1) {
      nameIndex = pickBest('text', [barcodeIndex, quantityIndex].filter((value) => value >= 0));
    }
  }

  return { barcodeIndex, nameIndex, quantityIndex, columnCount };
}

function createDisplayHeaders(headers) {
  const seen = new Map();

  return headers.map((header, index) => {
    const base = normalizeText(header) || `Column ${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function getFallbackBarcode(values) {
  return values.find((value) => looksLikeBarcode(value));
}

function getFallbackName(values, barcode) {
  return values.find((value) => {
    const normalized = normalizeText(value);
    return normalized && normalized !== barcode && parseQuantityValue(normalized) === null && !looksLikeBarcode(normalized);
  });
}

function findImportedMatches(entries, barcode) {
  const normalizedBarcode = normalizeText(barcode).toUpperCase();
  return entries.filter((entry) => normalizeText(entry.barcode).toUpperCase() === normalizedBarcode);
}

function buildProductFromEntry(baseProduct, entry, duplicateCount = 0) {
  if (!entry) {
    return baseProduct;
  }

  const originalQuantity = Number(entry.importedQuantity ?? baseProduct.expected_stock ?? 0);
  const currentQuantity = Number(entry.updatedQuantity ?? originalQuantity);

  return {
    ...baseProduct,
    name: entry.name || baseProduct.name,
    barcode: entry.barcode || baseProduct.barcode,
    expected_stock: originalQuantity,
    actual_stock: currentQuantity,
    difference: currentQuantity - originalQuantity,
    selectedEntryId: entry.id,
    duplicateCount,
    rowLabel: entry.rowLabel,
  };
}

async function parseImportedInventoryFile(file) {
  const { read, utils } = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: 'array' });
  const currentSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[currentSheetName];
  const originalRows = utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  });
  const candidateRows = originalRows
    .map((row, index) => ({ row: Array.isArray(row) ? row : [], index }))
    .filter(({ row }) => row.some((cell) => isMeaningful(cell)));

  if (!candidateRows.length) {
    return {
      sheetName: currentSheetName,
      sheetRows: [],
      rawHeaders: [],
      previewRows: [],
      entries: [],
      headerRowIndex: -1,
      columnCount: 0,
    };
  }

  const headerCandidateIndex = detectHeaderRow(candidateRows.map((item) => item.row));
  const headerRowIndex = headerCandidateIndex >= 0 ? candidateRows[headerCandidateIndex].index : -1;
  const { barcodeIndex, nameIndex, quantityIndex, columnCount } = detectColumns(
    candidateRows.map((item) => item.row),
    headerCandidateIndex
  );

  const rawHeaders = headerRowIndex >= 0
    ? Array.from({ length: columnCount }, (_, index) => normalizeText(originalRows[headerRowIndex]?.[index]) || `Column ${index + 1}`)
    : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
  const displayHeaders = createDisplayHeaders(rawHeaders);
  const sheetRows = originalRows.map((row) => Array.from({ length: columnCount }, (_, index) => row?.[index] ?? ''));

  const entries = sheetRows
    .map((rowValues, rowIndex) => {
      if (!rowValues.some((cell) => isMeaningful(cell)) || rowIndex === headerRowIndex) {
        return null;
      }

      const barcodeValue = barcodeIndex >= 0 ? rowValues[barcodeIndex] : getFallbackBarcode(rowValues);
      const barcode = normalizeText(barcodeValue);

      if (!barcode) {
        return null;
      }

      const nameValue = nameIndex >= 0 ? rowValues[nameIndex] : getFallbackName(rowValues, barcode);
      let resolvedQuantityIndex = quantityIndex;
      let parsedQuantity = quantityIndex >= 0 ? parseQuantityValue(rowValues[quantityIndex]) : null;

      if (parsedQuantity === null) {
        const fallbackIndex = rowValues.findIndex(
          (value, index) => index !== barcodeIndex && parseQuantityValue(value) !== null
        );

        if (fallbackIndex >= 0) {
          resolvedQuantityIndex = fallbackIndex;
          parsedQuantity = parseQuantityValue(rowValues[fallbackIndex]);
        }
      }

      const itemName = normalizeText(nameValue || `Item ${barcode}`);
      const quantityText = parsedQuantity !== null ? ` • Qty ${parsedQuantity}` : '';

      return {
        id: `${file.name}-${rowIndex}-${barcode}`,
        rowIndex,
        barcode,
        name: itemName,
        rowValues: [...rowValues],
        importedQuantity: parsedQuantity ?? 0,
        updatedQuantity: null,
        quantityColumnIndex: resolvedQuantityIndex,
        rowLabel: `Row ${rowIndex + 1} • ${itemName}${quantityText}`,
      };
    })
    .filter(Boolean);

  const previewRows = entries.slice(0, 8).map((entry) => displayHeaders.reduce((accumulator, header, index) => {
    accumulator[header] = entry.rowValues[index] ?? '';
    return accumulator;
  }, {}));

  return {
    sheetName: currentSheetName,
    sheetRows,
    rawHeaders,
    previewRows,
    entries,
    headerRowIndex,
    columnCount,
  };
}

function ScannerPage() {
  const { auth } = useAuth();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [product, setProduct] = useState(null);
  const [actualStock, setActualStock] = useState('0');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [pageError, setPageError] = useState('');
  const [statusMessage, setStatusMessage] = useState('Import your stock sheet to begin the 4-step workflow.');
  const [isImageScanning, setIsImageScanning] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('No file selected');
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [recentScans, setRecentScans] = useState([]);
  const [importedEntries, setImportedEntries] = useState([]);
  const [duplicateOptions, setDuplicateOptions] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [sheetRows, setSheetRows] = useState([]);
  const [sheetName, setSheetName] = useState('Updated Inventory');
  const [headerRowIndex, setHeaderRowIndex] = useState(-1);
  const [columnCount, setColumnCount] = useState(0);

  const scannerRef = useRef(null);
  const fileInputRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const duplicateScansRef = useRef(new Map());

  // Ensure JWT is set for API requests
  useEffect(() => {
    if (auth?.token) setAuthToken(auth.token);
  }, [auth]);

  const focusBarcodeInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select?.();
    });
  }, []);

  const handleLookup = useCallback(async (rawBarcode, source = 'manual') => {
    const barcode = normalizeText(rawBarcode);

    if (!barcode) {
      return;
    }

    const lastSeen = duplicateScansRef.current.get(barcode) || 0;
    if (Date.now() - lastSeen < 1500) {
      return;
    }

    duplicateScansRef.current.set(barcode, Date.now());
    setBarcodeInput(barcode);
    setPageError('');
    setIsLoading(true);

    try {
      const response = await api.get(`/product/${encodeURIComponent(barcode)}`);
      const data = response.data;
      const matches = findImportedMatches(importedEntries, barcode);
      const preferredMatch = matches.find((entry) => entry.id === selectedEntryId)
        || matches.find((entry) => entry.updatedQuantity === null || entry.updatedQuantity === undefined)
        || matches[0]
        || null;
      const normalizedProduct = preferredMatch
        ? buildProductFromEntry(data, preferredMatch, matches.length)
        : {
          ...data,
          actual_stock: data.last_verified_at
            ? Number(data.actual_stock || 0)
            : Number(data.actual_stock || data.expected_stock || 0),
        };

      setProduct(normalizedProduct);
      setDuplicateOptions(matches);
      setSelectedEntryId(preferredMatch?.id || '');
      setActualStock('0');
      setStatusMessage(
        matches.length > 1
          ? `Found ${matches.length} imported rows for ${barcode}. Choose the correct row, update it, then continue scanning the next item.`
          : `Product loaded: ${normalizedProduct.name}. Enter the adjustment needed for this item.`
      );
      setRecentScans((previous) => [
        {
          barcode,
          name: normalizedProduct.name,
          source,
          time: new Date().toLocaleTimeString(),
        },
        ...previous,
      ].slice(0, 6));

      toast.success(matches.length > 1 ? `Loaded ${matches.length} matching entries` : `Loaded ${normalizedProduct.name}`);
    } catch (error) {
      const matches = findImportedMatches(importedEntries, barcode);

      if (matches.length) {
        const selectedMatch = matches.find((entry) => entry.id === selectedEntryId)
          || matches.find((entry) => entry.updatedQuantity === null || entry.updatedQuantity === undefined)
          || matches[0];
        const fallbackProduct = buildProductFromEntry(
          {
            name: selectedMatch.name,
            barcode,
            expected_stock: selectedMatch.importedQuantity,
            actual_stock: selectedMatch.updatedQuantity ?? selectedMatch.importedQuantity,
            last_verified_at: selectedMatch.updatedQuantity !== null ? new Date().toISOString() : null,
          },
          selectedMatch,
          matches.length
        );

        setProduct(fallbackProduct);
        setDuplicateOptions(matches);
        setSelectedEntryId(selectedMatch.id);
        setActualStock('0');
        setStatusMessage('This barcode was found in the imported sheet. Import the sheet first if the backend has not synced it yet.');
        return;
      }

      setProduct(null);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setPageError(error.userMessage || 'Product not found.');
    } finally {
      setIsLoading(false);
    }
  }, [importedEntries, selectedEntryId]);

  useScannerInput((value) => handleLookup(value, 'external scanner'), {
    minLength: 4,
    timeout: 80,
    cooldown: 1500,
  });

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const cleanupCamera = useCallback(async () => {
    const scanner = scannerRef.current;

    if (!scanner) {
      return;
    }

    try {
      await scanner.stop();
    } catch (error) {
      // Scanner may already be stopped.
    }

    try {
      await scanner.clear();
    } catch (error) {
      // Ignore cleanup issues.
    }

    scannerRef.current = null;
  }, []);

  useEffect(() => {
    if (!cameraActive) {
      cleanupCamera();
      return undefined;
    }

    let cancelled = false;

    const startCamera = async () => {
      try {
        setCameraError('');
        setPageError('');
        const { Html5Qrcode } = await import('html5-qrcode');
        const cameras = await Html5Qrcode.getCameras();

        if (!cameras?.length) {
          throw new Error('No camera detected on this device.');
        }

        if (cancelled) {
          return;
        }

        const scanner = new Html5Qrcode('camera-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: { width: 280, height: 90 } },
          (decodedText) => {
            handleLookup(decodedText, 'camera');
            setCameraActive(false);
          },
          () => {}
        );

        await scanner.applyVideoConstraints({
          advanced: [{ torch: true }],
        }).catch(() => {});
      } catch (error) {
        if (!cancelled) {
          setCameraError('Camera access failed. Please allow permission or use the other scan methods.');
          setCameraActive(false);
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      cleanupCamera();
    };
  }, [cameraActive, cleanupCamera, handleLookup]);

  const handleInventoryFileChange = async (event) => {
    const selectedFile = event.target.files?.[0];
    setPageError('');
    setStatusMessage('');

    if (!selectedFile) {
      setSelectedFileName('No file selected');
      setPreviewRows([]);
      setImportedEntries([]);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setSheetRows([]);
      setColumnCount(0);
      setHeaderRowIndex(-1);
      return;
    }

    setSelectedFileName(selectedFile.name);

    try {
      const parsedFile = await parseImportedInventoryFile(selectedFile);

      if (!parsedFile.entries.length) {
        setPreviewRows([]);
        setImportedEntries([]);
        setPageError('The selected sheet is empty or has no readable rows.');
        return;
      }

      setPreviewRows(parsedFile.previewRows);
      setImportedEntries(parsedFile.entries);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setSheetRows(parsedFile.sheetRows);
      setSheetName(parsedFile.sheetName || 'Updated Inventory');
      setHeaderRowIndex(parsedFile.headerRowIndex);
      setColumnCount(parsedFile.columnCount);
      setProduct(null);
      setActualStock('0');
      setStatusMessage(`Preview ready for ${parsedFile.entries.length} imported row(s). The exported file will keep the same order and duplicates.`);
    } catch (error) {
      setPreviewRows([]);
      setImportedEntries([]);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setSheetRows([]);
      setPageError('Could not read that spreadsheet. Please choose a valid .xlsx or .csv file.');
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);

    const droppedFile = event.dataTransfer?.files?.[0];
    if (!droppedFile) {
      return;
    }

    if (fileInputRef.current && typeof DataTransfer !== 'undefined') {
      const transfer = new DataTransfer();
      transfer.items.add(droppedFile);
      fileInputRef.current.files = transfer.files;
    }

    handleInventoryFileChange({ target: { files: [droppedFile] } });
  };

  const handleInventoryUpload = async () => {
    const selectedFile = fileInputRef.current?.files?.[0];

    if (!selectedFile) {
      setPageError('Select an Excel or CSV file first.');
      return;
    }

    try {
      setIsUploading(true);
      setPageError('');
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setStatusMessage(response.data.message || 'Inventory imported successfully. Scan a product to start updating quantities.');
      toast.success(response.data.message || 'Inventory imported successfully.');
    } catch (error) {
      setPageError(error.userMessage || 'Import failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageUpload = async (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      setPageError('Please upload a valid barcode image.');
      event.target.value = '';
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    setImagePreviewUrl(URL.createObjectURL(selectedFile));
    setCameraActive(false);
    setCameraError('');
    setPageError('');

    let imageScanner;

    try {
      setIsImageScanning(true);
      const { Html5Qrcode } = await import('html5-qrcode');
      imageScanner = new Html5Qrcode('image-reader');
      const decodedText = await imageScanner.scanFile(selectedFile, false);
      await handleLookup(decodedText, 'image upload');
    } catch (error) {
      setPageError('No readable barcode was found in that image. Try a clearer photo.');
    } finally {
      if (imageScanner) {
        try {
          await imageScanner.clear();
        } catch (clearError) {
          // Ignore cleanup issues for image scans.
        }
      }

      setIsImageScanning(false);
      event.target.value = '';
    }
  };

  const handleDuplicateSelection = (entryId) => {
    setSelectedEntryId(entryId);
    setActualStock('0');

    const selectedEntry = duplicateOptions.find((entry) => entry.id === entryId)
      || importedEntries.find((entry) => entry.id === entryId);

    if (!selectedEntry || !product) {
      return;
    }

    setProduct(buildProductFromEntry(product, selectedEntry, duplicateOptions.length || 1));
    setStatusMessage(`Selected ${selectedEntry.rowLabel}. Update it, then continue with the next barcode in sequence.`);
  };

  const handleSave = async () => {
    if (!product) {
      setPageError('Scan or search for a product first.');
      return;
    }

    const adjustment = Number(actualStock || 0);
    const activeEntry = selectedEntryId
      ? importedEntries.find((entry) => entry.id === selectedEntryId)
      : findImportedMatches(importedEntries, product.barcode)[0] || null;
    const currentQuantity = activeEntry
      ? Number(activeEntry.updatedQuantity ?? activeEntry.importedQuantity ?? 0)
      : Number(product.actual_stock || product.expected_stock || 0);

    if (!Number.isFinite(adjustment)) {
      setPageError('Enter a valid positive or negative quantity change.');
      return;
    }

    const newQuantity = currentQuantity + adjustment;

    if (newQuantity < 0) {
      setPageError('The updated quantity cannot be below zero.');
      return;
    }

    try {
      setIsSaving(true);
      setPageError('');
      const response = await api.post('/update-stock', {
        barcode: product.barcode,
        actualStock: newQuantity,
      });

      const matches = findImportedMatches(importedEntries, product.barcode);
      const nextMatches = activeEntry
        ? matches.map((entry) => (entry.id === activeEntry.id ? { ...entry, updatedQuantity: newQuantity } : entry))
        : matches;
      const remainingDuplicate = activeEntry
        ? nextMatches.find((entry) => entry.id !== activeEntry.id && (entry.updatedQuantity === null || entry.updatedQuantity === undefined))
        : null;

      if (activeEntry) {
        setImportedEntries((previous) => previous.map((entry) => (
          entry.id === activeEntry.id
            ? { ...entry, updatedQuantity: newQuantity }
            : entry
        )));
      }

      setActualStock('0');

      if (remainingDuplicate) {
        setSelectedEntryId(remainingDuplicate.id);
        setDuplicateOptions(nextMatches);
        setProduct(buildProductFromEntry(response.data.product, remainingDuplicate, nextMatches.length));
        setStatusMessage(`Entry updated. Another imported row uses this barcode — choose it below or scan the next barcode.`);
      } else {
        setProduct(null);
        setDuplicateOptions([]);
        setSelectedEntryId('');
        setBarcodeInput('');
        setStatusMessage(`Quantity updated successfully. Scan the next barcode in sequence.`);
        focusBarcodeInput();
      }

      toast.success('Entry updated successfully. Ready for the next scan.');
    } catch (error) {
      setPageError(error.userMessage || 'Failed to update stock.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = async () => {
    try {
      setIsExporting(true);
      setPageError('');

      if (!importedEntries.length || !sheetRows.length) {
        setPageError('Import a sheet first so the download can keep the same entries and order.');
        return;
      }

      const { utils, writeFile } = await import('xlsx');
      const hasAnyUpdates = importedEntries.some(
        (entry) => entry.updatedQuantity !== null && entry.updatedQuantity !== undefined
      );
      const updatedQuantityColumnIndex = columnCount;
      const updatedEntryColumnIndex = columnCount + 1;
      const exportRows = sheetRows.map((row) => [...row]);

      if (hasAnyUpdates) {
        exportRows.forEach((row, rowIndex) => {
          if (rowIndex === headerRowIndex) {
            row[updatedQuantityColumnIndex] = 'Updated Quantity';
            row[updatedEntryColumnIndex] = 'Updated Entry';
          } else {
            row[updatedQuantityColumnIndex] = row[updatedQuantityColumnIndex] ?? '';
            row[updatedEntryColumnIndex] = '';
          }
        });
      }

      importedEntries.forEach((entry) => {
        if (entry.updatedQuantity === null || entry.updatedQuantity === undefined || !exportRows[entry.rowIndex]) {
          return;
        }

        exportRows[entry.rowIndex][updatedQuantityColumnIndex] = entry.updatedQuantity;
        exportRows[entry.rowIndex][updatedEntryColumnIndex] = `Changed from ${entry.importedQuantity} to ${entry.updatedQuantity}`;
      });

      const workbook = utils.book_new();
      const worksheet = utils.aoa_to_sheet(exportRows);
      utils.book_append_sheet(workbook, worksheet, sheetName || 'Updated Inventory');
      writeFile(
        workbook,
        `${selectedFileName.replace(/\.(xlsx|csv)$/i, '') || 'checkmate-inventory'}-updated.xlsx`
      );
      toast.success('Downloaded the same imported sheet with all rows preserved.');
    } catch (error) {
      setPageError(error.userMessage || 'Failed to generate the downloadable Excel file.');
    } finally {
      setIsExporting(false);
    }
  };

  const previewColumns = Object.keys(previewRows[0] || {});

  return (
    <div className="page-stack">
      <section className="panel workflow-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">4-step inventory flow</span>
            <h2>Import → Scan → Update → Download</h2>
            <p>Everything you need to verify stock now lives in a single, simpler workflow.</p>
          </div>
          <button type="button" className="secondary-btn" onClick={handleDownload} disabled={isExporting}>
            {isExporting ? 'Preparing file...' : 'Download updated Excel'}
          </button>
        </div>

        <div className="workflow-steps">
          <div className="workflow-step"><span>1</span><strong>Import data</strong></div>
          <div className="workflow-step"><span>2</span><strong>Scan product</strong></div>
          <div className="workflow-step"><span>3</span><strong>Update quantity</strong></div>
          <div className="workflow-step"><span>4</span><strong>Download file</strong></div>
        </div>

        {pageError ? <div className="warning-banner">{pageError}</div> : null}
        {statusMessage ? <div className="success-banner">{statusMessage}</div> : null}
      </section>

      <section className="scanner-grid">
        <div className="panel">
          <div className="section-header">
            <div>
              <h2>Step 1 & 2</h2>
              <p>Import your sheet first, then scan or search the product you want to update.</p>
            </div>
          </div>

          <div
            className={`import-inline-card ${isDragOver ? 'drag-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="upload-icon-badge">⇪</div>
            <div className="import-inline-content">
              <h3>Import stock sheet</h3>
              <p>Any file with a barcode/code column is accepted. Quantity columns are detected automatically.</p>
              <p className="helper-text">Drag and drop your Excel/CSV here, or choose the file manually.</p>
              <div className="button-row">
                <button type="button" className="primary-btn" onClick={() => fileInputRef.current?.click()}>
                  Choose Excel / CSV
                </button>
                <button type="button" className="secondary-btn" onClick={handleInventoryUpload} disabled={isUploading}>
                  {isUploading ? 'Importing...' : 'Import now'}
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv" hidden onChange={handleInventoryFileChange} />
              <div className="upload-meta">
                <span><strong>Selected file:</strong> {selectedFileName}</span>
                <span><strong>Imported entries:</strong> {importedEntries.length || previewRows.length}</span>
              </div>
            </div>
          </div>

          <div className="method-list">
            <div className="method-card">
              <h4>📷 Camera scanner</h4>
              <p>Use the live camera to detect a barcode automatically.</p>
              <div className="button-row">
                <button type="button" className="primary-btn" onClick={() => setCameraActive(true)}>
                  Start camera
                </button>
                <button type="button" className="secondary-btn" onClick={() => setCameraActive(false)}>
                  Stop
                </button>
              </div>
            </div>

            <div className="method-card">
              <h4>🖼️ Barcode image</h4>
              <p>Upload a photo or screenshot of the barcode and let CheckMate detect it.</p>
              <label className="file-upload-row">
                <span className="secondary-btn">Choose barcode image</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} />
              </label>
              {isImageScanning ? <p className="helper-text">Scanning selected image...</p> : null}
              {imagePreviewUrl ? (
                <div className="image-preview-box">
                  <img src={imagePreviewUrl} alt="Uploaded barcode preview" />
                </div>
              ) : null}
            </div>

            <div className="method-card">
              <h4>🔫 External scanner</h4>
              <p>USB/Bluetooth scanners are detected as fast keyboard input automatically.</p>
            </div>

            <div className="method-card">
              <h4>⌨️ Manual entry</h4>
              <p>Type or paste a barcode to fetch the product quantity immediately.</p>
              <form
                className="barcode-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleLookup(barcodeInput, 'manual entry');
                }}
              >
                <input
                  ref={barcodeInputRef}
                  type="text"
                  placeholder="Enter barcode"
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                />
                <button type="submit" className="primary-btn">
                  Search
                </button>
              </form>
            </div>
          </div>

          {cameraActive ? <div id="camera-reader" className="camera-reader" /> : null}
          <div id="image-reader" className="sr-only" />
          {cameraError ? <p className="error-text">{cameraError}</p> : null}
        </div>

        <ProductCard
          product={product}
          actualStock={actualStock}
          setActualStock={setActualStock}
          onSubmit={handleSave}
          isSaving={isSaving}
          duplicateOptions={duplicateOptions}
          selectedEntryId={selectedEntryId}
          onSelectEntry={handleDuplicateSelection}
        />
      </section>

      {isLoading ? <Loader label="Looking up barcode..." /> : null}

      {previewRows.length ? (
        <section className="panel">
          <div className="section-header">
            <div>
              <h3>Imported preview</h3>
              <p>Quick check of the first rows from the selected inventory sheet.</p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {previewColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => (
                  <tr key={`preview-${index}`}>
                    {previewColumns.map((column) => (
                      <td key={`${column}-${index}`}>{String(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-header">
          <div>
            <h3>Recent scans</h3>
            <p>Latest barcode events across camera, image upload, scanner, and manual entry.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Barcode</th>
                <th>Product</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {recentScans.length ? (
                recentScans.map((scan, index) => (
                  <tr key={`${scan.barcode}-${index}`}>
                    <td>{scan.time}</td>
                    <td>{scan.barcode}</td>
                    <td>{scan.name}</td>
                    <td>{scan.source}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4">No scans yet. Import a file, then scan or search for a product to begin.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default ScannerPage;
