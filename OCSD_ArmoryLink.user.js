// ==UserScript==
// @name         OCSD ArmoryLink
// @namespace    https://ocsd-armorylink
// @version      0.0.2
// @description  OCSD ArmoryLink Utility - Barcode-driven workflow for OCSD Loaner Workspace
// @author       P. Akhamlich
// @match        https://ocsheriff.servicenowservices.com/x/g/loaner-workspace/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// ==/UserScript==

/* **********************************************************************
 *  OCSD ArmoryLink v0.0.2 CGPT
 *  Module order:
 *  utils → stubs → capture → elements → rules → ui →
 *  persistence → exportManager → prefixes → macros →
 *  fields → bwc → x10 → activeContext → tabTitle →
 *  defaultsManager → broadcast → worker → init
 ***********************************************************************/

/* ===================== MODULE: utils ===================== */
const OCSDUtils = (() => {
    const APP_KEY = 'OCSD_ARMORYLINK';
    const TAB_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Simple deep clone
    function clone(obj) {
        return obj ? JSON.parse(JSON.stringify(obj)) : obj;
    }

    // Safe JSON parse
    function safeJSONParse(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return fallback;
        }
    }

    // Simple ID
    function uid(prefix = 'id') {
        return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
    }

    // Throttle
    function throttle(fn, delay) {
        let last = 0;
        let timeout = null;
        let lastArgs;
        return function (...args) {
            const now = Date.now();
            lastArgs = args;
            if (now - last >= delay) {
                last = now;
                fn.apply(this, args);
            } else if (!timeout) {
                timeout = setTimeout(() => {
                    last = Date.now();
                    timeout = null;
                    fn.apply(this, lastArgs);
                }, delay - (now - last));
            }
        };
    }

    // Simple debounce
    function debounce(fn, delay) {
        let timeout = null;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // Basic HTML sanitizer for innerHTML chunks
    function sanitizeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // Validation helpers (light for now)
    function validateRule(rule) {
        if (!rule || typeof rule !== 'object') return false;
        if (!rule.id) return false;
        if (!rule.patternType) return false;
        if (!rule.pattern) return false;
        return true;
    }

    function validateField(field) {
        if (!field || typeof field !== 'object') return false;
        if (!field.key) return false;
        return true;
    }

    // Simple event bus (local only)
    const listeners = {};
    function on(event, handler) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
    }
    function off(event, handler) {
        if (!listeners[event]) return;
        const idx = listeners[event].indexOf(handler);
        if (idx >= 0) listeners[event].splice(idx, 1);
    }
    function emit(event, payload) {
        (listeners[event] || []).forEach(fn => {
            try { fn(payload); } catch (e) { /* swallow */ }
        });
    }

    return {
        APP_KEY,
        TAB_ID,
        clone,
        safeJSONParse,
        uid,
        throttle,
        debounce,
        sanitizeHTML,
        validateRule,
        validateField,
        on,
        off,
        emit
    };
})();

/* ===================== MODULE: stubs (logging, toast, ticker) ===================== */
const OCSDStubs = (() => {
    const logBuffer = [];
    const MAX_LOG = 500;

    function pushLog(level, category, message, data) {
        const entry = {
            ts: Date.now(),
            level,
            category,
            message,
            data: data || null
        };
        logBuffer.push(entry);
        if (logBuffer.length > MAX_LOG) logBuffer.shift();
        // Notify UI if mounted
        OCSDUtils.emit('debug:update', entry);
    }

    function debug(level, category, message, data) {
        // level: info | warn | error
        pushLog(level || 'info', category || 'system', message || '', data || null);
    }

    // Toasts (rendered by UI module)
    function toast(message, type = 'info', options = {}) {
        OCSDUtils.emit('toast:show', {
            id: OCSDUtils.uid('toast'),
            message,
            type,
            options
        });
    }

    // Ticker (status bar inside panel)
    let tickerState = {
        type: '',
        user: '',
        weapon: '',
        vehicle: '',
        scanner: 'off'
    };

    function updateTicker(partial) {
        tickerState = Object.assign({}, tickerState, partial || {});
        OCSDUtils.emit('ticker:update', tickerState);
    }

    function getLogs() {
        return logBuffer.slice();
    }

    return {
        debug,
        toast,
        updateTicker,
        getLogs
    };
})();

/* ===================== MODULE: capture ===================== */
const OCSDSCapture = (() => {
    // Scanner capture modes: "on", "standby", "off"
    let mode = 'on';
    let buffer = '';
    let lastKeyTime = 0;
    const SCAN_TIMEOUT_MS = 80; // time between keystrokes to consider same scan
    const MIN_SCAN_LEN = 3;
    const queue = [];
    let processing = false;
    const MAX_EXEC_MS = 10000;

    function setMode(newMode) {
        if (!['on', 'standby', 'off'].includes(newMode)) return;
        mode = newMode;
        OCSDStubs.debug('info', 'capture', 'Mode changed', { mode });
        OCSDStubs.updateTicker({ scanner: mode });
        OCSDUtils.emit('capture:mode', mode);
        if (mode === 'off') {
            queue.length = 0;
        }
    }

    function getMode() {
        return mode;
    }

    function enqueueScan(scan) {
        if (!scan) return;
        queue.push({
            id: OCSDUtils.uid('scan'),
            value: scan,
            ts: Date.now()
        });
        OCSDStubs.debug('info', 'capture', 'Scan enqueued', { scan });
        OCSDUtils.emit('queue:update');
        processQueue();
    }

    async function processQueue() {
        if (processing || mode === 'off') return;
        if (!queue.length) return;
        processing = true;
        const started = Date.now();

        try {
            while (queue.length && mode === 'on') {
                if (Date.now() - started > MAX_EXEC_MS) {
                    OCSDStubs.debug('warn', 'capture', 'Queue processing timeout; unlocking');
                    break;
                }
                const item = queue.shift();
                OCSDUtils.emit('queue:update');
                await OCRulesEngine.processScan(item.value);
            }
        } catch (e) {
            OCSDStubs.debug('error', 'capture', 'Error processing queue', { error: String(e) });
        } finally {
            processing = false;
        }
    }

    function clearQueue() {
        queue.length = 0;
        OCSDUtils.emit('queue:update');
    }

    function getQueue() {
        return queue.slice();
    }

    function keyHandler(ev) {
        if (mode === 'off') return;
        // Ignore modifier keys / ctrl combos
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
        if (ev.target && ['INPUT', 'TEXTAREA'].includes(ev.target.tagName)) return;

        const now = Date.now();
        if (now - lastKeyTime > SCAN_TIMEOUT_MS) {
            buffer = '';
        }
        lastKeyTime = now;

        if (ev.key === 'Enter') {
            const scan = buffer.trim();
            buffer = '';
            if (scan.length >= MIN_SCAN_LEN) {
                if (mode === 'on') {
                    enqueueScan(scan);
                } else if (mode === 'standby') {
                    // standby: queue paused but we still record
                    queue.push({
                        id: OCSDUtils.uid('scan'),
                        value: scan,
                        ts: Date.now()
                    });
                    OCSDUtils.emit('queue:update');
                    OCSDStubs.toast(`Scan captured (standby): ${scan}`, 'info', { duration: 1500 });
                }
            }
        } else if (ev.key.length === 1) {
            buffer += ev.key;
        }
    }

    function attach() {
        document.addEventListener('keydown', keyHandler, true);
        OCSDStubs.debug('info', 'capture', 'Keyboard capture attached');
    }

    function detach() {
        document.removeEventListener('keydown', keyHandler, true);
        OCSDStubs.debug('info', 'capture', 'Keyboard capture detached');
    }

    // Hotkeys: Alt+Shift+O/S/X
    function hotkeyHandler(ev) {
        if (!ev.altKey || !ev.shiftKey) return;
        if (ev.key === 'O') {
            setMode('on');
            OCSDStubs.toast('Scanner ON', 'success');
        } else if (ev.key === 'S') {
            setMode('standby');
            OCSDStubs.toast('Scanner STANDBY', 'info');
        } else if (ev.key === 'X') {
            setMode('off');
            OCSDStubs.toast('Scanner OFF', 'warn');
        }
    }

    function attachHotkeys() {
        document.addEventListener('keydown', hotkeyHandler, false);
    }

    function detachHotkeys() {
        document.removeEventListener('keydown', hotkeyHandler, false);
    }

    return {
        setMode,
        getMode,
        enqueueScan,
        clearQueue,
        getQueue,
        attach,
        detach,
        attachHotkeys,
        detachHotkeys
    };
})();

/* ===================== MODULE: elements ===================== */
const OCSDElements = (() => {
    let cache = new Map();
    let cacheEnabled = true;
    let cacheTimeout = 5000; // ms
    const lastSeen = new Map();

    function keyFromSelector(selector) {
        return selector;
    }

    function find(selector, root = document) {
        if (!selector) return null;
        const key = keyFromSelector(selector);
        const now = Date.now();

        if (cacheEnabled && cache.has(key)) {
            const age = now - (lastSeen.get(key) || 0);
            if (age < cacheTimeout) {
                const cached = cache.get(key);
                if (cached && document.contains(cached)) {
                    return cached;
                }
            }
            cache.delete(key);
            lastSeen.delete(key);
        }

        const el = root.querySelector(selector);
        if (cacheEnabled && el) {
            cache.set(key, el);
            lastSeen.set(key, now);
        }
        return el;
    }

    function findAll(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
    }

    function value(el, newValue) {
        if (!el) return '';
        if (newValue !== undefined) {
            if ('value' in el) {
                el.value = newValue;
            } else {
                el.textContent = newValue;
            }
            return newValue;
        } else {
            return 'value' in el ? (el.value || '') : (el.textContent || '');
        }
    }

    function clearCache() {
        cache.clear();
        lastSeen.clear();
    }

    function configureCache(opt = {}) {
        if (typeof opt.enabled === 'boolean') cacheEnabled = opt.enabled;
        if (typeof opt.timeout === 'number') cacheTimeout = opt.timeout;
    }

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 &&
            rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.left <= (window.innerWidth || document.documentElement.clientWidth);
    }

    function scrollIntoView(el) {
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    return {
        find,
        findAll,
        value,
        clearCache,
        configureCache,
        isVisible,
        scrollIntoView
    };
})();

/* ===================== MODULE: rules ===================== */
const OCRulesEngine = (() => {
    // Symbol-based directives: / = Return, * = Deployment
    const directiveMap = {
        '/': 'Return',
        '*': 'Deployment'
    };

    let rules = [];

    function setRules(newRules) {
        rules = Array.isArray(newRules) ? newRules.filter(OCSDUtils.validateRule) : [];
        OCSDStubs.debug('info', 'rules', 'Rules set', { count: rules.length });
        OCSDUtils.emit('rules:update', rules);
    }

    function getRules() {
        return rules.slice();
    }

    function addRule(rule) {
        if (!OCSDUtils.validateRule(rule)) return false;
        rules.push(rule);
        OCSDUtils.emit('rules:update', rules);
        return true;
    }

    function testPattern(patternType, pattern, value) {
        if (!value) return null;
        switch (patternType) {
            case 'regex':
                try {
                    const regex = new RegExp(pattern);
                    const match = value.match(regex);
                    if (match) {
                        return { matched: true, groups: match, fullMatch: match[0] };
                    }
                } catch (e) {
                    OCSDStubs.debug('error', 'rules', 'Invalid regex', { pattern, error: String(e) });
                }
                return null;
            case 'string':
                if (value === pattern) {
                    return { matched: true, groups: [value], fullMatch: value };
                }
                return null;
            case 'startsWith':
                if (value.startsWith(pattern)) {
                    return { matched: true, groups: [value], fullMatch: value };
                }
                return null;
            case 'contains':
                if (value.includes(pattern)) {
                    return { matched: true, groups: [value], fullMatch: value };
                }
                return null;
            case 'endsWith':
                if (value.endsWith(pattern)) {
                    return { matched: true, groups: [value], fullMatch: value };
                }
                return null;
            default:
                OCSDStubs.debug('warn', 'rules', 'Unknown pattern type', { patternType });
                return null;
        }
    }

    function extractDirective(matchResult, directiveGroupIndex) {
        if (!matchResult || directiveGroupIndex == null) return null;
        const groups = matchResult.groups || [];
        const symbol = groups[directiveGroupIndex];
        if (symbol && directiveMap[symbol]) {
            return directiveMap[symbol];
        }
        return null;
    }

    function substituteTokens(template, context) {
        if (!template || typeof template !== 'string') return template;
        let result = template;

        // ${scan}
        if (context.scan !== undefined) {
            result = result.replace(/\$\{scan\}/g, context.scan);
        }
        // ${directive}
        if (context.directive !== undefined) {
            result = result.replace(/\$\{directive\}/g, context.directive || '');
        }
        // ${0}, ${1}, ${2}, ...
        if (Array.isArray(context.groups)) {
            context.groups.forEach((val, idx) => {
                const re = new RegExp(`\\$\\{${idx}\\}`, 'g');
                result = result.replace(re, val || '');
            });
        }
        // ${field:userKey}
        result = result.replace(/\$\{field:([a-zA-Z0-9_\-]+)\}/g, (m, key) => {
            try {
                const val = OCSDFields.getFieldValueByKey(key);
                return val != null ? val : '';
            } catch (e) {
                return '';
            }
        });

        return result;
    }

    function runAction(action, context) {
        if (!action || typeof action !== 'object') return;
        const type = action.type;

        switch (type) {
            case 'fill': {
                const fieldKey = action.fieldKey;
                const raw = action.value || '';
                const value = substituteTokens(raw, context);
                OCSDFields.setFieldValueByKey(fieldKey, value);
                break;
            }
            case 'click': {
                const fieldKey = action.fieldKey;
                OCSDFields.clickFieldByKey(fieldKey);
                break;
            }
            case 'select': {
                const fieldKey = action.fieldKey;
                const raw = action.value || '';
                const value = substituteTokens(raw, context);
                OCSDFields.setFieldValueByKey(fieldKey, value);
                break;
            }
            case 'runMacro': {
                const macroId = action.macroId;
                OCSDMacros.runMacro(macroId, context);
                break;
            }
            case 'bwc.process': {
                OCSDBWC.processScan(context.scan, context);
                break;
            }
            case 'x10.process': {
                OCSDX10.processScan(context.scan, context);
                break;
            }
            case 'toast': {
                const msg = substituteTokens(action.message || '', context);
                OCSDStubs.toast(msg, action.toastType || 'info');
                break;
            }
            default:
                OCSDStubs.debug('warn', 'rules', 'Unknown action type', { type });
        }
    }

    async function processScan(scan) {
        OCSDStubs.debug('info', 'rules', 'Processing scan', { scan });
        let matchedRule = null;
        let matchResult = null;
        let directive = null;

        for (const rule of rules) {
            const res = testPattern(rule.patternType, rule.pattern, scan);
            if (res && res.matched) {
                matchedRule = rule;
                matchResult = res;
                if (rule.directiveGroupIndex != null) {
                    directive = extractDirective(res, rule.directiveGroupIndex);
                }
                break;
            }
        }

        if (!matchedRule) {
            OCSDStubs.toast(`No rule matched: ${scan}`, 'warn');
            OCSDStubs.debug('info', 'rules', 'No rule matched', { scan });
            return;
        }

        const context = {
            scan,
            directive,
            groups: matchResult.groups || []
        };

        if (Array.isArray(matchedRule.actions)) {
            for (const action of matchedRule.actions) {
                runAction(action, context);
            }
        }

        // Update ticker
        if (directive) {
            OCSDStubs.updateTicker({ type: directive });
        }

        OCSDStubs.toast(`Processed: ${scan}`, 'success');
        OCSDStubs.debug('info', 'rules', 'Scan processed', { scan, ruleId: matchedRule.id });
    }

    return {
        setRules,
        getRules,
        addRule,
        processScan,
        testPattern,
        substituteTokens
    };
})();

/* ===================== MODULE: ui ===================== */
const OCSDUI = (() => {
    let panelEl = null;
    let bubbleEl = null;
    let activeTab = 'dashboard';
    let layoutMode = 'dock-right'; // dock-right | dock-bottom | float | left-strip
    let topGap = 0;
    const toastContainerId = 'ocsd-toast-container';
    let tickerState = {
        type: '',
        user: '',
        weapon: '',
        vehicle: '',
        scanner: 'off'
    };

    function injectStyles() {
        const css = `
:root {
  --ocsd-green: #2C5234;
  --ocsd-gold: #B19A55;
  --ocsd-bg: #ffffff;
  --ocsd-surface: #f5f5f5;
  --ocsd-border: #ccc;
  --ocsd-text: #222;
  --ocsd-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
#ocsd-armorylink-panel {
  position: fixed;
  right: 16px;
  top: var(--ocsd-top-gap, 16px);
  width: 640px;
  max-height: calc(100vh - var(--ocsd-top-gap, 16px) - 16px);
  background: var(--ocsd-bg);
  border: 1px solid var(--ocsd-border);
  border-radius: 10px;
  box-shadow: var(--ocsd-shadow);
  z-index: 999999;
  font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  display: flex;
  flex-direction: column;
}
#ocsd-armorylink-panel.ocsd-hidden {
  display: none !important;
}
.ocsd-panel-header {
  background: var(--ocsd-green);
  color: #fff;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ocsd-panel-header h2 {
  margin: 0;
  font-size: 16px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ocsd-signature {
  font-family: "Brush Script MT","Segoe Script",cursive;
  font-size: 14px;
  opacity: 0.9;
}
.ocsd-status-badges {
  font-size: 11px;
  margin-top: 2px;
}
.ocsd-header-controls {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ocsd-header-button,
.ocsd-close-btn {
  border: none;
  background: rgba(0,0,0,0.15);
  color: #fff;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ocsd-panel-tabs {
  display: flex;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--ocsd-border);
  background: #fafafa;
}
.ocsd-tab-btn {
  border: none;
  background: transparent;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ocsd-tab-btn.active {
  border-bottom: 2px solid var(--ocsd-green);
  font-weight: 600;
}
.ocsd-panel-body {
  padding: 8px;
  overflow: auto;
  flex: 1;
  background: var(--ocsd-surface);
}
.ocsd-ticker {
  font-size: 11px;
  padding: 4px 8px;
  border-top: 1px solid var(--ocsd-border);
  background: #fff;
  display: flex;
  gap: 12px;
}
.ocsd-ticker span {
  white-space: nowrap;
}

/* Toasts */
#${toastContainerId} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1000000;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ocsd-toast {
  background: #333;
  color: #fff;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  box-shadow: 0 3px 8px rgba(0,0,0,0.2);
}
.ocsd-toast-success { background: #2e7d32; }
.ocsd-toast-warn { background: #f57c00; }
.ocsd-toast-error { background: #c62828; }
.ocsd-toast-info { background: #1976d2; }

/* Bubble */
#ocsd-armorylink-bubble {
  position: fixed;
  right: 16px;
  bottom: 80px;
  width: 40px;
  height: 40px;
  background: var(--ocsd-green);
  color: #fff;
  border-radius: 50%;
  box-shadow: var(--ocsd-shadow);
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 999999;
}

/* Simple cards / lists */
.ocsd-section {
  margin-bottom: 10px;
  background: #fff;
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.ocsd-section h3 {
  margin: 0 0 6px;
  font-size: 13px;
}
.ocsd-form-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.ocsd-form-row label {
  font-size: 12px;
  flex: 1;
}
.ocsd-input,
.ocsd-select,
.ocsd-textarea {
  width: 100%;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid #ccc;
  box-sizing: border-box;
}
.ocsd-btn {
  font-size: 12px;
  border-radius: 4px;
  border: none;
  padding: 4px 8px;
  cursor: pointer;
}
.ocsd-btn-primary {
  background: var(--ocsd-green);
  color: #fff;
}
.ocsd-btn-ghost {
  background: transparent;
  border: 1px solid #ccc;
}
.ocsd-empty-state {
  font-size: 12px;
  color: #666;
  padding: 6px;
}

/* Debug list */
.ocsd-debug-log {
  font-family: "Courier New",monospace;
  font-size: 11px;
  max-height: 240px;
  overflow: auto;
  background: #111;
  color: #eee;
  padding: 4px;
  border-radius: 4px;
}
.ocsd-debug-entry-info { color: #90caf9; }
.ocsd-debug-entry-warn { color: #ffb74d; }
.ocsd-debug-entry-error { color: #ef9a9a; }
`.trim();

        GM_addStyle(css);
    }

    function createPanel() {
        if (panelEl) return;
        panelEl = document.createElement('div');
        panelEl.id = 'ocsd-armorylink-panel';
        panelEl.innerHTML = `
            <div class="ocsd-panel-header">
                <div>
                    <h2>OCSD ArmoryLink<span class="ocsd-signature">By P. Akhamlich</span></h2>
                    <div class="ocsd-status-badges" id="ocsd-status-badges"></div>
                </div>
                <span class="ocsd-header-controls">
                    <button class="ocsd-header-button" id="ocsd-layout-cycle-btn" title="Cycle Layout">L</button>
                    <button class="ocsd-header-button" id="ocsd-armorylink-minimize-btn" title="Minimize">–</button>
                    <button class="ocsd-close-btn" id="ocsd-armorylink-close-btn" title="Close">×</button>
                </span>
            </div>
            <div class="ocsd-panel-tabs">
                <button class="ocsd-tab-btn active" data-tab="dashboard">Dashboard</button>
                <button class="ocsd-tab-btn" data-tab="queue">Queue</button>
                <button class="ocsd-tab-btn" data-tab="rules">Rules</button>
                <button class="ocsd-tab-btn" data-tab="fields">Fields</button>
                <button class="ocsd-tab-btn" data-tab="prefixes">Prefixes</button>
                <button class="ocsd-tab-btn" data-tab="macros">Macros</button>
                <button class="ocsd-tab-btn" data-tab="bwc">BWC</button>
                <button class="ocsd-tab-btn" data-tab="x10">X10</button>
                <button class="ocsd-tab-btn" data-tab="settings">Settings</button>
                <button class="ocsd-tab-btn" data-tab="debug">Debug</button>
            </div>
            <div class="ocsd-panel-body" id="ocsd-panel-body"></div>
            <div class="ocsd-ticker" id="ocsd-ticker-bar">
                <span>Type: <strong id="ocsd-ticker-type">—</strong></span>
                <span>User: <strong id="ocsd-ticker-user">—</strong></span>
                <span>Weapon: <strong id="ocsd-ticker-weapon">—</strong></span>
                <span>Vehicle: <strong id="ocsd-ticker-vehicle">—</strong></span>
                <span>Scanner: <strong id="ocsd-ticker-scanner">off</strong></span>
            </div>
        `;
        document.body.appendChild(panelEl);

        // Bubble
        bubbleEl = document.createElement('div');
        bubbleEl.id = 'ocsd-armorylink-bubble';
        bubbleEl.textContent = 'AL';
        document.body.appendChild(bubbleEl);

        bubbleEl.addEventListener('click', () => {
            panelEl.classList.remove('ocsd-hidden');
            bubbleEl.style.display = 'none';
        });

        // Hook tab buttons
        Array.from(panelEl.querySelectorAll('.ocsd-tab-btn')).forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                setActiveTab(tab);
            });
        });

        // Minimize
        panelEl.querySelector('#ocsd-armorylink-minimize-btn').addEventListener('click', () => {
            panelEl.classList.add('ocsd-hidden');
            bubbleEl.style.display = 'flex';
        });
        // Close
        panelEl.querySelector('#ocsd-armorylink-close-btn').addEventListener('click', () => {
            panelEl.classList.add('ocsd-hidden');
            bubbleEl.style.display = 'flex';
        });

        // Layout cycle
        panelEl.querySelector('#ocsd-layout-cycle-btn').addEventListener('click', () => {
            cycleLayout();
        });

        applyLayout();
        renderActiveTab();
        updateTickerBar();
    }

    function setTopGap(px) {
        topGap = Math.max(0, px | 0);
        if (layoutMode === 'dock-right' || layoutMode === 'left-strip') {
            document.documentElement.style.setProperty('--ocsd-top-gap', `${topGap}px`);
        }
    }

    function cycleLayout() {
        const order = ['dock-right', 'dock-bottom', 'float', 'left-strip'];
        const idx = order.indexOf(layoutMode);
        layoutMode = order[(idx + 1) % order.length];
        applyLayout();
    }

    function applyLayout() {
        if (!panelEl) return;
        const style = panelEl.style;
        if (layoutMode === 'dock-right') {
            style.position = 'fixed';
            style.right = '16px';
            style.left = '';
            style.bottom = '';
            style.top = '';
            document.documentElement.style.setProperty('--ocsd-top-gap', `${topGap}px`);
        } else if (layoutMode === 'dock-bottom') {
            style.position = 'fixed';
            style.left = '16px';
            style.right = '16px';
            style.bottom = '16px';
            style.top = '';
        } else if (layoutMode === 'float') {
            style.position = 'fixed';
            style.right = '16px';
            style.top = '16px';
        } else if (layoutMode === 'left-strip') {
            style.position = 'fixed';
            style.left = '16px';
            style.top = '';
            document.documentElement.style.setProperty('--ocsd-top-gap', `${topGap}px`);
        }
        OCSDStubs.debug('info', 'ui', 'Layout applied', { layoutMode, topGap });
    }

    function setActiveTab(tab) {
        activeTab = tab;
        const tabs = Array.from(panelEl.querySelectorAll('.ocsd-tab-btn'));
        tabs.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
        });
        renderActiveTab();
    }

    function renderActiveTab() {
        if (!panelEl) return;
        const body = panelEl.querySelector('#ocsd-panel-body');
        if (!body) return;
        switch (activeTab) {
            case 'dashboard':
                body.innerHTML = renderDashboard();
                hookDashboard();
                break;
            case 'queue':
                body.innerHTML = renderQueue();
                hookQueue();
                break;
            case 'rules':
                body.innerHTML = renderRules();
                hookRules();
                break;
            case 'fields':
                body.innerHTML = renderFields();
                hookFields();
                break;
            case 'prefixes':
                body.innerHTML = renderPrefixes();
                hookPrefixes();
                break;
            case 'macros':
                body.innerHTML = renderMacros();
                hookMacros();
                break;
            case 'bwc':
                body.innerHTML = renderBWC();
                hookBWC();
                break;
            case 'x10':
                body.innerHTML = renderX10();
                hookX10();
                break;
            case 'settings':
                body.innerHTML = renderSettings();
                hookSettings();
                break;
            case 'debug':
                body.innerHTML = renderDebug();
                hookDebug();
                break;
            default:
                body.innerHTML = '<p class="ocsd-empty-state">Unknown tab</p>';
        }
    }

    function renderDashboard() {
        const mode = OCSDSCapture.getMode();
        return `
            <div class="ocsd-section">
                <h3>Scanner Capture</h3>
                <p>Current mode: <strong>${mode}</strong></p>
                <div class="ocsd-form-row">
                    <button class="ocsd-btn ocsd-btn-primary" data-capture-mode="on">On</button>
                    <button class="ocsd-btn ocsd-btn-ghost" data-capture-mode="standby">Standby</button>
                    <button class="ocsd-btn ocsd-btn-ghost" data-capture-mode="off">Off</button>
                </div>
                <small>Hotkeys: Alt+Shift+O (On), S (Standby), X (Off)</small>
            </div>
            <div class="ocsd-section">
                <h3>Quick Test Scan</h3>
                <div class="ocsd-form-row">
                    <label>
                        Test string
                        <input type="text" id="ocsd-test-scan-input" class="ocsd-input" placeholder="/01234 or *98765">
                    </label>
                </div>
                <button class="ocsd-btn ocsd-btn-primary" id="ocsd-test-scan-btn">Run through rules</button>
            </div>
        `;
    }

    function hookDashboard() {
        const body = panelEl.querySelector('#ocsd-panel-body');
        body.querySelectorAll('[data-capture-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-capture-mode');
                OCSDSCapture.setMode(mode);
                renderActiveTab();
            });
        });
        const testBtn = body.querySelector('#ocsd-test-scan-btn');
        const testInput = body.querySelector('#ocsd-test-scan-input');
        if (testBtn && testInput) {
            testBtn.addEventListener('click', () => {
                const val = testInput.value.trim();
                if (!val) return;
                OCRulesEngine.processScan(val);
            });
        }
    }

    function renderQueue() {
        const q = OCSDSCapture.getQueue();
        if (!q.length) {
            return `
            <div class="ocsd-section">
                <h3>Scan Queue</h3>
                <p class="ocsd-empty-state">No scans queued.</p>
                <button class="ocsd-btn ocsd-btn-ghost" id="ocsd-queue-refresh-btn">Refresh</button>
            </div>`;
        }
        const items = q.map(item => {
            const ts = new Date(item.ts).toLocaleTimeString();
            return `<li>[${ts}] ${OCSDUtils.sanitizeHTML(item.value)}</li>`;
        }).join('');
        return `
            <div class="ocsd-section">
                <h3>Scan Queue (${q.length})</h3>
                <ul>${items}</ul>
                <div class="ocsd-form-row">
                    <button class="ocsd-btn ocsd-btn-ghost" id="ocsd-queue-refresh-btn">Refresh</button>
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-queue-clear-btn">Clear Queue</button>
                </div>
            </div>
        `;
    }

    function hookQueue() {
        const body = panelEl.querySelector('#ocsd-panel-body');
        const refreshBtn = body.querySelector('#ocsd-queue-refresh-btn');
        const clearBtn = body.querySelector('#ocsd-queue-clear-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                renderActiveTab();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Clear all queued scans?')) {
                    OCSDSCapture.clearQueue();
                    renderActiveTab();
                    OCSDStubs.toast('Queue cleared', 'success');
                }
            });
        }
    }

    function renderRules() {
        const rules = OCRulesEngine.getRules();
        const rows = rules.map(r => `
            <tr>
                <td>${OCSDUtils.sanitizeHTML(r.id)}</td>
                <td>${OCSDUtils.sanitizeHTML(r.patternType)}</td>
                <td><code>${OCSDUtils.sanitizeHTML(r.pattern)}</code></td>
                <td>${r.directiveGroupIndex != null ? r.directiveGroupIndex : ''}</td>
                <td>${r.actions ? r.actions.length : 0}</td>
            </tr>
        `).join('');

        return `
            <div class="ocsd-section">
                <h3>Rules</h3>
                <table style="width:100%; font-size:11px; border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th style="text-align:left;">ID</th>
                            <th style="text-align:left;">Type</th>
                            <th style="text-align:left;">Pattern</th>
                            <th style="text-align:left;">Directive Group</th>
                            <th style="text-align:left;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="5" class="ocsd-empty-state">No rules configured.</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div class="ocsd-section">
                <h3>Test Pattern</h3>
                <div class="ocsd-form-row">
                    <label>
                        Pattern Type
                        <select id="ocsd-test-pattern-type" class="ocsd-select">
                            <option value="regex">Regex</option>
                            <option value="string">String</option>
                            <option value="startsWith">Starts With</option>
                            <option value="contains">Contains</option>
                            <option value="endsWith">Ends With</option>
                        </select>
                    </label>
                    <label>
                        Pattern
                        <input id="ocsd-test-pattern-pattern" class="ocsd-input" placeholder="^(/|\\*)?(\\d{5})$">
                    </label>
                </div>
                <div class="ocsd-form-row">
                    <label>
                        Test Value
                        <input id="ocsd-test-pattern-value" class="ocsd-input" placeholder="/01234">
                    </label>
                </div>
                <button class="ocsd-btn ocsd-btn-primary" id="ocsd-test-pattern-btn">Test Pattern</button>
                <div id="ocsd-test-results" style="margin-top:6px; font-size:11px;"></div>
            </div>
            <div class="ocsd-section">
                <h3>Symbol-Based Directives</h3>
                <ul style="font-size:11px; margin:0 0 4px 16px;">
                    <li><strong>/</strong> → Return</li>
                    <li><strong>*</strong> → Deployment</li>
                </ul>
                <p style="font-size:11px; margin:0;">Use capture group for directive symbol and set <code>directiveGroupIndex</code> in the rule.</p>
            </div>
        `;
    }

    function hookRules() {
        const body = panelEl.querySelector('#ocsd-panel-body');
        const btn = body.querySelector('#ocsd-test-pattern-btn');
        const typeEl = body.querySelector('#ocsd-test-pattern-type');
        const patEl = body.querySelector('#ocsd-test-pattern-pattern');
        const valEl = body.querySelector('#ocsd-test-pattern-value');
        const outEl = body.querySelector('#ocsd-test-results');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const t = typeEl.value;
            const p = patEl.value;
            const v = valEl.value;
            const res = OCRulesEngine.testPattern(t, p, v);
            if (res && res.matched) {
                outEl.textContent = 'Matched. Groups: ' + JSON.stringify(Array.from(res.groups));
            } else {
                outEl.textContent = 'No match.';
            }
        });
    }

    function renderFields() {
        const fields = OCSDFields.getAllFields();
        if (!Object.keys(fields).length) {
            return `
                <div class="ocsd-section">
                    <h3>Fields</h3>
                    <p class="ocsd-empty-state">No fields configured yet.</p>
                </div>
            `;
        }
        const cards = Object.keys(fields).map(key => {
            const f = fields[key];
            return `
                <div class="ocsd-section">
                    <h3>${OCSDUtils.sanitizeHTML(f.label)} (${OCSDUtils.sanitizeHTML(key)})</h3>
                    <p style="font-size:11px; margin:0 0 4px;">Roles: ${(f.roles || []).join(', ') || 'none'}</p>
                    <p style="font-size:11px; margin:0 0 4px;">Selector: <code>${OCSDUtils.sanitizeHTML(f.selector || '')}</code></p>
                    <div class="ocsd-form-row">
                        <button class="ocsd-btn ocsd-btn-ghost" data-field-test="${key}">Test</button>
                        <button class="ocsd-btn ocsd-btn-ghost" data-field-reset="${key}">Reset</button>
                    </div>
                </div>
            `;
        }).join('');
        return cards;
    }

    function hookFields() {
        const body = panelEl.querySelector('#ocsd-panel-body');
        body.querySelectorAll('[data-field-test]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-field-test');
                const ok = OCSDFields.detect(key);
                if (ok) {
                    OCSDStubs.toast(`Field detected: ${key}`, 'success');
                } else {
                    OCSDStubs.toast(`Field NOT found: ${key}`, 'error');
                }
            });
        });
        body.querySelectorAll('[data-field-reset]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-field-reset');
                OCSDFields.reset(key);
                OCSDStubs.toast(`Field reset: ${key}`, 'success');
            });
        });
    }

    function renderPrefixes() {
        const prefixes = OCPrefixes.getAll();
        const list = prefixes.map(p => `
            <div class="ocsd-section">
                <h3>${OCSDUtils.sanitizeHTML(p.label)}</h3>
                <p style="font-size:11px; margin:0 0 4px;">Symbol: <code>${OCSDUtils.sanitizeHTML(p.symbol)}</code></p>
                <button class="ocsd-btn ocsd-btn-primary" data-prefix-activate="${p.id}">Use prefix</button>
            </div>
        `).join('');
        return `
            <div class="ocsd-section">
                <h3>Prefixes</h3>
                <p style="font-size:11px;">No default prefixes. Add your own via settings/export config (handled by Claude build flow).</p>
            </div>
            ${list}
        `;
    }

    function hookPrefixes() {
        const body = panelEl.querySelector('#ocsd-panel-body');
        body.querySelectorAll('[data-prefix-activate]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-prefix-activate');
                OCPrefixes.setActive(id);
            });
        });
    }

    function renderMacros() {
        const macros = OCSDMacros.getAll();
        if (!macros.length) {
            return `
                <div class="ocsd-section">
                    <h3>Macros</h3>
                    <p class="ocsd-empty-state">No macros configured.</p>
                </div>
            `;
        }
        const list = macros.map(m => `
            <div class="ocsd-section">
                <h3>${OCSDUtils.sanitizeHTML(m.name)}</h3>
                <p style="font-size:11px; margin:0 0 4px;">Steps: ${m.steps.length}</p>
                <button class="ocsd-btn ocsd-btn-primary" data-macro-run="${m.id}">Run</button>
            </div>
        `).join('');
        return list;
    }

    function hookMacros() {
        const body = panelEl.querySelector('#ocsd-panel-body');
        body.querySelectorAll('[data-macro-run]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-macro-run');
                OCSDMacros.runMacro(id, {});
            });
        });
    }

    function renderBWC() {
        return `
            <div class="ocsd-section">
                <h3>BWC (Axon) Resolver</h3>
                <p style="font-size:11px;">Scans routed by rules with action <code>bwc.process</code> will be handled here.</p>
                <p style="font-size:11px;">Current mode: passive — uses ServiceNow PID field only; does not write back.</p>
            </div>
        `;
    }

    function hookBWC() { }

    function renderX10() {
        return `
            <div class="ocsd-section">
                <h3>X10 TASER Resolver</h3>
                <p style="font-size:11px;">Scans routed by rules with action <code>x10.process</code> will be handled here.</p>
                <p style="font-size:11px;">Current mode: passive — uses ServiceNow PID field only; does not write back.</p>
            </div>
        `;
    }

    function hookX10() { }

    function renderSettings() {
        const mode = OCSDSCapture.getMode();
        return `
            <div class="ocsd-section">
                <h3>Capture</h3>
                <p style="font-size:11px;">Mode: <strong>${mode}</strong></p>
                <p style="font-size:11px;">Scanner modes: On / Standby / Off. Queue clears when turned Off.</p>
            </div>
            <div class="ocsd-section">
                <h3>Layout</h3>
                <p style="font-size:11px;">Current layout: <strong>${layoutMode}</strong></p>
                <div class="ocsd-form-row">
                    <label>
                        Top Gap (dock-right / left-strip)
                        <input id="ocsd-top-gap-input" class="ocsd-input" type="number" min="0" value="${topGap}">
                    </label>
                </div>
                <button class="ocsd-btn ocsd-btn-primary" id="ocsd-top-gap-apply-btn">Apply Gap</button>
            </div>
        `;
    }

    function hookSettings() {
        const body = panelEl.querySelector('#ocsd-panel-body');
        const gapInput = body.querySelector('#ocsd-top-gap-input');
        const gapBtn = body.querySelector('#ocsd-top-gap-apply-btn');
        if (gapBtn && gapInput) {
            gapBtn.addEventListener('click', () => {
                const v = parseInt(gapInput.value, 10) || 0;
                setTopGap(v);
            });
        }
    }

    function renderDebug() {
        const logs = OCSDStubs.getLogs();
        const lines = logs.map(l => {
            const ts = new Date(l.ts).toLocaleTimeString();
            const cls = l.level === 'error' ? 'ocsd-debug-entry-error'
                : l.level === 'warn' ? 'ocsd-debug-entry-warn'
                    : 'ocsd-debug-entry-info';
            return `<div class="${cls}">[${ts}] [${l.level}] [${l.category}] ${OCSDUtils.sanitizeHTML(l.message)}</div>`;
        }).join('');
        return `
            <div class="ocsd-section">
                <h3>Debug Log</h3>
                <div class="ocsd-debug-log" id="ocsd-debug-log">${lines || 'No log entries.'}</div>
            </div>
        `;
    }

    function hookDebug() {
        // just static for now; live updates via event listener
    }

    function ensureToastContainer() {
        if (document.getElementById(toastContainerId)) return;
        const c = document.createElement('div');
        c.id = toastContainerId;
        document.body.appendChild(c);
    }

    function showToast(payload) {
        ensureToastContainer();
        const container = document.getElementById(toastContainerId);
        const div = document.createElement('div');
        const type = payload.type || 'info';
        div.className = `ocsd-toast ocsd-toast-${type}`;
        div.textContent = payload.message;
        container.appendChild(div);
        const duration = (payload.options && payload.options.duration) || 4000;
        setTimeout(() => {
            div.remove();
        }, duration);
    }

    function updateTicker(state) {
        tickerState = Object.assign({}, tickerState, state || {});
        updateTickerBar();
    }

    function updateTickerBar() {
        if (!panelEl) return;
        const t = tickerState;
        const typeEl = panelEl.querySelector('#ocsd-ticker-type');
        const userEl = panelEl.querySelector('#ocsd-ticker-user');
        const wepEl = panelEl.querySelector('#ocsd-ticker-weapon');
        const vehEl = panelEl.querySelector('#ocsd-ticker-vehicle');
        const scnEl = panelEl.querySelector('#ocsd-ticker-scanner');
        if (typeEl) typeEl.textContent = t.type || '—';
        if (userEl) userEl.textContent = t.user || '—';
        if (wepEl) wepEl.textContent = t.weapon || '—';
        if (vehEl) vehEl.textContent = t.vehicle || '—';
        if (scnEl) scnEl.textContent = t.scanner || 'off';
    }

    // Event wiring
    OCSDUtils.on('toast:show', showToast);
    OCSDUtils.on('ticker:update', updateTicker);
    OCSDUtils.on('queue:update', () => {
        if (activeTab === 'queue') {
            renderActiveTab();
        }
    });
    OCSDUtils.on('debug:update', () => {
        if (activeTab === 'debug') {
            renderActiveTab();
        }
    });

    return {
        injectStyles,
        createPanel,
        setTopGap
    };
})();

/* ===================== MODULE: persistence ===================== */
const OCSDStorage = (() => {
    const PREFIX = 'OCSD_ARMORYLINK_';

    function set(key, value) {
        try {
            GM_setValue(PREFIX + key, JSON.stringify(value));
        } catch (e) {
            OCSDStubs.debug('error', 'storage', 'set failed', { key, error: String(e) });
        }
    }

    function get(key, defaultValue) {
        try {
            const stored = GM_getValue(PREFIX + key, null);
            if (stored == null) return defaultValue;
            return JSON.parse(stored);
        } catch (e) {
            OCSDStubs.debug('error', 'storage', 'get failed', { key, error: String(e) });
            return defaultValue;
        }
    }

    function remove(key) {
        try {
            GM_deleteValue(PREFIX + key);
        } catch (e) {
            OCSDStubs.debug('error', 'storage', 'remove failed', { key, error: String(e) });
        }
    }

    return {
        set,
        get,
        remove
    };
})();

/* ===================== MODULE: exportManager ===================== */
const OCSDExportManager = (() => {
    function backupAll() {
        const snapshot = {
            rules: OCRulesEngine.getRules(),
            fields: OCSDFields.getAllFields(),
            prefixes: OCPrefixes.getAll(),
            macros: OCSDMacros.getAll()
        };
        return JSON.stringify(snapshot, null, 2);
    }

    return {
        backupAll
    };
})();

/* ===================== MODULE: prefixes ===================== */
const OCPrefixes = (() => {
    let prefixes = OCSDStorage.get('prefixes', []);
    let activePrefixId = null;

    function getAll() {
        return prefixes.slice();
    }

    function setAll(list) {
        prefixes = Array.isArray(list) ? list : [];
        OCSDStorage.set('prefixes', prefixes);
    }

    function setActive(id) {
        activePrefixId = id;
        const p = prefixes.find(x => x.id === id);
        if (p) {
            OCSDStubs.toast(`Active prefix: ${p.label}`, 'info');
        }
    }

    function getActiveSymbol() {
        if (!activePrefixId) return '';
        const p = prefixes.find(x => x.id === activePrefixId);
        return p ? (p.symbol || '') : '';
    }

    return {
        getAll,
        setAll,
        setActive,
        getActiveSymbol
    };
})();

/* ===================== MODULE: macros ===================== */
const OCSDMacros = (() => {
    let macros = OCSDStorage.get('macros', []);

    function getAll() {
        return macros.slice();
    }

    function setAll(list) {
        macros = Array.isArray(list) ? list : [];
        OCSDStorage.set('macros', macros);
    }

    async function runMacro(id, context) {
        const m = macros.find(x => x.id === id);
        if (!m) {
            OCSDStubs.toast(`Macro not found: ${id}`, 'error');
            return;
        }
        OCSDStubs.debug('info', 'macros', 'Running macro', { id });
        for (const step of m.steps || []) {
            if (step.type === 'toast') {
                const msg = OCRulesEngine.substituteTokens(step.message || '', context || {});
                OCSDStubs.toast(msg, step.toastType || 'info');
            }
            // other step types can be added as needed
            if (step.waitMs) {
                await new Promise(r => setTimeout(r, step.waitMs));
            }
        }
    }

    return {
        getAll,
        setAll,
        runMacro
    };
})();

/* ===================== MODULE: fields ===================== */
const OCSDFields = (() => {
    // default field keys (no selectors wired here; Claude / user will wire)
    const defaultFields = {
        type: {
            key: 'type',
            label: 'Type',
            selector: '',
            roles: ['write', 'ticker']
        },
        user: {
            key: 'user',
            label: 'User',
            selector: '',
            roles: ['write', 'ticker']
        },
        externalContact: {
            key: 'externalContact',
            label: 'External Contact',
            selector: '',
            roles: ['write']
        },
        department: {
            key: 'department',
            label: 'Department',
            selector: '',
            roles: ['write']
        },
        vehicle: {
            key: 'vehicle',
            label: 'Vehicle',
            selector: '',
            roles: ['write', 'ticker']
        },
        weapon: {
            key: 'weapon',
            label: 'Weapon',
            selector: '',
            roles: ['write', 'ticker']
        },
        taser: {
            key: 'taser',
            label: 'Taser',
            selector: '',
            roles: ['write']
        },
        patrol: {
            key: 'patrol',
            label: 'Patrol',
            selector: '',
            roles: ['write']
        },
        controlOneRadio: {
            key: 'controlOneRadio',
            label: 'Control One Radio',
            selector: '',
            roles: ['write']
        },
        comments: {
            key: 'comments',
            label: 'Comments',
            selector: '',
            roles: ['write']
        },
        bwcUserPid: {
            key: 'bwcUserPid',
            label: 'BWC User PID',
            selector: '',
            roles: ['read']
        }
    };

    let customFields = OCSDStorage.get('fields', {});
    let cache = {};

    function mergeFields() {
        const merged = {};
        Object.keys(defaultFields).forEach(k => {
            merged[k] = Object.assign({}, defaultFields[k], { isDefault: true });
        });
        Object.keys(customFields).forEach(k => {
            merged[k] = Object.assign({}, merged[k] || {}, customFields[k], { isDefault: !!defaultFields[k] });
        });
        return merged;
    }

    function getAllFields() {
        return mergeFields();
    }

    function getField(key) {
        return mergeFields()[key] || null;
    }

    function detect(key) {
        const field = getField(key);
        if (!field || !field.selector) return false;
        const el = OCSDElements.find(field.selector);
        return !!el;
    }

    function setFieldValueByKey(key, value) {
        const field = getField(key);
        if (!field || !field.selector) return;
        const el = OCSDElements.find(field.selector);
        if (!el) return;
        OCSDElements.value(el, value);
        if (key === 'user') {
            OCSDStubs.updateTicker({ user: value });
        } else if (key === 'weapon') {
            OCSDStubs.updateTicker({ weapon: value });
        } else if (key === 'vehicle') {
            OCSDStubs.updateTicker({ vehicle: value });
        }
    }

    function getFieldValueByKey(key) {
        const field = getField(key);
        if (!field || !field.selector) return '';
        const el = OCSDElements.find(field.selector);
        return el ? OCSDElements.value(el) : '';
    }

    function clickFieldByKey(key) {
        const field = getField(key);
        if (!field || !field.selector) return;
        const el = OCSDElements.find(field.selector);
        if (el) el.click();
    }

    function reset(key) {
        delete customFields[key];
        OCSDStorage.set('fields', customFields);
    }

    function resetAll() {
        customFields = {};
        OCSDStorage.set('fields', customFields);
    }

    return {
        getAllFields,
        getField,
        detect,
        setFieldValueByKey,
        getFieldValueByKey,
        clickFieldByKey,
        reset,
        resetAll
    };
})();

/* ===================== MODULE: bwc ===================== */
const OCSDBWC = (() => {
    function processScan(scan, ctx) {
        // BWC/X10 only uses user PID from SNOW; no write-back
        const pid = OCSDFields.getFieldValueByKey('bwcUserPid');
        OCSDStubs.debug('info', 'bwc', 'Processing BWC scan', { scan, pid, ctx });
        OCSDStubs.toast(`BWC scan processed (PID=${pid || 'n/a'})`, 'info');
        // Real iframe / Axon steps can be wired later
    }

    return {
        processScan
    };
})();

/* ===================== MODULE: x10 ===================== */
const OCSDX10 = (() => {
    function processScan(scan, ctx) {
        const pid = OCSDFields.getFieldValueByKey('bwcUserPid');
        OCSDStubs.debug('info', 'x10', 'Processing X10 scan', { scan, pid, ctx });
        OCSDStubs.toast(`X10 scan processed (PID=${pid || 'n/a'})`, 'info');
    }

    return {
        processScan
    };
})();

/* ===================== MODULE: activeContext ===================== */
const OCSDActiveContext = (() => {
    // simple workspace detector (can be extended)
    function isLoanerTabActive() {
        // For now: always true on match URL
        return true;
    }

    return {
        isLoanerTabActive
    };
})();

/* ===================== MODULE: tabTitle ===================== */
const OCSDTabTitle = (() => {
    function update(title) {
        if (!title) return;
        document.title = title;
    }

    function updateFromTicker(ticker) {
        const icon = ticker.type === 'Return' ? '↩'
            : ticker.type === 'Deployment' ? '🚀'
                : '⚙️';
        const lastName = (ticker.user || '').split(' ').slice(-1)[0] || '';
        const newTitle = `${icon} | ${lastName || 'Armory'} - OCSD Loaner`;
        update(newTitle);
    }

    OCSDUtils.on('ticker:update', (state) => {
        updateFromTicker(state || {});
    });

    return {
        update
    };
})();

/* ===================== MODULE: defaultsManager ===================== */
const OCSDDefaults = (() => {
    function loadInitialRulesIfEmpty() {
        const existing = OCRulesEngine.getRules();
        if (existing.length) return;
        // Example rule: / or * followed by 5 digits. Group1: symbol, Group2: PID
        const rules = [
            {
                id: 'user-pid-symbol',
                patternType: 'regex',
                pattern: '^([/*])?(\\d{5})$',
                directiveGroupIndex: 1,
                actions: [
                    { type: 'fill', fieldKey: 'user', value: '${2}' },
                    { type: 'toast', toastType: 'info', message: 'User PID ${2} / ${directive}' }
                ]
            }
        ];
        OCRulesEngine.setRules(rules);
    }

    function init() {
        loadInitialRulesIfEmpty();
    }

    return {
        init
    };
})();

/* ===================== MODULE: broadcast (leader election stub) ===================== */
const OCSDBroadcast = (() => {
    const CHANNEL_NAME = 'ocsdArmoryLink';
    let bc = null;
    let isLeader = true; // simplified: assume leader
    let lastPing = 0;

    function setup() {
        if ('BroadcastChannel' in window) {
            bc = new BroadcastChannel(CHANNEL_NAME);
            bc.onmessage = (ev) => {
                if (!ev || !ev.data) return;
                const msg = ev.data;
                if (msg.type === 'ping' && msg.tabId !== OCSDUtils.TAB_ID) {
                    lastPing = Date.now();
                }
            };
            setInterval(() => {
                ping();
            }, 2000);
        }
    }

    function ping() {
        if (!bc) return;
        bc.postMessage({ type: 'ping', tabId: OCSDUtils.TAB_ID, ts: Date.now() });
    }

    function leader() {
        // simplified: we don't demote; just assume single tab or manual control
        return isLeader;
    }

    return {
        setup,
        isLeader: leader
    };
})();

/* ===================== MODULE: worker (validation stub) ===================== */
const OCSDWorker = (() => {
    function validateConfig(snapshot) {
        // placeholder validation
        return !!snapshot;
    }

    return {
        validateConfig
    };
})();

/* ===================== MODULE: init ===================== */
(function OCSDInit() {
    function start() {
        OCSDUI.injectStyles();
        OCSDUI.createPanel();
        OCSDSCapture.attach();
        OCSDSCapture.attachHotkeys();
        OCSDBroadcast.setup();
        OCSDDefaults.init();
        OCSDStubs.debug('info', 'init', 'ArmoryLink initialized', {});
        OCSDStubs.toast('OCSD ArmoryLink loaded', 'success', { duration: 2500 });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(start, 100);
    } else {
        document.addEventListener('DOMContentLoaded', start);
    }
})();
