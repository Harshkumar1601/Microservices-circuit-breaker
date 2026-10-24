/**
 * server.js — Order Service (Port 3001)
 *
 * Entry point for Microservice 1.
 * Wires up Express, security headers, CORS, rate limiting, routes, and error handling.
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');

const ordersRouter         = require('./routes/orders');
const circuitBreakerRouter = require('./routes/circuitBreakerRoutes');
const metricsRouter        = require('./routes/metrics');

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

/* ─── Security: Helmet ─── */
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

/* ─── CORS ─── */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,null')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (Postman, curl) or from allowed list
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

/* ─── Body parsing ─── */
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

/* ─── Rate limiting ─── */
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
  max:      parseInt(process.env.RATE_LIMIT_MAX,        10) || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});
app.use('/api/', limiter);

/* ─── Request logger ─── */
app.use((req, _res, next) => {
  console.log(`[OrderService] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

/* ─── Routes ─── */
app.use('/api/orders',          ordersRouter);
app.use('/api/circuit-breaker', circuitBreakerRouter);
app.use('/api/metrics',         metricsRouter);

/* ─── Health check ─── */
app.get('/api/health', (_req, res) => {
  res.json({
    success:   true,
    service:   'order-service',
    status:    'UP',
    port:      PORT,
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* ─── 404 handler ─── */
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
});

/* ─── Central error handler ─── */
app.use(errorHandler);

/* ─── Handle malformed JSON ─── */
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON in request body.' });
  }
  next(err);
});

/* ─── Start server ─── */
const server = app.listen(PORT, () => {
  console.log('─'.repeat(55));
  console.log(`  🚀  Order Service running on http://localhost:${PORT}`);
  console.log(`  📦  Inventory URL : ${process.env.INVENTORY_SERVICE_URL || 'http://localhost:3002'}`);
  console.log(`  ⚡  CB Timeout    : ${process.env.CB_TIMEOUT || 3000}ms`);
  console.log(`  📊  CB Threshold  : ${process.env.CB_ERROR_THRESHOLD_PERCENTAGE || 50}%`);
  console.log(`  🔄  CB Reset In   : ${process.env.CB_RESET_TIMEOUT || 10000}ms`);
  console.log('─'.repeat(55));
});

/* ─── Graceful shutdown ─── */
process.on('SIGTERM', () => {
  console.log('[OrderService] SIGTERM received — shutting down gracefully.');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[OrderService] SIGINT received — shutting down.');
  server.close(() => process.exit(0));
});

module.exports = app;
