/**
 * errorHandler.js — Order Service middleware
 * Centralised error handler — never leaks stack traces to the client.
 */

'use strict';

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const isDev  = (process.env.NODE_ENV || 'development') === 'development';

  // Log internally
  console.error(`[OrderService] ${new Date().toISOString()} ERROR ${status}:`, err.message);
  if (isDev) console.error(err.stack);

  res.status(status).json({
    success: false,
    message: isDev ? err.message : 'An internal server error occurred.',
    // Stack traces are NEVER sent to the client in production
  });
}

module.exports = errorHandler;
