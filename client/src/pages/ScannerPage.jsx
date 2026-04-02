import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import api, { setAuthToken } from '../api';
import { useAuth } from '../AuthContext';
import Loader from '../components/Loader';
import ProductCard from '../components/ProductCard';
import { useScannerInput } from '../hooks/useScannerInput';
import {
  buildProductFromEntry,
  createFallbackProduct,
  findImportedMatches,
  mergeSecondaryEntries,
  normalizeText,
  parseImportedInventoryFile,
  parseQuantityValue,
} from '../utils/inventorySheet';
import { playSuccessTone } from '../utils/scannerAudio';

function ScannerPage() {
  const { auth } = useAuth();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [product, setProduct] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [isCameraBusy, setIsCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [pageError, setPageError] = useState('');
  const [statusMessage, setStatusMessage] = useState('Import your sheet to begin scanning and updating full rows.');
  const [isImageScanning, setIsImageScanning] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('No file selected');
  const [secondaryFileName, setSecondaryFileName] = useState('No secondary file selected');
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
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');

  const scannerRef = useRef(null);
  const scannerLibraryRef = useRef(null);
  const fileInputRef = useRef(null);
  const secondaryFileInputRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const duplicateScansRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const scanHandledRef = useRef(false);

  const forceStopCameraStream = useCallback(() => {
    const container = document.getElementById('camera-reader');
    const video = container?.querySelector('video');
    const mediaStream = video?.srcObject;

    if (mediaStream && typeof mediaStream.getTracks === 'function') {
      mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {}
      });
    }

    if (video) {
      video.pause?.();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load?.();
    }
  }, []);

  useEffect(() => {
    if (auth?.token) {
      setAuthToken(auth.token);
    }
  }, [auth]);

  useEffect(() => () => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const focusBarcodeInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select?.();
    });
  }, []);

  const handleLookup = useCallback(async (rawValue, source = 'manual') => {
    const query = normalizeText(rawValue);

    if (!query) {
      return;
    }

    const lastSeen = duplicateScansRef.current.get(query) || 0;

    if (Date.now() - lastSeen < 900) {
      return;
    }

    duplicateScansRef.current.set(query, Date.now());
    setBarcodeInput(query);
    setPageError('');
    setIsLoading(true);

    try {
      const matches = findImportedMatches(importedEntries, query);

      if (matches.length) {
        const preferredMatch = matches.find((entry) => entry.id === selectedEntryId)
          || matches.find((entry) => entry.updatedQuantity === null || entry.updatedQuantity === undefined)
          || matches[0];

        let backendProduct = null;

        if (preferredMatch.barcode) {
          try {
            const response = await api.get(`/product/${encodeURIComponent(preferredMatch.barcode)}`);
            backendProduct = response.data;
          } catch (error) {
            backendProduct = {
              name: preferredMatch.name,
              barcode: preferredMatch.barcode,
              expected_stock: preferredMatch.importedQuantity,
              actual_stock: preferredMatch.updatedQuantity ?? preferredMatch.importedQuantity,
              last_verified_at: preferredMatch.updatedQuantity !== null ? new Date().toISOString() : null,
            };
          }
        }

        const normalizedProduct = buildProductFromEntry(
          backendProduct || createFallbackProduct({
            name: preferredMatch.name,
            barcode: preferredMatch.barcode,
            expected_stock: preferredMatch.importedQuantity,
            actual_stock: preferredMatch.updatedQuantity ?? preferredMatch.importedQuantity,
          }),
          preferredMatch,
          sheetHeaders,
          query,
          matches.length
        );

        setProduct(normalizedProduct);
        setDuplicateOptions(matches);
        setSelectedEntryId(preferredMatch.id);
        setStatusMessage(
          matches.length > 1
            ? `Found ${matches.length} imported rows for "${query}". Pick the exact row, edit any field, then save it.`
            : `Loaded ${normalizedProduct.name}. You can now update any imported column for this row.`
        );
        setRecentScans((previous) => [
          {
            barcode: query,
            name: normalizedProduct.name,
            source,
            matchedBy: normalizedProduct.matchLabel,
            time: new Date().toLocaleTimeString(),
          },
          ...previous,
        ].slice(0, 8));
        playSuccessTone(audioContextRef);
        toast.success(matches.length > 1 ? `Loaded ${matches.length} matching rows` : `Loaded ${normalizedProduct.name}`);
        return;
      }

      const response = await api.get(`/product/${encodeURIComponent(query)}`);
      const fallbackProduct = createFallbackProduct({
        ...response.data,
        actual_stock: response.data.last_verified_at
          ? Number(response.data.actual_stock || 0)
          : Number(response.data.actual_stock || response.data.expected_stock || 0),
      });

      setProduct(fallbackProduct);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setStatusMessage(`Loaded ${fallbackProduct.name} from the backend. You can still update the quantity directly here.`);
      setRecentScans((previous) => [
        {
          barcode: query,
          name: fallbackProduct.name,
          source,
          matchedBy: 'Database lookup',
          time: new Date().toLocaleTimeString(),
        },
        ...previous,
      ].slice(0, 8));
      playSuccessTone(audioContextRef);
      toast.success(`Loaded ${fallbackProduct.name}`);
    } catch (error) {
      setProduct(null);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setPageError(error.userMessage || 'No matching imported row or backend product was found.');
    } finally {
      setIsLoading(false);
    }
  }, [importedEntries, selectedEntryId, sheetHeaders]);

  useScannerInput((value) => handleLookup(value, 'external scanner'), {
    minLength: 3,
    timeout: 60,
    cooldown: 900,
  });

  const cleanupCamera = useCallback(async () => {
    const scanner = scannerRef.current;

    if (!scanner) {
      forceStopCameraStream();
      return;
    }

    try {
      const state = typeof scanner.getState === 'function' ? scanner.getState() : null;
      const scannerState = scannerLibraryRef.current?.Html5QrcodeScannerState;

      if (
        state === scannerState?.SCANNING
        || state === scannerState?.PAUSED
      ) {
        await scanner.stop();
      }
    } catch (error) {}

    try {
      await scanner.clear();
    } catch (error) {}

    forceStopCameraStream();
    scannerRef.current = null;
  }, [forceStopCameraStream]);

  const handleStopCamera = useCallback(async () => {
    stopRequestedRef.current = true;
    setIsCameraBusy(true);

    await cleanupCamera();

    scanHandledRef.current = false;
    setCameraActive(false);
    setIsCameraBusy(false);
  }, [cleanupCamera]);

  const handleStartCamera = useCallback(() => {
    stopRequestedRef.current = false;
    scanHandledRef.current = false;
    setCameraError('');
    setPageError('');
    setCameraActive(true);
  }, []);

  useEffect(() => {
    if (!cameraActive) {
      return undefined;
    }

    let cancelled = false;

    const startCamera = async () => {
      try {
        setIsCameraBusy(true);
        setCameraError('');
        setPageError('');
        const {
          Html5Qrcode,
          Html5QrcodeSupportedFormats,
          Html5QrcodeScannerState,
        } = await import('html5-qrcode');
        scannerLibraryRef.current = { Html5QrcodeScannerState };
        const cameras = await Html5Qrcode.getCameras();

        if (!cameras?.length) {
          throw new Error('No camera detected on this device.');
        }

        if (cancelled || stopRequestedRef.current) {
          return;
        }

        setAvailableCameras(cameras);

        const preferredCamera = selectedCameraId
          || cameras.find((camera) => /back|rear|environment/i.test(camera.label))?.id
          || cameras[0].id;

        if (!selectedCameraId) {
          setSelectedCameraId(preferredCamera);
        }

        await cleanupCamera();

        if (cancelled || stopRequestedRef.current) {
          return;
        }

        const scanner = new Html5Qrcode('camera-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            aspectRatio: 1.777778,
            disableFlip: false,
            rememberLastUsedCamera: true,
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true,
            },
          },
          (decodedText) => {
            if (scanHandledRef.current || stopRequestedRef.current) {
              return;
            }

            scanHandledRef.current = true;
            handleLookup(decodedText, 'camera');
            handleStopCamera();
          },
          () => {}
        );

        if (!cancelled && !stopRequestedRef.current) {
          await scanner.applyVideoConstraints({
            facingMode: 'environment',
          }).catch(async () => {
            try {
              await cleanupCamera();
              const fallbackScanner = new Html5Qrcode('camera-reader');
              scannerRef.current = fallbackScanner;
              await fallbackScanner.start(
                preferredCamera,
                {
                  fps: 10,
                  disableFlip: false,
                  rememberLastUsedCamera: true,
                  experimentalFeatures: {
                    useBarCodeDetectorIfSupported: true,
                  },
                },
                (decodedText) => {
                  if (scanHandledRef.current || stopRequestedRef.current) {
                    return;
                  }

                  scanHandledRef.current = true;
                  handleLookup(decodedText, 'camera');
                  handleStopCamera();
                },
                () => {}
              );
            } catch (fallbackError) {}
          });
        }
      } catch (error) {
        if (!cancelled) {
          forceStopCameraStream();
          setCameraError('Camera scanning failed to start. Please allow permission or choose another camera.');
          setCameraActive(false);
        }
      } finally {
        if (!cancelled) {
          setIsCameraBusy(false);
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopRequestedRef.current = true;
      cleanupCamera();
    };
  }, [cameraActive, cleanupCamera, forceStopCameraStream, handleLookup, handleStopCamera, selectedCameraId]);

  const handleInventoryFileChange = async (event) => {
    const selectedFile = event.target.files?.[0];
    setPageError('');
    setStatusMessage('');

    if (!selectedFile) {
      setSelectedFileName('No file selected');
      setSecondaryFileName('No secondary file selected');
      setPreviewRows([]);
      setImportedEntries([]);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setSheetRows([]);
      setColumnCount(0);
      setHeaderRowIndex(-1);
      setSheetHeaders([]);
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
      setSheetHeaders(parsedFile.displayHeaders);
      setProduct(null);
      setSecondaryFileName('No secondary file selected');
      setStatusMessage(`Preview ready for ${parsedFile.entries.length} imported row(s). Scan any value from the sheet to load and edit that row.`);
    } catch (error) {
      setPreviewRows([]);
      setImportedEntries([]);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setSheetRows([]);
      setSheetHeaders([]);
      setPageError('Could not read that spreadsheet. Please choose a valid .xlsx or .csv file.');
    }
  };

  const handleSecondaryFileChange = async (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      setSecondaryFileName('No secondary file selected');
      return;
    }

    if (!importedEntries.length) {
      setPageError('Import the main sheet first, then add a secondary key sheet.');
      return;
    }

    try {
      setPageError('');
      setSecondaryFileName(selectedFile.name);
      const secondaryParsed = await parseImportedInventoryFile(selectedFile);

      if (!secondaryParsed.entries.length) {
        setPageError('The secondary sheet has no readable rows.');
        return;
      }

      const secondaryHeaders = secondaryParsed.displayHeaders.map((header) => `Reference: ${header}`);
      const nextHeaders = [...sheetHeaders, ...secondaryHeaders];
      const mergedPairs = mergeSecondaryEntries(importedEntries, secondaryParsed.entries);
      const mergedEntries = mergedPairs.map(({ primaryEntry, secondaryEntry }) => {
        if (!secondaryEntry) {
          return primaryEntry;
        }

        return {
          ...primaryEntry,
          rowValues: [...primaryEntry.rowValues, ...secondaryEntry.rowValues],
        };
      });

      const nextSheetRows = sheetRows.map((row, rowIndex) => {
        const nextRow = [...row];

        if (rowIndex === headerRowIndex) {
          secondaryHeaders.forEach((header, index) => {
            nextRow[columnCount + index] = header;
          });
          return nextRow;
        }

        const mergedPair = mergedPairs.find(({ primaryEntry }) => primaryEntry.rowIndex === rowIndex);
        const referenceEntry = mergedPair?.secondaryEntry;

        if (referenceEntry) {
          referenceEntry.rowValues.forEach((value, index) => {
            nextRow[columnCount + index] = value ?? '';
          });
        }

        return nextRow;
      });

      setImportedEntries(mergedEntries);
      setSheetHeaders(nextHeaders);
      setSheetRows(nextSheetRows);
      setColumnCount(columnCount + secondaryHeaders.length);
      setProduct(null);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setStatusMessage('Secondary key sheet attached. Matching reference values now work as extra searchable keys inside the primary sheet.');
      toast.success('Secondary key sheet linked successfully.');
    } catch (error) {
      setPageError('Could not merge the secondary sheet. Make sure its row order matches the main sheet.');
    } finally {
      if (event.target) {
        event.target.value = '';
      }
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

      setStatusMessage(response.data.message || 'Inventory imported successfully. You can now scan and edit matching rows.');
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
    await handleStopCamera();
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
      setPageError('No readable code was found in that image. Try a clearer, closer photo.');
    } finally {
      if (imageScanner) {
        try {
          await imageScanner.clear();
        } catch (clearError) {}
      }

      setIsImageScanning(false);
      event.target.value = '';
    }
  };

  const handleDuplicateSelection = (entryId) => {
    setSelectedEntryId(entryId);

    const selectedEntry = duplicateOptions.find((entry) => entry.id === entryId)
      || importedEntries.find((entry) => entry.id === entryId);

    if (!selectedEntry || !product) {
      return;
    }

    setProduct((current) => buildProductFromEntry(current, selectedEntry, sheetHeaders, selectedEntry.barcode, duplicateOptions.length || 1));
    setStatusMessage(`Selected ${selectedEntry.rowLabel}. Update the row values below, then save it.`);
  };

  const handleRowValueChange = (index, value) => {
    setProduct((current) => {
      if (!current) {
        return current;
      }

      const nextRowValues = [...(current.rowValues || [])];
      nextRowValues[index] = value;
      const nextProduct = { ...current, rowValues: nextRowValues };

      if (index === current.nameColumnIndex) {
        nextProduct.name = normalizeText(value) || current.name;
      }

      if (index === current.barcodeColumnIndex) {
        nextProduct.barcode = normalizeText(value) || current.barcode;
      }

      if (index === current.quantityColumnIndex) {
        const parsedQuantity = parseQuantityValue(value);

        if (parsedQuantity !== null) {
          nextProduct.actual_stock = parsedQuantity;
          nextProduct.difference = parsedQuantity - Number(current.expected_stock || 0);
        }
      }

      return nextProduct;
    });
  };

  const handleSave = async () => {
    if (!product) {
      setPageError('Scan or search for a row first.');
      return;
    }

    const activeEntry = selectedEntryId ? importedEntries.find((entry) => entry.id === selectedEntryId) : null;
    const quantityIndex = Number.isInteger(product.quantityColumnIndex) ? product.quantityColumnIndex : -1;
    const parsedQuantity = quantityIndex >= 0 ? parseQuantityValue(product.rowValues?.[quantityIndex]) : null;
    const quantityIsValid = quantityIndex < 0 || (Number.isInteger(parsedQuantity) && parsedQuantity >= 0);
    const syncBarcode = normalizeText(activeEntry?.barcode || product.barcode);

    if (!quantityIsValid) {
      setPageError('The quantity column must contain a non-negative whole number before saving.');
      return;
    }

    try {
      setIsSaving(true);
      setPageError('');

      if (syncBarcode && Number.isInteger(parsedQuantity)) {
        await api.post('/update-stock', {
          barcode: syncBarcode,
          actualStock: parsedQuantity,
        }).catch(() => null);
      }

      if (activeEntry) {
        const updatedEntry = {
          ...activeEntry,
          barcode: normalizeText(product.rowValues?.[activeEntry.barcodeColumnIndex] ?? activeEntry.barcode) || activeEntry.barcode,
          name: normalizeText(product.rowValues?.[activeEntry.nameColumnIndex] ?? activeEntry.name) || activeEntry.name,
          rowValues: [...(product.rowValues || activeEntry.rowValues)],
          updatedQuantity: Number.isInteger(parsedQuantity) ? parsedQuantity : activeEntry.updatedQuantity,
          isEdited: true,
        };

        const quantityText = Number.isInteger(parsedQuantity) ? ` | Qty ${parsedQuantity}` : '';
        updatedEntry.rowLabel = `Row ${updatedEntry.rowIndex + 1} | ${updatedEntry.name}${quantityText}`;

        setImportedEntries((previous) => previous.map((entry) => (
          entry.id === updatedEntry.id ? updatedEntry : entry
        )));
      }

      setProduct(null);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setBarcodeInput('');
      setStatusMessage('Row updated successfully. Scan the next value from your sheet.');
      focusBarcodeInput();
      toast.success('Row updated successfully. Ready for the next scan.');
    } catch (error) {
      setPageError(error.userMessage || 'Failed to save this row.');
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
      const hasAnyUpdates = importedEntries.some((entry) => entry.isEdited || entry.updatedQuantity !== null);
      const updatedQuantityColumnIndex = columnCount;
      const updatedEntryColumnIndex = columnCount + 1;
      const exportRows = sheetRows.map((row) => [...row]);

      importedEntries.forEach((entry) => {
        if (!exportRows[entry.rowIndex]) {
          return;
        }

        entry.rowValues.forEach((value, index) => {
          exportRows[entry.rowIndex][index] = value ?? '';
        });
      });

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
        if (!exportRows[entry.rowIndex]) {
          return;
        }

        if (entry.updatedQuantity !== null && entry.updatedQuantity !== undefined) {
          exportRows[entry.rowIndex][updatedQuantityColumnIndex] = entry.updatedQuantity;
        }

        if (entry.isEdited || entry.updatedQuantity !== null) {
          exportRows[entry.rowIndex][updatedEntryColumnIndex] = entry.updatedQuantity !== null
            ? `Saved row update, quantity ${entry.updatedQuantity}`
            : 'Saved row update';
        }
      });

      const workbook = utils.book_new();
      const worksheet = utils.aoa_to_sheet(exportRows);
      utils.book_append_sheet(workbook, worksheet, sheetName || 'Updated Inventory');
      writeFile(
        workbook,
        `${selectedFileName.replace(/\.(xlsx|csv)$/i, '') || 'checkmate-inventory'}-updated.xlsx`
      );
      toast.success('Downloaded the imported sheet with all updated rows preserved.');
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
            <span className="eyebrow">Portable scan workflow</span>
            <h2>Import - Scan - Edit row - Download</h2>
            <p>Scan any matching value from the imported sheet, update the row, and keep the original file structure intact.</p>
          </div>
          <button type="button" className="secondary-btn" onClick={handleDownload} disabled={isExporting}>
            {isExporting ? 'Preparing file...' : 'Download updated Excel'}
          </button>
        </div>

        <div className="workflow-steps">
          <div className="workflow-step"><span>1</span><strong>Import sheet</strong></div>
          <div className="workflow-step"><span>2</span><strong>Scan any value</strong></div>
          <div className="workflow-step"><span>3</span><strong>Edit columns</strong></div>
          <div className="workflow-step"><span>4</span><strong>Export file</strong></div>
        </div>

        {pageError ? <div className="warning-banner">{pageError}</div> : null}
        {statusMessage ? <div className="success-banner">{statusMessage}</div> : null}
      </section>

      <section className="scanner-grid">
        <div className="panel">
          <div className="section-header">
            <div>
              <h2>Step 1 and 2</h2>
              <p>Import a sheet, then scan through camera, image, external scanner, or manual search.</p>
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
            <div className="upload-icon-badge">+</div>
            <div className="import-inline-content">
              <h3>Import stock sheet</h3>
              <p>Any Excel or CSV file with a code column works. After import, scans can match barcode, SKU, batch, stock number, name, location, or combined values like batch&gt;stock.</p>
              <p className="helper-text">Drag and drop your sheet here, or choose the file manually.</p>
              <div className="button-row">
                <button type="button" className="primary-btn" onClick={() => fileInputRef.current?.click()}>
                  Choose Excel / CSV
                </button>
                <button type="button" className="secondary-btn" onClick={() => secondaryFileInputRef.current?.click()} disabled={!importedEntries.length}>
                  Add secondary key sheet
                </button>
                <button type="button" className="secondary-btn" onClick={handleInventoryUpload} disabled={isUploading}>
                  {isUploading ? 'Importing...' : 'Import now'}
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv" hidden onChange={handleInventoryFileChange} />
              <input ref={secondaryFileInputRef} type="file" accept=".xlsx,.csv" hidden onChange={handleSecondaryFileChange} />
              <div className="upload-meta">
                <span><strong>Selected file:</strong> {selectedFileName}</span>
                <span><strong>Secondary keys:</strong> {secondaryFileName}</span>
                <span><strong>Imported rows:</strong> {importedEntries.length || previewRows.length}</span>
              </div>
            </div>
          </div>

          <div className="method-list">
            <div className="method-card">
              <h4>Camera scanner</h4>
              <p>Uses the simpler live scan flow again, with rear-camera preference and forced shutdown when you stop it.</p>
              <div className="button-row">
                <button type="button" className="primary-btn" onClick={handleStartCamera} disabled={cameraActive || isCameraBusy}>
                  {isCameraBusy && !cameraActive ? 'Starting...' : 'Start camera'}
                </button>
                <button type="button" className="secondary-btn" onClick={handleStopCamera} disabled={!cameraActive && !isCameraBusy}>
                  {isCameraBusy && cameraActive ? 'Stopping...' : 'Stop'}
                </button>
              </div>
              {availableCameras.length > 1 ? (
                <label className="camera-select">
                  <span>Camera</span>
                  <select value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
                    {availableCameras.map((camera) => (
                      <option key={camera.id} value={camera.id}>
                        {camera.label || `Camera ${camera.id}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="method-card">
              <h4>Barcode image</h4>
              <p>Upload a barcode image or screenshot and let CheckMate decode it.</p>
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
              <h4>External scanner</h4>
              <p>USB and Bluetooth scanners are captured automatically, even while the scan field is focused.</p>
            </div>

            <div className="method-card">
              <h4>Manual search</h4>
              <p>Type any value from the imported sheet to find a row, not just the barcode. You can also use combined scans like <strong>batch123&gt;stock789</strong>.</p>
              <form
                className="barcode-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleLookup(barcodeInput, 'manual entry');
                }}
              >
                <input
                  ref={barcodeInputRef}
                  data-scanner-allow="true"
                  type="text"
                  placeholder="Enter barcode, batch>stock, SKU, name, or location"
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                />
                <button type="submit" className="primary-btn">
                  Search
                </button>
              </form>
            </div>
          </div>

          <div className={`camera-shell ${cameraActive || isCameraBusy ? '' : 'camera-shell-hidden'}`}>
              <div className="camera-frame">
                <div id="camera-reader" className="camera-reader" />
                <div className="camera-target" aria-hidden="true" />
              </div>
              <p className="helper-text">Move the code slowly inside the full guide area. Use the rear camera and keep the label flat and well lit.</p>
          </div>
          <div id="image-reader" className="sr-only" />
          {cameraError ? <p className="error-text">{cameraError}</p> : null}
        </div>

        <ProductCard
          product={product}
          rowHeaders={product?.rowHeaders || sheetHeaders}
          onRowValueChange={handleRowValueChange}
          onSubmit={handleSave}
          isSaving={isSaving}
          duplicateOptions={duplicateOptions}
          selectedEntryId={selectedEntryId}
          onSelectEntry={handleDuplicateSelection}
        />
      </section>

      {isLoading ? <Loader label="Looking up the scanned value..." /> : null}

      {previewRows.length ? (
        <section className="panel">
          <div className="section-header">
            <div>
              <h3>Imported preview</h3>
              <p>Quick check of the first rows from the selected sheet before and during scanning.</p>
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
            <p>Latest scan events across camera, image upload, external scanner, and manual search.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Value</th>
                <th>Matched row</th>
                <th>Matched by</th>
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
                    <td>{scan.matchedBy}</td>
                    <td>{scan.source}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5">No scans yet. Import a file, then scan a barcode or any other matching sheet value to begin.</td>
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
