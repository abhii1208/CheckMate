CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    barcode VARCHAR(120) NOT NULL,
    expected_stock INTEGER NOT NULL DEFAULT 0,
    actual_stock INTEGER NOT NULL DEFAULT 0,
    last_verified_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS stock_logs (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    old_stock INTEGER NOT NULL,
    new_stock INTEGER NOT NULL,
    difference INTEGER NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_user_barcode ON products(user_id, barcode);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_stock_logs_product_id ON stock_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_logs_timestamp ON stock_logs(timestamp DESC);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP;
