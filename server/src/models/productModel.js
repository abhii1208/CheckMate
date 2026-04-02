const db = require('../config/db');

const memoryStore = {
  products: [],
  logs: [],
  nextProductId: 1,
  nextLogId: 1,
};

function normalizeProductRecord(product) {
  const expectedStock = Number(product.expected_stock || 0);
  const actualStock = Number(product.actual_stock || 0);
  const effectiveActualStock = !product.last_verified_at && actualStock === 0 ? expectedStock : actualStock;

  return {
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    expected_stock: expectedStock,
    actual_stock: effectiveActualStock,
    last_verified_at: product.last_verified_at,
    difference: effectiveActualStock - expectedStock,
  };
}

function formatMemoryProduct(product) {
  return normalizeProductRecord(product);
}

function getUserMemoryProducts(userId) {
  return memoryStore.products.filter((item) => Number(item.user_id) === Number(userId));
}

async function upsertProducts(userId, products) {
  if (db.isDatabaseReady()) {
    const client = await db.getPool().connect();

    try {
      await client.query('BEGIN');
      const savedProducts = [];

      for (const product of products) {
        const quantityProvided = Boolean(product.quantity_provided);
        const expectedStock = Number(product.expected_stock) || 0;
        const importedStock = quantityProvided ? expectedStock : 0;
        const query = `
          INSERT INTO products (user_id, name, barcode, expected_stock, actual_stock, updated_at)
          VALUES ($1, $2, $3, $4, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, barcode)
          DO UPDATE SET
            name = EXCLUDED.name,
            expected_stock = CASE
              WHEN $5 THEN EXCLUDED.expected_stock
              ELSE products.expected_stock
            END,
            actual_stock = CASE
              WHEN $5 AND products.last_verified_at IS NULL THEN EXCLUDED.expected_stock
              ELSE products.actual_stock
            END,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, name, barcode, expected_stock, actual_stock, last_verified_at;
        `;

        const { rows } = await client.query(query, [
          userId,
          product.name,
          product.barcode,
          importedStock,
          quantityProvided,
        ]);
        savedProducts.push(rows[0]);
      }

      await client.query('COMMIT');
      return savedProducts.map((product) => normalizeProductRecord(product));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const savedProducts = [];

  for (const product of products) {
    const quantityProvided = Boolean(product.quantity_provided);
    const expectedStock = Number(product.expected_stock) || 0;
    const importedStock = quantityProvided ? expectedStock : 0;
    const existingProduct = memoryStore.products.find(
      (item) => Number(item.user_id) === Number(userId) && item.barcode === product.barcode
    );

    if (existingProduct) {
      existingProduct.name = product.name;
      if (quantityProvided) {
        existingProduct.expected_stock = expectedStock;
        if (!existingProduct.last_verified_at) {
          existingProduct.actual_stock = expectedStock;
        }
      }
      existingProduct.updated_at = new Date().toISOString();
      savedProducts.push(formatMemoryProduct(existingProduct));
      continue;
    }

    const newProduct = {
      id: memoryStore.nextProductId++,
      user_id: Number(userId),
      name: product.name,
      barcode: product.barcode,
      expected_stock: importedStock,
      actual_stock: importedStock,
      last_verified_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    memoryStore.products.push(newProduct);
    savedProducts.push(formatMemoryProduct(newProduct));
  }

  return savedProducts;
}

async function getProductByBarcode(userId, barcode) {
  if (db.isDatabaseReady()) {
    const query = `
      SELECT
        id,
        name,
        barcode,
        expected_stock,
        actual_stock,
        last_verified_at,
        actual_stock - expected_stock AS difference
      FROM products
      WHERE user_id = $1 AND barcode = $2
      LIMIT 1;
    `;

    const { rows } = await db.query(query, [userId, barcode]);
    return rows[0] ? normalizeProductRecord(rows[0]) : null;
  }

  const product = getUserMemoryProducts(userId).find((item) => item.barcode === barcode);
  return product ? formatMemoryProduct(product) : null;
}

async function getAllProducts(userId) {
  if (db.isDatabaseReady()) {
    const query = `
      SELECT
        id,
        name,
        barcode,
        expected_stock,
        actual_stock,
        last_verified_at,
        actual_stock - expected_stock AS difference
      FROM products
      WHERE user_id = $1
      ORDER BY name ASC, id ASC;
    `;

    const { rows } = await db.query(query, [userId]);
    return rows.map((product) => normalizeProductRecord(product));
  }

  return [...getUserMemoryProducts(userId)]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((product) => formatMemoryProduct(product));
}

async function updateProductStock({ userId, barcode, actualStock }) {
  if (db.isDatabaseReady()) {
    const client = await db.getPool().connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT * FROM products WHERE user_id = $1 AND barcode = $2 ORDER BY id ASC LIMIT 1 FOR UPDATE;',
        [userId, barcode]
      );
      const product = existing.rows[0];

      if (!product) {
        await client.query('ROLLBACK');
        return null;
      }

      const newStock = Number(actualStock);
      const oldStock = !product.last_verified_at && Number(product.actual_stock || 0) === 0
        ? Number(product.expected_stock || 0)
        : Number(product.actual_stock) || 0;
      const difference = newStock - Number(product.expected_stock);

      const updated = await client.query(
        `
          UPDATE products
          SET actual_stock = $1,
              last_verified_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING id, name, barcode, expected_stock, actual_stock, last_verified_at;
        `,
        [newStock, product.id]
      );

      await client.query(
        `
          INSERT INTO stock_logs (product_id, old_stock, new_stock, difference)
          VALUES ($1, $2, $3, $4);
        `,
        [product.id, oldStock, newStock, difference]
      );

      await client.query('COMMIT');

      return normalizeProductRecord({
        ...updated.rows[0],
        difference,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const product = getUserMemoryProducts(userId).find((item) => item.barcode === barcode);

  if (!product) {
    return null;
  }

  const oldStock = !product.last_verified_at && Number(product.actual_stock || 0) === 0
    ? Number(product.expected_stock || 0)
    : Number(product.actual_stock) || 0;
  const newStock = Number(actualStock) || 0;
  const difference = newStock - Number(product.expected_stock);
  const timestamp = new Date().toISOString();

  product.actual_stock = newStock;
  product.last_verified_at = timestamp;
  product.updated_at = timestamp;

  memoryStore.logs.unshift({
    id: memoryStore.nextLogId++,
    user_id: Number(userId),
    product_id: product.id,
    product_name: product.name,
    barcode: product.barcode,
    old_stock: oldStock,
    new_stock: newStock,
    difference,
    timestamp,
  });

  return formatMemoryProduct(product);
}

async function getDashboardSummary(userId) {
  if (db.isDatabaseReady()) {
    const query = `
      SELECT
        COUNT(*)::int AS total_products,
        COUNT(*) FILTER (WHERE last_verified_at IS NOT NULL AND actual_stock = expected_stock)::int AS matched_items,
        COUNT(*) FILTER (WHERE last_verified_at IS NOT NULL AND actual_stock <> expected_stock)::int AS mismatched_items,
        COUNT(*) FILTER (WHERE last_verified_at IS NULL)::int AS pending_items
      FROM products
      WHERE user_id = $1;
    `;

    const { rows } = await db.query(query, [userId]);
    return rows[0];
  }

  return getUserMemoryProducts(userId).reduce(
    (summary, product) => {
      summary.total_products += 1;

      if (!product.last_verified_at) {
        summary.pending_items += 1;
      } else if (Number(product.actual_stock) === Number(product.expected_stock)) {
        summary.matched_items += 1;
      } else {
        summary.mismatched_items += 1;
      }

      return summary;
    },
    {
      total_products: 0,
      matched_items: 0,
      mismatched_items: 0,
      pending_items: 0,
    }
  );
}

async function getLogs(userId, limit = 100) {
  if (db.isDatabaseReady()) {
    const query = `
      SELECT
        l.id,
        p.name AS product_name,
        p.barcode,
        l.old_stock,
        l.new_stock,
        l.difference,
        l.timestamp
      FROM stock_logs l
      INNER JOIN products p ON p.id = l.product_id
      WHERE p.user_id = $1
      ORDER BY l.timestamp DESC
      LIMIT $2;
    `;

    const { rows } = await db.query(query, [userId, limit]);
    return rows;
  }

  return memoryStore.logs
    .filter((log) => Number(log.user_id) === Number(userId))
    .slice(0, limit);
}

module.exports = {
  upsertProducts,
  getProductByBarcode,
  getAllProducts,
  updateProductStock,
  getDashboardSummary,
  getLogs,
};
