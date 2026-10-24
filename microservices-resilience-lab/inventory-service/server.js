/**
 * server.js — Inventory Service (Port 3002)
 *
 * Entry point for Microservice 2.
 * Manages a small in-memory product inventory and exposes simulation controls
 * so the circuit breaker in the Order Service can be demonstrated.
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');

// Import inventory router (also exports shared simulation state)
const { router: inventoryRouter, simulation, getCounters } = require('./routes/inventory');
const simulationRouter = require('./routes/simulation');

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3002;

/* ─── Security: Helmet ─── */
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

/* ─── CORS ─── */
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:3001,http://localhost:5500,http://127.0.0.1:5500,null'
).split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
}));

/* ─── Body parsing ─── */
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

/* ─── Rate limiting ─── */
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
  max:      parseInt(process.env.RATE_LIMIT_MAX,        10) || 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests.' },
});
app.use('/api/', limiter);

/* ─── Request logger ─── */
app.use((req, _res, next) => {
  console.log(`[InventoryService] ${new Date().toISOString()} ${req.method} ${req.originalUrl} [mode=${simulation.mode}]`);
  next();
});

/* ─── Health check (before inventory router so /health doesn't hit /:productId) ─── */
app.get('/api/health', (_req, res) => {
  res.json({
    success:        true,
    service:        'inventory-service',
    status:         'UP',
    port:           PORT,
    uptime:         Math.floor(process.uptime()),
    simulationMode: simulation.mode,
    timestamp:      new Date().toISOString(),
  });
});

/* ─── Stats endpoint ─── */
app.get('/api/stats', (_req, res) => {
  const c = getCounters();
  res.json({
    success:        true,
    service:        'inventory-service',
    simulationMode: simulation.mode,
    slowDelay:      simulation.slowDelay,
    counters:       c,
    uptime:         Math.floor(process.uptime()),
    timestamp:      new Date().toISOString(),
  });
});

/* ─── Simulation controls ─── */
app.use('/api/simulation', simulationRouter);

/* ─── Inventory routes — IMPORTANT: register AFTER /api/health and /api/stats
       so that "health" and "stats" path segments are not captured by /:productId ─── */
app.use('/api/inventory', inventoryRouter);

/* ─── 404 ─── */
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
});

/* ─── Central error handler ─── */
app.use(errorHandler);

/* ─── Start server ─── */
const server = app.listen(PORT, () => {
  console.log('─'.repeat(55));
  console.log(`  📦  Inventory Service running on http://localhost:${PORT}`);
  console.log(`  🎭  Simulation Mode : ${simulation.mode}`);
  console.log(`  🐢  Slow Mode Delay : ${simulation.slowDelay}ms`);
  console.log('─'.repeat(55));
});

/* ─── Graceful shutdown ─── */
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('\n[InventoryService] Shutting down.');
  server.close(() => process.exit(0));
});

module.exports = app;
