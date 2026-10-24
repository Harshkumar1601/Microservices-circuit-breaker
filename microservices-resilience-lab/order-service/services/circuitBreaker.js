/**
 * circuitBreaker.js — Order Service
 * Wraps the HTTP call to the Inventory Service using Opossum.
 *
 * All circuit-breaker configuration is pulled from environment variables
 * so that demonstration parameters can be changed without modifying code.
 */

'use strict';

const CircuitBreaker = require('opossum');
const axios = require('axios');

const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3002';

/* ─── Metrics store (shared with routes via module singleton) ─── */
const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  fallbackResponses: 0,
  timeouts: 0,
  inventoryRequests: 0, // requests that ACTUALLY reached Inventory Service
  stateChanges: [],
  events: [],
};

/* ─── The protected async function ─── */
async function callInventoryService(productId, quantity) {
  metrics.inventoryRequests += 1;
  const url = `${INVENTORY_URL}/api/inventory/${productId}?quantity=${quantity}`;
  const response = await axios.get(url, {
    timeout: (parseInt(process.env.CB_TIMEOUT, 10) || 3000) + 500, // axios timeout slightly beyond CB timeout
  });
  return response.data;
}

/* ─── Circuit breaker options ─── */
const options = {
  timeout:                    parseInt(process.env.CB_TIMEOUT, 10)                     || 3000,
  errorThresholdPercentage:   parseInt(process.env.CB_ERROR_THRESHOLD_PERCENTAGE, 10)  || 50,
  resetTimeout:               parseInt(process.env.CB_RESET_TIMEOUT, 10)               || 10000,
  volumeThreshold:            parseInt(process.env.CB_VOLUME_THRESHOLD, 10)            || 3,
  rollingCounterTimeoutInMs:  parseInt(process.env.CB_ROLLING_COUNTER_TIMEOUT, 10)     || 10000,
  name: 'InventoryServiceBreaker',
};

const breaker = new CircuitBreaker(callInventoryService, options);

/* ─── Helper: push to event log (newest first, cap at 50) ─── */
function logEvent(type, message, extra = {}) {
  const entry = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    type,
    message,
    ...extra,
  };
  metrics.events.unshift(entry);
  if (metrics.events.length > 50) metrics.events.pop();
  return entry;
}

/* ─── Opossum event listeners ─── */
breaker.on('success', () => {
  logEvent('SUCCESS', 'Inventory request succeeded — circuit is CLOSED');
});

breaker.on('timeout', () => {
  metrics.timeouts += 1;
  logEvent('TIMEOUT', 'Inventory request timed out — counting as failure');
});

breaker.on('failure', (err) => {
  logEvent('FAILURE', `Inventory request failed: ${err.message}`);
});

breaker.on('open', () => {
  const entry = logEvent('STATE_CHANGE', '⚡ Circuit breaker OPENED — blocking further inventory requests');
  metrics.stateChanges.push({ state: 'OPEN', timestamp: entry.timestamp });
});

breaker.on('halfOpen', () => {
  const entry = logEvent('STATE_CHANGE', '🔄 Circuit breaker HALF-OPEN — testing one request');
  metrics.stateChanges.push({ state: 'HALF_OPEN', timestamp: entry.timestamp });
});

breaker.on('close', () => {
  const entry = logEvent('STATE_CHANGE', '✅ Circuit breaker CLOSED — normal operation resumed');
  metrics.stateChanges.push({ state: 'CLOSED', timestamp: entry.timestamp });
});

breaker.on('fallback', () => {
  metrics.fallbackResponses += 1;
  logEvent('FALLBACK', 'Fallback response returned to caller');
});

breaker.on('reject', () => {
  // A request was rejected because the breaker is OPEN
  logEvent('REJECTED', 'Request rejected by open circuit breaker (not sent to Inventory Service)');
});

/* ─── Exported helpers ─── */
function getBreakerState() {
  const raw = breaker.status.stats;
  return {
    state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
    config: {
      timeout:                  options.timeout,
      errorThresholdPercentage: options.errorThresholdPercentage,
      resetTimeout:             options.resetTimeout,
      volumeThreshold:          options.volumeThreshold,
      rollingCounterTimeoutInMs: options.rollingCounterTimeoutInMs,
    },
    stats: {
      successes:       raw.successes       || 0,
      failures:        raw.failures        || 0,
      fallbacks:       raw.fallbacks       || 0,
      timeouts:        raw.timeouts        || 0,
      rejects:         raw.rejects         || 0,
      fires:           raw.fires           || 0,
    },
  };
}

function resetBreaker() {
  const isOpenOrHalfOpen = breaker.opened || breaker.halfOpen;
  if (!isOpenOrHalfOpen) return false; // already CLOSED, nothing to reset
  breaker.close(); // force-close — only valid in demo context
  logEvent('MANUAL_RESET', '🔧 Circuit breaker manually reset to CLOSED by operator');
  return true;
}

module.exports = { breaker, metrics, getBreakerState, resetBreaker, logEvent };
