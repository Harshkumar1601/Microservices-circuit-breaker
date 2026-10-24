/**
 * metrics.js — Order Service
 * Exposes GET /api/metrics and POST /api/metrics/reset.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { metrics, getBreakerState, logEvent } = require('../services/circuitBreaker');

/* ─── GET /api/metrics ─── */
router.get('/', (req, res) => {
  const state = getBreakerState();
  res.json({
    success: true,
    service: 'order-service',
    port: process.env.PORT || 3001,
    uptime: Math.floor(process.uptime()),
    circuitBreakerState: state.state,
    metrics: {
      totalRequests:       metrics.totalRequests,
      successfulRequests:  metrics.successfulRequests,
      failedRequests:      metrics.failedRequests,
      fallbackResponses:   metrics.fallbackResponses,
      timeouts:            metrics.timeouts,
      inventoryRequests:   metrics.inventoryRequests,
    },
    circuitBreakerStats: state.stats,
    circuitBreakerConfig: state.config,
    recentEvents: metrics.events.slice(0, 20),
    recentStateChanges: metrics.stateChanges.slice(-5),
  });
});

/* ─── POST /api/metrics/reset — reset demo counters ─── */
router.post('/reset', (req, res) => {
  metrics.totalRequests       = 0;
  metrics.successfulRequests  = 0;
  metrics.failedRequests      = 0;
  metrics.fallbackResponses   = 0;
  metrics.timeouts            = 0;
  metrics.inventoryRequests   = 0;
  metrics.stateChanges        = [];
  metrics.events              = [];
  logEvent('METRICS_RESET', '📊 Demonstration metrics have been reset.');
  res.json({ success: true, message: 'Demonstration metrics have been reset.' });
});

module.exports = router;
