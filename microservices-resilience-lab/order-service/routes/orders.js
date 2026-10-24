/**
 * orders.js — Order Service routes
 * Handles POST /api/orders — places an order by calling the Inventory Service
 * through the Opossum circuit breaker.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { breaker, metrics, getBreakerState, logEvent } = require('../services/circuitBreaker');

/* ─── Input validation helpers ─── */
const VALID_PRODUCT_IDS = ['P001', 'P002', 'P003', 'P004', 'P005'];

function validateOrderInput(productId, quantity) {
  const errors = [];
  if (!productId || typeof productId !== 'string') {
    errors.push('productId is required and must be a string.');
  } else if (!VALID_PRODUCT_IDS.includes(productId.toUpperCase())) {
    errors.push(`productId "${productId}" is not recognised. Valid IDs: ${VALID_PRODUCT_IDS.join(', ')}.`);
  }

  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty < 1 || qty > 1000) {
    errors.push('quantity must be an integer between 1 and 1000.');
  }

  return { errors, productId: productId ? productId.toUpperCase() : null, quantity: qty };
}

/* ─── Fallback function registered on the breaker ─── */
function inventoryFallback(error, productId, quantity) {
  const state = breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED';
  let message = 'Order cannot be confirmed because the Inventory Service is temporarily unavailable.';

  if (error && error.code === 'ETIMEDOUT') {
    message = 'Order cannot be confirmed — the Inventory Service did not respond in time.';
  } else if (error && error.message && error.message.includes('Breaker is open')) {
    message = 'Order cannot be confirmed — the circuit breaker is OPEN (protecting the system from a failing service).';
  }

  return {
    success: false,
    fallback: true,
    message,
    circuitBreakerState: state,
    retryable: true,
    hint: state === 'OPEN'
      ? `The circuit breaker will attempt recovery in ~${(parseInt(process.env.CB_RESET_TIMEOUT, 10) || 10000) / 1000}s.`
      : 'Please retry your order shortly.',
  };
}

breaker.fallback(inventoryFallback);

/* ─── POST /api/orders ─── */
router.post('/', async (req, res) => {
  metrics.totalRequests += 1;
  const { productId, quantity } = req.body || {};
  const { errors, productId: pid, quantity: qty } = validateOrderInput(productId, quantity);

  if (errors.length > 0) {
    logEvent('VALIDATION_ERROR', `Invalid order input: ${errors.join(' ')}`);
    return res.status(400).json({
      success: false,
      message: 'Invalid order request.',
      errors,
    });
  }

  logEvent('ORDER_RECEIVED', `Order received — productId=${pid}, quantity=${qty}`);

  let inventoryData;
  try {
    inventoryData = await breaker.fire(pid, qty);
  } catch (err) {
    // breaker.fire() should not normally throw when a fallback is registered,
    // but guard just in case.
    metrics.failedRequests += 1;
    logEvent('ERROR', `Unexpected error calling circuit breaker: ${err.message}`);
    return res.status(503).json({
      success: false,
      message: 'An unexpected error occurred while checking inventory.',
      circuitBreakerState: getBreakerState().state,
    });
  }

  // If fallback was triggered, inventoryData will have fallback:true
  if (inventoryData && inventoryData.fallback === true) {
    metrics.failedRequests += 1;
    logEvent('FALLBACK_RETURNED', `Fallback returned for productId=${pid}`);
    return res.status(503).json({
      ...inventoryData,
      order: null,
      productId: pid,
      quantity: qty,
    });
  }

  // Check actual inventory availability
  if (!inventoryData || !inventoryData.available) {
    metrics.failedRequests += 1;
    logEvent('OUT_OF_STOCK', `Insufficient stock for productId=${pid}, requested=${qty}`);
    return res.status(409).json({
      success: false,
      fallback: false,
      message: `Sorry, insufficient stock. Requested: ${qty}, Available: ${inventoryData ? inventoryData.stock : 0}.`,
      circuitBreakerState: getBreakerState().state,
      inventoryData,
    });
  }

  // All good — confirm the order
  metrics.successfulRequests += 1;
  const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  logEvent('ORDER_CONFIRMED', `Order confirmed — orderId=${orderId}, product=${pid}, qty=${qty}`);

  return res.status(201).json({
    success: true,
    fallback: false,
    message: 'Order placed successfully.',
    order: {
      orderId,
      productId: pid,
      productName: inventoryData.productName,
      quantity: qty,
      status: 'CONFIRMED',
      placedAt: new Date().toISOString(),
    },
    inventoryData,
    circuitBreakerState: getBreakerState().state,
  });
});

module.exports = router;
