const XLSX = require('xlsx');

const productModel = require('../models/productModel');

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
    && (/^\d{6,}$/.test(normalized) || (/[A-Za-z]/.test(normalized) && /\d/.test(normalized)));
}

function parseQuantityValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  let normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (looksLikeBarcode(normalized) && !/[\s.,()]/.test(normalized)) {
    return null;
  }

  normalized = normalized.replace(/,/g, '');
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

function getFallbackBarcode(values) {
  return values.find((value) => looksLikeBarcode(value));
}

function getFallbackName(values, barcode) {
  return values.find((value) => {
    const normalized = normalizeText(value);
    return normalized && normalized !== barcode && parseQuantityValue(normalized) === null && !looksLikeBarcode(normalized);
  });
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
  const dataRows = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
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

  return { dataRows, barcodeIndex, nameIndex, quantityIndex };
}

function normalizeRows(rows) {
  const filteredRows = (rows || []).filter((row) => Array.isArray(row) && row.some((cell) => isMeaningful(cell)));

  if (!filteredRows.length) {
    return [];
  }

  const headerIndex = detectHeaderRow(filteredRows);
  const { dataRows, barcodeIndex, nameIndex, quantityIndex } = detectColumns(filteredRows, headerIndex);

  return dataRows
    .map((row) => {
      const values = row.map((cell) => normalizeText(cell));
      const barcodeValue = barcodeIndex >= 0 ? values[barcodeIndex] : getFallbackBarcode(values);
      const barcode = normalizeText(barcodeValue);

      if (!barcode) {
        return null;
      }

      const nameValue = nameIndex >= 0 ? values[nameIndex] : getFallbackName(values, barcode);
      let parsedQuantity = quantityIndex >= 0 ? parseQuantityValue(values[quantityIndex]) : null;

      if (parsedQuantity === null) {
        parsedQuantity = values.find((value, index) => index !== barcodeIndex && parseQuantityValue(value) !== null);
        parsedQuantity = parseQuantityValue(parsedQuantity);
      }

      return {
        name: normalizeText(nameValue || `Item ${barcode}`),
        barcode,
        expected_stock: parsedQuantity ?? 0,
        quantity_provided: parsedQuantity !== null,
      };
    })
    .filter(Boolean);
}

async function uploadInventory(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a .xlsx or .csv file.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const [firstSheetName] = workbook.SheetNames;
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });
    const normalizedRows = normalizeRows(rows);

    if (!normalizedRows.length) {
      return res.status(400).json({
        message: 'No valid rows were found. Include a barcode/code/SKU column and quantity if available.',
      });
    }

    const saved = await productModel.upsertProducts(req.user.id, normalizedRows);

    return res.status(201).json({
      message: `${saved.length} products imported successfully.`,
      count: saved.length,
      preview: saved.slice(0, 10),
    });
  } catch (error) {
    return next(error);
  }
}

async function getProduct(req, res, next) {
  try {
    const { barcode } = req.params;

    if (!barcode) {
      return res.status(400).json({ message: 'Barcode is required.' });
    }

    const product = await productModel.getProductByBarcode(req.user.id, barcode);

    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.json(product);
  } catch (error) {
    return next(error);
  }
}

async function updateStock(req, res, next) {
  try {
    const { barcode, actualStock } = req.body;

    if (!barcode || barcode.trim().length < 3) {
      return res.status(400).json({ message: 'A valid barcode is required.' });
    }

    const stockValue = Number(actualStock);

    if (!Number.isInteger(stockValue) || stockValue < 0) {
      return res.status(400).json({ message: 'actualStock must be a non-negative integer.' });
    }

    const product = await productModel.updateProductStock({
      userId: req.user.id,
      barcode: String(barcode).trim(),
      actualStock: stockValue,
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.json({
      message: 'Stock updated successfully.',
      product,
    });
  } catch (error) {
    return next(error);
  }
}

async function getLogs(req, res, next) {
  try {
    const limit = Number(req.query.limit || 100);
    const logs = await productModel.getLogs(req.user.id, Number.isFinite(limit) ? limit : 100);
    return res.json(logs);
  } catch (error) {
    return next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    const summary = await productModel.getDashboardSummary(req.user.id);
    return res.json(summary);
  } catch (error) {
    return next(error);
  }
}

async function listProducts(req, res, next) {
  try {
    const products = await productModel.getAllProducts(req.user.id);
    return res.json(products);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  uploadInventory,
  getProduct,
  updateStock,
  getLogs,
  getDashboard,
  listProducts,
};
