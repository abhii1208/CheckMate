import { createContext, useContext, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import api from './api';
import {
  buildProductFromEntry,
  createEntryLabel,
  createFallbackProduct,
  findImportedMatches,
  mergeSecondaryEntries,
  normalizeText,
  parseImportedInventoryFile,
  parseQuantityValue,
} from './utils/inventorySheet';

const WorkflowContext = createContext(null);

export function WorkflowProvider({ children }) {
  const [product, setProduct] = useState(null);
  const [pageError, setPageError] = useState('');
  const [statusMessage, setStatusMessage] = useState('Import your sheet to begin the workflow.');
  const [selectedFileName, setSelectedFileName] = useState('No file selected');
  const [secondaryFileName, setSecondaryFileName] = useState('No secondary file selected');
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
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const resetWorkflow = () => {
    setProduct(null);
    setPageError('');
    setStatusMessage('Import your sheet to begin the workflow.');
    setSelectedFileName('No file selected');
    setSecondaryFileName('No secondary file selected');
    setPreviewRows([]);
    setRecentScans([]);
    setImportedEntries([]);
    setDuplicateOptions([]);
    setSelectedEntryId('');
    setSheetRows([]);
    setSheetName('Updated Inventory');
    setHeaderRowIndex(-1);
    setColumnCount(0);
    setSheetHeaders([]);
  };

  const importPrimaryFile = async (file) => {
    setPageError('');

    if (!file) {
      resetWorkflow();
      return false;
    }

    setSelectedFileName(file.name);

    try {
      const parsedFile = await parseImportedInventoryFile(file);

      if (!parsedFile.entries.length) {
        setPreviewRows([]);
        setImportedEntries([]);
        setPageError('The selected sheet is empty or has no readable rows.');
        return false;
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
      setStatusMessage(`Imported ${parsedFile.entries.length} entries. Continue to Scan & Filter.`);
      return true;
    } catch (error) {
      setPageError('Could not read that spreadsheet. Please choose a valid .xlsx or .csv file.');
      return false;
    }
  };

  const importSecondaryFile = async (file) => {
    if (!file) {
      setSecondaryFileName('No secondary file selected');
      return false;
    }

    if (!importedEntries.length) {
      setPageError('Import the main sheet first, then add the secondary key sheet.');
      return false;
    }

    try {
      setPageError('');
      setSecondaryFileName(file.name);
      const secondaryParsed = await parseImportedInventoryFile(file);

      if (!secondaryParsed.entries.length) {
        setPageError('The secondary sheet has no readable rows.');
        return false;
      }

      const secondaryHeaders = secondaryParsed.displayHeaders.map((header) => `Reference: ${header}`);
      const nextHeaders = [...sheetHeaders, ...secondaryHeaders];
      const mergedPairs = mergeSecondaryEntries(importedEntries, secondaryParsed.entries);
      const mergedEntries = mergedPairs.map(({ primaryEntry, secondaryEntry }) => (
        secondaryEntry
          ? { ...primaryEntry, rowValues: [...primaryEntry.rowValues, ...secondaryEntry.rowValues] }
          : { ...primaryEntry }
      )).map((entry) => ({
        ...entry,
        rowLabel: createEntryLabel(entry, nextHeaders),
      }));

      const nextSheetRows = sheetRows.map((row, rowIndex) => {
        const nextRow = [...row];

        if (rowIndex === headerRowIndex) {
          secondaryHeaders.forEach((header, index) => {
            nextRow[columnCount + index] = header;
          });
          return nextRow;
        }

        const pair = mergedPairs.find(({ primaryEntry }) => primaryEntry.rowIndex === rowIndex);
        if (pair?.secondaryEntry) {
          pair.secondaryEntry.rowValues.forEach((value, index) => {
            nextRow[columnCount + index] = value ?? '';
          });
        }

        return nextRow;
      });

      setImportedEntries(mergedEntries);
      setSheetHeaders(nextHeaders);
      setSheetRows(nextSheetRows);
      setColumnCount((current) => current + secondaryHeaders.length);
      setProduct(null);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setStatusMessage('Secondary key sheet attached. Extra reference fields are now searchable.');
      toast.success('Secondary key sheet linked successfully.');
      return true;
    } catch (error) {
      setPageError('Could not merge the secondary sheet. Try using a sheet that shares common values with the main file.');
      return false;
    }
  };

  const uploadPrimaryToServer = async (file) => {
    if (!file) {
      setPageError('Select an Excel or CSV file first.');
      return false;
    }

    try {
      setIsUploading(true);
      setPageError('');
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setStatusMessage(response.data.message || 'Inventory imported successfully.');
      toast.success(response.data.message || 'Inventory imported successfully.');
      return true;
    } catch (error) {
      setPageError(error.userMessage || 'Import failed.');
      return false;
    } finally {
      setIsUploading(false);
    }
  };

  const lookupValue = async (rawValue, source = 'manual') => {
    const query = normalizeText(rawValue);

    if (!query) {
      return null;
    }

    setPageError('');

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
            backendProduct = null;
          }
        }

        const resolvedProduct = buildProductFromEntry(
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

        setProduct(resolvedProduct);
        setDuplicateOptions(matches);
        setSelectedEntryId(preferredMatch.id);
        setStatusMessage(matches.length > 1
          ? `Found ${matches.length} possible matches. Narrow the scan or choose the exact entry.`
          : 'Exact entry loaded. Continue to Update.');
        setRecentScans((previous) => [
          {
            barcode: query,
            name: resolvedProduct.name,
            source,
            matchedBy: resolvedProduct.matchLabel,
            time: new Date().toLocaleTimeString(),
          },
          ...previous,
        ].slice(0, 8));
        return resolvedProduct;
      }

      const response = await api.get(`/product/${encodeURIComponent(query)}`);
      const fallbackProduct = createFallbackProduct(response.data);
      setProduct(fallbackProduct);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setStatusMessage('Backend product loaded. Continue to Update.');
      return fallbackProduct;
    } catch (error) {
      setProduct(null);
      setDuplicateOptions([]);
      setSelectedEntryId('');
      setPageError(error.userMessage || 'No matching entry or backend product was found.');
      return null;
    }
  };

  const selectDuplicateEntry = (entryId) => {
    setSelectedEntryId(entryId);
    const selectedEntry = duplicateOptions.find((entry) => entry.id === entryId)
      || importedEntries.find((entry) => entry.id === entryId);

    if (!selectedEntry || !product) {
      return;
    }

    setProduct((current) => buildProductFromEntry(current, selectedEntry, sheetHeaders, selectedEntry.barcode, duplicateOptions.length || 1));
    setStatusMessage(`Selected ${selectedEntry.rowLabel}. Continue to Update.`);
  };

  const updateProductRowValue = (index, value) => {
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

  const loadEntryForUpdate = (entry) => {
    if (!entry) {
      return null;
    }

    const nextProduct = buildProductFromEntry(
      createFallbackProduct({
        name: entry.name,
        barcode: entry.barcode,
        expected_stock: entry.importedQuantity,
        actual_stock: entry.updatedQuantity ?? entry.importedQuantity,
      }),
      entry,
      sheetHeaders,
      entry.barcode,
      1
    );

    setProduct(nextProduct);
    setDuplicateOptions([entry]);
    setSelectedEntryId(entry.id);
    return nextProduct;
  };

  const moveToNextPendingEntry = () => {
    const currentIndex = importedEntries.findIndex((entry) => entry.id === selectedEntryId);
    const nextEntry = importedEntries.slice(currentIndex + 1).find((entry) => !entry.isEdited && entry.updatedQuantity === null)
      || importedEntries.find((entry) => !entry.isEdited && entry.updatedQuantity === null);

    if (!nextEntry) {
      setStatusMessage('All updates in the current workflow are complete. You can now finish and export.');
      return null;
    }

      setStatusMessage(`Loaded next entry: ${nextEntry.rowLabel}`);
      return loadEntryForUpdate(nextEntry);
  };

  const saveSelectedRow = async () => {
    if (!product) {
      setPageError('Select an entry to update first.');
      return false;
    }

    const activeEntry = selectedEntryId ? importedEntries.find((entry) => entry.id === selectedEntryId) : null;
    const quantityIndex = Number.isInteger(product.quantityColumnIndex) ? product.quantityColumnIndex : -1;
    const parsedQuantity = quantityIndex >= 0 ? parseQuantityValue(product.rowValues?.[quantityIndex]) : null;
    const quantityIsValid = quantityIndex < 0 || (Number.isInteger(parsedQuantity) && parsedQuantity >= 0);
    const syncBarcode = normalizeText(activeEntry?.barcode || product.barcode);

    if (!quantityIsValid) {
      setPageError('The quantity field must be a non-negative whole number.');
      return false;
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

        updatedEntry.rowLabel = createEntryLabel(updatedEntry, sheetHeaders);

        setImportedEntries((previous) => previous.map((entry) => (
          entry.id === updatedEntry.id ? updatedEntry : entry
        )));
      }

      setStatusMessage('Entry updated successfully. Continue scanning or go to Export.');
      toast.success('Entry updated successfully.');
      return true;
    } catch (error) {
      setPageError(error.userMessage || 'Failed to save this entry.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const exportUpdatedSheet = async () => {
    try {
      setIsExporting(true);
      setPageError('');

      if (!importedEntries.length || !sheetRows.length) {
        setPageError('Import a sheet first so the download can keep the same order.');
        return false;
      }

      const { utils, writeFile } = await import('xlsx');
      const hasAnyUpdates = importedEntries.some((entry) => entry.isEdited || entry.updatedQuantity !== null);
      const updatedQuantityColumnIndex = columnCount;
      const updatedEntryColumnIndex = columnCount + 1;
      const changedColumnsColumnIndex = columnCount + 2;
      const matchedByColumnIndex = columnCount + 3;
      const updatedAtColumnIndex = columnCount + 4;
      const exportRows = sheetRows.map((row) => [...row]);
      const changeLogRows = [[
        'Imported Entry',
        'Primary Barcode',
        'Updated Quantity',
        'Changed Columns',
        'Matched By',
        'Updated At',
      ]];

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
            row[changedColumnsColumnIndex] = 'Changed Columns';
            row[matchedByColumnIndex] = 'Matched By';
            row[updatedAtColumnIndex] = 'Updated At';
          } else {
            row[updatedQuantityColumnIndex] = row[updatedQuantityColumnIndex] ?? '';
            row[updatedEntryColumnIndex] = '';
            row[changedColumnsColumnIndex] = '';
            row[matchedByColumnIndex] = '';
            row[updatedAtColumnIndex] = '';
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
          const changedColumns = (entry.rowValues || []).reduce((list, value, index) => {
            const originalValue = sheetRows[entry.rowIndex]?.[index] ?? '';

            if (String(originalValue ?? '') !== String(value ?? '')) {
              list.push(sheetHeaders[index] || `Column ${index + 1}`);
            }

            return list;
          }, []);

          exportRows[entry.rowIndex][updatedEntryColumnIndex] = entry.updatedQuantity !== null
            ? `Saved entry update, quantity ${entry.updatedQuantity}`
            : 'Saved entry update';
          exportRows[entry.rowIndex][changedColumnsColumnIndex] = changedColumns.join(', ');
          exportRows[entry.rowIndex][matchedByColumnIndex] = entry.barcode || entry.name || '';
          exportRows[entry.rowIndex][updatedAtColumnIndex] = new Date().toISOString();

          changeLogRows.push([
            entry.rowLabel,
            entry.barcode || '',
            entry.updatedQuantity ?? '',
            changedColumns.join(', '),
            entry.barcode || entry.name || '',
            exportRows[entry.rowIndex][updatedAtColumnIndex],
          ]);
        }
      });

      const workbook = utils.book_new();
      const worksheet = utils.aoa_to_sheet(exportRows);
      utils.book_append_sheet(workbook, worksheet, sheetName || 'Updated Inventory');

      if (changeLogRows.length > 1) {
        const changeLogSheet = utils.aoa_to_sheet(changeLogRows);
        utils.book_append_sheet(workbook, changeLogSheet, 'CheckMate Changes');
      }

      writeFile(workbook, `${selectedFileName.replace(/\.(xlsx|csv)$/i, '') || 'checkmate-inventory'}-updated.xlsx`);
      toast.success('Updated sheet downloaded successfully.');
      return true;
    } catch (error) {
      setPageError(error.userMessage || 'Failed to generate the downloadable sheet.');
      return false;
    } finally {
      setIsExporting(false);
    }
  };

  const value = useMemo(() => ({
    product,
    setProduct,
    pageError,
    setPageError,
    statusMessage,
    setStatusMessage,
    selectedFileName,
    secondaryFileName,
    previewRows,
    recentScans,
    importedEntries,
    duplicateOptions,
    selectedEntryId,
    sheetRows,
    sheetName,
    headerRowIndex,
    columnCount,
    sheetHeaders,
    isUploading,
    isSaving,
    isExporting,
    importPrimaryFile,
    importSecondaryFile,
    uploadPrimaryToServer,
    lookupValue,
    selectDuplicateEntry,
    updateProductRowValue,
    loadEntryForUpdate,
    moveToNextPendingEntry,
    saveSelectedRow,
    exportUpdatedSheet,
    resetWorkflow,
  }), [
    product, pageError, statusMessage, selectedFileName, secondaryFileName, previewRows, recentScans,
    importedEntries, duplicateOptions, selectedEntryId, sheetRows, sheetName, headerRowIndex, columnCount,
    sheetHeaders, isUploading, isSaving, isExporting,
  ]);

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

export function useWorkflow() {
  return useContext(WorkflowContext);
}
