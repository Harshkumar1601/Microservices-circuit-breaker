/**
 * circuitBreakerRoutes.js — Order Service
 * Routes for inspecting and resetting the circuit breaker.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { metrics, getBreakerState, resetBreaker, logEvent } = require('../services/circuitBreaker');

/* ─── GET /api/circuit-breaker ─── */
router.get('/', (req, res) => {
  const state = getBreakerState();
  res.json({
    success: true,
    circuitBreaker: state,
    appMetrics: {
      totalRequests:       metrics.totalRequests,
      successfulRequests:  metrics.successfulRequests,
      failedRequests:      metrics.failedRequests,
      fallbackResponses:   metrics.fallbackResponses,
      timeouts:            metrics.timeouts,
      inventoryRequests:   metrics.inventoryRequests,
    },
    recentStateChanges: metrics.stateChanges.slice(-10),
  });
});

/* ─── POST /api/circuit-breaker/reset ─── */
router.post('/reset', (req, res) => {
  const state = getBreakerState();
  if (state.state === 'CLOSED') {
    return res.json({
      success: false,
      message: 'Circuit breaker is already CLOSED — no reset needed.',
      circuitBreakerState: state.state,
    });
  }

  const wasReset = resetBreaker();
  if (wasReset) {
    logEvent('MANUAL_RESET', 'Circuit breaker manually reset via API.');
    return res.json({
      success: true,
      message: 'Circuit breaker has been manually reset to CLOSED. This is for demonstration only.',
      circuitBreakerState: 'CLOSED',
    });
  }

  return res.status(400).json({
    success: false,
    message: 'Could not reset circuit breaker at this time.',
  });
});

module.exports = router;
