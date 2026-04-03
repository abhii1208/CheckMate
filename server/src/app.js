require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const { requireAuth } = require('./middleware/authMiddleware');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const isDevelopment = (process.env.NODE_ENV || 'development') !== 'production';

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = origin.replace(/\/$/, '');
      const isLocalhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedOrigin);

      if (isDevelopment || isLocalhostOrigin || allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      console.warn(`Blocked CORS origin: ${normalizedOrigin}`);
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CheckMate API',
    message: 'Backend is running. Use /api/health to verify service health.',
  });
});

app.get('/health', (req, res) => {
  const connection = db.getConnectionInfo();

  res.json({
    status: 'ok',
    service: 'CheckMate API',
    mode: connection.mode,
    message: connection.message,
  });
});

app.get('/api/health', (req, res) => {
  const connection = db.getConnectionInfo();

  res.json({
    status: 'ok',
    service: 'CheckMate API',
    mode: connection.mode,
    message: connection.message,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, inventoryRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
