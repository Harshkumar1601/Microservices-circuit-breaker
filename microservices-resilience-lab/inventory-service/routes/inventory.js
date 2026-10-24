/**
 * inventory.js — Inventory Service routes
 * GET  /api/inventory/:productId?quantity=1
 * GET  /api/stats
 * GET  /api/health
 * POST /api/simulation/mode
 */

'use strict';

const express = require('express');
const router  = express.Router();

/* ─── In-memory product catalogue ─── */
const PRODUCTS = {
  P001: { id: 'P001', name: 'Wireless Keyboard',  stock: 150, price: 45.99 },
  P002: { id: 'P002', name: 'USB-C Monitor',       stock: 30,  price: 299.00 },
  P003: { id: 'P003', name: 'Mechanical Mouse',    stock: 200, price: 29.99 },
  P004: { id: 'P004', name: 'Laptop Stand',        stock: 75,  price: 59.99 },
  P005: { id: 'P005', name: 'Noise-Cancel Headset',stock: 50,  price: 149.99 },
};

/* ─── Simulation state (module-level singleton) ─── */
const simulation = {
  mode: (process.env.DEFAULT_SIMULATION_MODE || 'normal').toLowerCase(),
  slowDelay: parseInt(process.env.SLOW_MODE_DELAY, 10) || 5000,
};

const VALID_MODES = ['normal', 'failure', 'slow', 'recovery'];

/* ─── Request counters ─── */
let totalRequests       = 0;
let successfulRequests  = 0;
let failedRequests      = 0;
let rejectedBySimulation = 0;

/* ─── Helper: sleep ─── */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─── GET /api/inventory/:productId ─── */
router.get('/:productId', async (req, res) => {
  totalRequests += 1;

  const productId = (req.params.productId || '').toUpperCase();
  const quantity  = parseInt(req.query.quantity, 10) || 1;

  // Validate productId
  if (!PRODUCTS[productId]) {
    failedRequests += 1;
    return res.status(404).json({
      success: false,
      message: `Product "${productId}" not found.`,
      validProductIds: Object.keys(PRODUCTS),
    });
  }

  // Validate quantity
  if (isNaN(quantity) || quantity < 1) {
    failedRequests += 1;
    return res.status(400).json({
      success: false,
      message: 'quantity must be a positive integer.',
    });
  }

  // ─── Simulation Modes ───────────────────────────────────────────
  const mode = simulation.mode === 'recovery' ? 'normal' : simulation.mode;

  if (mode === 'failure') {
    rejectedBySimulation += 1;
    failedRequests += 1;
    console.log(`[InventoryService] [FAILURE MODE] Returning 500 for ${productId}`);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Simulated service failure — inventory database unreachable.',
      simulationMode: 'failure',
    });
  }

  if (mode === 'slow') {
    console.log(`[InventoryService] [SLOW MODE] Delaying ${simulation.slowDelay}ms for ${productId}`);
    await sleep(simulation.slowDelay);
    // After delay, fall through to respond — the circuit breaker on the caller side will
    // have already timed out, so this response will usually be ignored.
  }
  // ────────────────────────────────────────────────────────────────

  const product   = PRODUCTS[productId];
  const available = product.stock >= quantity;

  successfulRequests += 1;
  console.log(`[InventoryService] [${simulation.mode.toUpperCase()}] ${productId} — stock=${product.stock}, requested=${quantity}, available=${available}`);

  return res.json({
    success: true,
    productId: product.id,
    productName: product.name,
    stock: product.stock,
    requestedQuantity: quantity,
    available,
    price: product.price,
    simulationMode: simulation.mode,
    timestamp: new Date().toISOString(),
  });
});

/* ─── GET /api/stats ─── */
router.get('/stats', (req, res) => {
  // Express routes are matched in order; this route must be registered
  // before /:productId to not be shadowed. But since this file exports
  // the router mounted at /api/inventory, the path here is just '/stats'
  // and ':productId' would match 'stats'. To prevent that we register
  // /stats first in server.js OR handle it explicitly:
  res.json({
    success: true,
    service: 'inventory-service',
    simulationMode: simulation.mode,
    counters: {
      totalRequests,
      successfulRequests,
      failedRequests,
      rejectedBySimulation,
    },
  });
});

module.exports = { router, simulation, VALID_MODES, getCounters: () => ({ totalRequests, successfulRequests, failedRequests }) };
