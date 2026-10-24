/**
 * errorHandler.js — Inventory Service middleware
 */

'use strict';

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const isDev  = (process.env.NODE_ENV || 'development') === 'development';

  console.error(`[InventoryService] ${new Date().toISOString()} ERROR ${status}:`, err.message);
  if (isDev) console.error(err.stack);

  res.status(status).json({
    success: false,
    message: isDev ? err.message : 'An internal server error occurred.',
  });
}

module.exports = errorHandler;
