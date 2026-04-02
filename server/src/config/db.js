const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
const schemaPath = path.resolve(__dirname, '../../../database.sql');
let pool = null;
let connectionMode = 'memory';
let connectionMessage = 'Running in local demo mode with in-memory storage.';

async function initializeDatabase() {
  if (!connectionString) {
    connectionMode = 'memory';
    connectionMessage = 'DATABASE_URL is not configured. Running in local demo mode with in-memory storage.';
    console.warn(connectionMessage);
    return false;
  }

  try {
    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    pool.on('error', (error) => {
      console.error('Unexpected PostgreSQL error:', error.message);
    });

    await pool.query('SELECT 1');

    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schemaSql);
    }

    connectionMode = 'postgres';
    connectionMessage = 'PostgreSQL connection established and schema verified.';
    console.log(connectionMessage);
    return true;
  } catch (error) {
    if (pool) {
      await pool.end().catch(() => {});
    }

    pool = null;
    connectionMode = 'memory';
    connectionMessage = `PostgreSQL unavailable: ${error.message}. Running in local demo mode with in-memory storage.`;
    console.warn(connectionMessage);
    return false;
  }
}

function isDatabaseReady() {
  return Boolean(pool);
}

function getPool() {
  return pool;
}

function getConnectionInfo() {
  return {
    mode: connectionMode,
    message: connectionMessage,
  };
}

async function query(text, params) {
  if (!pool) {
    throw new Error('Database is not connected.');
  }

  return pool.query(text, params);
}

module.exports = {
  initializeDatabase,
  isDatabaseReady,
  getPool,
  getConnectionInfo,
  query,
};
