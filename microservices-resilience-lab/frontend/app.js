/**
 * app.js — Microservices Resilience Lab Dashboard
 *
 * Responsibilities:
 *  - Poll Order Service and Inventory Service every 2 seconds.
 *  - Display live circuit breaker state, metrics, and event log.
 *  - Handle order submissions and show real responses.
 *  - Control fault simulation through the Inventory Service API.
 *  - Maintain a local request history for the demo.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   1. Configuration
   ═══════════════════════════════════════════════════════════ */
const CONFIG = {
  ORDER_SERVICE_URL:     'http://localhost:3001',
  INVENTORY_SERVICE_URL: 'http://localhost:3002',
  POLL_INTERVAL_MS:      2000,   // polling interval in milliseconds
};

/* ═══════════════════════════════════════════════════════════
   2. State
   ═══════════════════════════════════════════════════════════ */
const state = {
  requestHistory:    [],    // local array of recent order attempts
  eventLogEntries:   [],    // local array of event log entries shown
  pollActive:        false, // guard against overlapping polls
  orderInProgress:   false, // prevent double-submission
};

/* ═══════════════════════════════════════════════════════════
   3. DOM References (cached once on load)
   ═══════════════════════════════════════════════════════════ */
const dom = {
  // Status
  orderBadge:          document.getElementById('order-service-badge'),
  inventoryBadge:      document.getElementById('inventory-service-badge'),
  inventorySimModeTag: document.getElementById('inventory-sim-mode-tag'),
  cbIcon:              document.getElementById('cb-icon'),
  cbStateText:         document.getElementById('cb-state-text'),

  // Order form
  orderForm:           document.getElementById('order-form'),
  productSelect:       document.getElementById('product-select'),
  qtyInput:            document.getElementById('qty-input'),
  placeOrderBtn:       document.getElementById('place-order-btn'),
  orderResponseBox:    document.getElementById('order-response-box'),

  // Simulation
  btnSimNormal:        document.getElementById('btn-sim-normal'),
  btnSimFailure:       document.getElementById('btn-sim-failure'),
  btnSimSlow:          document.getElementById('btn-sim-slow'),
  btnSimRecovery:      document.getElementById('btn-sim-recovery'),
  simFeedback:         document.getElementById('sim-feedback'),
  simModeBox:          document.getElementById('sim-mode-box'),

  // CB actions
  btnResetCb:          document.getElementById('btn-reset-cb'),
  btnResetMetrics:     document.getElementById('btn-reset-metrics'),

  // Metrics
  metricsUpdated:      document.getElementById('metrics-updated'),
  mTotal:              document.getElementById('m-total'),
  mSuccess:            document.getElementById('m-success'),
  mFailed:             document.getElementById('m-failed'),
  mFallbacks:          document.getElementById('m-fallbacks'),
  mTimeouts:           document.getElementById('m-timeouts'),
  mInventory:          document.getElementById('m-inventory'),
  mCbSuccess:          document.getElementById('m-cb-success'),
  mCbFailures:         document.getElementById('m-cb-failures'),
  mCbTimeouts:         document.getElementById('m-cb-timeouts'),
  mCbRejects:          document.getElementById('m-cb-rejects'),
  cfgTimeout:          document.getElementById('cfg-timeout'),
  cfgThreshold:        document.getElementById('cfg-threshold'),
  cfgReset:            document.getElementById('cfg-reset'),
  cfgVolume:           document.getElementById('cfg-volume'),

  // Log / History
  eventLog:            document.getElementById('event-log'),
  historyTbody:        document.getElementById('history-tbody'),
  btnClearLog:         document.getElementById('btn-clear-log'),
  btnClearHistory:     document.getElementById('btn-clear-history'),

  // Toast
  toastContainer:      document.getElementById('toast-container'),
};

/* ═══════════════════════════════════════════════════════════
   4. Utility Helpers
   ═══════════════════════════════════════════════════════════ */

/** Format an ISO timestamp to a short hh:mm:ss string. */
function fmtTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-IN', { hour12: false });
  } catch {
    return '—';
  }
}

/** Pretty-print a JSON value. */
function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

/** Show a toast notification. */
function toast(message, type = 'info', durationMs = 3500) {
  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 320);
  }, durationMs);
}

/** Safe fetch wrapper — returns { ok, data, error }. */
async function safeFetch(url, options = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message || 'Network error' };
  }
}

/* ═══════════════════════════════════════════════════════════
   5. Circuit Breaker State Rendering
   ═══════════════════════════════════════════════════════════ */
const CB_STATE_CONFIG = {
  CLOSED: {
    icon: '🟢',
    textClass: 'cb-state-closed',
    label: 'CLOSED',
    badgeClass: 'badge-closed',
  },
  OPEN: {
    icon: '🔴',
    textClass: 'cb-state-open',
    label: 'OPEN',
    badgeClass: 'badge-open',
  },
  HALF_OPEN: {
    icon: '🟡',
    textClass: 'cb-state-half-open',
    label: 'HALF-OPEN',
    badgeClass: 'badge-half-open',
  },
};

function renderCbState(stateStr) {
  const cfg = CB_STATE_CONFIG[stateStr] || {
    icon: '🔘', textClass: 'cb-state-unknown', label: stateStr || '—', badgeClass: 'badge-unknown',
  };

  dom.cbIcon.textContent = cfg.icon;

  // Remove old state classes, add new one
  dom.cbStateText.className = `cb-state-text ${cfg.textClass}`;
  dom.cbStateText.textContent = cfg.label;
}

/* ═══════════════════════════════════════════════════════════
   6. Polling — fetch data from both services
   ═══════════════════════════════════════════════════════════ */
async function poll() {
  if (state.pollActive) return;
  state.pollActive = true;

  try {
    // Parallel requests to both services
    const [orderHealth, cbStatus, inventoryHealth, inventoryStats, simMode] = await Promise.allSettled([
      safeFetch(`${CONFIG.ORDER_SERVICE_URL}/api/health`),
      safeFetch(`${CONFIG.ORDER_SERVICE_URL}/api/metrics`),
      safeFetch(`${CONFIG.INVENTORY_SERVICE_URL}/api/health`),
      safeFetch(`${CONFIG.INVENTORY_SERVICE_URL}/api/stats`),
      safeFetch(`${CONFIG.INVENTORY_SERVICE_URL}/api/simulation/mode`),
    ]);

    // ── Order Service status ──────────────────────────────
    const orderOk = orderHealth.status === 'fulfilled' && orderHealth.value.ok;
    setBadge(dom.orderBadge, orderOk ? 'UP' : 'DOWN');

    // ── Inventory Service status ──────────────────────────
    const invOk = inventoryHealth.status === 'fulfilled' && inventoryHealth.value.ok;
    setBadge(dom.inventoryBadge, invOk ? 'UP' : 'DOWN');

    // ── Simulation mode tag ───────────────────────────────
    if (simMode.status === 'fulfilled' && simMode.value.ok) {
      const modeData = simMode.value.data;
      dom.inventorySimModeTag.textContent =
        `localhost:3002 · mode: ${modeData.currentMode || '—'}`;
      dom.simModeBox.textContent = pretty(modeData);
    }

    // ── CB State + Metrics ────────────────────────────────
    if (cbStatus.status === 'fulfilled' && cbStatus.value.ok) {
      const d = cbStatus.value.data;

      // CB state
      renderCbState(d.circuitBreakerState);

      // Config tiles
      const cfg = d.circuitBreakerConfig || {};
      dom.cfgTimeout.textContent    = cfg.timeout            != null ? `${cfg.timeout}ms`            : '—';
      dom.cfgThreshold.textContent  = cfg.errorThresholdPercentage != null ? `${cfg.errorThresholdPercentage}%` : '—';
      dom.cfgReset.textContent      = cfg.resetTimeout       != null ? `${cfg.resetTimeout}ms`       : '—';
      dom.cfgVolume.textContent     = cfg.volumeThreshold    != null ? `${cfg.volumeThreshold} reqs`  : '—';

      // Application metrics
      const m = d.metrics || {};
      dom.mTotal.textContent     = m.totalRequests      ?? '—';
      dom.mSuccess.textContent   = m.successfulRequests ?? '—';
      dom.mFailed.textContent    = m.failedRequests     ?? '—';
      dom.mFallbacks.textContent = m.fallbackResponses  ?? '—';
      dom.mTimeouts.textContent  = m.timeouts           ?? '—';
      dom.mInventory.textContent = m.inventoryRequests  ?? '—';

      // CB internal stats
      const s = d.circuitBreakerStats || {};
      dom.mCbSuccess.textContent   = s.successes ?? '—';
      dom.mCbFailures.textContent  = s.failures  ?? '—';
      dom.mCbTimeouts.textContent  = s.timeouts  ?? '—';
      dom.mCbRejects.textContent   = s.rejects   ?? '—';

      // Event log (server-side events)
      if (d.recentEvents && Array.isArray(d.recentEvents)) {
        renderEventLog(d.recentEvents);
      }

      dom.metricsUpdated.textContent = `Updated ${fmtTime(new Date().toISOString())}`;
    } else {
      renderCbState(null);
    }
  } finally {
    state.pollActive = false;
  }
}

/** Set a status badge's text and class. */
function setBadge(el, status) {
  el.className = 'status-badge';
  if (status === 'UP')   { el.className += ' badge-up';   el.textContent = '● UP'; }
  else                   { el.className += ' badge-down'; el.textContent = '● DOWN'; }
}

/* ═══════════════════════════════════════════════════════════
   7. Event Log Rendering
   ═══════════════════════════════════════════════════════════ */
const LOG_ICONS = {
  SUCCESS:       '✅',
  FAILURE:       '❌',
  ERROR:         '💥',
  TIMEOUT:       '⏱️',
  FALLBACK:      '🛡️',
  FALLBACK_RETURNED: '🛡️',
  STATE_CHANGE:  '⚡',
  REJECTED:      '🚫',
  ORDER_RECEIVED:'📥',
  ORDER_CONFIRMED:'🎉',
  OUT_OF_STOCK:  '⚠️',
  MANUAL_RESET:  '🔧',
  METRICS_RESET: '📊',
  VALIDATION_ERROR: '⚠️',
};

function renderEventLog(serverEvents) {
  // Merge server events with what we're already showing (by id)
  const existingIds = new Set(state.eventLogEntries.map(e => e.id));
  let hasNew = false;

  for (const ev of serverEvents) {
    if (!existingIds.has(ev.id)) {
      state.eventLogEntries.unshift(ev);
      hasNew = true;
    }
  }

  // Cap at 50
  if (state.eventLogEntries.length > 50) {
    state.eventLogEntries = state.eventLogEntries.slice(0, 50);
  }

  if (!hasNew && dom.eventLog.children.length > 1) return; // no changes

  if (state.eventLogEntries.length === 0) {
    dom.eventLog.innerHTML = '<div class="log-empty">Events will appear here as you place orders.</div>';
    return;
  }

  dom.eventLog.innerHTML = '';
  for (const ev of state.eventLogEntries) {
    const el = document.createElement('div');
    el.className = `log-entry type-${ev.type}`;
    el.innerHTML = `
      <span class="log-icon">${LOG_ICONS[ev.type] || '🔵'}</span>
      <span class="log-time">${fmtTime(ev.timestamp)}</span>
      <span class="log-msg">${escapeHtml(ev.message)}</span>
    `;
    dom.eventLog.appendChild(el);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════════
   8. Order Submission
   ═══════════════════════════════════════════════════════════ */
async function placeOrder(productId, quantity) {
  if (state.orderInProgress) return;
  state.orderInProgress = true;

  dom.placeOrderBtn.disabled = true;
  dom.placeOrderBtn.innerHTML = '<span class="loading-spinner"></span> Placing…';
  dom.orderResponseBox.className = 'response-box';
  dom.orderResponseBox.textContent = 'Sending request to Order Service…';

  const { ok, status, data } = await safeFetch(
    `${CONFIG.ORDER_SERVICE_URL}/api/orders`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ productId, quantity: parseInt(quantity, 10) }),
    },
  );

  // Classify the response
  let boxClass = 'response-box';
  let outcome  = 'FAILED';

  if (data && data.fallback === true) {
    boxClass += ' fallback';
    outcome   = 'FALLBACK';
    toast(`🛡️ Fallback — CB state: ${data.circuitBreakerState}`, 'warning');
  } else if (ok && data && data.success) {
    boxClass += ' success';
    outcome   = 'SUCCESS';
    toast(`✅ Order confirmed — ${data.order?.orderId}`, 'success');
  } else if (status === 409) {
    boxClass += ' warning';
    outcome   = 'OUT_OF_STOCK';
    toast('⚠️ Out of stock', 'warning');
  } else {
    boxClass += ' error';
    toast('❌ Order failed', 'error');
  }

  dom.orderResponseBox.className = boxClass;
  dom.orderResponseBox.textContent = data ? pretty(data) : 'No response received.';

  // Add to local request history
  const cbStateStr = data?.circuitBreakerState || '—';
  state.requestHistory.unshift({
    time:      fmtTime(new Date().toISOString()),
    productId,
    quantity,
    outcome,
    cbState:   cbStateStr,
  });
  if (state.requestHistory.length > 20) state.requestHistory.pop();
  renderHistory();

  // Immediately poll for updated state
  await poll();

  dom.placeOrderBtn.disabled = false;
  dom.placeOrderBtn.innerHTML = '🛒 Place Order';
  state.orderInProgress = false;
}

/* ═══════════════════════════════════════════════════════════
   9. Request History Rendering
   ═══════════════════════════════════════════════════════════ */
function renderHistory() {
  if (state.requestHistory.length === 0) {
    dom.historyTbody.innerHTML = `
      <tr><td colspan="5" style="text-align:center;color:var(--color-muted);padding:20px;">No requests yet.</td></tr>`;
    return;
  }

  dom.historyTbody.innerHTML = state.requestHistory.map(r => {
    const cls = r.outcome === 'SUCCESS' ? 'outcome-success'
              : r.outcome === 'FALLBACK' ? 'outcome-fallback'
              : 'outcome-failed';
    const cbDisplay = r.cbState === 'CLOSED'    ? '🟢 CLOSED'
                    : r.cbState === 'OPEN'      ? '🔴 OPEN'
                    : r.cbState === 'HALF_OPEN' ? '🟡 HALF-OPEN'
                    : r.cbState;
    return `
      <tr>
        <td>${escapeHtml(r.time)}</td>
        <td>${escapeHtml(r.productId)}</td>
        <td>${escapeHtml(String(r.quantity))}</td>
        <td class="${cls}">${escapeHtml(r.outcome)}</td>
        <td>${escapeHtml(cbDisplay)}</td>
      </tr>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   10. Simulation Mode Buttons
   ═══════════════════════════════════════════════════════════ */
async function changeSimMode(mode) {
  const { ok, data } = await safeFetch(
    `${CONFIG.INVENTORY_SERVICE_URL}/api/simulation/mode`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode }),
    },
  );

  const fb = dom.simFeedback;
  fb.classList.remove('show', 'ok', 'err');

  void fb.offsetWidth; // reflow to restart animation

  if (ok && data?.success) {
    fb.textContent = `✅ ${data.message || `Mode set to "${mode}".`}`;
    fb.className = 'sim-feedback show ok';
    toast(`🎭 Simulation: ${mode}`, 'info');
  } else {
    fb.textContent = `❌ ${data?.message || 'Failed to change mode.'}`;
    fb.className = 'sim-feedback show err';
    toast(`Failed to set mode "${mode}"`, 'error');
  }

  await poll();
}

/* ═══════════════════════════════════════════════════════════
   11. Circuit Breaker Reset
   ═══════════════════════════════════════════════════════════ */
async function resetCircuitBreaker() {
  const { ok, data } = await safeFetch(
    `${CONFIG.ORDER_SERVICE_URL}/api/circuit-breaker/reset`,
    { method: 'POST' },
  );
  if (ok && data?.success) {
    toast('🔧 Circuit breaker reset to CLOSED', 'success');
  } else {
    toast(data?.message || 'Could not reset circuit breaker', 'info');
  }
  await poll();
}

/* ═══════════════════════════════════════════════════════════
   12. Metrics Reset
   ═══════════════════════════════════════════════════════════ */
async function resetMetrics() {
  const { ok } = await safeFetch(
    `${CONFIG.ORDER_SERVICE_URL}/api/metrics/reset`,
    { method: 'POST' },
  );
  if (ok) {
    toast('📊 Metrics reset', 'info');
    state.eventLogEntries = [];
    dom.eventLog.innerHTML = '<div class="log-empty">Events will appear here as you place orders.</div>';
  } else {
    toast('Failed to reset metrics', 'error');
  }
  await poll();
}

/* ═══════════════════════════════════════════════════════════
   13. Event Bindings
   ═══════════════════════════════════════════════════════════ */
function bindEvents() {
  // Order form
  dom.orderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = dom.productSelect.value;
    const qty = dom.qtyInput.value;
    if (!pid || !qty || parseInt(qty, 10) < 1) {
      toast('Please fill in all fields correctly.', 'error');
      return;
    }
    await placeOrder(pid, qty);
  });

  // Simulation buttons
  dom.btnSimNormal.addEventListener('click',   () => changeSimMode('normal'));
  dom.btnSimFailure.addEventListener('click',  () => changeSimMode('failure'));
  dom.btnSimSlow.addEventListener('click',     () => changeSimMode('slow'));
  dom.btnSimRecovery.addEventListener('click', () => changeSimMode('recovery'));

  // CB / metrics resets
  dom.btnResetCb.addEventListener('click',      resetCircuitBreaker);
  dom.btnResetMetrics.addEventListener('click', resetMetrics);

  // Clear log
  dom.btnClearLog.addEventListener('click', () => {
    state.eventLogEntries = [];
    dom.eventLog.innerHTML = '<div class="log-empty">Log cleared.</div>';
  });

  // Clear history
  dom.btnClearHistory.addEventListener('click', () => {
    state.requestHistory = [];
    renderHistory();
  });
}

/* ═══════════════════════════════════════════════════════════
   14. Polling Loop
   ═══════════════════════════════════════════════════════════ */
let pollTimer = null;

function startPolling() {
  poll(); // immediate first call
  pollTimer = setInterval(poll, CONFIG.POLL_INTERVAL_MS);
}

/* ═══════════════════════════════════════════════════════════
   15. Initialise
   ═══════════════════════════════════════════════════════════ */
(function init() {
  bindEvents();
  startPolling();
  renderHistory(); // render empty state initially
  console.log('[Dashboard] Microservices Resilience Lab loaded.');
  console.log(`[Dashboard] Order Service:     ${CONFIG.ORDER_SERVICE_URL}`);
  console.log(`[Dashboard] Inventory Service: ${CONFIG.INVENTORY_SERVICE_URL}`);
})();
