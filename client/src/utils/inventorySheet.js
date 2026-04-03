export function normalizeText(value) {
  return String(value ?? '').trim();
}

export function normalizeToken(value) {
  return normalizeText(value).toUpperCase();
}

function formatHeaderLabel(header) {
  return normalizeText(header).replace(/\s+/g, ' ');
}

export function isMeaningful(value) {
  return normalizeText(value) !== '';
}

export function looksLikeBarcode(value) {
  const normalized = normalizeText(value).replace(/\s+/g, '');

  if (!normalized || normalized.length < 4) {
    return false;
  }

  return /^[A-Z0-9-]+$/i.test(normalized)
    && (/^\d{4,}$/.test(normalized) || (/[A-Za-z]/.test(normalized) && /\d/.test(normalized)));
}

export function parseQuantityValue(value) {
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

const ENTITY_HEADER_PATTERNS = [
  /(stock\s*no|stock\s*number|stock|material\s*code|item\s*code|product\s*code|sku|code|barcode|ean|upc)/i,
  /(batch|lot|serial|reference|ref|part)/i,
  /(location|rack|bin|shelf|aisle|zone|position)/i,
  /(name|item|product|description|title)/i,
];

function getPriorityDisplayIndexes(headers, quantityIndex) {
  const prioritized = [];

  ENTITY_HEADER_PATTERNS.forEach((pattern) => {
    const matchIndex = headers.findIndex((header, index) => (
      index !== quantityIndex && pattern.test(formatHeaderLabel(header))
    ));

    if (matchIndex >= 0 && !prioritized.includes(matchIndex)) {
      prioritized.push(matchIndex);
    }
  });

  headers.forEach((header, index) => {
    if (index === quantityIndex || prioritized.includes(index)) {
      return;
    }

    const value = formatHeaderLabel(header);

    if (value) {
      prioritized.push(index);
    }
  });

  return prioritized;
}

export function createEntryLabel(entry, headers = []) {
  const resolvedQuantity = Number.isFinite(Number(entry.updatedQuantity))
    ? Number(entry.updatedQuantity)
    : Number.isFinite(Number(entry.importedQuantity))
      ? Number(entry.importedQuantity)
      : (
        Number.isInteger(entry.quantityColumnIndex)
          ? parseQuantityValue(entry.rowValues?.[entry.quantityColumnIndex])
          : null
      );
  const quantityText = Number.isFinite(Number(resolvedQuantity)) ? `Qty ${Number(resolvedQuantity)}` : '';
  const displayParts = [];
  const priorityIndexes = getPriorityDisplayIndexes(headers, entry.quantityColumnIndex);

  priorityIndexes.forEach((index) => {
    const value = normalizeText(entry.rowValues?.[index]);
    const header = formatHeaderLabel(headers[index] || `Column ${index + 1}`);

    if (!value) {
      return;
    }

    const normalizedPart = `${header} ${value}`;

    if (!displayParts.some((part) => part.toUpperCase() === normalizedPart.toUpperCase())) {
      displayParts.push(normalizedPart);
    }
  });

  if (!displayParts.length && entry.name) {
    displayParts.push(entry.name);
  }

  const coreLabel = displayParts.slice(0, 2).join(' | ') || `Entry ${entry.rowIndex + 1}`;
  return quantityText ? `${coreLabel} | ${quantityText}` : coreLabel;
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

function getFallbackPrimaryToken(values) {
  return values.find((value) => normalizeText(value));
}

function getComparableTokens(entry) {
  const tokens = new Set();

  if (entry.barcode) {
    tokens.add(normalizeToken(entry.barcode));
  }

  (entry.rowValues || []).forEach((value) => {
    const token = normalizeToken(value);

    if (token) {
      tokens.add(token);
    }
  });

  return [...tokens];
}

function scoreEntryMatch(primaryEntry, secondaryEntry) {
  const primaryTokens = getComparableTokens(primaryEntry);
  const secondaryTokens = getComparableTokens(secondaryEntry);
  let score = 0;

  primaryTokens.forEach((primaryToken) => {
    secondaryTokens.forEach((secondaryToken) => {
      if (primaryToken === secondaryToken) {
        score += 100;
      } else if (primaryToken.includes(secondaryToken) || secondaryToken.includes(primaryToken)) {
        score += 20;
      }
    });
  });

  return score;
}

export function mergeSecondaryEntries(primaryEntries, secondaryEntries) {
  const secondaryPool = [...secondaryEntries];

  return primaryEntries.map((primaryEntry) => {
    let bestIndex = -1;
    let bestScore = 0;

    secondaryPool.forEach((secondaryEntry, index) => {
      const score = scoreEntryMatch(primaryEntry, secondaryEntry);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex === -1) {
      return { primaryEntry, secondaryEntry: null };
    }

    const [matchedSecondary] = secondaryPool.splice(bestIndex, 1);
    return { primaryEntry, secondaryEntry: matchedSecondary };
  });
}

export function findImportedMatches(entries, query) {
  const rawQuery = normalizeText(query);
  const token = normalizeToken(rawQuery);

  if (!rawQuery || !token) {
    return [];
  }

  const tokens = rawQuery
    .split(/\s*(?:>|\||,|;|\/{1,2})\s*/)
    .map((part) => normalizeToken(part))
    .filter(Boolean);

  if (tokens.length > 1) {
    return entries
      .map((entry) => {
        const entryTokens = entry.rowValues.map((value) => normalizeToken(value));
        const exactMatches = tokens.filter((part) => (
          normalizeToken(entry.barcode) === part || entryTokens.some((value) => value === part)
        ));
        const containsMatches = tokens.filter((part) => (
          !exactMatches.includes(part) && entryTokens.some((value) => value.includes(part))
        ));

        if (!exactMatches.length && !containsMatches.length) {
          return null;
        }

        return {
          entry,
          score: (exactMatches.length * 100) + (containsMatches.length * 10),
          matchedCount: exactMatches.length + containsMatches.length,
        };
      })
      .filter(Boolean)
      .filter((result) => result.matchedCount === tokens.length)
      .sort((left, right) => right.score - left.score || left.entry.rowIndex - right.entry.rowIndex)
      .map((result) => result.entry);
  }

  const exactBarcode = [];
  const exactCell = [];
  const containsCell = [];
  const seen = new Set();

  entries.forEach((entry) => {
    if (normalizeToken(entry.barcode) === token) {
      if (!seen.has(entry.id)) {
        exactBarcode.push(entry);
        seen.add(entry.id);
      }
      return;
    }

    const exactIndex = entry.rowValues.findIndex((value) => normalizeToken(value) === token);

    if (exactIndex >= 0) {
      if (!seen.has(entry.id)) {
        exactCell.push(entry);
        seen.add(entry.id);
      }
      return;
    }

    const containsIndex = entry.rowValues.findIndex((value) => normalizeToken(value).includes(token));

    if (containsIndex >= 0 && !seen.has(entry.id)) {
      containsCell.push(entry);
      seen.add(entry.id);
    }
  });

  return [...exactBarcode, ...exactCell, ...containsCell];
}

export function getMatchLabel(entry, query, headers) {
  const rawQuery = normalizeText(query);
  const token = normalizeToken(rawQuery);

  const parts = rawQuery
    .split(/\s*(?:>|\||,|;|\/{1,2})\s*/)
    .map((part) => normalizeToken(part))
    .filter(Boolean);

  if (parts.length > 1) {
    const matchedLabels = parts.map((part) => {
      if (normalizeToken(entry.barcode) === part) {
        return 'Barcode / code';
      }

      const exactIndex = entry.rowValues.findIndex((value) => normalizeToken(value) === part);

      if (exactIndex >= 0) {
        return headers[exactIndex] || `Column ${exactIndex + 1}`;
      }

      const containsIndex = entry.rowValues.findIndex((value) => normalizeToken(value).includes(part));
      return containsIndex >= 0 ? headers[containsIndex] || `Column ${containsIndex + 1}` : null;
    }).filter(Boolean);

    return matchedLabels.length ? `Combined match: ${matchedLabels.join(' + ')}` : 'Combined sheet match';
  }

  if (normalizeToken(entry.barcode) === token) {
    return 'Barcode / code';
  }

  const exactIndex = entry.rowValues.findIndex((value) => normalizeToken(value) === token);

  if (exactIndex >= 0) {
    return headers[exactIndex] || `Column ${exactIndex + 1}`;
  }

  const containsIndex = entry.rowValues.findIndex((value) => normalizeToken(value).includes(token));

  if (containsIndex >= 0) {
    return `${headers[containsIndex] || `Column ${containsIndex + 1}`} contains "${normalizeText(query)}"`;
  }

  return 'Imported sheet match';
}

export function createFallbackProduct(baseProduct) {
  return {
    ...baseProduct,
    rowValues: [
      baseProduct.name || '',
      baseProduct.barcode || '',
      String(baseProduct.expected_stock ?? 0),
      String(baseProduct.actual_stock ?? baseProduct.expected_stock ?? 0),
    ],
    rowHeaders: ['Name', 'Barcode', 'Expected Quantity', 'Actual Quantity'],
    quantityColumnIndex: 3,
    barcodeColumnIndex: 1,
    nameColumnIndex: 0,
    rowLabel: 'Backend record',
    matchLabel: 'Database lookup',
  };
}

export function buildProductFromEntry(baseProduct, entry, headers, matchedQuery, duplicateCount = 0) {
  const parsedEntryQuantity = Number.isInteger(entry.quantityColumnIndex)
    ? parseQuantityValue(entry.rowValues?.[entry.quantityColumnIndex])
    : null;
  const originalQuantity = Number.isFinite(Number(entry.importedQuantity))
    ? Number(entry.importedQuantity)
    : Number.isFinite(Number(parsedEntryQuantity))
      ? Number(parsedEntryQuantity)
      : Number(baseProduct.expected_stock ?? 0);
  const currentQuantity = Number.isFinite(Number(entry.updatedQuantity))
    ? Number(entry.updatedQuantity)
    : originalQuantity;

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
    rowValues: [...entry.rowValues],
    rowHeaders: headers,
    quantityColumnIndex: entry.quantityColumnIndex,
    barcodeColumnIndex: entry.barcodeColumnIndex,
    nameColumnIndex: entry.nameColumnIndex,
    matchLabel: getMatchLabel(entry, matchedQuery, headers),
  };
}

export async function parseImportedInventoryFile(file) {
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
      displayHeaders: [],
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
      const barcode = normalizeText(barcodeValue || getFallbackPrimaryToken(rowValues));

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
      const entry = {
        id: `${file.name}-${rowIndex}-${barcode}`,
        rowIndex,
        barcode,
        name: itemName,
        rowValues: [...rowValues],
        importedQuantity: parsedQuantity,
        updatedQuantity: null,
        quantityColumnIndex: resolvedQuantityIndex,
        barcodeColumnIndex: barcodeIndex >= 0 ? barcodeIndex : rowValues.findIndex((value) => normalizeText(value) === barcode),
        nameColumnIndex: nameIndex,
        rowLabel: '',
        isEdited: false,
      };

      entry.rowLabel = createEntryLabel(entry, displayHeaders);
      return entry;
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
    displayHeaders,
    previewRows,
    entries,
    headerRowIndex,
    columnCount,
  };
}
