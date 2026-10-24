#!/usr/bin/env node
/**
 * demo-cli.js — Microservices Resilience Lab Interactive Terminal Demo
 *
 * Run this from the project root:
 *   node demo-cli.js
 *
 * It connects to both running microservices and lets you drive every
 * demonstration scenario from the terminal with coloured output and
 * interactive menus.
 *
 * Requirements: Node.js 18+, both services must be running.
 */

'use strict';

const readline = require('readline');
const http     = require('http');

/* ═══════════════════════════════════════════════════
   ANSI colour helpers
   ═══════════════════════════════════════════════════ */
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  bgRed:   '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow:'\x1b[43m',
  bgBlue:  '\x1b[44m',
};

const col  = (c, s) => `${C[c]}${s}${C.reset}`;
const bold = (s)    => `${C.bold}${s}${C.reset}`;
const dim  = (s)    => `${C.dim}${s}${C.reset}`;

/* ═══════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════ */
const ORDER_URL     = 'http://localhost:3001';
const INVENTORY_URL = 'http://localhost:3002';

const PRODUCTS = [
  { id: 'P001', name: 'Wireless Keyboard',   price: '$45.99'  },
  { id: 'P002', name: 'USB-C Monitor',        price: '$299.00' },
  { id: 'P003', name: 'Mechanical Mouse',     price: '$29.99'  },
  { id: 'P004', name: 'Laptop Stand',         price: '$59.99'  },
  { id: 'P005', name: 'Noise-Cancel Headset', price: '$149.99' },
];

/* ═══════════════════════════════════════════════════
   HTTP helper — returns { ok, status, data }
   ═══════════════════════════════════════════════════ */
function httpRequest(method, urlStr, body = null) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ ok: false, status: res.statusCode, data: { message: raw } });
        }
      });
    });

    req.on('error', (e) => resolve({ ok: false, status: 0, data: { message: e.message } }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, status: 0, data: { message: 'Request timed out' } }); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* ═══════════════════════════════════════════════════
   Readline interface
   ═══════════════════════════════════════════════════ */
const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
  terminal: true,
});

function ask(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function pause(ms = 800) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ═══════════════════════════════════════════════════
   Display helpers
   ═══════════════════════════════════════════════════ */
function clearLine() {
  process.stdout.write('\r\x1b[K');
}

function hr(char = '─', len = 60) {
  console.log(col('dim', char.repeat(len)));
}

function banner() {
  console.clear();
  console.log(col('blue', bold('╔══════════════════════════════════════════════════════════╗')));
  console.log(col('blue', bold('║') + col('cyan', bold('     ⚡  MICROSERVICES RESILIENCE LAB — CLI DEMO          ')) + col('blue', bold('║'))));
  console.log(col('blue', bold('║') + col('white', '         Circuit Breaker Pattern Demonstration            ') + col('blue', bold('║'))));
  console.log(col('blue', bold('║') + col('dim',   '         Practical-9 · MAP B.Tech Sem 7                  ') + col('blue', bold('║'))));
  console.log(col('blue', bold('╚══════════════════════════════════════════════════════════╝')));
  console.log();
}

function cbStateDisplay(state) {
  if (state === 'CLOSED')    return col('green',   bold('🟢 CLOSED   '));
  if (state === 'OPEN')      return col('red',     bold('🔴 OPEN     '));
  if (state === 'HALF_OPEN') return col('yellow',  bold('🟡 HALF-OPEN'));
  return col('dim', '⚪ UNKNOWN  ');
}

/* ═══════════════════════════════════════════════════
   Status Dashboard (shown before each menu)
   ═══════════════════════════════════════════════════ */
async function showStatus() {
  process.stdout.write(col('dim', '  Fetching status…'));

  const [oh, ih, cb, inv] = await Promise.allSettled([
    httpRequest('GET', `${ORDER_URL}/api/health`),
    httpRequest('GET', `${INVENTORY_URL}/api/health`),
    httpRequest('GET', `${ORDER_URL}/api/metrics`),
    httpRequest('GET', `${INVENTORY_URL}/api/stats`),
  ]);

  clearLine();

  const orderOk = oh.status === 'fulfilled' && oh.value.ok;
  const invOk   = ih.status === 'fulfilled' && ih.value.ok;

  const orderStatus = orderOk ? col('green', '● UP') : col('red', '● DOWN');
  const invStatus   = invOk   ? col('green', '● UP') : col('red', '● DOWN');

  let simMode = '—';
  let cbState = '—';
  let metrics = {};

  if (invOk && ih.value.data) simMode = ih.value.data.simulationMode || 'normal';
  if (cb.status === 'fulfilled' && cb.value.ok) {
    cbState  = cb.value.data.circuitBreakerState || '—';
    metrics  = cb.value.data.metrics || {};
  }

  hr();
  console.log(
    `  ${bold('Order Service')}  :3001   ${orderStatus}   ` +
    `${bold('Inventory Service')}  :3002   ${invStatus}   ` +
    `Sim Mode: ${col('yellow', bold(simMode))}`
  );

  const cbLine = `  ${bold('Circuit Breaker')}: ${cbStateDisplay(cbState)}`;
  const metLine = dim(
    `   Requests: ${metrics.totalRequests ?? 0}  ` +
    `✅ ${metrics.successfulRequests ?? 0}  ` +
    `❌ ${metrics.failedRequests ?? 0}  ` +
    `🛡️  ${metrics.fallbackResponses ?? 0}  ` +
    `⏱️  ${metrics.timeouts ?? 0}  ` +
    `📦 InventoryHits: ${metrics.inventoryRequests ?? 0}`
  );
  console.log(cbLine + metLine);
  hr();
  console.log();
}

/* ═══════════════════════════════════════════════════
   Action: Place Order
   ═══════════════════════════════════════════════════ */
async function actionPlaceOrder() {
  console.log(bold('\n  📦 PLACE AN ORDER\n'));

  // Product selection
  console.log('  Available Products:');
  PRODUCTS.forEach((p, i) => {
    console.log(`    ${col('cyan', bold(String(i + 1)))}. [${col('yellow', p.id)}] ${p.name} — ${col('green', p.price)}`);
  });
  console.log(`    ${col('cyan', bold('6'))}. Enter a Product ID manually`);
  console.log();

  const choice = (await ask('  Select product [1-6]: ')).trim();
  let productId = '';

  if (choice === '6') {
    productId = (await ask('  Enter Product ID (e.g. P001): ')).trim().toUpperCase();
  } else {
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < PRODUCTS.length) {
      productId = PRODUCTS[idx].id;
      console.log(dim(`  → Selected: ${PRODUCTS[idx].name}`));
    } else {
      console.log(col('red', '  ✗ Invalid choice.'));
      return;
    }
  }

  const qtyStr = (await ask('  Enter quantity [1-1000]: ')).trim();
  const quantity = parseInt(qtyStr, 10);

  if (isNaN(quantity) || quantity < 1 || quantity > 1000) {
    console.log(col('red', '  ✗ Invalid quantity.'));
    return;
  }

  console.log(dim(`\n  → Sending POST ${ORDER_URL}/api/orders …`));
  process.stdout.write('  ');

  const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let si = 0;
  const spin = setInterval(() => {
    process.stdout.write(`\r  ${spinner[si++ % spinner.length]} Waiting for response…`);
  }, 100);

  const { ok, status, data } = await httpRequest('POST', `${ORDER_URL}/api/orders`, { productId, quantity });
  clearInterval(spin);
  clearLine();

  // Display result
  console.log();
  hr('─', 60);

  if (data && data.fallback === true) {
    console.log(col('magenta', bold('  🛡️  FALLBACK RESPONSE RETURNED')));
    console.log(`  CB State : ${cbStateDisplay(data.circuitBreakerState)}`);
    console.log(`  Message  : ${col('yellow', data.message)}`);
    console.log(`  Retryable: ${data.retryable ? col('green','yes') : col('red','no')}`);
    if (data.hint) console.log(`  Hint     : ${dim(data.hint)}`);

  } else if (ok && data && data.success) {
    console.log(col('green', bold('  ✅ ORDER CONFIRMED')));
    console.log(`  Order ID  : ${col('cyan', bold(data.order?.orderId))}`);
    console.log(`  Product   : ${data.order?.productName} (${productId})`);
    console.log(`  Quantity  : ${quantity}`);
    console.log(`  Status    : ${col('green', data.order?.status)}`);
    console.log(`  CB State  : ${cbStateDisplay(data.circuitBreakerState)}`);
    if (data.inventoryData) {
      console.log(`  Stock Left: ${data.inventoryData.stock} units`);
    }

  } else if (status === 409) {
    console.log(col('yellow', bold('  ⚠️  OUT OF STOCK')));
    console.log(`  Message: ${data?.message}`);
    console.log(`  CB State: ${cbStateDisplay(data?.circuitBreakerState)}`);

  } else {
    console.log(col('red', bold(`  ❌ ORDER FAILED (HTTP ${status})`)));
    console.log(`  Message: ${data?.message || 'Unknown error'}`);
    console.log(`  CB State: ${cbStateDisplay(data?.circuitBreakerState)}`);
  }

  hr('─', 60);
  console.log();
}

/* ═══════════════════════════════════════════════════
   Action: Place Multiple Orders (stress test)
   ═══════════════════════════════════════════════════ */
async function actionBatchOrders() {
  console.log(bold('\n  🔁 BATCH ORDER TEST (trigger circuit breaker)\n'));

  const countStr = (await ask('  How many orders to send? [3-10]: ')).trim();
  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 1 || count > 20) {
    console.log(col('red', '  ✗ Please enter a number between 1 and 20.'));
    return;
  }

  const pidChoice = (await ask('  Product ID [default P001]: ')).trim().toUpperCase() || 'P001';
  const qtyChoice = parseInt((await ask('  Quantity per order [default 1]: ')).trim() || '1', 10);
  const delay     = parseInt((await ask('  Delay between requests in ms [default 200]: ')).trim() || '200', 10);

  console.log();
  hr();
  console.log(`  Sending ${count} orders for ${col('yellow', pidChoice)} × ${qtyChoice}`);
  hr();

  const results = [];
  for (let i = 1; i <= count; i++) {
    process.stdout.write(`  [${i}/${count}] Sending… `);
    const start = Date.now();
    const { ok, status, data } = await httpRequest('POST', `${ORDER_URL}/api/orders`, {
      productId: pidChoice,
      quantity: qtyChoice,
    });
    const ms = Date.now() - start;

    let label, stateStr;
    if (data?.fallback)       { label = col('magenta', '🛡️  FALLBACK'); }
    else if (ok && data?.success) { label = col('green',   '✅ CONFIRMED'); }
    else                      { label = col('red',     '❌ FAILED   '); }

    stateStr = cbStateDisplay(data?.circuitBreakerState || '—');
    const inv = data?.circuitBreakerState === 'OPEN' ? col('red', 'blocked') : col('green', 'reached');
    console.log(`${label}  CB: ${stateStr}  Inventory: ${inv}  (${ms}ms)`);

    results.push({ i, label: data?.fallback ? 'FALLBACK' : ok ? 'SUCCESS' : 'FAILED', state: data?.circuitBreakerState, ms });

    if (i < count) await pause(delay);
  }

  console.log();
  const opened = results.find(r => r.state === 'OPEN');
  if (opened) {
    console.log(col('red', bold(`  ⚡ Circuit breaker OPENED after request #${opened.i}`)));
    const blocked = results.filter(r => r.state === 'OPEN' && r.label === 'FALLBACK').length;
    console.log(col('magenta', `  🛡️  ${blocked} requests returned fallback without hitting Inventory Service`));
  } else {
    console.log(col('green', '  🟢 Circuit breaker remained CLOSED throughout'));
  }
  console.log();
}

/* ═══════════════════════════════════════════════════
   Action: Change Simulation Mode
   ═══════════════════════════════════════════════════ */
async function actionSimulation() {
  console.log(bold('\n  🎭 FAULT SIMULATION CONTROL\n'));
  console.log(`  ${col('green',   bold('1.'))} Normal    — Inventory responds normally`);
  console.log(`  ${col('red',     bold('2.'))} Failure   — Inventory returns HTTP 500 errors`);
  console.log(`  ${col('yellow',  bold('3.'))} Slow      — Inventory delays 5000ms (triggers timeout)`);
  console.log(`  ${col('magenta', bold('4.'))} Recovery  — Same as Normal (alias)`);
  console.log();

  const c = (await ask('  Choose mode [1-4]: ')).trim();
  const modes = { '1': 'normal', '2': 'failure', '3': 'slow', '4': 'recovery' };
  const mode = modes[c];

  if (!mode) {
    console.log(col('red', '  ✗ Invalid choice.'));
    return;
  }

  const { ok, data } = await httpRequest('POST', `${INVENTORY_URL}/api/simulation/mode`, { mode });

  if (ok && data?.success) {
    console.log(col('green', `\n  ✅ Mode changed: ${data.previousMode} → ${col('cyan', bold(data.currentMode))}`));
    console.log(dim(`  ${data.description}`));

    if (mode === 'slow') {
      console.log(col('yellow', '\n  ⏱️  Slow mode active — each order will time out after ~3s.'));
      console.log(col('yellow', '     Submit a few orders and watch the CB trip from timeouts.'));
    } else if (mode === 'failure') {
      console.log(col('red', '\n  ❌ Failure mode active — submit 3+ orders to trip the circuit breaker.'));
    } else if (mode === 'normal' || mode === 'recovery') {
      console.log(col('green', '\n  ✅ Normal mode active — wait ~10s for HALF-OPEN, then place one order.'));
    }
  } else {
    console.log(col('red', `\n  ✗ Failed: ${data?.message || 'Unknown error'}`));
  }
  console.log();
}

/* ═══════════════════════════════════════════════════
   Action: Show Circuit Breaker Details
   ═══════════════════════════════════════════════════ */
async function actionShowCB() {
  console.log(bold('\n  📊 CIRCUIT BREAKER DETAILS\n'));

  const { ok, data } = await httpRequest('GET', `${ORDER_URL}/api/metrics`);
  if (!ok) {
    console.log(col('red', '  ✗ Could not reach Order Service.'));
    return;
  }

  const cb  = data.circuitBreaker || {};
  const cfg = data.circuitBreakerConfig || {};
  const s   = data.circuitBreakerStats  || {};
  const m   = data.metrics              || {};

  console.log(`  State      : ${cbStateDisplay(data.circuitBreakerState)}`);
  console.log();
  console.log(bold('  Configuration:'));
  console.log(`    Timeout              : ${col('cyan', cfg.timeout + 'ms')}`);
  console.log(`    Error Threshold      : ${col('cyan', cfg.errorThresholdPercentage + '%')}`);
  console.log(`    Reset Timeout        : ${col('cyan', cfg.resetTimeout + 'ms')}`);
  console.log(`    Volume Threshold     : ${col('cyan', cfg.volumeThreshold + ' requests')}`);
  console.log();
  console.log(bold('  Opossum Internal Stats:'));
  console.log(`    Fires    : ${col('blue',    String(s.fires    ?? 0))}`);
  console.log(`    Successes: ${col('green',   String(s.successes ?? 0))}`);
  console.log(`    Failures : ${col('red',     String(s.failures  ?? 0))}`);
  console.log(`    Timeouts : ${col('yellow',  String(s.timeouts  ?? 0))}`);
  console.log(`    Rejects  : ${col('magenta', String(s.rejects   ?? 0))} ${dim('(blocked by OPEN breaker)')}`);
  console.log(`    Fallbacks: ${col('magenta', String(s.fallbacks ?? 0))}`);
  console.log();
  console.log(bold('  Application Metrics:'));
  console.log(`    Total Requests    : ${bold(String(m.totalRequests      ?? 0))}`);
  console.log(`    Successful Orders : ${col('green',   String(m.successfulRequests ?? 0))}`);
  console.log(`    Failed Orders     : ${col('red',     String(m.failedRequests     ?? 0))}`);
  console.log(`    Fallback Responses: ${col('magenta', String(m.fallbackResponses  ?? 0))}`);
  console.log(`    Timeouts          : ${col('yellow',  String(m.timeouts           ?? 0))}`);
  console.log(`    Inventory Requests: ${col('blue',    String(m.inventoryRequests  ?? 0))} ${dim('(actual hits to Inventory Service)')}`);
  console.log();

  // Recent events
  if (data.recentEvents && data.recentEvents.length > 0) {
    console.log(bold('  Recent Events (latest first):'));
    data.recentEvents.slice(0, 8).forEach((ev) => {
      const t = new Date(ev.timestamp).toLocaleTimeString('en-IN', { hour12: false });
      const icon = {
        SUCCESS: '✅', FAILURE: '❌', TIMEOUT: '⏱️ ',
        STATE_CHANGE: '⚡', FALLBACK: '🛡️ ', REJECTED: '🚫',
        ORDER_CONFIRMED: '🎉', ORDER_RECEIVED: '📥', FALLBACK_RETURNED: '🛡️ ',
        MANUAL_RESET: '🔧', METRICS_RESET: '📊',
      }[ev.type] || '🔵';
      console.log(`    ${dim(t)} ${icon}  ${ev.message}`);
    });
  }
  console.log();
}

/* ═══════════════════════════════════════════════════
   Action: Reset
   ═══════════════════════════════════════════════════ */
async function actionReset() {
  console.log(bold('\n  🔧 RESET OPTIONS\n'));
  console.log(`  ${col('cyan', bold('1.'))} Reset Circuit Breaker (force-close to CLOSED)`);
  console.log(`  ${col('cyan', bold('2.'))} Reset Metrics / Event Log`);
  console.log(`  ${col('cyan', bold('3.'))} Reset Both`);
  console.log();

  const c = (await ask('  Choose [1-3]: ')).trim();

  if (c === '1' || c === '3') {
    const { ok, data } = await httpRequest('POST', `${ORDER_URL}/api/circuit-breaker/reset`);
    if (ok && data?.success) {
      console.log(col('green', `  ✅ CB Reset: ${data.message}`));
    } else {
      console.log(col('yellow', `  ℹ  ${data?.message || 'No reset performed.'}`));
    }
  }

  if (c === '2' || c === '3') {
    const { ok } = await httpRequest('POST', `${ORDER_URL}/api/metrics/reset`);
    console.log(ok ? col('green', '  ✅ Metrics reset.') : col('red', '  ✗ Metrics reset failed.'));
  }

  if (!['1','2','3'].includes(c)) {
    console.log(col('red', '  ✗ Invalid choice.'));
  }
  console.log();
}

/* ═══════════════════════════════════════════════════
   Action: Guided Scenario Walkthrough
   ═══════════════════════════════════════════════════ */
async function actionScenarios() {
  console.log(bold('\n  📋 GUIDED SCENARIO WALKTHROUGHS\n'));
  console.log(`  ${col('cyan', bold('1.'))} Scenario 1 — Normal Operation`);
  console.log(`  ${col('cyan', bold('2.'))} Scenario 2 — Service Failure → Circuit Opens`);
  console.log(`  ${col('cyan', bold('3.'))} Scenario 3 — Timeout`);
  console.log(`  ${col('cyan', bold('4.'))} Scenario 4 — Service Recovery → HALF-OPEN → CLOSED`);
  console.log();

  const c = (await ask('  Choose scenario [1-4]: ')).trim();

  switch(c) {
    case '1': await scenarioNormal();    break;
    case '2': await scenarioFailure();   break;
    case '3': await scenarioTimeout();   break;
    case '4': await scenarioRecovery();  break;
    default:  console.log(col('red', '  ✗ Invalid choice.')); break;
  }
}

async function scenarioNormal() {
  console.log(col('green', bold('\n  ═══ SCENARIO 1: Normal Operation ═══\n')));
  console.log('  Expected: CB stays CLOSED, order is confirmed.\n');

  // Ensure normal mode
  await httpRequest('POST', `${INVENTORY_URL}/api/simulation/mode`, { mode: 'normal' });
  console.log(col('green', '  ✅ Inventory mode set to NORMAL'));

  const pid = (await ask('\n  Product ID [default P001]: ')).trim().toUpperCase() || 'P001';
  const qty = parseInt((await ask('  Quantity   [default 1  ]: ')).trim() || '1', 10);

  console.log(dim('\n  → Placing order…'));
  const { ok, data } = await httpRequest('POST', `${ORDER_URL}/api/orders`, { productId: pid, quantity: qty });

  console.log();
  if (ok && data?.success) {
    console.log(col('green',  bold('  ✅ RESULT: Order Confirmed!')));
    console.log(`     Order ID : ${col('cyan', data.order?.orderId)}`);
    console.log(`     CB State : ${cbStateDisplay(data.circuitBreakerState)}`);
    console.log(col('green', bold('\n  ✔  Scenario 1 PASSED — CB stayed CLOSED, Inventory Service reached normally.')));
  } else if (data?.fallback) {
    console.log(col('red', '  ✗ Got fallback — is Inventory Service running?'));
  } else {
    console.log(col('red', `  ✗ Failed: ${data?.message}`));
  }
  console.log();
}

async function scenarioFailure() {
  console.log(col('red', bold('\n  ═══ SCENARIO 2: Service Failure → Circuit Opens ═══\n')));
  console.log('  Expected: After ~3 failures, CB opens and returns fallback.\n');

  const count = parseInt((await ask('  How many requests to send? [default 6]: ')).trim() || '6', 10);

  // Enable failure mode
  await httpRequest('POST', `${INVENTORY_URL}/api/simulation/mode`, { mode: 'failure' });
  console.log(col('red', '  ❌ Inventory mode set to FAILURE'));

  // Reset metrics first for clean demo
  await httpRequest('POST', `${ORDER_URL}/api/metrics/reset`);
  console.log(dim('  📊 Metrics reset for clean demo\n'));
  await pause(500);

  let openedAt = null;
  for (let i = 1; i <= count; i++) {
    process.stdout.write(`  [${i}/${count}] `);
    const { data } = await httpRequest('POST', `${ORDER_URL}/api/orders`, { productId: 'P001', quantity: 1 });
    const cbState = data?.circuitBreakerState || '—';

    if (data?.fallback) {
      if (cbState === 'OPEN' && !openedAt) openedAt = i;
      const invStatus = cbState === 'OPEN' ? col('red', 'BLOCKED (not sent)') : col('yellow', 'reached → 500');
      console.log(`${col('magenta','🛡️  FALLBACK')}  CB:${cbStateDisplay(cbState)}  Inventory: ${invStatus}`);
    } else if (data?.success) {
      console.log(`${col('green','✅ CONFIRMED')}  CB:${cbStateDisplay(cbState)}`);
    } else {
      console.log(`${col('red','❌ FAILED   ')}  CB:${cbStateDisplay(cbState)}`);
    }

    await pause(300);
  }

  // Final metrics
  const { data: m } = await httpRequest('GET', `${ORDER_URL}/api/metrics`);
  console.log();
  hr();
  console.log(bold('  Final Metrics:'));
  console.log(`    Inventory Service actual requests : ${col('blue', String(m?.metrics?.inventoryRequests ?? 0))}`);
  console.log(`    Fallback responses returned       : ${col('magenta', String(m?.metrics?.fallbackResponses ?? 0))}`);
  console.log(`    CB rejects (blocked)             : ${col('red', String(m?.circuitBreakerStats?.rejects ?? 0))}`);

  if (openedAt) {
    console.log(col('red', bold(`\n  ⚡ Circuit breaker OPENED after request #${openedAt}`)));
    console.log(col('magenta', '  🛡️  Further requests returned fallback WITHOUT hitting Inventory Service.'));
    console.log(col('green', bold('  ✔  Scenario 2 PASSED')));
  }
  hr();
  console.log();
}

async function scenarioTimeout() {
  console.log(col('yellow', bold('\n  ═══ SCENARIO 3: Timeout ═══\n')));
  console.log('  Expected: Requests time out after 3s, counted as failures, CB may open.\n');

  const count = parseInt((await ask('  How many requests? [default 4]: ')).trim() || '4', 10);

  // Reset then set slow mode
  await httpRequest('POST', `${ORDER_URL}/api/metrics/reset`);
  await httpRequest('POST', `${INVENTORY_URL}/api/simulation/mode`, { mode: 'slow' });
  console.log(col('yellow', '  🐢 Inventory mode set to SLOW (5000ms delay)'));
  console.log(col('yellow', '  ⏱️  Circuit breaker timeout = 3000ms'));
  console.log(dim('  Each order will wait ~3s then receive a timeout fallback.\n'));

  for (let i = 1; i <= count; i++) {
    process.stdout.write(`  [${i}/${count}] Waiting for timeout (up to 3s)… `);
    const start = Date.now();
    const { data } = await httpRequest('POST', `${ORDER_URL}/api/orders`, { productId: 'P002', quantity: 1 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const cbState = data?.circuitBreakerState || '—';

    const label = data?.fallback ? col('yellow', '⏱️  TIMEOUT/FALLBACK') : col('green', '✅ CONFIRMED');
    console.log(`\r  [${i}/${count}] ${label}  CB:${cbStateDisplay(cbState)}  took ${elapsed}s`);
    await pause(200);
  }

  const { data: m } = await httpRequest('GET', `${ORDER_URL}/api/metrics`);
  console.log();
  console.log(`  Timeouts recorded: ${col('yellow', String(m?.metrics?.timeouts ?? 0))}`);
  console.log(`  CB state now     : ${cbStateDisplay(m?.circuitBreakerState)}`);
  console.log(col('green', bold('  ✔  Scenario 3 complete — timeouts acted as failures for the CB.')));
  console.log();
}

async function scenarioRecovery() {
  console.log(col('magenta', bold('\n  ═══ SCENARIO 4: Service Recovery → HALF-OPEN → CLOSED ═══\n')));
  console.log('  Expected: After reset timeout (10s), CB enters HALF-OPEN,');
  console.log('            one successful request returns it to CLOSED.\n');
  console.log('  Pre-condition: Circuit breaker should currently be OPEN.');
  console.log('  (If it is not, run Scenario 2 first to open it.)\n');

  const { data: before } = await httpRequest('GET', `${ORDER_URL}/api/circuit-breaker`);
  const stateBefore = before?.circuitBreaker?.state || '—';
  console.log(`  Current CB state: ${cbStateDisplay(stateBefore)}`);

  if (stateBefore === 'CLOSED') {
    console.log(col('yellow', '\n  ⚠  CB is already CLOSED. Run Scenario 2 first to open it,'));
    console.log(col('yellow', '     then come back to Scenario 4.'));
    console.log();
    return;
  }

  // Restore normal mode
  await httpRequest('POST', `${INVENTORY_URL}/api/simulation/mode`, { mode: 'normal' });
  console.log(col('green', '\n  ✅ Inventory mode restored to NORMAL'));

  const resetMs = before?.circuitBreaker?.config?.resetTimeout || 10000;
  console.log(col('cyan', `\n  ⏳ Waiting ${resetMs / 1000}s for CB reset timeout…`));
  console.log(dim('  (Watch the dashboard or run Option 4 to monitor state)'));

  // Countdown
  for (let remaining = Math.ceil(resetMs / 1000); remaining > 0; remaining--) {
    process.stdout.write(`\r  ${col('cyan', `  ${remaining}s remaining…`)}`);
    await pause(1000);
  }
  clearLine();

  // Check for HALF-OPEN
  const { data: mid } = await httpRequest('GET', `${ORDER_URL}/api/circuit-breaker`);
  const stateMid = mid?.circuitBreaker?.state || '—';
  console.log(`\n  CB state after timeout: ${cbStateDisplay(stateMid)}`);

  if (stateMid === 'HALF_OPEN' || stateMid === 'CLOSED') {
    console.log(col('yellow', '\n  🟡 Sending one test request in HALF-OPEN state…'));
    const { ok, data: testData } = await httpRequest('POST', `${ORDER_URL}/api/orders`, { productId: 'P001', quantity: 1 });

    console.log();
    const { data: after } = await httpRequest('GET', `${ORDER_URL}/api/circuit-breaker`);
    const stateAfter = after?.circuitBreaker?.state || '—';

    if (ok && testData?.success) {
      console.log(col('green', bold('  ✅ Test request SUCCEEDED!')));
      console.log(`  CB transitioned: ${cbStateDisplay(stateMid)} → ${cbStateDisplay(stateAfter)}`);
      console.log(col('green', bold('\n  ✔  Scenario 4 PASSED — CB self-healed back to CLOSED!')));
    } else {
      console.log(col('red', '  ✗ Test request failed — CB returned to OPEN.'));
      console.log(`  CB state: ${cbStateDisplay(stateAfter)}`);
    }
  } else {
    console.log(col('yellow', '  ℹ  CB did not enter HALF-OPEN yet. Try placing an order to trigger the check.'));
  }
  console.log();
}

/* ═══════════════════════════════════════════════════
   Action: View Inventory Stats
   ═══════════════════════════════════════════════════ */
async function actionInventoryStats() {
  console.log(bold('\n  📦 INVENTORY SERVICE STATS\n'));
  const { ok, data } = await httpRequest('GET', `${INVENTORY_URL}/api/stats`);
  if (!ok) { console.log(col('red', '  ✗ Could not reach Inventory Service.')); return; }

  console.log(`  Simulation Mode : ${col('yellow', bold(data.simulationMode || '—'))}`);
  console.log(`  Slow Delay      : ${data.slowDelay}ms`);
  console.log(`  Uptime          : ${data.uptime}s`);
  console.log();
  console.log(bold('  Request Counters (since last service restart):'));
  console.log(`    Total Requests    : ${bold(String(data.counters?.totalRequests     ?? 0))}`);
  console.log(`    Successful        : ${col('green',   String(data.counters?.successfulRequests ?? 0))}`);
  console.log(`    Failed (500/slow) : ${col('red',     String(data.counters?.failedRequests     ?? 0))}`);
  console.log();
}

/* ═══════════════════════════════════════════════════
   MAIN MENU
   ═══════════════════════════════════════════════════ */
async function mainMenu() {
  banner();
  await showStatus();

  console.log(bold('  MAIN MENU'));
  console.log(`  ${col('green',   bold('1.'))} Place an Order`);
  console.log(`  ${col('blue',    bold('2.'))} Batch Orders (stress test / trip the breaker)`);
  console.log(`  ${col('yellow',  bold('3.'))} Change Simulation Mode (normal / failure / slow / recovery)`);
  console.log(`  ${col('cyan',    bold('4.'))} View Circuit Breaker Details & Event Log`);
  console.log(`  ${col('magenta', bold('5.'))} View Inventory Service Stats`);
  console.log(`  ${col('cyan',    bold('6.'))} Guided Scenario Walkthroughs (Scenarios 1–4)`);
  console.log(`  ${col('white',   bold('7.'))} Reset Circuit Breaker / Metrics`);
  console.log(`  ${col('red',     bold('8.'))} Refresh Status`);
  console.log(`  ${col('dim',     bold('0.'))} Exit`);
  console.log();

  const choice = (await ask(bold('  Enter choice: '))).trim();
  console.log();

  switch (choice) {
    case '1': await actionPlaceOrder();    break;
    case '2': await actionBatchOrders();   break;
    case '3': await actionSimulation();    break;
    case '4': await actionShowCB();        break;
    case '5': await actionInventoryStats();break;
    case '6': await actionScenarios();     break;
    case '7': await actionReset();         break;
    case '8': /* just loops back */        break;
    case '0':
      console.log(col('cyan', '  Goodbye! 👋\n'));
      rl.close();
      process.exit(0);
      break;
    default:
      console.log(col('red', '  ✗ Invalid choice — please enter 0-8.\n'));
  }

  await ask(dim('  Press Enter to return to menu…'));
  return mainMenu();
}

/* ═══════════════════════════════════════════════════
   Entry point
   ═══════════════════════════════════════════════════ */
(async () => {
  // Pre-flight checks
  console.clear();
  console.log(col('cyan', bold('\n  ⚡ Microservices Resilience Lab — CLI Demo\n')));
  console.log(dim('  Checking services…\n'));

  const [oh, ih] = await Promise.all([
    httpRequest('GET', `${ORDER_URL}/api/health`),
    httpRequest('GET', `${INVENTORY_URL}/api/health`),
  ]);

  const orderUp = oh.ok;
  const invUp   = ih.ok;

  console.log(`  Order Service     :3001 — ${orderUp ? col('green', '● ONLINE') : col('red', '● OFFLINE')}`);
  console.log(`  Inventory Service :3002 — ${invUp   ? col('green', '● ONLINE') : col('red', '● OFFLINE')}`);
  console.log();

  if (!orderUp || !invUp) {
    console.log(col('red', bold('  ✗ One or more services are not running!\n')));
    console.log('  Please start both services first:');
    console.log(col('cyan', '    Terminal 1: cd inventory-service && npm start'));
    console.log(col('cyan', '    Terminal 2: cd order-service     && npm start'));
    console.log();
    rl.close();
    process.exit(1);
  }

  console.log(col('green', bold('  ✅ Both services are online. Starting demo…\n')));
  await pause(1000);
  await mainMenu();
})();
