/**
 * simulation.js — Inventory Service routes
 * POST /api/simulation/mode — change the simulation mode.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { simulation, VALID_MODES } = require('./inventory');

/* ─── POST /api/simulation/mode ─── */
router.post('/mode', (req, res) => {
  const { mode } = req.body || {};

  if (!mode || typeof mode !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'mode is required and must be a string.',
      validModes: VALID_MODES,
    });
  }

  const normalised = mode.toLowerCase().trim();
  if (!VALID_MODES.includes(normalised)) {
    return res.status(400).json({
      success: false,
      message: `Unknown mode "${mode}". Valid modes: ${VALID_MODES.join(', ')}.`,
      validModes: VALID_MODES,
    });
  }

  const previous = simulation.mode;
  simulation.mode = normalised;

  console.log(`[InventoryService] Simulation mode changed: ${previous} → ${normalised}`);

  const descriptions = {
    normal:   'Inventory service is responding normally.',
    failure:  'Inventory service is simulating HTTP 500 failures.',
    slow:     `Inventory service is simulating slow responses (${simulation.slowDelay}ms delay).`,
    recovery: 'Inventory service is restoring normal operation (alias for normal).',
  };

  return res.json({
    success: true,
    message: `Simulation mode changed to "${normalised}".`,
    previousMode: previous,
    currentMode: normalised,
    description: descriptions[normalised],
    timestamp: new Date().toISOString(),
  });
});

/* ─── GET /api/simulation/mode ─── */
router.get('/mode', (_req, res) => {
  const descriptions = {
    normal:   'Responding normally.',
    failure:  'Returning HTTP 500 errors.',
    slow:     `Delaying responses by ${simulation.slowDelay}ms.`,
    recovery: 'Restoring normal operation.',
  };
  res.json({
    success: true,
    currentMode: simulation.mode,
    description: descriptions[simulation.mode],
    validModes: VALID_MODES,
    slowDelay: simulation.slowDelay,
  });
});

module.exports = router;
