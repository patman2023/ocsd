// ==UserScript==
// @name         OCSD ArmoryLink
// @namespace    https://github.com/OCSD
// @version      0.1.0
// @description  Barcode-driven armory utility for OCSD ServiceNow
// @author       P. Akhamlich
// @match        https://ocsheriff.servicenowservices.com/x/g/loaner-workspace/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ========================================
    // ⚠️⚠️⚠️ CRITICAL IMPLEMENTATION NOTE ⚠️⚠️⚠️
    // ========================================
    //
    // This script uses the "Tabbed Names" pattern for per-tab context management.
    // DO NOT modify AL.pageState or AL.tabTitle without understanding this pattern:
    //
    // 1. Contexts are stored in Map<tabId, Context> where tabId = <a role="tab">.id
    // 2. apply() reads fields ONLY from active tab and updates its context
    // 3. readFieldsAndUpdate() stores lastTabLabel in the context
    // 4. refreshUI() calls updateAllTabLabels() which updates ALL tabs
    // 5. updateAllTabLabels() sets each tab's label from its stored ctx.lastTabLabel
    // 6. Ticker uses getActiveTabContext() to show only visible subpage data
    //
    // This ensures labels/data persist correctly when tabs are reordered.
    // Breaking this pattern will cause tabs to show wrong data after reordering.
    //
    // ========================================

    // ========================================
    // NAMESPACE
    // ========================================
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    const AL = window.OCSDArmoryLink;

    // ========================================
    // MODULE: UTILS
    // ========================================
    AL.utils = {
        // DOM helpers, debounce, formatting, selector walking

        /**
         * Debounce function to limit rapid firing
         */
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        /**
         * Throttle function to ensure minimum time between calls
         */
        throttle(func, limit) {
            let inThrottle;
            return function(...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        },

        /**
         * Create throttled MutationObserver to reduce DOM watch overhead
         * Batches mutations and only fires callback at most once per delay period
         */
        createThrottledObserver(callback, delay = 100) {
            let timeout;
            let mutations = [];

            return new MutationObserver((mutationList) => {
                mutations.push(...mutationList);

                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (mutations.length > 0) {
                        callback(mutations);
                        mutations = [];
                    }
                }, delay);
            });
        },

        /**
         * Query selector that pierces shadow DOM boundaries
         */
        querySelectorDeep(selector, root = document) {
            if (!selector) return null;

            try {
                // First try normal query
                let element = root.querySelector(selector);
                if (element) return element;

                // If not found, recursively search shadow roots and iframes
                const allElements = root.querySelectorAll('*');
                for (const el of allElements) {
                    // Search shadow DOM
                    if (el.shadowRoot) {
                        element = this.querySelectorDeep(selector, el.shadowRoot);
                        if (element) return element;
                    }

                    // Search same-origin iframes
                    if (el.tagName === 'IFRAME' && el.contentDocument) {
                        try {
                            element = this.querySelectorDeep(selector, el.contentDocument);
                            if (element) return element;
                        } catch (e) {
                            // Ignore cross-origin iframes
                        }
                    }
                }

                return null;
            } catch (error) {
                console.error('[utils] querySelectorDeep error:', error);
                return null;
            }
        },

        /**
         * Query all selectors that pierce shadow DOM boundaries
         */
        querySelectorAllDeep(selector, root = document) {
            const results = [];

            try {
                // Add results from current level
                const elements = root.querySelectorAll(selector);
                results.push(...elements);

                // Recursively search shadow roots and iframes
                const allElements = root.querySelectorAll('*');
                for (const el of allElements) {
                    // Search shadow DOM
                    if (el.shadowRoot) {
                        const shadowResults = this.querySelectorAllDeep(selector, el.shadowRoot);
                        results.push(...shadowResults);
                    }

                    // Search same-origin iframes
                    if (el.tagName === 'IFRAME' && el.contentDocument) {
                        try {
                            const frameResults = this.querySelectorAllDeep(selector, el.contentDocument);
                            results.push(...frameResults);
                        } catch (e) {
                            // Ignore cross-origin iframes
                        }
                    }
                }

                return results;
            } catch (error) {
                console.error('[utils] querySelectorAllDeep error:', error);
                return results;
            }
        },

        /**
         * Find element by CSS selector with optional iframe/shadow DOM path
         * Uses deep query by default for shadow DOM piercing
         */
        findElement(selector, selectorPath) {
            if (!selector) return null;

            try {
                // Validate selector first
                document.createDocumentFragment().querySelector(selector);
            } catch (error) {
                console.error('[utils] Invalid selector:', selector, error);
                return null;
            }

            try {
                // If no path, use deep query to pierce shadow DOM
                if (!selectorPath || selectorPath.length === 0) {
                    return this.querySelectorDeep(selector);
                }

                // Walk through path (iframes, shadow roots)
                let context = document;
                for (const step of selectorPath) {
                    if (step.type === 'iframe') {
                        const iframe = context.querySelector(step.selector);
                        if (!iframe || !iframe.contentDocument) return null;
                        context = iframe.contentDocument;
                    } else if (step.type === 'shadow') {
                        const host = context.querySelector(step.selector);
                        if (!host || !host.shadowRoot) return null;
                        context = host.shadowRoot;
                    }
                }

                return this.querySelectorDeep(selector, context);
            } catch (error) {
                console.error('[utils] findElement error:', error);
                return null;
            }
        },

        /**
         * Get last N digits of a string
         */
        getLastDigits(str, n = 4) {
            const digits = (str || '').replace(/\D/g, '');
            return digits.slice(-n);
        },

        /**
         * Format PID (ensure uppercase, trim)
         */
        formatPID(pid) {
            return (pid || '').toString().trim().toUpperCase();
        },

        /**
         * Parse full name into parts
         * Handles "Last, First" and "First Last" formats
         */
        parseName(fullName) {
            if (!fullName) return { first: '', last: '', lastUpper: 'UNKNOWN' };

            const trimmed = fullName.trim();

            // Check for "Last, First" format
            if (trimmed.includes(',')) {
                const parts = trimmed.split(',').map(p => p.trim());
                return {
                    first: parts[1] || '',
                    last: parts[0] || '',
                    lastUpper: (parts[0] || 'UNKNOWN').toUpperCase()
                };
            }

            // Assume "First Last" format
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
                return {
                    first: parts[0],
                    last: parts[parts.length - 1],
                    lastUpper: parts[parts.length - 1].toUpperCase()
                };
            }

            // Single name
            return {
                first: trimmed,
                last: trimmed,
                lastUpper: trimmed.toUpperCase()
            };
        },

        /**
         * Generate unique ID
         */
        generateId() {
            return 'al_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        },

        /**
         * Scroll element into view with highlight
         */
        highlightElement(element, duration = 2000) {
            if (!element) return;

            element.scrollIntoView({ behavior: 'smooth', block: 'center' });

            const originalOutline = element.style.outline;
            element.style.outline = '3px solid magenta';

            setTimeout(() => {
                element.style.outline = originalOutline;
            }, duration);
        },

        /**
         * Deep clone object
         */
        deepClone(obj) {
            return JSON.parse(JSON.stringify(obj));
        },

        /**
         * Safe JSON parse with fallback
         */
        safeJSONParse(str, fallback = null) {
            try {
                return JSON.parse(str);
            } catch {
                return fallback;
            }
        },

        /**
         * Escape HTML special characters
         */
        escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        init() {
            console.log('[utils] Initialized');
        }
    };

    // ========================================
    // MODULE: STUBS
    // ========================================
    AL.stubs = {
        // Default configs for fields, rules, prefixes

        /**
         * Get default field configurations
         * Updated to match actual ServiceNow Workspace DOM structure
         */
        getDefaultFields() {
            return [
                {
                    key: 'type',
                    label: 'Type',
                    // Type field is in shadow DOM - combobox trigger button
                    selector: "button[role='combobox'][aria-label='Type']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write', 'ticker'],
                    commitEvent: 'click',
                    enabled: true
                },
                {
                    key: 'user',
                    label: 'User',
                    selector: "input[aria-label='User']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write', 'ticker'],
                    commitEvent: 'change',
                    enabled: true
                },
                {
                    key: 'externalContact',
                    label: 'External Loan',
                    selector: "input[aria-label='External Loan']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write'],
                    commitEvent: 'change',
                    enabled: true
                },
                {
                    key: 'department',
                    label: 'Department',
                    // Department field not visible on current form
                    selector: '',
                    selectorPath: [],
                    kind: 'field',
                    roles: ['write'],
                    commitEvent: 'change',
                    enabled: false
                },
                {
                    key: 'vehicle',
                    label: 'Vehicle',
                    selector: "input[aria-label='Vehicle Asset']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write', 'ticker'],
                    commitEvent: 'change',
                    enabled: true
                },
                {
                    key: 'weapon',
                    label: 'Weapon',
                    selector: "input[aria-label='Weapon Asset']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write', 'ticker'],
                    commitEvent: 'change',
                    enabled: true
                },
                {
                    key: 'taser',
                    label: 'Taser',
                    selector: "input[aria-label='Taser Asset']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write', 'ticker'],
                    commitEvent: 'change',
                    enabled: true
                },
                {
                    key: 'patrol',
                    label: 'Patrol',
                    selector: "input[aria-label='Patrol Assets']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write'],
                    commitEvent: 'change',
                    enabled: true
                },
                {
                    key: 'controlOneRadio',
                    label: 'Control One Radio',
                    selector: "input[aria-label='Control One Radio']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write', 'ticker'],
                    commitEvent: 'change',
                    enabled: true
                },
                {
                    key: 'comments',
                    label: 'Comments',
                    selector: "textarea[name='comments']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read', 'write'],
                    commitEvent: 'blur',
                    enabled: true
                },
                {
                    key: 'updated_on',
                    label: 'Updated On',
                    selector: "input[name='sys_updated_on-date']",
                    selectorPath: [],
                    kind: 'field',
                    roles: ['read'],
                    commitEvent: 'change',
                    enabled: true
                }
            ];
        },

        /**
         * Get default rules
         */
        getDefaultRules() {
            return [
                {
                    id: AL.utils.generateId(),
                    name: 'PID with Directive',
                    enabled: true,
                    pattern: '^([*/])([A-Z0-9]+)([*/])?$',
                    patternType: 'regex',
                    useDirective: true,
                    directiveChars: ['*', '/'],
                    groupIndexes: [2], // Capture PID from group 2
                    actions: [
                        {
                            type: 'setField',
                            field: 'user',
                            value: '${group2}' // The PID (group 2 in the regex)
                        },
                        {
                            type: 'setType',
                            value: '${directive}' // Deployment or Return
                        }
                    ],
                    speechLabel: 'PID'
                },
                {
                    id: AL.utils.generateId(),
                    name: 'Badge Number (Simple)',
                    enabled: false,
                    pattern: '^(\\d{4,6})$',
                    patternType: 'regex',
                    useDirective: false,
                    directiveChars: [],
                    groupIndexes: [1],
                    actions: [
                        {
                            type: 'setField',
                            field: 'user',
                            value: '${group1}'
                        }
                    ],
                    speechLabel: 'Badge'
                },
                {
                    id: AL.utils.generateId(),
                    name: 'Weapon Serial',
                    enabled: false,
                    pattern: '^WPN-([A-Z0-9]+)$',
                    patternType: 'regex',
                    useDirective: false,
                    directiveChars: [],
                    groupIndexes: [1],
                    actions: [
                        {
                            type: 'setField',
                            field: 'weapon',
                            value: '${group1}'
                        },
                        {
                            type: 'speech',
                            text: 'Weapon ${last4}'
                        }
                    ],
                    speechLabel: 'Weapon'
                },
                {
                    id: AL.utils.generateId(),
                    name: 'Taser Serial',
                    enabled: false,
                    pattern: '^(TSR|TASER)-([A-Z0-9]+)$',
                    patternType: 'regex',
                    useDirective: false,
                    directiveChars: [],
                    groupIndexes: [2],
                    actions: [
                        {
                            type: 'setField',
                            field: 'taser',
                            value: '${group2}'
                        },
                        {
                            type: 'speech',
                            text: 'Taser ${last4}'
                        }
                    ],
                    speechLabel: 'Taser'
                },
                {
                    id: AL.utils.generateId(),
                    name: 'Vehicle ID',
                    enabled: false,
                    pattern: '^VEH-([A-Z0-9]+)$',
                    patternType: 'regex',
                    useDirective: false,
                    directiveChars: [],
                    groupIndexes: [1],
                    actions: [
                        {
                            type: 'setField',
                            field: 'vehicle',
                            value: '${group1}'
                        },
                        {
                            type: 'speech',
                            text: 'Vehicle ${group1}'
                        }
                    ],
                    speechLabel: 'Vehicle'
                },
                {
                    id: AL.utils.generateId(),
                    name: 'Radio Serial',
                    enabled: false,
                    pattern: '^(RAD|RADIO)-([A-Z0-9]+)$',
                    patternType: 'regex',
                    useDirective: false,
                    directiveChars: [],
                    groupIndexes: [2],
                    actions: [
                        {
                            type: 'setField',
                            field: 'patrol_radio',
                            value: '${group2}'
                        },
                        {
                            type: 'speech',
                            text: 'Radio ${last4}'
                        }
                    ],
                    speechLabel: 'Radio'
                },
                {
                    id: AL.utils.generateId(),
                    name: 'Generic Equipment',
                    enabled: false,
                    pattern: '^EQP-([A-Z0-9]+)$',
                    patternType: 'regex',
                    useDirective: false,
                    directiveChars: [],
                    groupIndexes: [1],
                    actions: [
                        {
                            type: 'setField',
                            field: 'comments',
                            value: 'Equipment: ${group1}'
                        },
                        {
                            type: 'toast',
                            title: 'Equipment',
                            message: 'Scanned: ${group1}',
                            level: 'info'
                        }
                    ],
                    speechLabel: 'Equipment'
                }
            ];
        },

        /**
         * Get default prefixes (empty by default)
         */
        getDefaultPrefixes() {
            return [];
        },

        /**
         * Get default macros (empty by default)
         */
        getDefaultMacros() {
            return [];
        },

        /**
         * Get default settings
         */
        getDefaultSettings() {
            return {
                // Layout
                dockMode: 'dock-right',
                topGapLeft: 0,
                topGapRight: 0,
                panelWidth: 400,
                panelHeight: 600,

                // Capture
                captureMode: 'off',
                scanThrottle: 150,
                duplicateWindow: 5000,
                scanTimeout: 10000,

                // Toast
                toastPosition: 'top-right', // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
                toastDuration: 3000,
                toastSticky: false,
                toastSound: false,

                // Speech
                speechEnabled: false,
                speechRate: 1.0,
                speechPitch: 1.0,

                // Ticker
                tickerEnabled: true,
                tickerHeight: 30,
                tickerFontSize: 13,

                // Tab visibility
                visibleTabs: ['dashboard', 'rules', 'fields', 'prefixes', 'macros', 'favorites', 'bwc', 'x10', 'batch', 'history', 'settings', 'debug'],

                // Debug
                debugEnabled: true,
                debugAutoScroll: true,
                debugWrap: false
            };
        },

        init() {
            console.log('[stubs] Initialized');
        }
    };

    // ========================================
    // MODULE: CAPTURE
    // ========================================
    AL.capture = {
        // Scanner mode state machine, FIFO queue, throttle, duplicate suppression
        scanQueue: [],
        processingScan: false,
        mode: 'off', // 'on', 'standby', 'off'
        lastScan: null,
        lastScanTime: 0,
        scanBuffer: '',
        scanTimeout: null,
        recentScans: new Map(), // For duplicate suppression
        scanHistory: [], // Persistent scan history

        // Mode labels
        modeLabels: {
            'on': 'Activate',
            'standby': 'Standby',
            'off': 'Disable'
        },

        init() {
            // Load mode from storage
            const savedMode = AL.persistence.get('captureMode', 'off');
            this.setMode(savedMode);

            // Load scan history from storage
            this.scanHistory = AL.persistence.get('scanHistory', []);

            // Set up keyboard listener for scanner input
            document.addEventListener('keydown', this.handleKeydown.bind(this));

            console.log('[capture] Initialized, mode:', this.mode);
        },

        /**
         * Add entry to scan history
         */
        addToHistory(scan, type, rulesMatched, status, statusText) {
            const entry = {
                timestamp: Date.now(),
                scan: scan,
                type: type,
                rulesMatched: rulesMatched || 0,
                status: status || 'info',
                statusText: statusText || 'Processed'
            };

            this.scanHistory.push(entry);

            // Limit history to last 1000 entries
            if (this.scanHistory.length > 1000) {
                this.scanHistory = this.scanHistory.slice(-1000);
            }

            // Save to storage
            AL.persistence.set('scanHistory', this.scanHistory);
        },

        /**
         * Set capture mode
         */
        setMode(newMode) {
            if (!['on', 'standby', 'off'].includes(newMode)) {
                console.warn('[capture] Invalid mode:', newMode);
                return;
            }

            this.mode = newMode;
            AL.persistence.set('captureMode', newMode);

            console.log('[capture] Mode changed to:', newMode);

            // Update UI
            if (AL.ui && AL.ui.updateStatus) {
                AL.ui.updateStatus();
            }
        },

        /**
         * Handle keyboard input for scanner
         */
        handleKeydown(event) {
            // Only capture in 'on' mode and if we're leader in armory context
            if (this.mode !== 'on') return;
            if (!AL.broadcast.isLeader) return;
            if (!AL.activeContext.isArmoryContext) return;

            // Ignore if user is typing in an input field
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                // Exception: allow if it's our manual input field
                if (target.id !== 'al_manual_input') {
                    return;
                }
            }

            // Scanner typically sends characters rapidly followed by Enter
            if (event.key === 'Enter') {
                if (this.scanBuffer.trim().length > 0) {
                    this.enqueue(this.scanBuffer.trim(), 'scanner');
                    this.scanBuffer = '';
                }

                // Clear timeout
                if (this.scanTimeout) {
                    clearTimeout(this.scanTimeout);
                    this.scanTimeout = null;
                }
            } else if (event.key.length === 1) {
                // Accumulate character
                this.scanBuffer += event.key;

                // Reset timeout
                if (this.scanTimeout) {
                    clearTimeout(this.scanTimeout);
                }

                // Auto-submit if no more input after 100ms
                this.scanTimeout = setTimeout(() => {
                    if (this.scanBuffer.trim().length > 0) {
                        this.enqueue(this.scanBuffer.trim(), 'scanner');
                        this.scanBuffer = '';
                    }
                }, 100);
            }
        },

        /**
         * Enqueue scan for processing
         */
        enqueue(scanText, source = 'manual') {
            if (!scanText || scanText.trim().length === 0) return;

            const now = Date.now();
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());

            // Duplicate suppression
            if (this.recentScans.has(scanText)) {
                const lastTime = this.recentScans.get(scanText);
                if (now - lastTime < settings.duplicateWindow) {
                    console.log('[capture] Duplicate scan suppressed:', scanText);
                    return;
                }
            }

            // Add to recent scans
            this.recentScans.set(scanText, now);

            // Clean up old entries
            for (const [key, time] of this.recentScans.entries()) {
                if (now - time > settings.duplicateWindow * 2) {
                    this.recentScans.delete(key);
                }
            }

            // Enqueue
            this.scanQueue.push({
                scanText,
                source,
                timestamp: now
            });

            console.log('[capture] Enqueued:', scanText, 'Queue length:', this.scanQueue.length);

            // Trigger processing
            AL.worker.processNext();
        },

        /**
         * Manual input handler
         */
        handleManualInput(scanText) {
            if (AL.broadcast.isLeader) {
                this.enqueue(scanText, 'manual');
            } else {
                // Forward to leader
                AL.broadcast.forwardScan(scanText, 'manual');
            }
        },

        /**
         * Clear scan queue
         */
        clearQueue() {
            this.scanQueue = [];
            console.log('[capture] Queue cleared');
        },

        /**
         * Get mode label
         */
        getModeLabel() {
            return this.modeLabels[this.mode] || 'Unknown';
        }
    };

    // ========================================
    // MODULE: ELEMENTS
    // ========================================
    AL.elements = {
        // DOM element references for UI components
        panel: null,
        ticker: null,
        content: null,

        init() {
            // Store references (will be populated by UI module)
            this.panel = document.getElementById('al-panel');
            this.ticker = document.getElementById('al-ticker');
            this.content = document.getElementById('al-content');

            console.log('[elements] Initialized');
        },

        /**
         * Refresh element references
         */
        refresh() {
            this.panel = document.getElementById('al-panel');
            this.ticker = document.getElementById('al-ticker');
            this.content = document.getElementById('al-content');
        }
    };

    // ========================================
    // MODULE: RULES
    // ========================================
    AL.rules = {
        // Pattern matching, directive system, template variables
        directiveMap: { "*": "Deployment", "/": "Return" },
        rules: [],

        init() {
            // Load rules from storage or use defaults
            this.rules = AL.persistence.get('rules', AL.stubs.getDefaultRules());
            console.log('[rules] Initialized with', this.rules.length, 'rules');
        },

        /**
         * Match scan against rules
         */
        matchScan(scanText) {
            const cleanScan = scanText.trim();

            for (const rule of this.rules) {
                if (!rule.enabled) continue;

                const matchResult = this.testPattern(cleanScan, rule);
                if (matchResult) {
                    return {
                        rule,
                        variables: matchResult.variables,
                        actions: this.processActions(rule.actions, matchResult.variables)
                    };
                }
            }

            return null;
        },

        /**
         * Test if scan matches rule pattern
         */
        testPattern(scanText, rule) {
            let matches = false;
            let groups = [];
            let directive = null;

            // Extract directive if enabled
            if (rule.useDirective && rule.directiveChars) {
                for (const char of rule.directiveChars) {
                    if (scanText.includes(char)) {
                        directive = this.directiveMap[char] || null;
                        break;
                    }
                }
            }

            // Test pattern
            switch (rule.patternType) {
                case 'regex':
                    try {
                        const regex = new RegExp(rule.pattern);
                        const match = scanText.match(regex);
                        if (match) {
                            matches = true;
                            groups = match.slice(1); // Capture groups (excluding full match)
                        }
                    } catch (error) {
                        console.error('[rules] Invalid regex:', rule.pattern, error);
                    }
                    break;

                case 'string':
                    matches = scanText === rule.pattern;
                    break;

                case 'startsWith':
                    matches = scanText.startsWith(rule.pattern);
                    break;

                case 'contains':
                    matches = scanText.includes(rule.pattern);
                    break;

                case 'endsWith':
                    matches = scanText.endsWith(rule.pattern);
                    break;

                default:
                    console.warn('[rules] Unknown pattern type:', rule.patternType);
            }

            if (!matches) return null;

            // Build variables for template substitution
            const variables = {
                scanRaw: scanText,
                cleanScan: scanText.trim(),
                last4: AL.utils.getLastDigits(scanText, 4),
                directive: directive
            };

            // Add regex groups
            groups.forEach((group, index) => {
                variables[`group${index + 1}`] = group;
            });

            // Extract specific groups if specified
            if (rule.groupIndexes && rule.groupIndexes.length > 0) {
                rule.groupIndexes.forEach((groupIndex, position) => {
                    const groupValue = groups[groupIndex - 1]; // groupIndexes are 1-based
                    if (groupValue !== undefined) {
                        variables[`extracted${position + 1}`] = groupValue;
                    }
                });
            }

            return { matches: true, variables };
        },

        /**
         * Process actions with variable substitution
         */
        processActions(actions, variables) {
            return actions.map(action => {
                const processedAction = { ...action };

                // Substitute variables in value
                if (processedAction.value && typeof processedAction.value === 'string') {
                    processedAction.value = this.substituteVariables(processedAction.value, variables);
                }

                return processedAction;
            });
        },

        /**
         * Substitute template variables in string
         */
        substituteVariables(template, variables) {
            let result = template;

            for (const [key, value] of Object.entries(variables)) {
                const placeholder = `\${${key}}`;
                result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value || '');
            }

            return result;
        },

        /**
         * Execute an action
         */
        async executeAction(action, variables) {
            console.log('[rules] Executing action:', action.type, action);

            switch (action.type) {
                case 'setField':
                    AL.fields.setFieldValue(action.field, action.value);
                    break;

                case 'setType':
                    AL.fields.setFieldValue('type', action.value);
                    break;

                case 'toast':
                    if (AL.ui && AL.ui.showToast) {
                        AL.ui.showToast(action.title || 'Notification', action.message || '', action.level || 'info');
                    }
                    break;

                case 'speech':
                    if (AL.ui && AL.ui.speak) {
                        AL.ui.speak(action.text || '');
                    }
                    break;

                case 'wait':
                    await new Promise(resolve => setTimeout(resolve, action.duration || 1000));
                    break;

                case 'click':
                    const clickElement = AL.utils.findElement(action.selector, action.selectorPath);
                    if (clickElement) {
                        clickElement.click();
                    }
                    break;

                case 'openURL':
                    if (action.url) {
                        window.open(action.url, action.target || '_blank');
                    }
                    break;

                case 'bwc':
                    if (AL.bwc && AL.bwc.launch) {
                        AL.bwc.launch(action.serial);
                    }
                    break;

                case 'x10':
                    if (AL.x10 && AL.x10.launch) {
                        AL.x10.launch(action.serial);
                    }
                    break;

                default:
                    console.warn('[rules] Unknown action type:', action.type);
            }
        },

        /**
         * Add rule
         */
        addRule(rule) {
            rule.id = rule.id || AL.utils.generateId();
            this.rules.push(rule);
            this.save();
        },

        /**
         * Update rule
         */
        updateRule(id, updates) {
            const index = this.rules.findIndex(r => r.id === id);
            if (index >= 0) {
                this.rules[index] = { ...this.rules[index], ...updates };
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Delete rule
         */
        deleteRule(id) {
            const index = this.rules.findIndex(r => r.id === id);
            if (index >= 0) {
                this.rules.splice(index, 1);
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Save rules to storage
         */
        save() {
            AL.persistence.set('rules', this.rules);
        },

        /**
         * Reset to defaults
         */
        resetDefaults() {
            this.rules = AL.stubs.getDefaultRules();
            this.save();
        }
    };

    // ========================================
    // MODULE: UI
    // ========================================
    AL.ui = {
        // Panel creation, tab system, dock modes
        currentTab: 'dashboard',
        dockMode: 'dock-right',
        panel: null,
        ticker: null,
        bubble: null,
        toast: null,
        stripLauncher: null,
        debugLogs: [],
        originalConsole: {},
        _lastFocusedVariableInput: null, // Track last focused input for variable insertion

        init() {
            this.loadSettings();
            this.setupConsoleIntercept();
            this.injectStyles();
            this.loadTheme();  // Load theme after styles are injected
            this.createPanel();
            this.createTicker();
            this.createBubble();
            this.createStripLauncher();
            this.addDebugLog('system', '[ui] Initialized');
        },

        /**
         * Setup console intercept for debug logging
         */
        setupConsoleIntercept() {
            // Store original console methods
            this.originalConsole.log = console.log;
            this.originalConsole.warn = console.warn;
            this.originalConsole.error = console.error;

            // Intercept console.log
            console.log = (...args) => {
                this.originalConsole.log.apply(console, args);
                const message = args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' ');

                // Detect category from message
                let category = 'log';
                if (message.includes('[rules]')) category = 'rules';
                else if (message.includes('[capture]')) category = 'capture';
                else if (message.includes('[ui]')) category = 'ui';
                else if (message.includes('[bwc]')) category = 'bwc';
                else if (message.includes('[x10]')) category = 'x10';
                else if (message.includes('[') && message.includes(']')) category = 'system';

                this.addDebugLog(category, message);
            };

            // Intercept console.warn
            console.warn = (...args) => {
                this.originalConsole.warn.apply(console, args);
                const message = args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' ');
                this.addDebugLog('warn', message);
            };

            // Intercept console.error
            console.error = (...args) => {
                this.originalConsole.error.apply(console, args);
                const message = args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' ');
                this.addDebugLog('error', message);
            };
        },

        /**
         * Add a debug log entry
         */
        addDebugLog(level, message) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            if (!settings.debugEnabled) return;

            this.debugLogs.push({
                timestamp: Date.now(),
                level: level,
                message: message
            });

            // Limit log size to prevent memory issues (keep last 500 entries)
            if (this.debugLogs.length > 500) {
                this.debugLogs = this.debugLogs.slice(-500);
            }

            // If debug tab is currently visible, update it
            if (this.currentTab === 'debug') {
                const content = document.getElementById('al-content');
                if (content) {
                    // Refresh the debug tab to show new log
                    this.renderDebug(content);
                }
            }
        },

        /**
         * Load UI settings
         */
        loadSettings() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            this.dockMode = settings.dockMode || 'dock-right';
            this.currentTab = settings.currentTab || 'dashboard';
        },

        /**
         * Inject CSS styles
         */
        injectStyles() {
            GM_addStyle(`
                /* Main Panel */
                #al-panel {
                    position: fixed;
                    background: #1e1e1e;
                    color: #e0e0e0;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 13px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                    z-index: 999999;
                    display: flex;
                    flex-direction: column;
                    border: 1px solid #333;
                }
                #al-panel.dock-left {
                    left: 0;
                    top: 0;
                    bottom: var(--ticker-height, 30px);
                    width: 400px;
                }
                #al-panel.dock-right {
                    right: 0;
                    top: 0;
                    bottom: var(--ticker-height, 30px);
                    width: 400px;
                }
                #al-panel.dock-bottom {
                    left: 0;
                    right: 0;
                    bottom: var(--ticker-height, 30px);
                    height: 300px;
                }
                #al-panel.float {
                    top: 100px;
                    right: 100px;
                    width: 400px;
                    height: 600px;
                    resize: both;
                    overflow: auto;
                }

                /* Panel Header */
                #al-header {
                    background: #2a2a2a;
                    padding: 10px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #444;
                }
                #al-header h3 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                }

                /* Tabs */
                #al-tabs {
                    display: flex;
                    background: #252525;
                    border-bottom: 1px solid #444;
                    overflow-x: auto;
                    padding: 0;
                    margin: 0;
                    /* Hide scrollbar while keeping scroll functionality */
                    scrollbar-width: none; /* Firefox */
                    -ms-overflow-style: none; /* IE and Edge */
                }
                #al-tabs::-webkit-scrollbar {
                    display: none; /* Chrome, Safari, Opera */
                }
                #al-tabs button {
                    background: transparent;
                    border: none;
                    color: #999;
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 12px;
                    white-space: nowrap;
                    border-bottom: 2px solid transparent;
                }
                #al-tabs button:hover {
                    background: #2a2a2a;
                    color: #e0e0e0;
                }
                #al-tabs button.active {
                    color: #4CAF50;
                    border-bottom-color: #4CAF50;
                }

                /* Tab Content */
                #al-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 15px;
                    /* Hide scrollbar while keeping scroll functionality */
                    scrollbar-width: none; /* Firefox */
                    -ms-overflow-style: none; /* IE and Edge */
                }
                #al-content::-webkit-scrollbar {
                    display: none; /* Chrome, Safari, Opera */
                }

                /* Ticker */
                #al-ticker {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: #2a2a2a;
                    color: #e0e0e0;
                    padding: var(--ticker-padding, 8px 12px);
                    font-size: var(--ticker-font-size, 13px);
                    height: var(--ticker-height, 30px);
                    box-sizing: border-box;
                    z-index: 1000000;
                    border-top: 1px solid #444;
                    display: flex;
                    justify-content: flex-start;
                    align-items: center;
                    gap: 20px;
                }

                .al-ticker-status-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    display: inline-block;
                    margin-right: 8px;
                }

                .al-ticker-status-dot.mode-on {
                    background: #4CAF50;
                    box-shadow: 0 0 8px #4CAF50;
                }

                .al-ticker-status-dot.mode-standby {
                    background: #ff9800;
                    box-shadow: 0 0 8px #ff9800;
                }

                .al-ticker-status-dot.mode-off {
                    background: #f44336;
                    box-shadow: 0 0 8px #f44336;
                }

                /* Toast */
                .al-toast {
                    position: fixed;
                    background: #333;
                    color: #fff;
                    padding: 12px 16px;
                    border-radius: 4px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    z-index: 1000000;
                    min-width: 200px;
                    max-width: 400px;
                    animation: al-toast-in 0.3s ease;
                }
                .al-toast.top-right { top: 20px; right: 20px; }
                .al-toast.top-left { top: 20px; left: 20px; }
                .al-toast.bottom-right { bottom: 20px; right: 20px; }
                .al-toast.bottom-left { bottom: 20px; left: 20px; }
                .al-toast.top-center { top: 20px; left: 50%; transform: translateX(-50%); }
                .al-toast.bottom-center { bottom: 20px; left: 50%; transform: translateX(-50%); }
                .al-toast.success { background: #4CAF50; }
                .al-toast.error { background: #f44336; }
                .al-toast.warning { background: #ff9800; }
                .al-toast.info { background: #2196F3; }
                @keyframes al-toast-in {
                    from { opacity: 0; transform: translateY(-20px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* Buttons */
                .al-btn {
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                }
                .al-btn:hover {
                    background: #45a049;
                }
                .al-btn-secondary {
                    background: #555;
                }
                .al-btn-secondary:hover {
                    background: #666;
                }
                .al-btn-danger {
                    background: #f44336;
                }
                .al-btn-danger:hover {
                    background: #da190b;
                }

                /* Inputs */
                .al-input {
                    background: #2a2a2a;
                    color: #e0e0e0;
                    border: 1px solid #444;
                    padding: 8px;
                    border-radius: 4px;
                    font-size: 13px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .al-input:focus {
                    outline: none;
                    border-color: #4CAF50;
                }

                /* Strip Launcher */
                #al-strip {
                    position: fixed;
                    left: 0;
                    top: 50%;
                    transform: translateY(-50%);
                    background: #2a2a2a;
                    padding: 8px 4px;
                    border-radius: 0 8px 8px 0;
                    box-shadow: 2px 0 10px rgba(0,0,0,0.3);
                    z-index: 999999;
                    cursor: pointer;
                    writing-mode: vertical-rl;
                    font-size: 12px;
                    color: #4CAF50;
                }

                /* Resize Handles */
                .al-resize-handle {
                    position: absolute;
                    z-index: 999999;
                }
                .al-resize-handle.left {
                    left: 0;
                    top: 10px;
                    bottom: 10px;
                    width: 4px;
                    cursor: ew-resize;
                }
                .al-resize-handle.right {
                    right: 0;
                    top: 10px;
                    bottom: 10px;
                    width: 4px;
                    cursor: ew-resize;
                }
                .al-resize-handle.top {
                    top: 0;
                    left: 10px;
                    right: 10px;
                    height: 4px;
                    cursor: ns-resize;
                }
                .al-resize-handle.bottom {
                    bottom: 0;
                    left: 10px;
                    right: 10px;
                    height: 4px;
                    cursor: ns-resize;
                }
                .al-resize-handle.top-left {
                    top: 0;
                    left: 0;
                    width: 10px;
                    height: 10px;
                    cursor: nwse-resize;
                }
                .al-resize-handle.top-right {
                    top: 0;
                    right: 0;
                    width: 10px;
                    height: 10px;
                    cursor: nesw-resize;
                }
                .al-resize-handle.bottom-left {
                    bottom: 0;
                    left: 0;
                    width: 10px;
                    height: 10px;
                    cursor: nesw-resize;
                }
                .al-resize-handle.bottom-right {
                    bottom: 0;
                    right: 0;
                    width: 10px;
                    height: 10px;
                    cursor: nwse-resize;
                }

                /* Bubble Launcher (appears when panel is closed) */
                #al-bubble {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 60px;
                    height: 60px;
                    background: #4CAF50;
                    border-radius: 50%;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    z-index: 999999;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 28px;
                    color: white;
                    transition: all 0.3s ease;
                }
                #al-bubble:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 16px rgba(0,0,0,0.4);
                }
                #al-bubble:active {
                    transform: scale(0.95);
                }

                /* Modal Overlay */
                .al-modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.7);
                    z-index: 1000000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: al-fade-in 0.2s ease;
                }

                /* Modal Dialog */
                .al-modal {
                    background: #1e1e1e;
                    color: #e0e0e0;
                    border-radius: 8px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                    max-width: 600px;
                    width: 90%;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    animation: al-modal-in 0.3s ease;
                }

                .al-modal-header {
                    background: #2a2a2a;
                    padding: 15px 20px;
                    border-bottom: 1px solid #444;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .al-modal-header h3 {
                    margin: 0;
                    font-size: 16px;
                }

                .al-modal-body {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }

                .al-modal-footer {
                    background: #2a2a2a;
                    padding: 15px 20px;
                    border-top: 1px solid #444;
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                }

                .al-form-group {
                    margin-bottom: 15px;
                }

                .al-form-group label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: 500;
                    font-size: 13px;
                }

                .al-form-group small {
                    display: block;
                    color: #999;
                    font-size: 11px;
                    margin-top: 3px;
                }

                .al-checkbox-group {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .al-action-item {
                    background: #2a2a2a;
                    padding: 10px;
                    margin-bottom: 8px;
                    border-radius: 4px;
                    border-left: 3px solid #4CAF50;
                }

                @keyframes al-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes al-modal-in {
                    from { opacity: 0; transform: scale(0.9); }
                    to { opacity: 1; transform: scale(1); }
                }

                /* ========================================
                 * THEME SYSTEM
                 * ======================================== */

                /* Light Theme (Default) */
                :root {
                    --al-panel-bg: #ffffff;
                    --al-panel-border: #d1d5db;
                    --al-tab-bg: #f3f4f6;
                    --al-tab-active-bg: #3b82f6;
                    --al-tab-text: #374151;
                    --al-tab-active-text: #ffffff;
                    --al-ticker-bg: #f9fafb;
                    --al-ticker-text: #111827;
                    --al-ticker-deploy: #fbbf24;
                    --al-ticker-return: #10b981;
                    --al-ticker-alert: #ef4444;
                    --al-toast-bg: #ffffff;
                    --al-toast-border: #d1d5db;
                    --al-toast-text: #111827;
                    --al-text-primary: #111827;
                    --al-text-secondary: #6b7280;
                    --al-accent: #3b82f6;
                    --al-content-bg: #f9fafb;
                    --al-header-bg: #ffffff;
                    --al-input-bg: #ffffff;
                    --al-input-border: #d1d5db;
                    --al-input-text: #111827;
                    --al-button-bg: #3b82f6;
                    --al-button-text: #ffffff;
                    --al-button-hover-bg: #2563eb;
                    --al-section-bg: #f3f4f6;
                    --al-section-border: #e5e7eb;
                    --al-code-bg: #f3f4f6;
                    --al-label-text: #374151;
                    --al-link-color: #3b82f6;
                }

                /* Dark Theme */
                [data-al-theme="dark"] {
                    --al-panel-bg: #1f2937;
                    --al-panel-border: #374151;
                    --al-tab-bg: #111827;
                    --al-tab-active-bg: #3b82f6;
                    --al-tab-text: #d1d5db;
                    --al-tab-active-text: #ffffff;
                    --al-ticker-bg: #111827;
                    --al-ticker-text: #f3f4f6;
                    --al-ticker-deploy: #fbbf24;
                    --al-ticker-return: #10b981;
                    --al-ticker-alert: #ef4444;
                    --al-toast-bg: #374151;
                    --al-toast-border: #4b5563;
                    --al-toast-text: #f3f4f6;
                    --al-text-primary: #f3f4f6;
                    --al-text-secondary: #9ca3af;
                    --al-accent: #60a5fa;
                    --al-content-bg: #1f2937;
                    --al-header-bg: #111827;
                    --al-input-bg: #374151;
                    --al-input-border: #4b5563;
                    --al-input-text: #f3f4f6;
                    --al-button-bg: #3b82f6;
                    --al-button-text: #ffffff;
                    --al-button-hover-bg: #2563eb;
                    --al-section-bg: #2a2a2a;
                    --al-section-border: #374151;
                    --al-code-bg: #1e1e1e;
                    --al-label-text: #d1d5db;
                    --al-link-color: #60a5fa;
                }

                /* High Contrast Theme */
                [data-al-theme="high-contrast"] {
                    --al-panel-bg: #000000;
                    --al-panel-border: #ffffff;
                    --al-tab-bg: #000000;
                    --al-tab-active-bg: #ffffff;
                    --al-tab-text: #ffffff;
                    --al-tab-active-text: #000000;
                    --al-ticker-bg: #000000;
                    --al-ticker-text: #ffffff;
                    --al-ticker-deploy: #ffff00;
                    --al-ticker-return: #00ff00;
                    --al-ticker-alert: #ff0000;
                    --al-toast-bg: #000000;
                    --al-toast-border: #ffffff;
                    --al-toast-text: #ffffff;
                    --al-text-primary: #ffffff;
                    --al-text-secondary: #ffffff;
                    --al-accent: #00ffff;
                    --al-content-bg: #000000;
                    --al-header-bg: #000000;
                    --al-input-bg: #000000;
                    --al-input-border: #ffffff;
                    --al-input-text: #ffffff;
                    --al-button-bg: #ffffff;
                    --al-button-text: #000000;
                    --al-button-hover-bg: #cccccc;
                    --al-section-bg: #000000;
                    --al-section-border: #ffffff;
                    --al-code-bg: #000000;
                    --al-label-text: #ffffff;
                    --al-link-color: #00ffff;
                }

                /* OCSD Sheriff Theme */
                [data-al-theme="ocsd-sheriff"] {
                    --al-panel-bg: #0a0a0a;
                    --al-panel-border: #c9a227;
                    --al-tab-bg: #0b3b2e;
                    --al-tab-active-bg: linear-gradient(135deg, #c9a227, #dcc48e);
                    --al-tab-text: #dcc48e;
                    --al-tab-active-text: #0a0a0a;
                    --al-ticker-bg: #0b3b2e;
                    --al-ticker-text: #dcc48e;
                    --al-ticker-deploy: #c9a227;
                    --al-ticker-return: #0b3b2e;
                    --al-ticker-alert: #dc2626;
                    --al-toast-bg: #1c1c1c;
                    --al-toast-border: #c9a227;
                    --al-toast-text: #dcc48e;
                    --al-text-primary: #dcc48e;
                    --al-text-secondary: #c9a227;
                    --al-accent: #c9a227;
                    --al-content-bg: #0a0a0a;
                    --al-header-bg: #0b3b2e;
                    --al-input-bg: #1c1c1c;
                    --al-input-border: #c9a227;
                    --al-input-text: #dcc48e;
                    --al-button-bg: #c9a227;
                    --al-button-text: #0a0a0a;
                    --al-button-hover-bg: #b38f1f;
                    --al-section-bg: #0b3b2e;
                    --al-section-border: #c9a227;
                    --al-code-bg: #1c1c1c;
                    --al-label-text: #dcc48e;
                    --al-link-color: #c9a227;
                }

                /* Apply theme variables to components */
                #al-panel {
                    background: var(--al-panel-bg, #1e1e1e) !important;
                    border-color: var(--al-panel-border, #333) !important;
                    color: var(--al-text-primary, #e0e0e0) !important;
                    transition: background 0.3s, border-color 0.3s, color 0.3s;
                }

                #al-header {
                    background: var(--al-header-bg, #2a2a2a);
                    color: var(--al-text-primary, #e0e0e0);
                }

                #al-content {
                    background: var(--al-content-bg, #1e1e1e);
                    color: var(--al-text-primary, #e0e0e0);
                }

                /* Tab buttons - apply theme but preserve original behavior */
                #al-tabs {
                    background: var(--al-header-bg, #252525) !important;
                    border-bottom-color: var(--al-panel-border, #444) !important;
                }

                #al-tabs button {
                    color: var(--al-tab-text, #999) !important;
                }

                #al-tabs button:hover {
                    background: var(--al-section-bg, #2a2a2a) !important;
                    color: var(--al-text-primary, #e0e0e0) !important;
                }

                #al-tabs button.active {
                    color: var(--al-accent, #4CAF50) !important;
                    border-bottom-color: var(--al-accent, #4CAF50) !important;
                }

                #al-ticker {
                    background: var(--al-ticker-bg, #2a2a2a);
                    color: var(--al-ticker-text, #e0e0e0);
                    border-top: 1px solid var(--al-panel-border, #333);
                }

                .al-toast {
                    background: var(--al-toast-bg, #ffffff);
                    border: 1px solid var(--al-toast-border, #d1d5db);
                    color: var(--al-toast-text, #111827);
                }

                /* Toast Container */
                #al-toast-container {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 1000001;
                    pointer-events: none;
                }

                .al-toast {
                    padding: 12px 16px;
                    margin-bottom: 10px;
                    border-radius: 6px;
                    min-width: 250px;
                    max-width: 350px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    cursor: pointer;
                    pointer-events: auto;
                    opacity: 0;
                    transform: translateX(20px);
                    transition: all 0.3s ease;
                }

                .al-toast.al-toast-show {
                    opacity: 1;
                    transform: translateX(0);
                }

                .al-toast-success {
                    border-color: #10b981 !important;
                }

                .al-toast-error {
                    border-color: #ef4444 !important;
                }

                .al-toast-warning {
                    border-color: #f59e0b !important;
                }

                .al-toast-info {
                    border-color: #3b82f6 !important;
                }

                /* Apply theme variables to all components */

                /* Buttons */
                .al-btn {
                    background: var(--al-button-bg) !important;
                    color: var(--al-button-text) !important;
                }

                .al-btn:hover {
                    background: var(--al-button-hover-bg) !important;
                }

                .al-btn-secondary {
                    background: var(--al-section-bg) !important;
                    color: var(--al-text-primary) !important;
                    border: 1px solid var(--al-section-border);
                }

                /* Inputs and Textareas */
                .al-input, .al-textarea {
                    background: var(--al-input-bg) !important;
                    color: var(--al-input-text) !important;
                    border-color: var(--al-input-border) !important;
                }

                input[type="text"],
                input[type="number"],
                input[type="email"],
                select,
                textarea {
                    background: var(--al-input-bg) !important;
                    color: var(--al-input-text) !important;
                    border-color: var(--al-input-border) !important;
                }

                /* Labels */
                label,
                .al-form-group label {
                    color: var(--al-label-text) !important;
                }

                /* Form Groups / Sections */
                .al-form-group,
                div[style*="background: #2a2a2a"],
                div[style*="background:#2a2a2a"] {
                    background: var(--al-section-bg) !important;
                    border-color: var(--al-section-border) !important;
                }

                /* Code blocks */
                div[style*="background: #1e1e1e"],
                div[style*="background:#1e1e1e"],
                div[style*="background: #1a1a1a"],
                div[style*="background:#1a1a1a"],
                code,
                pre {
                    background: var(--al-code-bg) !important;
                    color: var(--al-text-primary) !important;
                }

                /* Links */
                a {
                    color: var(--al-link-color) !important;
                }

                /* Small text / descriptions */
                small {
                    color: var(--al-text-secondary) !important;
                }

                /* Settings sections specifically */
                #al-content > div[style*="background: #2a2a2a"] {
                    background: var(--al-section-bg) !important;
                    color: var(--al-text-primary) !important;
                }

                #al-content > div[style*="background: #2a2a2a"] h4 {
                    color: var(--al-text-primary) !important;
                    border-color: var(--al-section-border) !important;
                }
            `);
        },

        /**
         * Load saved theme
         */
        loadTheme() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            const savedTheme = settings.theme || 'dark';  // Default to dark for backward compatibility
            this.setTheme(savedTheme, false);  // Don't save on load
        },

        /**
         * Set theme
         */
        setTheme(theme, save = true) {
            const validThemes = ['light', 'dark', 'high-contrast', 'ocsd-sheriff'];
            if (!validThemes.includes(theme)) {
                theme = 'dark';
            }

            document.documentElement.setAttribute('data-al-theme', theme);

            if (save) {
                const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
                settings.theme = theme;
                AL.persistence.set('settings', settings);
                console.log('[ui] Theme changed to:', theme);
            }

            // Update theme selector if it exists
            const selector = document.getElementById('al-theme-selector');
            if (selector && selector.value !== theme) {
                selector.value = theme;
            }

            // Add smooth transition when theme changes
            if (this.panel && save) {
                this.panel.style.transition = 'all 0.3s ease';
                setTimeout(() => {
                    this.panel.style.transition = '';
                }, 300);
            }
        },

        /**
         * Toast notification stack manager
         */
        toastStack: [],
        maxToasts: 5,

        /**
         * Show toast notification
         */
        showToast(title, message, type = 'info', duration = 3000) {
            // Create container if doesn't exist
            let container = document.getElementById('al-toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'al-toast-container';
                document.body.appendChild(container);
            }

            // Remove oldest if at max
            if (this.toastStack.length >= this.maxToasts) {
                const oldest = this.toastStack.shift();
                if (oldest && oldest.element) {
                    this.dismissToast(oldest.element);
                }
            }

            // Create toast element
            const toast = document.createElement('div');
            toast.className = `al-toast al-toast-${type}`;

            toast.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 4px;">${AL.utils.escapeHtml(title)}</div>
                <div style="font-size: 13px; opacity: 0.9;">${AL.utils.escapeHtml(message)}</div>
            `;

            // Click to dismiss
            toast.onclick = () => {
                this.dismissToast(toast);
            };

            // Add to container
            container.appendChild(toast);

            // Animate in
            setTimeout(() => {
                toast.classList.add('al-toast-show');
            }, 10);

            // Track in stack
            const toastItem = { element: toast, timeout: null };
            this.toastStack.push(toastItem);

            // Auto dismiss
            if (duration > 0) {
                toastItem.timeout = setTimeout(() => {
                    this.dismissToast(toast);
                }, duration);
            }
        },

        /**
         * Dismiss toast notification
         */
        dismissToast(toast) {
            // Find in stack
            const index = this.toastStack.findIndex(t => t.element === toast);
            if (index !== -1) {
                const item = this.toastStack[index];
                if (item.timeout) clearTimeout(item.timeout);
                this.toastStack.splice(index, 1);
            }

            // Animate out
            toast.classList.remove('al-toast-show');

            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        },

        /**
         * Create main panel
         */
        createPanel() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());

            this.panel = document.createElement('div');
            this.panel.id = 'al-panel';
            this.panel.className = this.dockMode;

            // Apply top gap based on dock mode
            if (this.dockMode === 'dock-left') {
                this.panel.style.top = `${settings.topGapLeft || 0}px`;
            } else if (this.dockMode === 'dock-right') {
                this.panel.style.top = `${settings.topGapRight || 0}px`;
            }

            // Header
            const header = document.createElement('div');
            header.id = 'al-header';
            header.innerHTML = `
                <h3>OCSD ArmoryLink</h3>
                <div>
                    <button class="al-btn al-btn-secondary" id="al-minimize">−</button>
                    <button class="al-btn al-btn-secondary" id="al-close">×</button>
                </div>
            `;
            this.panel.appendChild(header);

            // Tabs
            const tabs = document.createElement('div');
            tabs.id = 'al-tabs';
            const tabNames = ['dashboard', 'rules', 'fields', 'prefixes', 'macros', 'favorites', 'bwc', 'x10', 'batch', 'history', 'settings', 'debug'];
            tabNames.forEach(name => {
                const btn = document.createElement('button');
                btn.textContent = name.charAt(0).toUpperCase() + name.slice(1);
                btn.dataset.tab = name;
                if (name === this.currentTab) btn.className = 'active';
                btn.onclick = () => this.switchTab(name);
                tabs.appendChild(btn);
            });
            this.panel.appendChild(tabs);

            // Content area
            const content = document.createElement('div');
            content.id = 'al-content';
            this.panel.appendChild(content);

            // Attach to body
            document.body.appendChild(this.panel);

            // Event listeners
            document.getElementById('al-close').onclick = () => this.togglePanel();
            document.getElementById('al-minimize').onclick = () => this.togglePanel();

            // Drag functionality for docked → floating conversion
            this.initDragBehavior(header);

            // Add resize handles
            this.initResizeHandles();

            // Render current tab
            this.renderTab(this.currentTab);
        },

        /**
         * Initialize drag behavior for panel header
         * Allows dragging docked panels to convert them to floating, with viewport constraints
         */
        initDragBehavior(header) {
            let isDragging = false;
            let startX = 0;
            let startY = 0;
            let currentX = 0;
            let currentY = 0;
            let offsetX = 0;
            let offsetY = 0;
            const dragThreshold = 5; // pixels to move before triggering drag

            header.style.cursor = 'grab';

            const onMouseDown = (e) => {
                // Don't drag if clicking on buttons
                if (e.target.closest('button')) return;

                isDragging = false;
                startX = e.clientX;
                startY = e.clientY;

                // Get current panel position
                const rect = this.panel.getBoundingClientRect();
                offsetX = startX - rect.left;
                offsetY = startY - rect.top;

                header.style.cursor = 'grabbing';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                currentX = e.clientX;
                currentY = e.clientY;

                // Check if we've moved beyond the threshold
                const deltaX = currentX - startX;
                const deltaY = currentY - startY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                if (!isDragging && distance > dragThreshold) {
                    isDragging = true;

                    // Convert docked panel to floating if needed
                    if (this.panel.className !== 'float') {
                        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());

                        // Get current panel dimensions
                        const rect = this.panel.getBoundingClientRect();

                        // Switch to float mode
                        settings.dockMode = 'float';
                        AL.persistence.set('settings', settings);
                        this.panel.className = 'float';

                        // Set panel position to current mouse position minus offset
                        this.panel.style.top = (currentY - offsetY) + 'px';
                        this.panel.style.left = (currentX - offsetX) + 'px';
                        this.panel.style.right = 'auto';
                        this.panel.style.bottom = 'auto';
                        this.panel.style.width = rect.width + 'px';
                        this.panel.style.height = rect.height + 'px';
                    }
                }

                if (isDragging) {
                    // Update panel position with viewport constraints
                    let newLeft = currentX - offsetX;
                    let newTop = currentY - offsetY;

                    const rect = this.panel.getBoundingClientRect();
                    const panelWidth = rect.width;
                    const panelHeight = rect.height;

                    // Apply viewport constraints
                    const minMargin = 10; // Small margin to keep header accessible
                    const maxLeft = window.innerWidth - panelWidth - minMargin;
                    const maxTop = window.innerHeight - panelHeight - minMargin;

                    newLeft = Math.max(minMargin, Math.min(newLeft, maxLeft));
                    newTop = Math.max(minMargin, Math.min(newTop, maxTop));

                    this.panel.style.left = newLeft + 'px';
                    this.panel.style.top = newTop + 'px';
                }

                e.preventDefault();
            };

            const onMouseUp = () => {
                isDragging = false;
                header.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            header.addEventListener('mousedown', onMouseDown);
        },

        /**
         * Initialize resize handles for panel
         * Adds 8 resize handles (4 edges + 4 corners)
         */
        initResizeHandles() {
            const handles = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
            const minWidth = 300;
            const minHeight = 400;

            handles.forEach(position => {
                const handle = document.createElement('div');
                handle.className = `al-resize-handle ${position}`;

                let isResizing = false;
                let startX = 0;
                let startY = 0;
                let startWidth = 0;
                let startHeight = 0;
                let startLeft = 0;
                let startTop = 0;

                const onMouseDown = (e) => {
                    isResizing = true;
                    startX = e.clientX;
                    startY = e.clientY;

                    const rect = this.panel.getBoundingClientRect();
                    startWidth = rect.width;
                    startHeight = rect.height;
                    startLeft = rect.left;
                    startTop = rect.top;

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                    e.preventDefault();
                    e.stopPropagation();
                };

                const onMouseMove = (e) => {
                    if (!isResizing) return;

                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;

                    let newWidth = startWidth;
                    let newHeight = startHeight;
                    let newLeft = startLeft;
                    let newTop = startTop;

                    // Calculate new dimensions based on handle position
                    if (position.includes('right')) {
                        newWidth = startWidth + deltaX;
                    }
                    if (position.includes('left')) {
                        newWidth = startWidth - deltaX;
                        newLeft = startLeft + deltaX;
                    }
                    if (position.includes('bottom')) {
                        newHeight = startHeight + deltaY;
                    }
                    if (position.includes('top')) {
                        newHeight = startHeight - deltaY;
                        newTop = startTop + deltaY;
                    }

                    // Apply constraints
                    newWidth = Math.max(minWidth, Math.min(newWidth, window.innerWidth - 20));
                    newHeight = Math.max(minHeight, Math.min(newHeight, window.innerHeight - 20));

                    // Apply viewport constraints for position
                    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - newWidth));
                    newTop = Math.max(0, Math.min(newTop, window.innerHeight - newHeight));

                    // Apply new dimensions
                    this.panel.style.width = newWidth + 'px';
                    this.panel.style.height = newHeight + 'px';

                    // Only update position if panel is floating or if resize affects position
                    if (this.panel.className === 'float' || position.includes('left') || position.includes('top')) {
                        this.panel.style.left = newLeft + 'px';
                        this.panel.style.top = newTop + 'px';
                    }

                    e.preventDefault();
                };

                const onMouseUp = () => {
                    if (isResizing) {
                        isResizing = false;

                        // Save new dimensions to settings
                        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
                        const rect = this.panel.getBoundingClientRect();
                        settings.panelWidth = Math.round(rect.width);
                        settings.panelHeight = Math.round(rect.height);
                        AL.persistence.set('settings', settings);

                        console.log('[ui] Panel resized to:', settings.panelWidth, 'x', settings.panelHeight);
                    }

                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                handle.addEventListener('mousedown', onMouseDown);
                this.panel.appendChild(handle);
            });
        },

        /**
         * Create ticker
         */
        createTicker() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            if (!settings.tickerEnabled) return;

            this.ticker = document.createElement('div');
            this.ticker.id = 'al-ticker';

            // Apply CSS variables for ticker size
            const tickerHeight = settings.tickerHeight || 30;
            const tickerFontSize = settings.tickerFontSize || 13;
            document.documentElement.style.setProperty('--ticker-height', `${tickerHeight}px`);
            document.documentElement.style.setProperty('--ticker-font-size', `${tickerFontSize}px`);
            document.documentElement.style.setProperty('--ticker-padding', `${Math.floor(tickerHeight / 4)}px 12px`);

            document.body.appendChild(this.ticker);

            this.updateTicker();

            // Start auto-update interval (every 2 seconds)
            if (!this._tickerInterval) {
                this._tickerInterval = setInterval(() => {
                    this.updateTicker();
                }, 2000);
            }
        },

        /**
         * Update ticker
         * Shows active subpage data only with optimized text (no field labels)
         * Background color represents Type/Updated state
         */
        updateTicker() {
            if (!this.ticker) return;

            try {
                // Get mode and determine dot class
                const mode = AL.capture.mode;
                const modeDotClass = `mode-${mode}`;

                // Get active tab context (ensures ticker shows current visible subpage only)
                const ctx = AL.pageState?.getActiveTabContext();
                if (!ctx) return;

                // Build ticker parts: PID, Vehicle (Type shown via background color)
                const tickerParts = [];

                // Add PID/User if available
                if (ctx.userFull) {
                    tickerParts.push(ctx.userFull);
                } else if (ctx.userLast && ctx.userLast !== 'NO USER') {
                    tickerParts.push(ctx.userLast);
                }

                // Add Vehicle if available
                if (ctx.vehicle) {
                    tickerParts.push(`Vehicle: ${ctx.vehicle}`);
                }

                // Build asset parts from pills (weapon, taser, patrol)
                const assetParts = [];

                // Add weapon pills
                if (ctx.weaponPills && ctx.weaponPills.length > 0) {
                    assetParts.push(...ctx.weaponPills);
                }

                // Add taser pills
                if (ctx.taserPills && ctx.taserPills.length > 0) {
                    assetParts.push(...ctx.taserPills);
                }

                // Add patrol pills
                if (ctx.patrolPills && ctx.patrolPills.length > 0) {
                    assetParts.push(...ctx.patrolPills);
                }

                // Add Control One Radio if available
                if (ctx.controlOneRadio) {
                    assetParts.push(`Radio: ${ctx.controlOneRadio}`);
                }

                // Get prefix text if active
                const prefixText = AL.prefixes.activePrefix ?
                    `Prefix: ${AL.prefixes.activePrefix.label} (${AL.prefixes.activeStickyCount})` : '';

                // Determine ticker styling using helper function
                const tickerStyle = AL.pageState.deriveTickerStyle(ctx);

                let bgColor = '#2a2a2a';  // default
                let textColor = '#e0e0e0'; // default
                let prefixColor = '#ff9800'; // default orange

                if (tickerStyle === 'updated') {
                    // Priority 1: Record updated (Updated On has value)
                    bgColor = '#f44336';  // red
                    textColor = '#ffffff'; // white
                    prefixColor = '#ffd700'; // gold for better visibility on red
                } else if (tickerStyle === 'deploy') {
                    // Priority 2: Type is Deploy/Deployment
                    bgColor = '#ffeb3b';  // yellow
                    textColor = '#000000'; // black
                    prefixColor = '#ff6f00'; // dark orange for visibility on yellow
                } else if (tickerStyle === 'return') {
                    // Priority 3: Type is Return
                    bgColor = '#4CAF50';  // green
                    textColor = '#000000'; // black
                    prefixColor = '#1b5e20'; // dark green for visibility
                }

                // Apply styling to ticker
                this.ticker.style.backgroundColor = bgColor;
                this.ticker.style.color = textColor;

                // Build ticker HTML with optimized format
                // Format: ● PID | Vehicle | Asset1 | Asset2 | ... [PREFIX]
                // (Type shown via background color: yellow=Deployment, green=Return)
                let tickerHTML = `
                    <span style="display: flex; align-items: center;">
                        <span class="al-ticker-status-dot ${modeDotClass}"></span>
                    </span>
                `;

                // Add ticker parts (PID, Vehicle) with separator
                if (tickerParts.length > 0) {
                    tickerHTML += `<span style="font-weight: 600;">${AL.utils.escapeHtml(tickerParts[0])}</span>`;
                    for (let i = 1; i < tickerParts.length; i++) {
                        tickerHTML += ` <span style="opacity: 0.5;">|</span> <span style="font-weight: 500;">${AL.utils.escapeHtml(tickerParts[i])}</span>`;
                    }
                }

                // Add assets with separator
                if (assetParts.length > 0) {
                    if (tickerParts.length > 0) {
                        tickerHTML += ` <span style="opacity: 0.5;">|</span> `;
                    }
                    tickerHTML += `<span style="font-weight: 400;">${AL.utils.escapeHtml(assetParts[0])}</span>`;
                    for (let i = 1; i < assetParts.length; i++) {
                        tickerHTML += ` <span style="opacity: 0.5;">|</span> <span style="font-weight: 400;">${AL.utils.escapeHtml(assetParts[i])}</span>`;
                    }
                }

                // If nothing to show
                if (tickerParts.length === 0 && assetParts.length === 0) {
                    tickerHTML += `<span style="font-weight: 400; opacity: 0.7;">No data</span>`;
                }

                // Add prefix if active
                if (prefixText) {
                    tickerHTML += ` <span style="color: ${prefixColor}; margin-left: 10px; font-weight: 600;">[${AL.utils.escapeHtml(prefixText)}]</span>`;
                }

                this.ticker.innerHTML = tickerHTML;
            } catch (error) {
                console.error('[ui] Error updating ticker:', error);
            }
        },

        /**
         * Show toast notification
         */
        /**
         * Play toast notification sound
         */
        playToastSound() {
            try {
                // Create a simple beep using Web Audio API
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = 800; // Frequency in Hz
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.2);
            } catch (error) {
                // Silently fail if audio playback is blocked or unavailable
                console.log('[ui] Toast sound playback failed:', error.message);
            }
        },

        showToast(title, message, level = 'info', duration = 3000) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            const position = settings.toastPosition || 'top-right';

            // Play sound if enabled
            if (settings.toastSound) {
                this.playToastSound();
            }

            const toast = document.createElement('div');
            toast.className = `al-toast ${position} ${level}`;
            toast.innerHTML = `<strong>${title}</strong><br>${message}`;

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.remove();
            }, duration);
        },

        /**
         * Speak text using speech synthesis
         */
        speak(text) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            if (!settings.speechEnabled) return;

            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = settings.speechRate || 1.0;
                utterance.pitch = settings.speechPitch || 1.0;
                window.speechSynthesis.speak(utterance);
            }
        },

        /**
         * Create bubble launcher (appears when panel is closed)
         */
        createBubble() {
            this.bubble = document.createElement('div');
            this.bubble.id = 'al-bubble';
            this.bubble.innerHTML = '⚙️';
            this.bubble.title = 'Open ArmoryLink Panel';
            this.bubble.style.display = 'none'; // Hidden by default (panel is open initially)

            // Click handler to open panel
            this.bubble.onclick = () => {
                this.togglePanel();
            };

            document.body.appendChild(this.bubble);
        },

        /**
         * Create strip launcher (left-side vertical launcher)
         */
        createStripLauncher() {
            this.stripLauncher = document.createElement('div');
            this.stripLauncher.id = 'al-strip';
            this.stripLauncher.textContent = 'ArmoryLink';
            this.stripLauncher.title = 'Toggle ArmoryLink Panel';

            // Click handler to toggle panel
            this.stripLauncher.onclick = () => {
                this.togglePanel();
            };

            document.body.appendChild(this.stripLauncher);
        },

        /**
         * Switch tab
         */
        switchTab(tabName) {
            this.currentTab = tabName;

            // Update active button
            const tabs = document.querySelectorAll('#al-tabs button');
            tabs.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabName);
            });

            // Render tab content
            this.renderTab(tabName);

            // Save
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            settings.currentTab = tabName;
            AL.persistence.set('settings', settings);
        },

        /**
         * Render tab content
         */
        renderTab(tabName) {
            const content = document.getElementById('al-content');
            if (!content) return;

            switch (tabName) {
                case 'dashboard':
                    this.renderDashboard(content);
                    break;

                case 'fields':
                    this.renderFields(content);
                    break;

                case 'rules':
                    this.renderRules(content);
                    break;

                case 'prefixes':
                    this.renderPrefixes(content);
                    break;

                case 'macros':
                    this.renderMacros(content);
                    break;

                case 'favorites':
                    this.renderFavorites(content);
                    break;

                case 'bwc':
                    this.renderBWC(content);
                    break;

                case 'x10':
                    this.renderX10(content);
                    break;

                case 'settings':
                    this.renderSettings(content);
                    break;

                case 'batch':
                    this.renderBatch(content);
                    break;

                case 'history':
                    this.renderHistory(content);
                    break;

                case 'debug':
                    this.renderDebug(content);
                    break;

                default:
                    content.innerHTML = `<p>Tab: ${tabName} (content will be implemented in future passes)</p>`;
            }
        },

        /**
         * Render Dashboard tab
         */
        renderDashboard(content) {
            const mode = AL.capture.mode;
            const leader = AL.broadcast.isLeader;
            const lastScan = AL.capture.lastScan;

            content.innerHTML = `
                <h3>Manual Input</h3>
                <div style="margin-bottom: 20px;">
                    <input type="text" id="al_manual_input" class="al-input" placeholder="Enter barcode or scan..." style="margin-bottom: 10px;">
                    <button class="al-btn" id="al_manual_submit">Process</button>
                    <button class="al-btn al-btn-secondary" id="al_manual_clear">Clear</button>
                </div>

                <h3>Scanner Mode</h3>
                <div style="margin-bottom: 20px;">
                    <button class="al-btn ${mode === 'on' ? '' : 'al-btn-secondary'}" id="al_mode_on">Activate</button>
                    <button class="al-btn ${mode === 'standby' ? '' : 'al-btn-secondary'}" id="al_mode_standby">Standby</button>
                    <button class="al-btn ${mode === 'off' ? '' : 'al-btn-secondary'}" id="al_mode_off">Disable</button>
                </div>

                <h3>Status</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr style="border-bottom: 1px solid #444;">
                        <td style="padding: 8px;"><strong>Mode:</strong></td>
                        <td style="padding: 8px;">${AL.capture.getModeLabel()}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #444;">
                        <td style="padding: 8px;"><strong>Role:</strong></td>
                        <td style="padding: 8px;">${leader ? 'Leader' : 'Follower'}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #444;">
                        <td style="padding: 8px;"><strong>Context:</strong></td>
                        <td style="padding: 8px;">${AL.activeContext.isArmoryContext ? 'Armory' : 'Non-Armory'}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #444;">
                        <td style="padding: 8px;"><strong>Active Prefix:</strong></td>
                        <td style="padding: 8px;">${AL.prefixes.activePrefix ? `${AL.prefixes.activePrefix.label} (${AL.prefixes.activeStickyCount})` : 'None'}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #444;">
                        <td style="padding: 8px;"><strong>Last Scan:</strong></td>
                        <td style="padding: 8px;">${lastScan ? lastScan.scanText : 'None'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px;"><strong>Queue Length:</strong></td>
                        <td style="padding: 8px;">${AL.capture.scanQueue.length}</td>
                    </tr>
                </table>
            `;

            // Event listeners
            document.getElementById('al_manual_input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleManualInput();
                }
            });

            document.getElementById('al_manual_submit').onclick = () => this.handleManualInput();
            document.getElementById('al_manual_clear').onclick = () => {
                document.getElementById('al_manual_input').value = '';
            };

            document.getElementById('al_mode_on').onclick = () => {
                AL.capture.setMode('on');
                this.renderDashboard(content);
            };

            document.getElementById('al_mode_standby').onclick = () => {
                AL.capture.setMode('standby');
                this.renderDashboard(content);
            };

            document.getElementById('al_mode_off').onclick = () => {
                AL.capture.setMode('off');
                this.renderDashboard(content);
            };
        },

        /**
         * Handle manual input submission
         */
        handleManualInput() {
            const input = document.getElementById('al_manual_input');
            if (!input) return;

            const scanText = input.value.trim();
            if (scanText.length === 0) return;

            AL.capture.handleManualInput(scanText);

            input.value = '';
            this.showToast('Manual Scan', `Submitted: ${scanText}`, 'info');
        },

        /**
         * Render Fields tab
         */
        renderFields(content) {
            content.innerHTML = `
                <h3>Fields Configuration</h3>
                <p style="margin-bottom: 15px;">Configure ServiceNow field selectors. Use the Test button to verify each selector.</p>
                <button class="al-btn al-btn-secondary" id="al_fields_add" style="margin-bottom: 15px;">Add Field</button>
                <button class="al-btn al-btn-danger" id="al_fields_reset">Reset Defaults</button>
                <div id="al_fields_list" style="margin-top: 15px;"></div>
            `;

            // Render fields list
            const fieldsList = document.getElementById('al_fields_list');
            AL.fields.fields.forEach(field => {
                const row = document.createElement('div');
                row.style.cssText = 'background: #2a2a2a; padding: 10px; margin-bottom: 10px; border-radius: 4px;';
                row.innerHTML = `
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <input type="checkbox" ${field.enabled ? 'checked' : ''} data-key="${field.key}" class="al-field-enabled" style="margin-right: 8px;">
                        <strong>${field.label}</strong> <span style="color: #999; margin-left: 8px;">(${field.key})</span>
                    </div>
                    <div style="margin-bottom: 8px;">
                        <input type="text" class="al-input al-field-selector" data-key="${field.key}" value="${field.selector}" placeholder="CSS Selector">
                    </div>
                    <div style="margin-bottom: 8px;">
                        <select class="al-input al-field-commit" data-key="${field.key}">
                            <option value="change" ${field.commitEvent === 'change' ? 'selected' : ''}>change</option>
                            <option value="input" ${field.commitEvent === 'input' ? 'selected' : ''}>input</option>
                            <option value="blur" ${field.commitEvent === 'blur' ? 'selected' : ''}>blur</option>
                            <option value="none" ${field.commitEvent === 'none' ? 'selected' : ''}>none</option>
                        </select>
                    </div>
                    <div>
                        <button class="al-btn al-btn-secondary al-field-test" data-key="${field.key}">Test</button>
                        <button class="al-btn al-btn-danger al-field-delete" data-key="${field.key}">Delete</button>
                    </div>
                `;
                fieldsList.appendChild(row);
            });

            // Event listeners
            document.querySelectorAll('.al-field-enabled').forEach(el => {
                el.onchange = () => {
                    AL.fields.updateField(el.dataset.key, { enabled: el.checked });
                };
            });

            document.querySelectorAll('.al-field-selector').forEach(el => {
                el.onchange = () => {
                    AL.fields.updateField(el.dataset.key, { selector: el.value });
                };
            });

            document.querySelectorAll('.al-field-commit').forEach(el => {
                el.onchange = () => {
                    AL.fields.updateField(el.dataset.key, { commitEvent: el.value });
                };
            });

            document.querySelectorAll('.al-field-test').forEach(el => {
                el.onclick = () => {
                    AL.fields.testField(el.dataset.key);
                };
            });

            document.querySelectorAll('.al-field-delete').forEach(el => {
                el.onclick = () => {
                    if (confirm(`Delete field "${el.dataset.key}"?`)) {
                        AL.fields.deleteField(el.dataset.key);
                        this.renderFields(content);
                    }
                };
            });

            document.getElementById('al_fields_reset').onclick = () => {
                if (confirm('Reset all fields to defaults?')) {
                    AL.fields.resetDefaults();
                    this.renderFields(content);
                }
            };
        },

        /**
         * Render Rules tab
         */
        renderRules(content) {
            content.innerHTML = `
                <h3>Rules Configuration</h3>
                <p style="margin-bottom: 15px;">Configure pattern matching rules for barcode processing.</p>

                <!-- Pattern Tester -->
                <div style="background: #2a2a2a; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
                    <h4 style="margin: 0 0 10px 0;">Pattern Tester</h4>
                    <input type="text" id="al_rule_test_input" class="al-input" placeholder="Enter test barcode..." style="margin-bottom: 10px;">
                    <button class="al-btn al-btn-secondary" id="al_rule_test_btn">Test Pattern</button>
                    <div id="al_rule_test_result" style="margin-top: 10px; padding: 10px; background: #1e1e1e; border-radius: 4px; min-height: 40px;"></div>
                </div>

                <!-- Action Buttons -->
                <button class="al-btn al-btn-secondary" id="al_rules_add" style="margin-bottom: 15px;">Add Rule</button>
                <button class="al-btn al-btn-danger" id="al_rules_reset">Reset Defaults</button>

                <!-- Rules List -->
                <div id="al_rules_list" style="margin-top: 15px;"></div>
            `;

            // Render rules list
            const rulesList = document.getElementById('al_rules_list');
            AL.rules.rules.forEach((rule, index) => {
                const row = document.createElement('div');
                row.style.cssText = 'background: #2a2a2a; padding: 12px; margin-bottom: 10px; border-radius: 4px;';

                // Format actions for display
                const actionsDisplay = rule.actions.map(a => {
                    if (a.type === 'setField') return `Set ${a.field} = ${a.value}`;
                    if (a.type === 'setType') return `Set type = ${a.value}`;
                    if (a.type === 'toast') return `Toast: ${a.message || a.title}`;
                    if (a.type === 'speech') return `Speak: ${a.text}`;
                    return a.type;
                }).join(', ');

                row.innerHTML = `
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-id="${rule.id}" class="al-rule-enabled" style="margin-right: 8px;">
                        <strong style="font-size: 14px;">${rule.name}</strong>
                        <span style="color: #999; margin-left: 8px; font-size: 11px;">(Priority: ${index + 1})</span>
                    </div>
                    <div style="margin-bottom: 8px; padding: 8px; background: #1e1e1e; border-radius: 3px; font-family: monospace; font-size: 12px;">
                        <div style="margin-bottom: 4px;"><strong>Pattern:</strong> ${AL.utils.escapeHtml(rule.pattern)}</div>
                        <div style="margin-bottom: 4px;"><strong>Type:</strong> ${rule.patternType}</div>
                        ${rule.useDirective ? `<div style="margin-bottom: 4px;"><strong>Directive:</strong> ${rule.directiveChars.join(', ')} → ${rule.directiveChars.map(c => AL.rules.directiveMap[c] || c).join(', ')}</div>` : ''}
                        ${rule.speechLabel ? `<div style="margin-bottom: 4px;"><strong>Speech:</strong> ${rule.speechLabel}</div>` : ''}
                    </div>
                    <div style="margin-bottom: 8px; padding: 8px; background: #1e1e1e; border-radius: 3px; font-size: 12px;">
                        <strong>Actions:</strong> ${actionsDisplay || 'None'}
                    </div>
                    <div>
                        <button class="al-btn al-btn-secondary al-rule-test" data-id="${rule.id}" style="font-size: 12px;">Test</button>
                        <button class="al-btn al-btn-secondary al-rule-edit" data-id="${rule.id}" style="font-size: 12px;">Edit</button>
                        <button class="al-btn al-btn-secondary al-rule-move-up" data-id="${rule.id}" style="font-size: 12px;" ${index === 0 ? 'disabled' : ''}>↑</button>
                        <button class="al-btn al-btn-secondary al-rule-move-down" data-id="${rule.id}" style="font-size: 12px;" ${index === AL.rules.rules.length - 1 ? 'disabled' : ''}>↓</button>
                        <button class="al-btn al-btn-danger al-rule-delete" data-id="${rule.id}" style="font-size: 12px;">Delete</button>
                    </div>
                `;
                rulesList.appendChild(row);
            });

            // Event listeners - Pattern Tester
            document.getElementById('al_rule_test_btn').onclick = () => {
                const input = document.getElementById('al_rule_test_input').value.trim();
                const resultDiv = document.getElementById('al_rule_test_result');

                if (!input) {
                    resultDiv.innerHTML = '<span style="color: #999;">Enter a barcode to test</span>';
                    return;
                }

                const match = AL.rules.matchScan(input);
                if (match) {
                    const varsHtml = Object.entries(match.variables)
                        .map(([key, val]) => `<div><strong>${key}:</strong> ${AL.utils.escapeHtml(val || '(empty)')}</div>`)
                        .join('');

                    resultDiv.innerHTML = `
                        <div style="color: #4ade80; margin-bottom: 8px;">✓ Matched Rule: <strong>${match.rule.name}</strong></div>
                        <div style="font-size: 11px; color: #999;">Variables:</div>
                        <div style="font-size: 11px; margin-left: 10px;">${varsHtml}</div>
                    `;
                } else {
                    resultDiv.innerHTML = '<span style="color: #fbbf24;">⚠ No matching rules</span>';
                }
            };

            document.getElementById('al_rule_test_input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    document.getElementById('al_rule_test_btn').click();
                }
            });

            // Event listeners - Enable/Disable
            document.querySelectorAll('.al-rule-enabled').forEach(el => {
                el.onchange = () => {
                    AL.rules.updateRule(el.dataset.id, { enabled: el.checked });
                    AL.ui.showToast('Rule Updated', `Rule ${el.checked ? 'enabled' : 'disabled'}`, 'success');
                };
            });

            // Event listeners - Test individual rule
            document.querySelectorAll('.al-rule-test').forEach(el => {
                el.onclick = () => {
                    const rule = AL.rules.rules.find(r => r.id === el.dataset.id);
                    if (!rule) return;

                    const testInput = prompt(`Test pattern for rule "${rule.name}"\n\nPattern: ${rule.pattern}\nType: ${rule.patternType}\n\nEnter test barcode:`);
                    if (!testInput) return;

                    const matchResult = AL.rules.testPattern(testInput, rule);
                    if (matchResult) {
                        const varsText = Object.entries(matchResult.variables)
                            .map(([key, val]) => `${key}: ${val || '(empty)'}`)
                            .join('\n');
                        alert(`✓ Match Success!\n\nVariables:\n${varsText}`);
                    } else {
                        alert('✗ No match');
                    }
                };
            });

            // Event listeners - Edit
            document.querySelectorAll('.al-rule-edit').forEach(el => {
                el.onclick = () => {
                    const rule = AL.rules.rules.find(r => r.id === el.dataset.id);
                    if (!rule) return;

                    AL.ui._modalActions = [...(rule.actions || [])];
                    AL.ui.showRuleEditor(rule);
                };
            });

            // Event listeners - Move Up/Down
            document.querySelectorAll('.al-rule-move-up').forEach(el => {
                el.onclick = () => {
                    const index = AL.rules.rules.findIndex(r => r.id === el.dataset.id);
                    if (index > 0) {
                        [AL.rules.rules[index - 1], AL.rules.rules[index]] = [AL.rules.rules[index], AL.rules.rules[index - 1]];
                        AL.rules.save();
                        this.renderRules(content);
                    }
                };
            });

            document.querySelectorAll('.al-rule-move-down').forEach(el => {
                el.onclick = () => {
                    const index = AL.rules.rules.findIndex(r => r.id === el.dataset.id);
                    if (index >= 0 && index < AL.rules.rules.length - 1) {
                        [AL.rules.rules[index], AL.rules.rules[index + 1]] = [AL.rules.rules[index + 1], AL.rules.rules[index]];
                        AL.rules.save();
                        this.renderRules(content);
                    }
                };
            });

            // Event listeners - Delete
            document.querySelectorAll('.al-rule-delete').forEach(el => {
                el.onclick = () => {
                    const rule = AL.rules.rules.find(r => r.id === el.dataset.id);
                    if (!rule) return;

                    if (confirm(`Delete rule "${rule.name}"?`)) {
                        AL.rules.deleteRule(el.dataset.id);
                        this.renderRules(content);
                        AL.ui.showToast('Rule Deleted', `Removed rule: ${rule.name}`, 'success');
                    }
                };
            });

            // Event listeners - Add Rule
            document.getElementById('al_rules_add').onclick = () => {
                AL.ui._modalActions = [];
                AL.ui.showRuleEditor(null);
            };

            // Event listeners - Reset Defaults
            document.getElementById('al_rules_reset').onclick = () => {
                if (confirm('Reset all rules to defaults? This will delete all custom rules.')) {
                    AL.rules.resetDefaults();
                    this.renderRules(content);
                    AL.ui.showToast('Rules Reset', 'All rules restored to defaults', 'success');
                }
            };
        },

        /**
         * Render Prefixes tab
         */
        renderPrefixes(content) {
            const activePrefix = AL.prefixes.activePrefix;

            content.innerHTML = `
                <h3>Prefix System (Alt+1-9 Hotkeys)</h3>
                <p style="margin-bottom: 15px;">Configure text prefixes that can be quickly activated with Alt+1 through Alt+9 hotkeys.</p>

                <!-- Active Prefix Display -->
                ${activePrefix ? `
                    <div style="background: #2a2a2a; padding: 12px; margin-bottom: 20px; border-radius: 4px; border-left: 4px solid #4CAF50;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong style="color: #4CAF50;">Active Prefix:</strong> ${activePrefix.label}
                                <div style="font-size: 11px; color: #999; margin-top: 4px;">Value: "${activePrefix.value}" | Remaining: ${AL.prefixes.activeStickyCount}</div>
                            </div>
                            <button class="al-btn al-btn-secondary" id="al_prefix_deactivate">Deactivate</button>
                        </div>
                    </div>
                ` : `
                    <div style="background: #2a2a2a; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
                        <div style="color: #999; font-size: 12px;">No active prefix. Press Alt+1-9 to activate.</div>
                    </div>
                `}

                <!-- Action Buttons -->
                <button class="al-btn al-btn-secondary" id="al_prefixes_add" style="margin-bottom: 15px;">Add Prefix</button>
                <button class="al-btn al-btn-danger" id="al_prefixes_clear">Clear All</button>

                <!-- Prefixes List -->
                <div id="al_prefixes_list" style="margin-top: 15px;"></div>
            `;

            // Deactivate button
            if (activePrefix) {
                document.getElementById('al_prefix_deactivate').onclick = () => {
                    AL.prefixes.deactivate();
                    this.renderPrefixes(content);
                };
            }

            // Render prefixes list
            const prefixesList = document.getElementById('al_prefixes_list');

            if (AL.prefixes.prefixes.length === 0) {
                prefixesList.innerHTML = '<div style="color: #999; font-size: 12px; padding: 20px; text-align: center;">No prefixes configured. Click "Add Prefix" to create one.</div>';
            } else {
                AL.prefixes.prefixes.forEach(prefix => {
                    const row = document.createElement('div');
                    row.style.cssText = 'background: #2a2a2a; padding: 12px; margin-bottom: 10px; border-radius: 4px;';

                    const isActive = activePrefix && activePrefix.id === prefix.id;

                    row.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                                    <strong style="font-size: 14px;">${AL.utils.escapeHtml(prefix.label)}</strong>
                                    ${prefix.hotkey ? `<span style="background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px; font-family: monospace;">Alt+${prefix.hotkey}</span>` : ''}
                                    ${isActive ? `<span style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px;">ACTIVE</span>` : ''}
                                </div>
                                <div style="font-family: monospace; font-size: 12px; background: #1e1e1e; padding: 6px 8px; border-radius: 3px; margin-bottom: 4px;">
                                    "${AL.utils.escapeHtml(prefix.value)}"
                                </div>
                                <div style="font-size: 11px; color: #999;">
                                    Sticky: ${prefix.stickyCount || 1} scan(s)
                                </div>
                            </div>
                        </div>
                        <div>
                            <button class="al-btn al-btn-secondary al-prefix-activate" data-id="${prefix.id}" style="font-size: 12px;" ${isActive ? 'disabled' : ''}>Activate</button>
                            <button class="al-btn al-btn-secondary al-prefix-edit" data-id="${prefix.id}" style="font-size: 12px;">Edit</button>
                            <button class="al-btn al-btn-danger al-prefix-delete" data-id="${prefix.id}" style="font-size: 12px;">Delete</button>
                        </div>
                    `;
                    prefixesList.appendChild(row);
                });
            }

            // Event listeners - Activate
            document.querySelectorAll('.al-prefix-activate').forEach(el => {
                el.onclick = () => {
                    const prefix = AL.prefixes.prefixes.find(p => p.id === el.dataset.id);
                    if (prefix) {
                        AL.prefixes.activate(prefix);
                        this.renderPrefixes(content);
                    }
                };
            });

            // Event listeners - Edit
            document.querySelectorAll('.al-prefix-edit').forEach(el => {
                el.onclick = () => {
                    const prefix = AL.prefixes.prefixes.find(p => p.id === el.dataset.id);
                    if (prefix) {
                        this.showPrefixEditor(prefix);
                    }
                };
            });

            // Event listeners - Delete
            document.querySelectorAll('.al-prefix-delete').forEach(el => {
                el.onclick = () => {
                    const prefix = AL.prefixes.prefixes.find(p => p.id === el.dataset.id);
                    if (!prefix) return;

                    if (confirm(`Delete prefix "${prefix.label}"?`)) {
                        AL.prefixes.deletePrefix(el.dataset.id);
                        this.renderPrefixes(content);
                        this.showToast('Prefix Deleted', `Removed prefix: ${prefix.label}`, 'success');
                    }
                };
            });

            // Event listeners - Add Prefix
            document.getElementById('al_prefixes_add').onclick = () => {
                this.showPrefixEditor(null);
            };

            // Event listeners - Clear All
            document.getElementById('al_prefixes_clear').onclick = () => {
                if (confirm('Delete all prefixes?')) {
                    AL.prefixes.prefixes = [];
                    AL.prefixes.save();
                    AL.prefixes.deactivate();
                    this.renderPrefixes(content);
                    this.showToast('Prefixes Cleared', 'All prefixes removed', 'success');
                }
            };
        },

        /**
         * Render Settings tab
         */
        renderSettings(content) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());

            content.innerHTML = `
                <h3>Settings</h3>
                <p style="margin-bottom: 20px;">Configure system preferences and behavior.</p>

                <!-- Theme Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Theme</h4>

                    <div class="al-form-group">
                        <label>Color Theme</label>
                        <select class="al-input" id="al-theme-selector">
                            <option value="light" ${(settings.theme || 'dark') === 'light' ? 'selected' : ''}>Light</option>
                            <option value="dark" ${(settings.theme || 'dark') === 'dark' ? 'selected' : ''}>Dark</option>
                            <option value="high-contrast" ${(settings.theme || 'dark') === 'high-contrast' ? 'selected' : ''}>High Contrast</option>
                            <option value="ocsd-sheriff" ${(settings.theme || 'dark') === 'ocsd-sheriff' ? 'selected' : ''}>OCSD Sheriff</option>
                        </select>
                        <small>Choose your preferred color theme. Sheriff theme uses official OCSD branding colors.</small>
                    </div>
                </div>

                <!-- Layout Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Layout</h4>

                    <div class="al-form-group">
                        <label>Dock Mode</label>
                        <select class="al-input" id="al-setting-dock-mode">
                            <option value="dock-left" ${settings.dockMode === 'dock-left' ? 'selected' : ''}>Dock Left</option>
                            <option value="dock-right" ${settings.dockMode === 'dock-right' ? 'selected' : ''}>Dock Right</option>
                            <option value="dock-bottom" ${settings.dockMode === 'dock-bottom' ? 'selected' : ''}>Dock Bottom</option>
                            <option value="float" ${settings.dockMode === 'float' ? 'selected' : ''}>Float</option>
                        </select>
                    </div>

                    <div class="al-form-group">
                        <label>Panel Width (px)</label>
                        <input type="number" class="al-input" id="al-setting-panel-width" value="${settings.panelWidth}" min="300" max="800">
                    </div>

                    <div class="al-form-group">
                        <label>Panel Height (px)</label>
                        <input type="number" class="al-input" id="al-setting-panel-height" value="${settings.panelHeight}" min="400" max="1000">
                    </div>

                    <div class="al-form-group">
                        <label>Top Gap - Left Dock (px)</label>
                        <input type="number" class="al-input" id="al-setting-top-gap-left" value="${settings.topGapLeft || 0}" min="0" max="200">
                        <small>Top offset when panel is docked left</small>
                    </div>

                    <div class="al-form-group">
                        <label>Top Gap - Right Dock (px)</label>
                        <input type="number" class="al-input" id="al-setting-top-gap-right" value="${settings.topGapRight || 0}" min="0" max="200">
                        <small>Top offset when panel is docked right</small>
                    </div>
                </div>

                <!-- Capture Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Scanner Capture</h4>

                    <div class="al-form-group">
                        <label>Scan Throttle (ms)</label>
                        <input type="number" class="al-input" id="al-setting-scan-throttle" value="${settings.scanThrottle}" min="50" max="1000" step="50">
                        <small>Minimum time between processing scans (prevents duplicates)</small>
                    </div>

                    <div class="al-form-group">
                        <label>Duplicate Window (ms)</label>
                        <input type="number" class="al-input" id="al-setting-duplicate-window" value="${settings.duplicateWindow}" min="1000" max="30000" step="1000">
                        <small>Time window to suppress identical scans</small>
                    </div>

                    <div class="al-form-group">
                        <label>Scan Timeout (ms)</label>
                        <input type="number" class="al-input" id="al-setting-scan-timeout" value="${settings.scanTimeout}" min="5000" max="60000" step="1000">
                        <small>Maximum time to wait for barcode completion</small>
                    </div>
                </div>

                <!-- Toast Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Toast Notifications</h4>

                    <div class="al-form-group">
                        <label>Toast Position</label>
                        <select class="al-input" id="al-setting-toast-position">
                            <option value="top-left" ${settings.toastPosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                            <option value="top-center" ${settings.toastPosition === 'top-center' ? 'selected' : ''}>Top Center</option>
                            <option value="top-right" ${settings.toastPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                            <option value="bottom-left" ${settings.toastPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                            <option value="bottom-center" ${settings.toastPosition === 'bottom-center' ? 'selected' : ''}>Bottom Center</option>
                            <option value="bottom-right" ${settings.toastPosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                        </select>
                    </div>

                    <div class="al-form-group">
                        <label>Toast Duration (ms)</label>
                        <input type="number" class="al-input" id="al-setting-toast-duration" value="${settings.toastDuration}" min="1000" max="10000" step="500">
                    </div>

                    <div class="al-form-group">
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-setting-toast-sticky" ${settings.toastSticky ? 'checked' : ''}>
                            <label for="al-setting-toast-sticky" style="margin: 0;">Sticky (requires manual dismiss)</label>
                        </div>
                    </div>

                    <div class="al-form-group">
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-setting-toast-sound" ${settings.toastSound ? 'checked' : ''}>
                            <label for="al-setting-toast-sound" style="margin: 0;">Play Sound on Toast</label>
                        </div>
                    </div>
                </div>

                <!-- Speech Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Speech Synthesis</h4>

                    <div class="al-form-group">
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-setting-speech-enabled" ${settings.speechEnabled ? 'checked' : ''}>
                            <label for="al-setting-speech-enabled" style="margin: 0;">Enable Speech</label>
                        </div>
                    </div>

                    <div class="al-form-group">
                        <label>Speech Rate</label>
                        <input type="range" class="al-input" id="al-setting-speech-rate" value="${settings.speechRate}" min="0.5" max="2.0" step="0.1" style="width: 100%;">
                        <small>Current: <span id="al-speech-rate-value">${settings.speechRate}</span>x</small>
                    </div>

                    <div class="al-form-group">
                        <label>Speech Pitch</label>
                        <input type="range" class="al-input" id="al-setting-speech-pitch" value="${settings.speechPitch}" min="0.5" max="2.0" step="0.1" style="width: 100%;">
                        <small>Current: <span id="al-speech-pitch-value">${settings.speechPitch}</span>x</small>
                    </div>

                    <div class="al-form-group">
                        <button class="al-btn al-btn-secondary" id="al-test-speech-btn">Test Speech</button>
                    </div>
                </div>

                <!-- Ticker Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Ticker</h4>

                    <div class="al-form-group">
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-setting-ticker-enabled" ${settings.tickerEnabled ? 'checked' : ''}>
                            <label for="al-setting-ticker-enabled" style="margin: 0;">Show Ticker Bar</label>
                        </div>
                    </div>

                    <div class="al-form-group">
                        <label>Ticker Height (px)</label>
                        <input type="number" class="al-input" id="al-setting-ticker-height" value="${settings.tickerHeight || 30}" min="20" max="60" step="5">
                        <small>Height of the ticker bar at bottom of screen</small>
                    </div>

                    <div class="al-form-group">
                        <label>Ticker Font Size (px)</label>
                        <input type="number" class="al-input" id="al-setting-ticker-font-size" value="${settings.tickerFontSize || 13}" min="10" max="20" step="1">
                        <small>Font size for ticker text</small>
                    </div>
                </div>

                <!-- Debug Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Debug</h4>

                    <div class="al-form-group">
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-setting-debug-enabled" ${settings.debugEnabled ? 'checked' : ''}>
                            <label for="al-setting-debug-enabled" style="margin: 0;">Enable Debug Logging</label>
                        </div>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div style="margin-top: 20px;">
                    <button class="al-btn al-btn-secondary" id="al-reset-settings-btn">Reset to Defaults</button>
                    <span style="color: #999; font-size: 12px; margin-left: 15px;">Settings auto-save on change</span>
                </div>
            `;

            // Auto-save helper function
            const autoSave = () => {
                this.saveSettingsFromForm(true); // Pass true to indicate auto-save (silent mode)
            };

            // Theme selector - apply theme immediately and save
            document.getElementById('al-theme-selector').onchange = (e) => {
                AL.ui.setTheme(e.target.value, true);
            };

            // Layout settings - auto-save on change
            document.getElementById('al-setting-dock-mode').onchange = autoSave;
            document.getElementById('al-setting-panel-width').onchange = autoSave;
            document.getElementById('al-setting-panel-height').onchange = autoSave;
            document.getElementById('al-setting-top-gap-left').onchange = autoSave;
            document.getElementById('al-setting-top-gap-right').onchange = autoSave;

            // Capture settings - auto-save on change
            document.getElementById('al-setting-scan-throttle').onchange = autoSave;
            document.getElementById('al-setting-duplicate-window').onchange = autoSave;
            document.getElementById('al-setting-scan-timeout').onchange = autoSave;

            // Toast settings - auto-save on change
            document.getElementById('al-setting-toast-position').onchange = autoSave;
            document.getElementById('al-setting-toast-duration').onchange = autoSave;
            document.getElementById('al-setting-toast-sticky').onchange = autoSave;
            document.getElementById('al-setting-toast-sound').onchange = autoSave;

            // Speech settings - auto-save on change
            document.getElementById('al-setting-speech-enabled').onchange = autoSave;

            // Update speech rate/pitch value displays and auto-save
            document.getElementById('al-setting-speech-rate').oninput = (e) => {
                document.getElementById('al-speech-rate-value').textContent = e.target.value;
                autoSave();
            };

            document.getElementById('al-setting-speech-pitch').oninput = (e) => {
                document.getElementById('al-speech-pitch-value').textContent = e.target.value;
                autoSave();
            };

            // Ticker settings - auto-save on change
            document.getElementById('al-setting-ticker-enabled').onchange = autoSave;
            document.getElementById('al-setting-ticker-height').onchange = autoSave;
            document.getElementById('al-setting-ticker-font-size').onchange = autoSave;

            // Debug settings - auto-save on change
            document.getElementById('al-setting-debug-enabled').onchange = autoSave;

            // Test speech button
            document.getElementById('al-test-speech-btn').onclick = () => {
                const enabled = document.getElementById('al-setting-speech-enabled').checked;
                const rate = parseFloat(document.getElementById('al-setting-speech-rate').value);
                const pitch = parseFloat(document.getElementById('al-setting-speech-pitch').value);

                if (!enabled) {
                    this.showToast('Speech Disabled', 'Enable speech to test', 'warning');
                    return;
                }

                // Test with custom rate/pitch
                const utterance = new SpeechSynthesisUtterance('This is a test of the speech synthesis system.');
                utterance.rate = rate;
                utterance.pitch = pitch;
                window.speechSynthesis.speak(utterance);
            };

            // Reset button
            document.getElementById('al-reset-settings-btn').onclick = () => {
                if (confirm('Reset all settings to defaults?')) {
                    AL.persistence.set('settings', AL.stubs.getDefaultSettings());
                    this.showToast('Settings Reset', 'All settings restored to defaults', 'success');
                    this.renderSettings(content);
                }
            };
        },

        /**
         * Render BWC tab
         */
        renderBWC(content) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            const bwcSettings = {
                enabled: settings.bwcEnabled !== false,
                useIframe: settings.bwcUseIframe !== false,
                baseUrl: settings.bwcBaseUrl || 'https://evidence.com'
            };

            content.innerHTML = `
                <h3>Body Worn Camera (BWC)</h3>
                <p style="margin-bottom: 15px; color: #999;">Axon Evidence.com integration</p>

                <!-- Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Settings</h4>

                    <div class="al-form-group">
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-bwc-enabled" ${bwcSettings.enabled ? 'checked' : ''}>
                            <label for="al-bwc-enabled" style="margin: 0;">Enable BWC Integration</label>
                        </div>
                    </div>

                    <div class="al-form-group">
                        <label>Display Mode</label>
                        <select class="al-input" id="al-bwc-mode">
                            <option value="iframe" ${bwcSettings.useIframe ? 'selected' : ''}>Embedded iframe (recommended)</option>
                            <option value="tab" ${!bwcSettings.useIframe ? 'selected' : ''}>New browser tab</option>
                        </select>
                        <small>How to display Evidence.com when launched</small>
                    </div>

                    <div class="al-form-group">
                        <label>Base URL</label>
                        <input type="text" class="al-input" id="al-bwc-base-url" value="${bwcSettings.baseUrl}" placeholder="https://evidence.com">
                        <small>Evidence.com base URL for your agency</small>
                    </div>

                    <button class="al-btn al-btn-primary" id="al-bwc-save-settings-btn">Save Settings</button>
                </div>

                <!-- Launch Controls -->
                <div style="background: #2a2a2a; padding: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Quick Launch</h4>

                    <p style="font-size: 12px; color: #999; margin-bottom: 15px;">
                        Automatically reads User field from active ServiceNow page to look up camera assignments.
                    </p>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <button class="al-btn al-btn-primary" id="al-bwc-launch-btn" ${!bwcSettings.enabled ? 'disabled' : ''}>
                            🎥 Launch Evidence.com
                        </button>
                        <button class="al-btn al-btn-secondary" id="al-bwc-launch-inventory-btn" ${!bwcSettings.enabled ? 'disabled' : ''}>
                            View Inventory
                        </button>
                    </div>

                    ${bwcSettings.useIframe ? `
                        <div id="al-bwc-iframe-container" style="
                            background: #1a1a1a;
                            border: 1px solid #333;
                            border-radius: 4px;
                            height: 500px;
                            overflow: hidden;
                            display: none;
                        ">
                            <div style="background: #2a2a2a; padding: 8px; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 10px;">
                                <span style="flex: 1; font-size: 11px; color: #999;" id="al-bwc-iframe-url">No page loaded</span>
                                <button class="al-btn al-btn-secondary" id="al-bwc-iframe-close" style="padding: 4px 8px; font-size: 11px;">Close</button>
                            </div>
                            <iframe id="al-bwc-iframe" style="width: 100%; height: calc(100% - 40px); border: none;"></iframe>
                        </div>
                    ` : ''}

                    <div style="margin-top: 15px; font-size: 11px; color: #666;">
                        <strong>Note:</strong> BWC integration is read-only from ServiceNow's perspective.
                        No data is written back to ServiceNow fields.
                    </div>
                </div>
            `;

            // Event handlers
            document.getElementById('al-bwc-save-settings-btn').onclick = () => {
                const enabled = document.getElementById('al-bwc-enabled').checked;
                const useIframe = document.getElementById('al-bwc-mode').value === 'iframe';
                const baseUrl = document.getElementById('al-bwc-base-url').value.trim();

                const updatedSettings = {
                    ...settings,
                    bwcEnabled: enabled,
                    bwcUseIframe: useIframe,
                    bwcBaseUrl: baseUrl
                };

                AL.persistence.set('settings', updatedSettings);
                this.showToast('Settings Saved', 'BWC settings have been updated', 'success');
                this.renderBWC(content);
            };

            document.getElementById('al-bwc-launch-btn').onclick = () => {
                const user = AL.fields.getFieldValue('user');
                const url = bwcSettings.baseUrl;

                if (bwcSettings.useIframe) {
                    const container = document.getElementById('al-bwc-iframe-container');
                    const iframe = document.getElementById('al-bwc-iframe');
                    const urlDisplay = document.getElementById('al-bwc-iframe-url');

                    container.style.display = 'block';
                    iframe.src = url;
                    urlDisplay.textContent = url;

                    this.showToast('BWC Launched', user ? `Loading for user: ${user}` : 'Opening Evidence.com', 'info');
                } else {
                    window.open(url, '_blank');
                    this.showToast('BWC Launched', 'Opened in new tab', 'info');
                }
            };

            document.getElementById('al-bwc-launch-inventory-btn').onclick = () => {
                const url = `${bwcSettings.baseUrl}/inventory`;

                if (bwcSettings.useIframe) {
                    const container = document.getElementById('al-bwc-iframe-container');
                    const iframe = document.getElementById('al-bwc-iframe');
                    const urlDisplay = document.getElementById('al-bwc-iframe-url');

                    container.style.display = 'block';
                    iframe.src = url;
                    urlDisplay.textContent = url;

                    this.showToast('BWC Inventory', 'Loading inventory view', 'info');
                } else {
                    window.open(url, '_blank');
                    this.showToast('BWC Inventory', 'Opened in new tab', 'info');
                }
            };

            if (bwcSettings.useIframe) {
                const closeBtn = document.getElementById('al-bwc-iframe-close');
                if (closeBtn) {
                    closeBtn.onclick = () => {
                        const container = document.getElementById('al-bwc-iframe-container');
                        const iframe = document.getElementById('al-bwc-iframe');
                        container.style.display = 'none';
                        iframe.src = 'about:blank';
                    };
                }
            }
        },

        /**
         * Render X10 tab
         */
        renderX10(content) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            const x10Settings = {
                enabled: settings.x10Enabled !== false,
                useIframe: settings.x10UseIframe !== false,
                baseUrl: settings.x10BaseUrl || 'https://my.taser.com'
            };

            content.innerHTML = `
                <h3>TASER X10</h3>
                <p style="margin-bottom: 15px; color: #999;">TASER device management integration</p>

                <!-- Settings -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Settings</h4>

                    <div class="al-form-group">
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-x10-enabled" ${x10Settings.enabled ? 'checked' : ''}>
                            <label for="al-x10-enabled" style="margin: 0;">Enable X10 Integration</label>
                        </div>
                    </div>

                    <div class="al-form-group">
                        <label>Display Mode</label>
                        <select class="al-input" id="al-x10-mode">
                            <option value="iframe" ${x10Settings.useIframe ? 'selected' : ''}>Embedded iframe (recommended)</option>
                            <option value="tab" ${!x10Settings.useIframe ? 'selected' : ''}>New browser tab</option>
                        </select>
                        <small>How to display TASER site when launched</small>
                    </div>

                    <div class="al-form-group">
                        <label>Base URL</label>
                        <input type="text" class="al-input" id="al-x10-base-url" value="${x10Settings.baseUrl}" placeholder="https://my.taser.com">
                        <small>TASER management base URL for your agency</small>
                    </div>

                    <button class="al-btn al-btn-primary" id="al-x10-save-settings-btn">Save Settings</button>
                </div>

                <!-- Launch Controls -->
                <div style="background: #2a2a2a; padding: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Quick Launch</h4>

                    <p style="font-size: 12px; color: #999; margin-bottom: 15px;">
                        Automatically reads Taser Asset field from active ServiceNow page to look up device info.
                    </p>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <button class="al-btn al-btn-primary" id="al-x10-launch-btn" ${!x10Settings.enabled ? 'disabled' : ''}>
                            ⚡ Launch TASER Site
                        </button>
                        <button class="al-btn al-btn-secondary" id="al-x10-launch-inventory-btn" ${!x10Settings.enabled ? 'disabled' : ''}>
                            View Inventory
                        </button>
                    </div>

                    ${x10Settings.useIframe ? `
                        <div id="al-x10-iframe-container" style="
                            background: #1a1a1a;
                            border: 1px solid #333;
                            border-radius: 4px;
                            height: 500px;
                            overflow: hidden;
                            display: none;
                        ">
                            <div style="background: #2a2a2a; padding: 8px; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 10px;">
                                <span style="flex: 1; font-size: 11px; color: #999;" id="al-x10-iframe-url">No page loaded</span>
                                <button class="al-btn al-btn-secondary" id="al-x10-iframe-close" style="padding: 4px 8px; font-size: 11px;">Close</button>
                            </div>
                            <iframe id="al-x10-iframe" style="width: 100%; height: calc(100% - 40px); border: none;"></iframe>
                        </div>
                    ` : ''}

                    <div style="margin-top: 15px; font-size: 11px; color: #666;">
                        <strong>Note:</strong> X10 integration is read-only from ServiceNow's perspective.
                        No data is written back to ServiceNow fields.
                    </div>
                </div>
            `;

            // Event handlers
            document.getElementById('al-x10-save-settings-btn').onclick = () => {
                const enabled = document.getElementById('al-x10-enabled').checked;
                const useIframe = document.getElementById('al-x10-mode').value === 'iframe';
                const baseUrl = document.getElementById('al-x10-base-url').value.trim();

                const updatedSettings = {
                    ...settings,
                    x10Enabled: enabled,
                    x10UseIframe: useIframe,
                    x10BaseUrl: baseUrl
                };

                AL.persistence.set('settings', updatedSettings);
                this.showToast('Settings Saved', 'X10 settings have been updated', 'success');
                this.renderX10(content);
            };

            document.getElementById('al-x10-launch-btn').onclick = () => {
                const taser = AL.fields.getFieldValue('taser');
                const url = x10Settings.baseUrl;

                if (x10Settings.useIframe) {
                    const container = document.getElementById('al-x10-iframe-container');
                    const iframe = document.getElementById('al-x10-iframe');
                    const urlDisplay = document.getElementById('al-x10-iframe-url');

                    container.style.display = 'block';
                    iframe.src = url;
                    urlDisplay.textContent = url;

                    this.showToast('X10 Launched', taser ? `Loading for device: ${taser}` : 'Opening TASER site', 'info');
                } else {
                    window.open(url, '_blank');
                    this.showToast('X10 Launched', 'Opened in new tab', 'info');
                }
            };

            document.getElementById('al-x10-launch-inventory-btn').onclick = () => {
                const url = `${x10Settings.baseUrl}/inventory`;

                if (x10Settings.useIframe) {
                    const container = document.getElementById('al-x10-iframe-container');
                    const iframe = document.getElementById('al-x10-iframe');
                    const urlDisplay = document.getElementById('al-x10-iframe-url');

                    container.style.display = 'block';
                    iframe.src = url;
                    urlDisplay.textContent = url;

                    this.showToast('X10 Inventory', 'Loading inventory view', 'info');
                } else {
                    window.open(url, '_blank');
                    this.showToast('X10 Inventory', 'Opened in new tab', 'info');
                }
            };

            if (x10Settings.useIframe) {
                const closeBtn = document.getElementById('al-x10-iframe-close');
                if (closeBtn) {
                    closeBtn.onclick = () => {
                        const container = document.getElementById('al-x10-iframe-container');
                        const iframe = document.getElementById('al-x10-iframe');
                        container.style.display = 'none';
                        iframe.src = 'about:blank';
                    };
                }
            }
        },

        /**
         * Render Favorites/Prefills tab
         */
        renderFavorites(content) {
            // Initialize favorites storage if not exists
            if (!AL.favorites) {
                AL.favorites = {
                    items: AL.persistence.get('favorites', []),
                    save() {
                        AL.persistence.set('favorites', this.items);
                    },
                    add(favorite) {
                        favorite.id = favorite.id || AL.utils.generateId();
                        favorite.created = Date.now();
                        this.items.push(favorite);
                        this.save();
                    },
                    update(id, updates) {
                        const index = this.items.findIndex(f => f.id === id);
                        if (index >= 0) {
                            this.items[index] = { ...this.items[index], ...updates };
                            this.save();
                        }
                    },
                    delete(id) {
                        this.items = this.items.filter(f => f.id !== id);
                        this.save();
                    }
                };
            }

            const favorites = AL.favorites.items;

            content.innerHTML = `
                <h3>Favorites / Prefills</h3>
                <p style="margin-bottom: 15px; color: #999;">Save and restore field configurations</p>

                <!-- Snapshot Current State Button -->
                <div style="margin-bottom: 15px;">
                    <button class="al-btn al-btn-primary" id="al-snapshot-btn">📸 Snapshot Current Fields</button>
                    <small style="color: #666; margin-left: 10px; font-size: 11px;">Save current field values as a favorite</small>
                </div>

                <!-- Favorites List -->
                <div style="background: #2a2a2a; padding: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">
                        Saved Favorites (${favorites.length})
                    </h4>

                    ${favorites.length === 0 ? `
                        <div style="color: #666; padding: 40px; text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 10px;">⭐</div>
                            <div>No favorites saved</div>
                            <div style="font-size: 11px; margin-top: 5px;">Snapshot current field values to create a favorite</div>
                        </div>
                    ` : `
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${favorites.slice().reverse().map(fav => `
                                <div style="
                                    background: #1a1a1a;
                                    border: 1px solid #444;
                                    border-left: 3px solid #ffaa00;
                                    border-radius: 4px;
                                    padding: 12px;
                                ">
                                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                        <div style="flex: 1;">
                                            <div style="font-weight: 600;">
                                                ${fav.name || 'Unnamed Favorite'}
                                            </div>
                                            ${fav.description ? `
                                                <div style="font-size: 11px; color: #666; margin-top: 2px;">
                                                    ${fav.description}
                                                </div>
                                            ` : ''}
                                            <div style="font-size: 11px; color: #999; margin-top: 4px;">
                                                Created: ${new Date(fav.created).toLocaleString()}
                                            </div>
                                        </div>
                                        <div style="display: flex; gap: 5px;">
                                            <button class="al-btn al-btn-primary al-fav-apply-btn" data-fav-id="${fav.id}" title="Apply to Fields">
                                                Apply
                                            </button>
                                            <button class="al-btn al-btn-secondary al-fav-edit-btn" data-fav-id="${fav.id}" title="Edit">
                                                ✎
                                            </button>
                                            <button class="al-btn al-btn-danger al-fav-delete-btn" data-fav-id="${fav.id}" title="Delete">
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                    <div style="font-size: 11px; color: #666; background: #0a0a0a; padding: 8px; border-radius: 3px; margin-top: 8px;">
                                        <div style="font-weight: 600; margin-bottom: 4px;">Field Values:</div>
                                        ${Object.entries(fav.fieldValues || {}).map(([key, value]) => `
                                            <div style="margin: 2px 0;">
                                                <span style="color: #00aaff;">${key}:</span>
                                                <span style="color: #e0e0e0;">${value || '<empty>'}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            `;

            // Snapshot button
            document.getElementById('al-snapshot-btn').onclick = () => {
                this.showFavoriteEditor();
            };

            // Apply buttons
            document.querySelectorAll('.al-fav-apply-btn').forEach(btn => {
                btn.onclick = async () => {
                    const favId = btn.dataset.favId;
                    const fav = favorites.find(f => f.id === favId);
                    if (fav) {
                        await this.applyFavorite(fav);
                    }
                };
            });

            // Edit buttons
            document.querySelectorAll('.al-fav-edit-btn').forEach(btn => {
                btn.onclick = () => {
                    const favId = btn.dataset.favId;
                    const fav = favorites.find(f => f.id === favId);
                    if (fav) {
                        this.showFavoriteEditor(fav);
                    }
                };
            });

            // Delete buttons
            document.querySelectorAll('.al-fav-delete-btn').forEach(btn => {
                btn.onclick = () => {
                    const favId = btn.dataset.favId;
                    const fav = favorites.find(f => f.id === favId);
                    if (fav && confirm(`Delete favorite "${fav.name}"?`)) {
                        AL.favorites.delete(favId);
                        this.showToast('Favorite Deleted', `${fav.name} has been removed`, 'success');
                        this.renderFavorites(content);
                    }
                };
            });
        },

        /**
         * Show favorite editor modal
         */
        showFavoriteEditor(favorite = null) {
            const isEdit = favorite !== null;
            const title = isEdit ? 'Edit Favorite' : 'Create Favorite from Current Fields';

            // Snapshot current field values if creating new
            let fieldValues = {};
            if (!isEdit && AL.fields && AL.fields.fields) {
                AL.fields.fields.forEach(field => {
                    if (field.enabled && field.roles?.includes('write')) {
                        const value = AL.fields.getFieldValue(field.key);
                        if (value) {
                            fieldValues[field.key] = value;
                        }
                    }
                });
            } else if (isEdit) {
                fieldValues = favorite.fieldValues || {};
            }

            const editFavorite = favorite || {
                id: null,
                name: '',
                description: '',
                fieldValues: fieldValues
            };

            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.id = 'al-modal-favorite-editor';
            overlay.className = 'al-modal-overlay';
            overlay.innerHTML = `
                <div class="al-modal" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
                    <div class="al-modal-header">
                        <h3>${title}</h3>
                    </div>
                    <div class="al-modal-body">
                        <div class="al-form-group">
                            <label>Favorite Name *</label>
                            <input type="text" class="al-input" id="al-fav-name" value="${editFavorite.name}" placeholder="e.g., Standard Deployment">
                        </div>

                        <div class="al-form-group">
                            <label>Description</label>
                            <textarea class="al-input" id="al-fav-description" rows="2" placeholder="Optional description">${editFavorite.description || ''}</textarea>
                        </div>

                        <div class="al-form-group">
                            <label>Field Values</label>
                            <div style="
                                background: #1a1a1a;
                                border: 1px solid #333;
                                border-radius: 4px;
                                padding: 12px;
                                max-height: 300px;
                                overflow-y: auto;
                            ">
                                ${Object.keys(editFavorite.fieldValues).length === 0 ? `
                                    <div style="color: #666; text-align: center; padding: 20px; font-size: 11px;">
                                        No field values captured
                                    </div>
                                ` : Object.entries(editFavorite.fieldValues).map(([key, value]) => `
                                    <div style="margin-bottom: 10px; background: #0a0a0a; padding: 8px; border-radius: 3px;">
                                        <div style="font-size: 11px; color: #00aaff; margin-bottom: 4px;">${key}</div>
                                        <input type="text" class="al-input al-fav-field-value" data-field-key="${key}" value="${value || ''}" style="width: 100%; font-size: 11px;">
                                    </div>
                                `).join('')}
                            </div>
                            <small style="color: #666; font-size: 11px;">You can edit the values before saving</small>
                        </div>
                    </div>
                    <div class="al-modal-footer">
                        <button class="al-btn al-btn-secondary" id="al-fav-cancel-btn">Cancel</button>
                        <button class="al-btn al-btn-primary" id="al-fav-save-btn">${isEdit ? 'Update' : 'Save'} Favorite</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Cancel button
            document.getElementById('al-fav-cancel-btn').onclick = () => {
                overlay.remove();
            };

            // Save button
            document.getElementById('al-fav-save-btn').onclick = () => {
                const name = document.getElementById('al-fav-name').value.trim();
                const description = document.getElementById('al-fav-description').value.trim();

                if (!name) {
                    this.showToast('Validation Error', 'Please enter a favorite name', 'error');
                    return;
                }

                // Collect field values from inputs
                const updatedFieldValues = {};
                document.querySelectorAll('.al-fav-field-value').forEach(input => {
                    const key = input.dataset.fieldKey;
                    const value = input.value.trim();
                    if (value) {
                        updatedFieldValues[key] = value;
                    }
                });

                const favData = {
                    id: editFavorite.id,
                    name,
                    description,
                    fieldValues: updatedFieldValues
                };

                if (isEdit) {
                    AL.favorites.update(favData.id, favData);
                    this.showToast('Favorite Updated', `${name} has been updated`, 'success');
                } else {
                    AL.favorites.add(favData);
                    this.showToast('Favorite Saved', `${name} has been saved`, 'success');
                }

                overlay.remove();
                const content = document.getElementById('al-content');
                if (content && this.currentTab === 'favorites') this.renderFavorites(content);
            };

            // Close on overlay click
            overlay.onclick = (e) => {
                if (e.target === overlay) overlay.remove();
            };
        },

        /**
         * Apply favorite to ServiceNow fields
         */
        async applyFavorite(favorite) {
            if (!favorite || !favorite.fieldValues) {
                this.showToast('Error', 'Invalid favorite data', 'error');
                return;
            }

            let successCount = 0;
            let failCount = 0;

            for (const [fieldKey, value] of Object.entries(favorite.fieldValues)) {
                try {
                    const success = await AL.fields.setFieldValue(fieldKey, value);
                    if (success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (error) {
                    console.error(`[favorites] Error setting field ${fieldKey}:`, error);
                    failCount++;
                }

                // Small delay between field updates
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (successCount > 0) {
                this.showToast(
                    'Favorite Applied',
                    `${successCount} field${successCount !== 1 ? 's' : ''} updated${failCount > 0 ? `, ${failCount} failed` : ''}`,
                    failCount > 0 ? 'warning' : 'success'
                );
            } else {
                this.showToast('Apply Failed', 'No fields were updated', 'error');
            }
        },

        /**
         * Render Macros tab
         */
        renderMacros(content) {
            const macros = AL.macros.macros || [];

            content.innerHTML = `
                <h3>Macros</h3>
                <p style="margin-bottom: 15px; color: #999;">Define reusable action sequences</p>

                <!-- Add Macro Button -->
                <div style="margin-bottom: 15px;">
                    <button class="al-btn al-btn-primary" id="al-add-macro-btn">+ Add Macro</button>
                </div>

                <!-- Macro List -->
                <div style="background: #2a2a2a; padding: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">
                        Macros (${macros.length})
                    </h4>

                    ${macros.length === 0 ? `
                        <div style="color: #666; padding: 40px; text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 10px;">⚙️</div>
                            <div>No macros defined</div>
                            <div style="font-size: 11px; margin-top: 5px;">Create a macro to automate sequences of actions</div>
                        </div>
                    ` : `
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${macros.map(macro => `
                                <div style="
                                    background: #1a1a1a;
                                    border: 1px solid ${macro.enabled ? '#444' : '#333'};
                                    border-left: 3px solid ${macro.enabled ? '#00aaff' : '#666'};
                                    border-radius: 4px;
                                    padding: 12px;
                                ">
                                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                        <input type="checkbox" ${macro.enabled ? 'checked' : ''}
                                            onchange="AL.macros.updateMacro('${macro.id}', { enabled: this.checked }); AL.ui.renderMacros(document.getElementById('al-content'));">
                                        <div style="flex: 1;">
                                            <div style="font-weight: 600; color: ${macro.enabled ? '#e0e0e0' : '#999'};">
                                                ${macro.name || 'Unnamed Macro'}
                                            </div>
                                            ${macro.description ? `
                                                <div style="font-size: 11px; color: #666; margin-top: 2px;">
                                                    ${macro.description}
                                                </div>
                                            ` : ''}
                                        </div>
                                        <div style="display: flex; gap: 5px;">
                                            <button class="al-btn al-btn-secondary" onclick="AL.macros.executeMacro('${macro.id}'); AL.ui.showToast('Macro Executed', '${macro.name}', 'success');" title="Execute">
                                                ▶
                                            </button>
                                            <button class="al-btn al-btn-secondary al-macro-edit-btn" data-macro-id="${macro.id}" title="Edit">
                                                ✎
                                            </button>
                                            <button class="al-btn al-btn-danger al-macro-delete-btn" data-macro-id="${macro.id}" title="Delete">
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                    <div style="font-size: 11px; color: #666; margin-left: 28px;">
                                        ${macro.actions?.length || 0} action${(macro.actions?.length || 0) !== 1 ? 's' : ''}
                                        ${macro.hotkey ? ` • Hotkey: ${macro.hotkey}` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            `;

            // Event handlers
            document.getElementById('al-add-macro-btn').onclick = () => {
                this.showMacroEditor();
            };

            // Edit buttons
            document.querySelectorAll('.al-macro-edit-btn').forEach(btn => {
                btn.onclick = () => {
                    const macroId = btn.dataset.macroId;
                    const macro = macros.find(m => m.id === macroId);
                    if (macro) {
                        this.showMacroEditor(macro);
                    }
                };
            });

            // Delete buttons
            document.querySelectorAll('.al-macro-delete-btn').forEach(btn => {
                btn.onclick = () => {
                    const macroId = btn.dataset.macroId;
                    const macro = macros.find(m => m.id === macroId);
                    if (macro && confirm(`Delete macro "${macro.name}"?`)) {
                        AL.macros.deleteMacro(macroId);
                        this.showToast('Macro Deleted', `${macro.name} has been removed`, 'success');
                        this.renderMacros(content);
                    }
                };
            });
        },

        /**
         * Show macro editor modal
         */
        showMacroEditor(macro = null) {
            const isEdit = macro !== null;
            const title = isEdit ? 'Edit Macro' : 'Add New Macro';

            const editMacro = macro || {
                id: null,
                name: '',
                description: '',
                enabled: true,
                hotkey: '',
                actions: []
            };

            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.id = 'al-modal-macro-editor';
            overlay.className = 'al-modal-overlay';
            overlay.innerHTML = `
                <div class="al-modal" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
                    <div class="al-modal-header">
                        <h3>${title}</h3>
                    </div>
                    <div class="al-modal-body">
                        <div class="al-form-group">
                            <label>Macro Name *</label>
                            <input type="text" class="al-input" id="al-macro-name" value="${editMacro.name}" placeholder="e.g., Quick Return">
                        </div>

                        <div class="al-form-group">
                            <label>Description</label>
                            <textarea class="al-input" id="al-macro-description" rows="2" placeholder="Optional description of what this macro does">${editMacro.description || ''}</textarea>
                        </div>

                        <div class="al-form-group">
                            <label>Hotkey (optional)</label>
                            <input type="text" class="al-input" id="al-macro-hotkey" value="${editMacro.hotkey || ''}" placeholder="e.g., Ctrl+Shift+R" maxlength="20">
                            <small>Keyboard shortcut to execute this macro</small>
                        </div>

                        <div class="al-form-group">
                            <div class="al-checkbox-group">
                                <input type="checkbox" id="al-macro-enabled" ${editMacro.enabled ? 'checked' : ''}>
                                <label for="al-macro-enabled" style="margin: 0;">Enabled</label>
                            </div>
                        </div>

                        <div class="al-form-group">
                            <label>Actions</label>
                            <div id="al-macro-actions-list" style="
                                background: #1a1a1a;
                                border: 1px solid #333;
                                border-radius: 4px;
                                padding: 10px;
                                min-height: 100px;
                                max-height: 200px;
                                overflow-y: auto;
                            ">
                                ${editMacro.actions.length === 0 ? `
                                    <div style="color: #666; text-align: center; padding: 20px; font-size: 11px;">
                                        No actions yet. Click "Add Action" below.
                                    </div>
                                ` : editMacro.actions.map((action, index) => {
                                    let display = '';
                                    switch (action.type) {
                                        case 'setField':
                                            display = `Set ${action.field} = "${action.value}"`;
                                            break;
                                        case 'setType':
                                            display = `Set Type = "${action.value}"`;
                                            break;
                                        case 'toast':
                                            display = `Toast: ${action.message || action.title}`;
                                            break;
                                        case 'speech':
                                            display = `Speak: "${action.text}"`;
                                            break;
                                        case 'wait':
                                            display = `Wait ${action.duration || 1000}ms`;
                                            break;
                                        default:
                                            display = action.type;
                                    }
                                    return `
                                        <div style="
                                            background: #0a0a0a;
                                            padding: 8px;
                                            margin-bottom: 5px;
                                            border-radius: 3px;
                                            display: flex;
                                            align-items: center;
                                            gap: 8px;
                                            font-size: 11px;
                                        ">
                                            <span style="color: #999;">${index + 1}.</span>
                                            <span style="flex: 1;">${display}</span>
                                            <button class="al-btn-icon al-macro-action-remove" data-index="${index}">✕</button>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                            <button class="al-btn al-btn-secondary" id="al-macro-add-action-btn" style="margin-top: 8px;">+ Add Action</button>
                            <small style="color: #666; font-size: 11px;">Actions will execute in order from top to bottom</small>
                        </div>
                    </div>
                    <div class="al-modal-footer">
                        <button class="al-btn al-btn-secondary" id="al-macro-cancel-btn">Cancel</button>
                        <button class="al-btn al-btn-primary" id="al-macro-save-btn">${isEdit ? 'Update' : 'Create'} Macro</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Store actions temporarily
            let tempActions = [...editMacro.actions];

            // Render actions list
            const renderActionsList = () => {
                const listContainer = document.getElementById('al-macro-actions-list');
                if (tempActions.length === 0) {
                    listContainer.innerHTML = `
                        <div style="color: #666; text-align: center; padding: 20px; font-size: 11px;">
                            No actions yet. Click "Add Action" below.
                        </div>
                    `;
                } else {
                    listContainer.innerHTML = tempActions.map((action, index) => {
                        let display = '';
                        switch (action.type) {
                            case 'setField':
                                display = `Set ${action.field} = "${action.value}"`;
                                break;
                            case 'setType':
                                display = `Set Type = "${action.value}"`;
                                break;
                            case 'toast':
                                display = `Toast: ${action.message || action.title}`;
                                break;
                            case 'speech':
                                display = `Speak: "${action.text}"`;
                                break;
                            case 'wait':
                                display = `Wait ${action.duration || 1000}ms`;
                                break;
                            default:
                                display = action.type;
                        }
                        return `
                            <div style="
                                background: #0a0a0a;
                                padding: 8px;
                                margin-bottom: 5px;
                                border-radius: 3px;
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                font-size: 11px;
                            ">
                                <span style="color: #999;">${index + 1}.</span>
                                <span style="flex: 1;">${display}</span>
                                <button class="al-btn-icon al-macro-action-remove" data-index="${index}">✕</button>
                            </div>
                        `;
                    }).join('');

                    // Reattach remove handlers
                    document.querySelectorAll('.al-macro-action-remove').forEach(btn => {
                        btn.onclick = () => {
                            const index = parseInt(btn.dataset.index);
                            tempActions.splice(index, 1);
                            renderActionsList();
                        };
                    });
                }
            };

            // Add action button - reuse the rule action editor
            document.getElementById('al-macro-add-action-btn').onclick = () => {
                // We can reuse the showActionEditor from rules
                this.showActionEditor(null, (newAction) => {
                    tempActions.push(newAction);
                    renderActionsList();
                });
            };

            // Cancel button
            document.getElementById('al-macro-cancel-btn').onclick = () => {
                overlay.remove();
            };

            // Save button
            document.getElementById('al-macro-save-btn').onclick = () => {
                const name = document.getElementById('al-macro-name').value.trim();
                const description = document.getElementById('al-macro-description').value.trim();
                const hotkey = document.getElementById('al-macro-hotkey').value.trim();
                const enabled = document.getElementById('al-macro-enabled').checked;

                if (!name) {
                    this.showToast('Validation Error', 'Please enter a macro name', 'error');
                    return;
                }

                const macroData = {
                    id: editMacro.id || AL.utils.generateId(),
                    name,
                    description,
                    hotkey,
                    enabled,
                    actions: tempActions
                };

                if (isEdit) {
                    AL.macros.updateMacro(macroData.id, macroData);
                    this.showToast('Macro Updated', `${name} has been updated`, 'success');
                } else {
                    AL.macros.addMacro(macroData);
                    this.showToast('Macro Created', `${name} has been created`, 'success');
                }

                overlay.remove();
                const content = document.getElementById('al-content');
                if (content) this.renderMacros(content);
            };

            // Close on overlay click
            overlay.onclick = (e) => {
                if (e.target === overlay) overlay.remove();
            };
        },

        /**
         * Render Batch tab
         */
        renderBatch(content) {
            // Initialize batch session if not exists
            if (!AL.capture.batchSession) {
                AL.capture.batchSession = {
                    active: false,
                    scans: [],
                    applyRules: false,
                    startTime: null
                };
            }

            const batch = AL.capture.batchSession;
            const isActive = batch.active;

            content.innerHTML = `
                <h3>Batch Scanning</h3>
                <p style="margin-bottom: 15px; color: #999;">Collect multiple scans into a session</p>

                <!-- Session Controls -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">Session Control</h4>

                    <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">
                        <button class="al-btn ${isActive ? 'al-btn-danger' : 'al-btn-primary'}" id="al-batch-toggle-btn">
                            ${isActive ? '⏹ Stop Session' : '▶ Start Session'}
                        </button>
                        <div style="margin-left: auto; font-size: 12px; color: #999;">
                            ${isActive ? `<span style="color: #00ff88;">● Active</span> | ${batch.scans.length} scans` : 'Inactive'}
                        </div>
                    </div>

                    <div style="margin-bottom: 10px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="al-batch-apply-rules" ${batch.applyRules ? 'checked' : ''} ${isActive ? 'disabled' : ''}>
                            <span>Apply rules to scans in batch</span>
                        </label>
                        <small style="color: #999; margin-left: 24px; font-size: 11px;">
                            When enabled, rules will process each scan. When disabled, scans are collected without processing.
                        </small>
                    </div>

                    ${isActive && batch.startTime ? `
                        <div style="font-size: 11px; color: #666; margin-top: 10px;">
                            Started: ${new Date(batch.startTime).toLocaleString()}
                        </div>
                    ` : ''}
                </div>

                <!-- Batch Actions -->
                <div style="margin-bottom: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="al-btn al-btn-secondary" id="al-batch-clear-btn" ${batch.scans.length === 0 ? 'disabled' : ''}>Clear All</button>
                    <button class="al-btn al-btn-secondary" id="al-batch-export-btn" ${batch.scans.length === 0 ? 'disabled' : ''}>Export to JSON</button>
                    <button class="al-btn al-btn-secondary" id="al-batch-export-csv-btn" ${batch.scans.length === 0 ? 'disabled' : ''}>Export to CSV</button>
                </div>

                <!-- Scan List -->
                <div style="background: #2a2a2a; padding: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">
                        Scans in Batch (${batch.scans.length})
                    </h4>

                    <div style="
                        background: #1a1a1a;
                        border: 1px solid #333;
                        border-radius: 4px;
                        height: 350px;
                        overflow-y: auto;
                        padding: 8px;
                    ">
                        ${batch.scans.length === 0 ? `
                            <div style="color: #666; padding: 40px; text-align: center;">
                                <div style="font-size: 48px; margin-bottom: 10px;">📦</div>
                                <div>No scans in batch</div>
                                <div style="font-size: 11px; margin-top: 5px;">
                                    ${isActive ? 'Scans will be added automatically' : 'Start a session to begin collecting scans'}
                                </div>
                            </div>
                        ` : `
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <thead style="position: sticky; top: 0; background: #2a2a2a; border-bottom: 2px solid #444;">
                                    <tr>
                                        <th style="padding: 8px; text-align: left; font-weight: 600;">#</th>
                                        <th style="padding: 8px; text-align: left; font-weight: 600;">Time</th>
                                        <th style="padding: 8px; text-align: left; font-weight: 600;">Scan</th>
                                        <th style="padding: 8px; text-align: center; font-weight: 600;">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${batch.scans.map((scan, index) => {
                                        const time = new Date(scan.timestamp).toLocaleTimeString();
                                        return `
                                            <tr style="border-bottom: 1px solid #2a2a2a;">
                                                <td style="padding: 8px; color: #999;">${index + 1}</td>
                                                <td style="padding: 8px; white-space: nowrap; color: #999;">${time}</td>
                                                <td style="padding: 8px;">
                                                    <code style="background: #0a0a0a; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${scan.value}</code>
                                                </td>
                                                <td style="padding: 8px; text-align: center;">
                                                    <button class="al-btn-icon al-batch-remove-btn" data-index="${index}" title="Remove">
                                                        ✕
                                                    </button>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        `}
                    </div>
                </div>
            `;

            // Event handlers
            const toggleBtn = document.getElementById('al-batch-toggle-btn');
            const applyRulesCheckbox = document.getElementById('al-batch-apply-rules');
            const clearBtn = document.getElementById('al-batch-clear-btn');
            const exportBtn = document.getElementById('al-batch-export-btn');
            const exportCsvBtn = document.getElementById('al-batch-export-csv-btn');
            const removeButtons = document.querySelectorAll('.al-batch-remove-btn');

            // Toggle batch session
            toggleBtn.onclick = () => {
                if (isActive) {
                    // Stop session
                    batch.active = false;
                    this.showToast('Session Stopped', `Collected ${batch.scans.length} scans`, 'info');
                } else {
                    // Start session
                    batch.active = true;
                    batch.startTime = Date.now();
                    this.showToast('Session Started', 'Batch scanning is now active', 'success');
                }
                this.renderBatch(content);
            };

            // Apply rules toggle
            applyRulesCheckbox.onchange = (e) => {
                batch.applyRules = e.target.checked;
            };

            // Clear all scans
            clearBtn.onclick = () => {
                if (confirm(`Clear all ${batch.scans.length} scans from batch?`)) {
                    batch.scans = [];
                    this.showToast('Batch Cleared', 'All scans removed', 'success');
                    this.renderBatch(content);
                }
            };

            // Export to JSON
            exportBtn.onclick = () => {
                const data = {
                    exportTime: new Date().toISOString(),
                    sessionStart: batch.startTime ? new Date(batch.startTime).toISOString() : null,
                    totalScans: batch.scans.length,
                    scans: batch.scans
                };
                const dataStr = JSON.stringify(data, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `ocsd-batch-${Date.now()}.json`;
                link.click();
                URL.revokeObjectURL(url);
                this.showToast('Export Complete', 'Batch exported to JSON', 'success');
            };

            // Export to CSV
            exportCsvBtn.onclick = () => {
                const headers = ['Index', 'Timestamp', 'Time', 'Scan'];
                const rows = batch.scans.map((scan, index) => [
                    index + 1,
                    scan.timestamp,
                    new Date(scan.timestamp).toLocaleString(),
                    scan.value
                ]);
                const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
                const dataBlob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `ocsd-batch-${Date.now()}.csv`;
                link.click();
                URL.revokeObjectURL(url);
                this.showToast('Export Complete', 'Batch exported to CSV', 'success');
            };

            // Remove individual scans
            removeButtons.forEach(btn => {
                btn.onclick = () => {
                    const index = parseInt(btn.dataset.index);
                    batch.scans.splice(index, 1);
                    this.renderBatch(content);
                };
            });
        },

        /**
         * Render History tab
         */
        renderHistory(content) {
            const scanHistory = AL.capture.scanHistory || [];

            content.innerHTML = `
                <h3>Scan History</h3>
                <p style="margin-bottom: 15px; color: #999;">Record of all processed scans</p>

                <!-- Controls -->
                <div style="margin-bottom: 15px; display: flex; gap: 10px; align-items: center;">
                    <button class="al-btn al-btn-secondary" id="al-history-clear-btn">Clear History</button>
                    <button class="al-btn al-btn-secondary" id="al-history-export-btn">Export to JSON</button>
                    <div style="margin-left: auto;">
                        <span style="color: #999; font-size: 12px;">${scanHistory.length} scans</span>
                    </div>
                </div>

                <!-- History Table -->
                <div style="
                    background: #1a1a1a;
                    border: 1px solid #333;
                    border-radius: 4px;
                    height: 500px;
                    overflow-y: auto;
                ">
                    ${scanHistory.length === 0 ? `
                        <div style="color: #666; padding: 40px; text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 10px;">📋</div>
                            <div>No scan history yet</div>
                            <div style="font-size: 11px; margin-top: 5px;">Scans will appear here as they are processed</div>
                        </div>
                    ` : `
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead style="position: sticky; top: 0; background: #2a2a2a; border-bottom: 2px solid #444;">
                                <tr>
                                    <th style="padding: 10px; text-align: left; font-weight: 600;">Time</th>
                                    <th style="padding: 10px; text-align: left; font-weight: 600;">Scan</th>
                                    <th style="padding: 10px; text-align: left; font-weight: 600;">Type</th>
                                    <th style="padding: 10px; text-align: left; font-weight: 600;">Rules Matched</th>
                                    <th style="padding: 10px; text-align: left; font-weight: 600;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${scanHistory.slice().reverse().map(entry => {
                                    const time = new Date(entry.timestamp).toLocaleTimeString();
                                    const date = new Date(entry.timestamp).toLocaleDateString();
                                    const statusColors = {
                                        success: '#00ff88',
                                        warning: '#ffaa00',
                                        error: '#ff4444',
                                        info: '#00aaff'
                                    };
                                    const statusColor = statusColors[entry.status] || '#e0e0e0';

                                    return `
                                        <tr style="border-bottom: 1px solid #2a2a2a;">
                                            <td style="padding: 10px; white-space: nowrap;">
                                                <div style="font-size: 11px; color: #999;">${date}</div>
                                                <div>${time}</div>
                                            </td>
                                            <td style="padding: 10px;">
                                                <code style="background: #2a2a2a; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${entry.scan || 'N/A'}</code>
                                            </td>
                                            <td style="padding: 10px;">
                                                ${entry.type ? `<span style="color: ${entry.type === 'Deployment' ? '#00ff88' : '#ffaa00'};">${entry.type}</span>` : '<span style="color: #666;">—</span>'}
                                            </td>
                                            <td style="padding: 10px; font-size: 11px; color: #999;">
                                                ${entry.rulesMatched > 0 ? `${entry.rulesMatched} rule${entry.rulesMatched !== 1 ? 's' : ''}` : 'None'}
                                            </td>
                                            <td style="padding: 10px;">
                                                <span style="color: ${statusColor};">●</span>
                                                <span style="font-size: 11px; color: #999;">${entry.statusText || 'Processed'}</span>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            `;

            // Event handlers
            const clearBtn = document.getElementById('al-history-clear-btn');
            const exportBtn = document.getElementById('al-history-export-btn');

            clearBtn.onclick = () => {
                if (confirm('Clear all scan history?')) {
                    AL.capture.scanHistory = [];
                    AL.persistence.set('scanHistory', []);
                    this.showToast('History Cleared', 'Scan history has been cleared', 'success');
                    this.renderHistory(content);
                }
            };

            exportBtn.onclick = () => {
                const dataStr = JSON.stringify(scanHistory, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `ocsd-scan-history-${Date.now()}.json`;
                link.click();
                URL.revokeObjectURL(url);
                this.showToast('Export Complete', 'Scan history exported', 'success');
            };
        },

        /**
         * Render Debug tab
         */
        renderDebug(content) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            const debugLogs = this.debugLogs || [];

            // Calculate stats
            const stats = {
                totalScans: AL.capture.scanQueue?.length || 0,
                queuedScans: AL.capture.scanQueue?.filter(s => !s.processed).length || 0,
                totalRules: AL.rules.rules?.length || 0,
                enabledRules: AL.rules.rules?.filter(r => r.enabled).length || 0,
                totalFields: AL.fields.fields?.length || 0,
                enabledFields: AL.fields.fields?.filter(f => f.enabled).length || 0,
                totalPrefixes: AL.prefixes.prefixes?.length || 0,
                totalMacros: AL.macros.macros?.length || 0,
                isLeader: AL.broadcast.isLeader,
                captureMode: AL.capture.mode,
                lastScan: AL.capture.lastScan || 'None'
            };

            content.innerHTML = `
                <h3>Debug Console</h3>
                <p style="margin-bottom: 15px; color: #999;">System logs and diagnostics</p>

                <!-- Stats Panel -->
                <div style="background: #2a2a2a; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                    <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid #444; padding-bottom: 8px;">System Statistics</h4>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 12px;">
                        <div><strong>Mode:</strong> ${stats.captureMode}</div>
                        <div><strong>Leader:</strong> ${stats.isLeader ? 'Yes' : 'No'}</div>
                        <div><strong>Queue:</strong> ${stats.queuedScans} / ${stats.totalScans}</div>
                        <div><strong>Last Scan:</strong> ${stats.lastScan}</div>
                        <div><strong>Rules:</strong> ${stats.enabledRules} / ${stats.totalRules}</div>
                        <div><strong>Fields:</strong> ${stats.enabledFields} / ${stats.totalFields}</div>
                        <div><strong>Prefixes:</strong> ${stats.totalPrefixes}</div>
                        <div><strong>Macros:</strong> ${stats.totalMacros}</div>
                    </div>
                </div>

                <!-- Controls -->
                <div style="margin-bottom: 15px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                    <button class="al-btn al-btn-secondary" id="al-debug-clear-btn">Clear Logs</button>
                    <button class="al-btn al-btn-secondary" id="al-debug-export-btn">Export Logs</button>
                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                        <input type="checkbox" id="al-debug-autoscroll" ${settings.debugAutoScroll !== false ? 'checked' : ''}>
                        <span>Auto-scroll</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                        <input type="checkbox" id="al-debug-wrap" ${settings.debugWrap ? 'checked' : ''}>
                        <span>Wrap text</span>
                    </label>
                    <div style="margin-left: auto;">
                        <span style="color: #999; font-size: 12px;">${debugLogs.length} entries</span>
                    </div>
                </div>

                <!-- Log Display -->
                <div id="al-debug-log-container" style="
                    background: #1a1a1a;
                    border: 1px solid #333;
                    border-radius: 4px;
                    height: 400px;
                    overflow-y: auto;
                    font-family: 'Courier New', monospace;
                    font-size: 11px;
                    padding: 8px;
                    white-space: ${settings.debugWrap ? 'pre-wrap' : 'pre'};
                    word-break: ${settings.debugWrap ? 'break-word' : 'normal'};
                ">
                    ${debugLogs.length === 0 ? '<div style="color: #666; padding: 20px; text-align: center;">No log entries yet</div>' :
                      debugLogs.map(log => {
                        const colors = {
                            log: '#e0e0e0',
                            warn: '#ffaa00',
                            error: '#ff4444',
                            system: '#00aaff',
                            rules: '#00ff88',
                            capture: '#ff88ff',
                            ui: '#88aaff',
                            bwc: '#ffaa88',
                            x10: '#88ffaa'
                        };
                        const color = colors[log.level] || colors.log;
                        const time = new Date(log.timestamp).toLocaleTimeString();
                        return `<div style="margin-bottom: 4px; color: ${color};">[${time}] [${log.level.toUpperCase()}] ${log.message}</div>`;
                    }).join('')}
                </div>

                <!-- Category Filter (for future enhancement) -->
                <div style="margin-top: 10px; font-size: 11px; color: #666;">
                    Categories: system, rules, capture, ui, bwc, x10
                </div>
            `;

            // Event handlers
            const clearBtn = document.getElementById('al-debug-clear-btn');
            const exportBtn = document.getElementById('al-debug-export-btn');
            const autoScrollCheckbox = document.getElementById('al-debug-autoscroll');
            const wrapCheckbox = document.getElementById('al-debug-wrap');

            clearBtn.onclick = () => {
                this.debugLogs = [];
                this.renderDebug(content);
            };

            exportBtn.onclick = () => {
                const dataStr = JSON.stringify(this.debugLogs, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `ocsd-debug-${Date.now()}.json`;
                link.click();
                URL.revokeObjectURL(url);
                this.showToast('Export Complete', 'Debug logs exported', 'success');
            };

            autoScrollCheckbox.onchange = (e) => {
                settings.debugAutoScroll = e.target.checked;
                AL.persistence.set('settings', settings);
                if (e.target.checked) {
                    const container = document.getElementById('al-debug-log-container');
                    if (container) container.scrollTop = container.scrollHeight;
                }
            };

            wrapCheckbox.onchange = (e) => {
                settings.debugWrap = e.target.checked;
                AL.persistence.set('settings', settings);
                const container = document.getElementById('al-debug-log-container');
                if (container) {
                    container.style.whiteSpace = e.target.checked ? 'pre-wrap' : 'pre';
                    container.style.wordBreak = e.target.checked ? 'break-word' : 'normal';
                }
            };

            // Auto-scroll to bottom if enabled
            if (settings.debugAutoScroll !== false) {
                setTimeout(() => {
                    const container = document.getElementById('al-debug-log-container');
                    if (container) container.scrollTop = container.scrollHeight;
                }, 50);
            }
        },

        /**
         * Save settings from form
         */
        saveSettingsFromForm(silent = false) {
            const settings = {
                // Layout
                dockMode: document.getElementById('al-setting-dock-mode').value,
                panelWidth: parseInt(document.getElementById('al-setting-panel-width').value),
                panelHeight: parseInt(document.getElementById('al-setting-panel-height').value),
                topGapLeft: parseInt(document.getElementById('al-setting-top-gap-left').value) || 0,
                topGapRight: parseInt(document.getElementById('al-setting-top-gap-right').value) || 0,

                // Capture
                captureMode: AL.capture.mode,
                scanThrottle: parseInt(document.getElementById('al-setting-scan-throttle').value),
                duplicateWindow: parseInt(document.getElementById('al-setting-duplicate-window').value),
                scanTimeout: parseInt(document.getElementById('al-setting-scan-timeout').value),

                // Toast
                toastPosition: document.getElementById('al-setting-toast-position').value,
                toastDuration: parseInt(document.getElementById('al-setting-toast-duration').value),
                toastSticky: document.getElementById('al-setting-toast-sticky').checked,
                toastSound: document.getElementById('al-setting-toast-sound').checked,

                // Speech
                speechEnabled: document.getElementById('al-setting-speech-enabled').checked,
                speechRate: parseFloat(document.getElementById('al-setting-speech-rate').value),
                speechPitch: parseFloat(document.getElementById('al-setting-speech-pitch').value),

                // Ticker
                tickerEnabled: document.getElementById('al-setting-ticker-enabled').checked,
                tickerHeight: parseInt(document.getElementById('al-setting-ticker-height').value) || 30,
                tickerFontSize: parseInt(document.getElementById('al-setting-ticker-font-size').value) || 13,

                // Tab visibility
                visibleTabs: ['dashboard', 'rules', 'fields', 'prefixes', 'macros', 'favorites', 'bwc', 'x10', 'batch', 'history', 'settings', 'debug'],

                // Debug
                debugEnabled: document.getElementById('al-setting-debug-enabled').checked,
                debugAutoScroll: true,
                debugWrap: false,

                // Current tab
                currentTab: this.currentTab
            };

            AL.persistence.set('settings', settings);

            // Only show toast if not silent (manual save, not auto-save)
            if (!silent) {
                this.showToast('Settings Saved', 'Settings updated successfully', 'success');
            }

            // Apply dock mode change and top gap
            if (this.panel) {
                this.panel.className = settings.dockMode;

                // Apply top gap based on dock mode
                if (settings.dockMode === 'dock-left') {
                    this.panel.style.top = `${settings.topGapLeft}px`;
                } else if (settings.dockMode === 'dock-right') {
                    this.panel.style.top = `${settings.topGapRight}px`;
                } else {
                    // For float and dock-bottom, don't apply top gap
                    this.panel.style.top = '';
                }
            }

            // Apply ticker settings
            if (settings.tickerEnabled && !this.ticker) {
                this.createTicker();
            } else if (!settings.tickerEnabled && this.ticker) {
                this.ticker.remove();
                this.ticker = null;
            } else if (settings.tickerEnabled && this.ticker) {
                // Update CSS variables for ticker size
                document.documentElement.style.setProperty('--ticker-height', `${settings.tickerHeight}px`);
                document.documentElement.style.setProperty('--ticker-font-size', `${settings.tickerFontSize}px`);
                document.documentElement.style.setProperty('--ticker-padding', `${Math.floor(settings.tickerHeight / 4)}px 12px`);
            }
        },

        /**
         * Show prefix editor modal
         */
        showPrefixEditor(prefix = null) {
            const isEdit = prefix !== null;
            const title = isEdit ? 'Edit Prefix' : 'Add New Prefix';

            const editPrefix = prefix || {
                id: null,
                label: '',
                value: '',
                hotkey: null,
                stickyCount: 1
            };

            const overlay = document.createElement('div');
            overlay.className = 'al-modal-overlay';
            overlay.id = 'al-modal-prefix-editor';

            // Get available hotkeys (1-9 not already assigned)
            const usedHotkeys = AL.prefixes.prefixes
                .filter(p => p.id !== editPrefix.id)
                .map(p => p.hotkey)
                .filter(h => h !== null);
            const availableHotkeys = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => !usedHotkeys.includes(n));

            let hotkeyOptions = '<option value="">None</option>';
            for (let i = 1; i <= 9; i++) {
                const available = availableHotkeys.includes(i) || editPrefix.hotkey === i;
                const selected = editPrefix.hotkey === i ? 'selected' : '';
                const disabled = !available ? 'disabled' : '';
                hotkeyOptions += `<option value="${i}" ${selected} ${disabled}>Alt+${i}${!available ? ' (in use)' : ''}</option>`;
            }

            overlay.innerHTML = `
                <div class="al-modal" onclick="event.stopPropagation()">
                    <div class="al-modal-header">
                        <h3>${title}</h3>
                        <button class="al-btn al-btn-secondary" onclick="AL.ui.closePrefixModal()">×</button>
                    </div>
                    <div class="al-modal-body">
                        <div class="al-form-group">
                            <label>Label *</label>
                            <input type="text" class="al-input" id="al-prefix-label" value="${AL.utils.escapeHtml(editPrefix.label)}" placeholder="e.g., Building A">
                            <small>Descriptive name for this prefix</small>
                        </div>

                        <div class="al-form-group">
                            <label>Prefix Value *</label>
                            <input type="text" class="al-input" id="al-prefix-value" value="${AL.utils.escapeHtml(editPrefix.value)}" placeholder="e.g., BLD-A-">
                            <small>Text that will be prepended to scanned barcodes</small>
                        </div>

                        <div class="al-form-group">
                            <label>Hotkey</label>
                            <select class="al-input" id="al-prefix-hotkey">
                                ${hotkeyOptions}
                            </select>
                            <small>Keyboard shortcut to activate this prefix (Alt+1 through Alt+9)</small>
                        </div>

                        <div class="al-form-group">
                            <label>Sticky Count *</label>
                            <input type="number" class="al-input" id="al-prefix-sticky" value="${editPrefix.stickyCount}" min="1" max="999">
                            <small>Number of scans this prefix stays active for (default: 1)</small>
                        </div>
                    </div>
                    <div class="al-modal-footer">
                        <button class="al-btn al-btn-secondary" onclick="AL.ui.closePrefixModal()">Cancel</button>
                        <button class="al-btn" id="al-save-prefix-btn">${isEdit ? 'Update' : 'Add'} Prefix</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Close on overlay click
            overlay.onclick = () => this.closePrefixModal();

            // Save button
            document.getElementById('al-save-prefix-btn').onclick = () => {
                this.savePrefixFromModal(editPrefix.id);
            };
        },

        /**
         * Save prefix from modal
         */
        savePrefixFromModal(prefixId) {
            const label = document.getElementById('al-prefix-label').value.trim();
            const value = document.getElementById('al-prefix-value').value;
            const hotkeyStr = document.getElementById('al-prefix-hotkey').value;
            const hotkey = hotkeyStr ? parseInt(hotkeyStr) : null;
            const stickyCount = parseInt(document.getElementById('al-prefix-sticky').value) || 1;

            // Validation
            if (!label) {
                this.showToast('Validation Error', 'Label is required', 'error');
                return;
            }

            if (!value && value !== '') {
                this.showToast('Validation Error', 'Prefix value is required', 'error');
                return;
            }

            // Build prefix object
            const prefix = {
                label,
                value,
                hotkey,
                stickyCount
            };

            // Add or update
            if (prefixId) {
                AL.prefixes.updatePrefix(prefixId, prefix);
                this.showToast('Prefix Updated', `Updated prefix: ${label}`, 'success');
            } else {
                AL.prefixes.addPrefix(prefix);
                this.showToast('Prefix Added', `Added new prefix: ${label}`, 'success');
            }

            // Close modal and refresh
            this.closePrefixModal();

            // Refresh prefixes tab if it's open
            const content = document.getElementById('al-content');
            if (content && this.currentTab === 'prefixes') {
                this.renderPrefixes(content);
            }
        },

        /**
         * Close prefix modal
         */
        closePrefixModal() {
            const modal = document.getElementById('al-modal-prefix-editor');
            if (modal) {
                modal.remove();
            }
        },

        /**
         * Show rule editor modal
         */
        showRuleEditor(rule = null) {
            const isEdit = rule !== null;
            const title = isEdit ? 'Edit Rule' : 'Add New Rule';

            // Default rule structure
            const editRule = rule || {
                id: null,
                name: '',
                enabled: true,
                pattern: '',
                patternType: 'regex',
                useDirective: false,
                directiveChars: ['*', '/'],
                groupIndexes: [],
                speechLabel: '',
                actions: []
            };

            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.className = 'al-modal-overlay';
            overlay.id = 'al-modal-rule-editor';

            overlay.innerHTML = `
                <div class="al-modal" onclick="event.stopPropagation()">
                    <div class="al-modal-header">
                        <h3>${title}</h3>
                        <button class="al-btn al-btn-secondary" onclick="AL.ui.closeModal()">×</button>
                    </div>
                    <div class="al-modal-body">
                        <div class="al-form-group">
                            <label>Rule Name *</label>
                            <input type="text" class="al-input" id="al-rule-name" value="${AL.utils.escapeHtml(editRule.name)}" placeholder="e.g., PID with Directive">
                        </div>

                        <div class="al-form-group">
                            <div class="al-checkbox-group">
                                <input type="checkbox" id="al-rule-enabled" ${editRule.enabled ? 'checked' : ''}>
                                <label for="al-rule-enabled" style="margin: 0;">Enabled</label>
                            </div>
                        </div>

                        <div class="al-form-group">
                            <label>Pattern Type *</label>
                            <select class="al-input" id="al-rule-pattern-type">
                                <option value="regex" ${editRule.patternType === 'regex' ? 'selected' : ''}>Regular Expression</option>
                                <option value="string" ${editRule.patternType === 'string' ? 'selected' : ''}>Exact String</option>
                                <option value="startsWith" ${editRule.patternType === 'startsWith' ? 'selected' : ''}>Starts With</option>
                                <option value="contains" ${editRule.patternType === 'contains' ? 'selected' : ''}>Contains</option>
                                <option value="endsWith" ${editRule.patternType === 'endsWith' ? 'selected' : ''}>Ends With</option>
                            </select>
                        </div>

                        <div class="al-form-group">
                            <label>Pattern *</label>
                            <input type="text" class="al-input" id="al-rule-pattern" value="${AL.utils.escapeHtml(editRule.pattern)}" placeholder="e.g., ^([*/])([A-Z0-9]+)([*/])?">
                            <small>For regex: use capture groups (parentheses) to extract variables</small>
                        </div>

                        <div class="al-form-group">
                            <div class="al-checkbox-group">
                                <input type="checkbox" id="al-rule-use-directive" ${editRule.useDirective ? 'checked' : ''}>
                                <label for="al-rule-use-directive" style="margin: 0;">Use Directive System</label>
                            </div>
                            <small>Extract * (Deployment) or / (Return) from barcode</small>
                        </div>

                        <div class="al-form-group" id="al-directive-chars-group" style="display: ${editRule.useDirective ? 'block' : 'none'};">
                            <label>Directive Characters</label>
                            <input type="text" class="al-input" id="al-rule-directive-chars" value="${editRule.directiveChars.join(', ')}" placeholder="*, /">
                            <small>Comma-separated characters to detect (e.g., *, /)</small>
                        </div>

                        <div class="al-form-group">
                            <label>Speech Label</label>
                            <input type="text" class="al-input" id="al-rule-speech-label" value="${AL.utils.escapeHtml(editRule.speechLabel || '')}" placeholder="e.g., PID">
                            <small>Text to speak when rule matches (optional)</small>
                        </div>

                        <div class="al-form-group">
                            <label>Actions</label>
                            <div id="al-rule-actions-list"></div>
                            <button class="al-btn al-btn-secondary" id="al-add-action-btn" style="margin-top: 10px;">+ Add Action</button>
                        </div>
                    </div>
                    <div class="al-modal-footer">
                        <button class="al-btn al-btn-secondary" onclick="AL.ui.closeModal()">Cancel</button>
                        <button class="al-btn" id="al-save-rule-btn">${isEdit ? 'Update' : 'Add'} Rule</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Close on overlay click
            overlay.onclick = () => this.closeModal();

            // Toggle directive chars visibility
            document.getElementById('al-rule-use-directive').onchange = (e) => {
                document.getElementById('al-directive-chars-group').style.display = e.target.checked ? 'block' : 'none';
            };

            // Render actions
            this.renderRuleActions(editRule.actions);

            // Add action button
            document.getElementById('al-add-action-btn').onclick = () => {
                this.showAddActionDialog();
            };

            // Save button
            document.getElementById('al-save-rule-btn').onclick = () => {
                this.saveRuleFromModal(editRule.id);
            };
        },

        /**
         * Render actions list in rule editor
         */
        renderRuleActions(actions) {
            const actionsList = document.getElementById('al-rule-actions-list');
            if (!actionsList) return;

            if (actions.length === 0) {
                actionsList.innerHTML = '<div style="color: #999; font-size: 12px;">No actions configured</div>';
                return;
            }

            actionsList.innerHTML = actions.map((action, index) => {
                let display = '';
                switch (action.type) {
                    case 'setField':
                        display = `Set field <strong>${action.field}</strong> = <code>${action.value}</code>`;
                        break;
                    case 'setType':
                        display = `Set Type = <code>${action.value}</code>`;
                        break;
                    case 'toast':
                        display = `Toast: ${action.message || action.title}`;
                        break;
                    case 'speech':
                        display = `Speak: "${action.text}"`;
                        break;
                    default:
                        display = `Action: ${action.type}`;
                }

                return `
                    <div class="al-action-item" data-index="${index}">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px;">${display}</span>
                            <button class="al-btn al-btn-danger" style="font-size: 11px; padding: 4px 8px;" onclick="AL.ui.removeAction(${index})">Remove</button>
                        </div>
                    </div>
                `;
            }).join('');
        },

        /**
         * Insert a variable token at the cursor position in the last focused input
         */
        insertVariableToken(token) {
            const input = this._lastFocusedVariableInput;
            if (!input) {
                this.showToast('No Input Selected', 'Please focus on an input field first', 'warning');
                return;
            }

            const cursorPos = input.selectionStart || input.value.length;
            const textBefore = input.value.substring(0, cursorPos);
            const textAfter = input.value.substring(cursorPos);

            input.value = textBefore + token + textAfter;

            // Set cursor position after the inserted token
            const newCursorPos = cursorPos + token.length;
            input.setSelectionRange(newCursorPos, newCursorPos);
            input.focus();
        },

        /**
         * Show add action dialog with proper form controls
         */
        showAddActionDialog() {
            // Create action editor modal
            const actionOverlay = document.createElement('div');
            actionOverlay.className = 'al-modal-overlay';
            actionOverlay.id = 'al-modal-action-editor';
            actionOverlay.style.zIndex = '10000001'; // Above rule editor

            // Get available fields for dropdown
            const fieldOptions = AL.fields.fields
                .filter(f => f.enabled)
                .map(f => `<option value="${f.key}">${f.label} (${f.key})</option>`)
                .join('');

            actionOverlay.innerHTML = `
                <div class="al-modal" onclick="event.stopPropagation()" style="max-width: 500px;">
                    <div class="al-modal-header">
                        <h3>Add Action</h3>
                        <button class="al-btn al-btn-secondary" onclick="document.getElementById('al-modal-action-editor').remove()">×</button>
                    </div>
                    <div class="al-modal-body">
                        <div class="al-form-group">
                            <label>Action Type *</label>
                            <select class="al-input" id="al-action-type">
                                <option value="">-- Select Action Type --</option>
                                <option value="setField">Set Field Value</option>
                                <option value="setType">Set Type Field</option>
                                <option value="toast">Show Toast Notification</option>
                                <option value="speech">Speak Text</option>
                            </select>
                        </div>

                        <!-- setField form -->
                        <div id="al-action-form-setField" style="display: none;">
                            <div class="al-form-group">
                                <label>Field *</label>
                                <select class="al-input" id="al-action-field">
                                    <option value="">-- Select Field --</option>
                                    ${fieldOptions}
                                    <option value="externalContact">External Loan</option>
                                    <option value="department">Department</option>
                                    <option value="comments">Comments</option>
                                </select>
                            </div>
                            <div class="al-form-group">
                                <label>Value *</label>
                                <input type="text" class="al-input" id="al-action-field-value" placeholder="e.g., \${scanRaw}, \${cleanScan}, \${group1}">
                                <small>Use dropdown below to insert variables at cursor</small>
                            </div>
                        </div>

                        <!-- setType form -->
                        <div id="al-action-form-setType" style="display: none;">
                            <div class="al-form-group">
                                <label>Type Value *</label>
                                <select class="al-input" id="al-action-type-value">
                                    <option value="\${directive}">Use Directive Value (Deployment/Return)</option>
                                    <option value="Deployment">Deployment</option>
                                    <option value="Return">Return</option>
                                    <option value="">Other (specify below)</option>
                                </select>
                            </div>
                            <div class="al-form-group" id="al-type-custom-group" style="display: none;">
                                <label>Custom Type Value</label>
                                <input type="text" class="al-input" id="al-action-type-custom" placeholder="Enter custom type value">
                            </div>
                        </div>

                        <!-- toast form -->
                        <div id="al-action-form-toast" style="display: none;">
                            <div class="al-form-group">
                                <label>Title</label>
                                <input type="text" class="al-input" id="al-action-toast-title" value="Notification" placeholder="Toast title">
                            </div>
                            <div class="al-form-group">
                                <label>Message *</label>
                                <input type="text" class="al-input" id="al-action-toast-message" placeholder="e.g., Scanned: \${last4}">
                                <small>Use dropdown below to insert variables at cursor</small>
                            </div>
                            <div class="al-form-group">
                                <label>Level</label>
                                <select class="al-input" id="al-action-toast-level">
                                    <option value="info">Info (blue)</option>
                                    <option value="success">Success (green)</option>
                                    <option value="warning">Warning (yellow)</option>
                                    <option value="error">Error (red)</option>
                                </select>
                            </div>
                        </div>

                        <!-- speech form -->
                        <div id="al-action-form-speech" style="display: none;">
                            <div class="al-form-group">
                                <label>Speech Text *</label>
                                <input type="text" class="al-input" id="al-action-speech-text" placeholder="e.g., PID \${last4}">
                                <small>Use dropdown below to insert variables at cursor</small>
                            </div>
                        </div>

                        <!-- Variable Insertion Tool -->
                        <div class="al-form-group" style="background: #252525; padding: 12px; margin-bottom: 15px; border-radius: 4px;">
                            <label style="font-weight: bold; margin-bottom: 8px; display: block;">🔧 Insert Variable</label>
                            <div style="display: flex; gap: 8px; align-items: flex-start;">
                                <select class="al-input" id="al-variable-selector" style="flex: 1;">
                                    <option value="">-- Select Variable to Insert --</option>
                                    <option value="\${scanRaw}">\${scanRaw} - Full barcode</option>
                                    <option value="\${cleanScan}">\${cleanScan} - Trimmed barcode</option>
                                    <option value="\${last4}">\${last4} - Last 4 characters</option>
                                    <option value="\${directive}">\${directive} - Directive (Deploy/Return)</option>
                                    <option value="\${group1}">\${group1} - Regex group 1</option>
                                    <option value="\${group2}">\${group2} - Regex group 2</option>
                                    <option value="\${group3}">\${group3} - Regex group 3</option>
                                    <option value="__custom__">Other / Custom regex group...</option>
                                </select>
                            </div>
                            <div id="al-custom-group-container" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #333;">
                                <label style="font-size: 12px; margin-bottom: 5px; display: block;">Custom Regex Group #</label>
                                <div style="display: flex; gap: 8px;">
                                    <input type="number" class="al-input" id="al-custom-group-number" placeholder="e.g., 4, 5, 6..." min="1" style="flex: 1;">
                                    <button class="al-btn al-btn-secondary" id="al-insert-custom-group-btn" style="white-space: nowrap;">Insert</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="al-modal-footer">
                        <button class="al-btn al-btn-secondary" onclick="document.getElementById('al-modal-action-editor').remove()">Cancel</button>
                        <button class="al-btn" id="al-save-action-btn">Add Action</button>
                    </div>
                </div>
            `;

            document.body.appendChild(actionOverlay);

            // Close on overlay click
            actionOverlay.onclick = () => actionOverlay.remove();

            // Show/hide forms based on action type
            document.getElementById('al-action-type').onchange = (e) => {
                // Hide all forms
                document.querySelectorAll('[id^="al-action-form-"]').forEach(el => el.style.display = 'none');

                // Show selected form
                const selectedType = e.target.value;
                if (selectedType) {
                    const formEl = document.getElementById(`al-action-form-${selectedType}`);
                    if (formEl) formEl.style.display = 'block';
                }
            };

            // Show/hide custom type field
            const typeValueSelect = document.getElementById('al-action-type-value');
            if (typeValueSelect) {
                typeValueSelect.onchange = (e) => {
                    document.getElementById('al-type-custom-group').style.display =
                        e.target.value === '' ? 'block' : 'none';
                };
            }

            // Track focus on all value input fields that can receive variables
            const variableInputs = [
                'al-action-field-value',
                'al-action-type-custom',
                'al-action-toast-title',
                'al-action-toast-message',
                'al-action-speech-text'
            ];

            variableInputs.forEach(id => {
                const input = document.getElementById(id);
                if (input) {
                    input.onfocus = () => {
                        this._lastFocusedVariableInput = input;
                    };
                }
            });

            // Variable selector dropdown
            const variableSelector = document.getElementById('al-variable-selector');
            if (variableSelector) {
                variableSelector.onchange = (e) => {
                    const selectedValue = e.target.value;

                    if (selectedValue === '__custom__') {
                        // Show custom group input
                        document.getElementById('al-custom-group-container').style.display = 'block';
                    } else if (selectedValue) {
                        // Insert the selected variable
                        this.insertVariableToken(selectedValue);
                        // Reset dropdown
                        e.target.value = '';
                        // Hide custom group container if it was shown
                        document.getElementById('al-custom-group-container').style.display = 'none';
                    }
                };
            }

            // Custom group insert button
            const insertCustomGroupBtn = document.getElementById('al-insert-custom-group-btn');
            if (insertCustomGroupBtn) {
                insertCustomGroupBtn.onclick = () => {
                    const groupNumber = document.getElementById('al-custom-group-number').value;
                    if (!groupNumber || groupNumber < 1) {
                        this.showToast('Invalid Group', 'Please enter a valid group number (1 or greater)', 'warning');
                        return;
                    }

                    // Insert the custom group variable
                    this.insertVariableToken(`\${group${groupNumber}}`);

                    // Reset and hide custom group container
                    document.getElementById('al-custom-group-number').value = '';
                    document.getElementById('al-custom-group-container').style.display = 'none';
                    document.getElementById('al-variable-selector').value = '';
                };
            }

            // Allow Enter key to insert custom group
            const customGroupInput = document.getElementById('al-custom-group-number');
            if (customGroupInput) {
                customGroupInput.onkeypress = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        insertCustomGroupBtn.click();
                    }
                };
            }

            // Save action button
            document.getElementById('al-save-action-btn').onclick = () => {
                const actionType = document.getElementById('al-action-type').value;
                if (!actionType) {
                    this.showToast('Validation Error', 'Please select an action type', 'error');
                    return;
                }

                let action = null;

                switch (actionType) {
                    case 'setField':
                        const field = document.getElementById('al-action-field').value;
                        const fieldValue = document.getElementById('al-action-field-value').value.trim();

                        if (!field) {
                            this.showToast('Validation Error', 'Please select a field', 'error');
                            return;
                        }
                        if (!fieldValue) {
                            this.showToast('Validation Error', 'Please enter a field value', 'error');
                            return;
                        }

                        action = { type: 'setField', field, value: fieldValue };
                        break;

                    case 'setType':
                        let typeValue = document.getElementById('al-action-type-value').value;
                        if (typeValue === '') {
                            typeValue = document.getElementById('al-action-type-custom').value.trim();
                        }

                        if (!typeValue) {
                            this.showToast('Validation Error', 'Please select or enter a type value', 'error');
                            return;
                        }

                        action = { type: 'setType', value: typeValue };
                        break;

                    case 'toast':
                        const title = document.getElementById('al-action-toast-title').value.trim() || 'Notification';
                        const message = document.getElementById('al-action-toast-message').value.trim();
                        const level = document.getElementById('al-action-toast-level').value;

                        if (!message) {
                            this.showToast('Validation Error', 'Please enter a toast message', 'error');
                            return;
                        }

                        action = { type: 'toast', title, message, level };
                        break;

                    case 'speech':
                        const speechText = document.getElementById('al-action-speech-text').value.trim();

                        if (!speechText) {
                            this.showToast('Validation Error', 'Please enter speech text', 'error');
                            return;
                        }

                        action = { type: 'speech', text: speechText };
                        break;
                }

                if (action) {
                    // Add action to current list
                    const currentActions = this._modalActions || [];
                    currentActions.push(action);
                    this._modalActions = currentActions;
                    this.renderRuleActions(currentActions);

                    // Close action editor
                    actionOverlay.remove();

                    this.showToast('Action Added', 'Action added successfully', 'success');
                }
            };
        },

        /**
         * Remove action from editor
         */
        removeAction(index) {
            if (!this._modalActions) return;
            this._modalActions.splice(index, 1);
            this.renderRuleActions(this._modalActions);
        },

        /**
         * Save rule from modal
         */
        saveRuleFromModal(ruleId) {
            const name = document.getElementById('al-rule-name').value.trim();
            const pattern = document.getElementById('al-rule-pattern').value.trim();
            const patternType = document.getElementById('al-rule-pattern-type').value;
            const enabled = document.getElementById('al-rule-enabled').checked;
            const useDirective = document.getElementById('al-rule-use-directive').checked;
            const directiveCharsStr = document.getElementById('al-rule-directive-chars').value;
            const speechLabel = document.getElementById('al-rule-speech-label').value.trim();

            // Validation
            if (!name) {
                this.showToast('Validation Error', 'Rule name is required', 'error');
                return;
            }

            if (!pattern) {
                this.showToast('Validation Error', 'Pattern is required', 'error');
                return;
            }

            // Validate regex if pattern type is regex
            if (patternType === 'regex') {
                try {
                    new RegExp(pattern);
                } catch (e) {
                    this.showToast('Validation Error', 'Invalid regex pattern: ' + e.message, 'error');
                    return;
                }
            }

            // Parse directive chars
            const directiveChars = directiveCharsStr.split(',').map(c => c.trim()).filter(c => c.length > 0);

            // Build rule object
            const rule = {
                name,
                enabled,
                pattern,
                patternType,
                useDirective,
                directiveChars: directiveChars.length > 0 ? directiveChars : ['*', '/'],
                groupIndexes: [],
                speechLabel,
                actions: this._modalActions || []
            };

            // Add or update
            if (ruleId) {
                AL.rules.updateRule(ruleId, rule);
                this.showToast('Rule Updated', `Updated rule: ${name}`, 'success');
            } else {
                AL.rules.addRule(rule);
                this.showToast('Rule Added', `Added new rule: ${name}`, 'success');
            }

            // Close modal and refresh
            this.closeModal();

            // Refresh rules tab if it's open
            const content = document.getElementById('al-content');
            if (content && this.currentTab === 'rules') {
                this.renderRules(content);
            }
        },

        /**
         * Close modal
         */
        closeModal() {
            const modal = document.getElementById('al-modal-rule-editor');
            if (modal) {
                modal.remove();
            }
            this._modalActions = null;
        },

        /**
         * Toggle panel visibility
         */
        togglePanel() {
            if (this.panel) {
                const isHidden = this.panel.style.display === 'none';
                this.panel.style.display = isHidden ? 'flex' : 'none';

                // Show bubble when panel is hidden, hide bubble when panel is visible
                if (this.bubble) {
                    this.bubble.style.display = isHidden ? 'none' : 'flex';
                }
            }
        },

        /**
         * Update status (called by other modules)
         */
        updateStatus() {
            this.updateTicker();
        }
    };

    // ========================================
    // MODULE: PERSISTENCE
    // ========================================
    AL.persistence = {
        // GM_getValue/GM_setValue wrappers with JSON serialization

        /**
         * Get value from storage (auto-parses JSON)
         */
        get(key, defaultValue = null) {
            try {
                const raw = GM_getValue(key);
                if (raw === undefined || raw === null) {
                    return defaultValue;
                }
                return AL.utils.safeJSONParse(raw, defaultValue);
            } catch (error) {
                console.error('[persistence] get error:', key, error);
                return defaultValue;
            }
        },

        /**
         * Set value in storage (auto-stringifies)
         */
        set(key, value) {
            try {
                GM_setValue(key, JSON.stringify(value));
                return true;
            } catch (error) {
                console.error('[persistence] set error:', key, error);
                return false;
            }
        },

        /**
         * Delete value from storage
         */
        delete(key) {
            try {
                GM_deleteValue(key);
                return true;
            } catch (error) {
                console.error('[persistence] delete error:', key, error);
                return false;
            }
        },

        /**
         * List all keys
         */
        listKeys() {
            try {
                return GM_listValues();
            } catch (error) {
                console.error('[persistence] listKeys error:', error);
                return [];
            }
        },

        /**
         * Get all settings as object
         */
        getAllSettings() {
            const keys = this.listKeys();
            const settings = {};
            for (const key of keys) {
                settings[key] = this.get(key);
            }
            return settings;
        },

        /**
         * Clear all storage (use with caution)
         */
        clearAll() {
            const keys = this.listKeys();
            for (const key of keys) {
                this.delete(key);
            }
            console.log('[persistence] Cleared all storage');
        },

        init() {
            console.log('[persistence] Initialized');
        }
    };

    // ========================================
    // MODULE: EXPORT_MANAGER
    // ========================================
    AL.exportManager = {
        // Export/Import buckets for config, rules, prefixes, etc.

        init() {
            console.log('[exportManager] Initialized');
        },

        /**
         * Export data bucket
         */
        exportBucket(bucketName) {
            const data = AL.persistence.get(bucketName);
            if (!data) {
                console.warn('[exportManager] No data found for bucket:', bucketName);
                return null;
            }

            const exportData = {
                bucket: bucketName,
                timestamp: Date.now(),
                version: '0.1.0',
                data: data
            };

            return JSON.stringify(exportData, null, 2);
        },

        /**
         * Export all data
         */
        exportAll() {
            const allData = {
                version: '0.1.0',
                timestamp: Date.now(),
                buckets: AL.persistence.getAllSettings()
            };

            return JSON.stringify(allData, null, 2);
        },

        /**
         * Import data bucket
         */
        importBucket(jsonString) {
            try {
                const importData = JSON.parse(jsonString);

                if (!importData.bucket || !importData.data) {
                    throw new Error('Invalid import format');
                }

                AL.persistence.set(importData.bucket, importData.data);

                console.log('[exportManager] Imported bucket:', importData.bucket);
                return true;
            } catch (error) {
                console.error('[exportManager] Import error:', error);
                return false;
            }
        },

        /**
         * Import all data
         */
        importAll(jsonString) {
            try {
                const importData = JSON.parse(jsonString);

                if (!importData.buckets) {
                    throw new Error('Invalid import format');
                }

                for (const [key, value] of Object.entries(importData.buckets)) {
                    AL.persistence.set(key, value);
                }

                console.log('[exportManager] Imported all data');
                return true;
            } catch (error) {
                console.error('[exportManager] Import error:', error);
                return false;
            }
        },

        /**
         * Download export as file
         */
        downloadExport(jsonString, filename) {
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `ocsd_armorylink_export_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    // ========================================
    // MODULE: PREFIXES
    // ========================================
    AL.prefixes = {
        // Prefix system with label, value, sticky count, hotkey, color
        prefixes: [],
        activePrefix: null,
        activeStickyCount: 0,

        init() {
            // Load prefixes from storage
            this.prefixes = AL.persistence.get('prefixes', AL.stubs.getDefaultPrefixes());

            // Set up hotkey listeners (1-9)
            document.addEventListener('keydown', this.handleHotkey.bind(this));

            console.log('[prefixes] Initialized with', this.prefixes.length, 'prefixes');
        },

        /**
         * Handle hotkey press
         */
        handleHotkey(event) {
            // Only if Alt + number
            if (!event.altKey) return;

            const key = event.key;
            if (key >= '1' && key <= '9') {
                const hotkeyNum = parseInt(key);
                const prefix = this.prefixes.find(p => p.hotkey === hotkeyNum);

                if (prefix) {
                    this.activate(prefix);
                    event.preventDefault();
                }
            }
        },

        /**
         * Activate prefix
         */
        activate(prefix) {
            this.activePrefix = prefix;
            this.activeStickyCount = prefix.stickyCount || 1;

            console.log('[prefixes] Activated:', prefix.label);

            // Update UI
            if (AL.ui && AL.ui.updateTicker) {
                AL.ui.updateTicker();
            }

            if (AL.ui && AL.ui.showToast) {
                AL.ui.showToast('Prefix Activated', `${prefix.label}: "${prefix.value}"`, 'info');
            }
        },

        /**
         * Deactivate prefix
         */
        deactivate() {
            this.activePrefix = null;
            this.activeStickyCount = 0;

            console.log('[prefixes] Deactivated');

            // Update UI
            if (AL.ui && AL.ui.updateTicker) {
                AL.ui.updateTicker();
            }
        },

        /**
         * Decrement sticky count after use
         */
        decrementSticky() {
            if (!this.activePrefix) return;

            this.activeStickyCount--;

            if (this.activeStickyCount <= 0) {
                this.deactivate();
            }
        },

        /**
         * Add prefix
         */
        addPrefix(prefix) {
            prefix.id = prefix.id || AL.utils.generateId();
            this.prefixes.push(prefix);
            this.save();
        },

        /**
         * Update prefix
         */
        updatePrefix(id, updates) {
            const index = this.prefixes.findIndex(p => p.id === id);
            if (index >= 0) {
                this.prefixes[index] = { ...this.prefixes[index], ...updates };
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Delete prefix
         */
        deletePrefix(id) {
            const index = this.prefixes.findIndex(p => p.id === id);
            if (index >= 0) {
                // Deactivate if currently active
                if (this.activePrefix && this.activePrefix.id === id) {
                    this.deactivate();
                }

                this.prefixes.splice(index, 1);
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Save to storage
         */
        save() {
            AL.persistence.set('prefixes', this.prefixes);
        },

        /**
         * Reset to defaults
         */
        resetDefaults() {
            this.prefixes = AL.stubs.getDefaultPrefixes();
            this.deactivate();
            this.save();
        }
    };

    // ========================================
    // MODULE: MACROS
    // ========================================
    AL.macros = {
        // Macro sequences (actions, wait, fill, click, toast, speech, URL, BWC/X10)
        macros: [],

        init() {
            // Load macros from storage
            this.macros = AL.persistence.get('macros', AL.stubs.getDefaultMacros());
            console.log('[macros] Initialized with', this.macros.length, 'macros');
        },

        /**
         * Execute macro by ID
         */
        async executeMacro(id) {
            const macro = this.macros.find(m => m.id === id);
            if (!macro || !macro.enabled) {
                console.warn('[macros] Macro not found or disabled:', id);
                return false;
            }

            console.log('[macros] Executing macro:', macro.name);

            try {
                for (const action of macro.actions) {
                    await AL.rules.executeAction(action, {});
                }
                return true;
            } catch (error) {
                console.error('[macros] Macro execution error:', error);
                return false;
            }
        },

        /**
         * Add macro
         */
        addMacro(macro) {
            macro.id = macro.id || AL.utils.generateId();
            macro.enabled = macro.enabled !== false;
            this.macros.push(macro);
            this.save();
        },

        /**
         * Update macro
         */
        updateMacro(id, updates) {
            const index = this.macros.findIndex(m => m.id === id);
            if (index >= 0) {
                this.macros[index] = { ...this.macros[index], ...updates };
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Delete macro
         */
        deleteMacro(id) {
            const index = this.macros.findIndex(m => m.id === id);
            if (index >= 0) {
                this.macros.splice(index, 1);
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Save to storage
         */
        save() {
            AL.persistence.set('macros', this.macros);
        },

        /**
         * Reset to defaults
         */
        resetDefaults() {
            this.macros = AL.stubs.getDefaultMacros();
            this.save();
        }
    };

    // ========================================
    // MODULE: FIELDS
    // ========================================
    AL.fields = {
        // Field selector system with prewired fields
        fields: [],

        init() {
            // Load fields from storage or use defaults
            this.fields = AL.persistence.get('fields', AL.stubs.getDefaultFields());
            console.log('[fields] Initialized with', this.fields.length, 'fields');
        },

        /**
         * Get field config by key
         */
        getField(key) {
            return this.fields.find(f => f.key === key);
        },

        /**
         * Set field value in ServiceNow
         * Uses pageState to find the visible field on active subpage
         */
        setFieldValue(key, value) {
            const field = this.getField(key);
            if (!field || !field.enabled) {
                console.warn('[fields] Field not found or disabled:', key);
                return false;
            }

            // Use pageState to find visible field on active subpage
            const element = AL.pageState?.findVisibleField(key);
            if (!element) {
                console.warn('[fields] Element not found or not visible for field:', key);
                return false;
            }

            try {
                // Special handling for Type field (combobox in shadow DOM)
                if (key === 'type' && element.getAttribute('role') === 'combobox') {
                    // Click to open dropdown
                    element.click();

                    // Wait for dropdown to open, then find and click the option
                    setTimeout(() => {
                        // Find the dropdown list item matching the value
                        const options = AL.utils.querySelectorAllDeep('[role="option"]');
                        const matchingOption = Array.from(options).find(opt => {
                            const text = opt.textContent?.trim();
                            return text === value || text.toLowerCase() === value.toLowerCase();
                        });

                        if (matchingOption) {
                            matchingOption.click();
                            console.log('[fields] Set Type field to:', value);
                        } else {
                            console.warn('[fields] Option not found for Type:', value);
                        }
                    }, 100);

                    return true;
                }

                // Standard handling for other fields
                if (element.tagName === 'SELECT') {
                    // Try to find option by value or text
                    const option = Array.from(element.options).find(opt =>
                        opt.value === value || opt.text === value
                    );
                    if (option) {
                        element.value = option.value;
                    } else {
                        console.warn('[fields] Option not found in select:', value);
                        return false;
                    }
                } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                    element.value = value;
                } else {
                    // Generic fallback
                    element.textContent = value;
                }

                // Trigger commit event
                if (field.commitEvent && field.commitEvent !== 'none') {
                    const event = new Event(field.commitEvent, { bubbles: true });
                    element.dispatchEvent(event);
                }

                console.log('[fields] Set field', key, 'to:', value);
                return true;
            } catch (error) {
                console.error('[fields] Error setting field:', key, error);
                return false;
            }
        },

        /**
         * Get field value from ServiceNow
         * Uses pageState to read from the active subpage
         */
        getFieldValue(key) {
            const field = this.getField(key);
            if (!field) return null;

            // Use pageState to read field value from active subpage
            if (AL.pageState && AL.pageState.readFieldValue) {
                return AL.pageState.readFieldValue(key);
            }

            // Fallback to direct element access if pageState not available
            const element = AL.utils.findElement(field.selector, field.selectorPath);
            if (!element) return null;

            try {
                // Special handling for Type field (combobox in shadow DOM)
                if (key === 'type' && element.getAttribute('role') === 'combobox') {
                    // Get the displayed text from the trigger button
                    const labelElement = element.querySelector('.now-select-trigger-label');
                    if (labelElement) {
                        return labelElement.textContent?.trim() || null;
                    }
                    // Fallback to aria-label or button text
                    return element.textContent?.trim() || element.getAttribute('aria-label') || null;
                }

                // Standard handling for other fields
                if (element.tagName === 'SELECT') {
                    return element.options[element.selectedIndex]?.text || element.value;
                } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                    return element.value;
                } else if (element.tagName === 'BUTTON') {
                    return element.textContent?.trim() || null;
                } else {
                    return element.textContent;
                }
            } catch (error) {
                console.log('[fields] Error getting field:', key, error);
                return null;
            }
        },

        /**
         * Test field (highlight and scroll into view)
         * Uses pageState to find visible field on active subpage
         */
        testField(key) {
            const field = this.getField(key);
            if (!field) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('Test Failed', 'Field not found', 'error');
                }
                return false;
            }

            // Use pageState to find visible field on active subpage
            const element = AL.pageState?.findVisibleField(key);
            if (!element) {
                // Check if element exists in DOM but not visible
                const anyElement = AL.utils.findElement(field.selector, field.selectorPath);
                if (anyElement) {
                    if (AL.ui && AL.ui.showToast) {
                        AL.ui.showToast('Test Warning', `Field found in DOM but not visible on active subpage: ${field.label}`, 'warning');
                    }
                } else {
                    if (AL.ui && AL.ui.showToast) {
                        AL.ui.showToast('Test Failed', `Element not found for active subpage: ${field.selector}`, 'error');
                    }
                }
                return false;
            }

            // Check if element is actually visible
            const isVisible = AL.pageState?.isElementVisible(element);
            if (!isVisible) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('Test Warning', `Element found but not visible on this subpage: ${field.label}`, 'warning');
                }
                return false;
            }

            // Highlight element
            AL.utils.highlightElement(element);

            if (AL.ui && AL.ui.showToast) {
                AL.ui.showToast('Test Success', `Found on active subpage: ${field.label}`, 'success');
            }

            return true;
        },

        /**
         * Add field
         */
        addField(field) {
            field.key = field.key || AL.utils.generateId();
            this.fields.push(field);
            this.save();
        },

        /**
         * Update field
         */
        updateField(key, updates) {
            const index = this.fields.findIndex(f => f.key === key);
            if (index >= 0) {
                this.fields[index] = { ...this.fields[index], ...updates };
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Delete field
         */
        deleteField(key) {
            const index = this.fields.findIndex(f => f.key === key);
            if (index >= 0) {
                this.fields.splice(index, 1);
                this.save();
                return true;
            }
            return false;
        },

        /**
         * Save fields to storage
         */
        save() {
            AL.persistence.set('fields', this.fields);
        },

        /**
         * Reset to defaults
         */
        resetDefaults() {
            this.fields = AL.stubs.getDefaultFields();
            this.save();
        }
    };

    // ========================================
    // MODULE: BWC
    // ========================================
    AL.bwc = {
        // BWC helper - PID extraction, iframe/tab launching, site navigation
        bwcUrl: 'https://evidence.com', // Placeholder - user will configure
        mode: 'iframe', // 'iframe' or 'tab'
        iframeContainer: null,

        init() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            this.bwcUrl = settings.bwcUrl || this.bwcUrl;
            this.mode = settings.bwcMode || this.mode;
            console.log('[bwc] Initialized, mode:', this.mode);
        },

        /**
         * Launch BWC in iframe with auto-navigation and fallback
         */
        openBwcInIframe(config) {
            const pid = config.pid || AL.fields.getFieldValue('user');
            const serial = config.serial || '';

            if (!pid) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('BWC Error', 'No user PID found', 'error');
                }
                return false;
            }

            const url = `${this.bwcUrl}`;

            console.log('[bwc] Opening in iframe:', url);

            // Create iframe container in panel
            if (!this.iframeContainer) {
                this.iframeContainer = document.createElement('div');
                this.iframeContainer.id = 'al-bwc-iframe-container';
                this.iframeContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: white; z-index: 10;';

                const closeBtn = document.createElement('button');
                closeBtn.textContent = '×';
                closeBtn.className = 'al-btn al-btn-danger';
                closeBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; z-index: 11;';
                closeBtn.onclick = () => this.closeIframe();

                this.iframeContainer.appendChild(closeBtn);
            }

            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
            iframe.src = url;

            // Try to load iframe and detect errors
            let iframeFailed = false;

            iframe.onerror = () => {
                iframeFailed = true;
                console.log('[bwc] Iframe load error, falling back to new tab');
                this.closeIframe();
                this.fallbackToTab(pid, serial);
            };

            iframe.onload = () => {
                if (iframeFailed) return;

                console.log('[bwc] Iframe loaded, attempting auto-navigation');

                // Try to auto-navigate within iframe
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

                    // Wait a bit for page to load, then try to search
                    setTimeout(() => {
                        try {
                            // Look for search field and enter PID
                            const searchField = iframeDoc.querySelector('input[type="search"], input[name="search"], input[placeholder*="search" i]');
                            if (searchField) {
                                searchField.value = pid;
                                searchField.dispatchEvent(new Event('input', { bubbles: true }));
                                searchField.dispatchEvent(new Event('change', { bubbles: true }));

                                // Try to find and click search button
                                const searchBtn = iframeDoc.querySelector('button[type="submit"], button.search-btn, input[type="submit"]');
                                if (searchBtn) {
                                    searchBtn.click();
                                }
                            }
                        } catch (navError) {
                            console.log('[bwc] Auto-navigation blocked (CORS):', navError.message);
                        }
                    }, 1500);

                } catch (e) {
                    // Cross-origin iframe - cannot navigate
                    console.log('[bwc] Cannot auto-navigate (cross-origin):', e.message);
                }
            };

            // Clear existing iframe if any
            const existingIframe = this.iframeContainer.querySelector('iframe');
            if (existingIframe) existingIframe.remove();

            this.iframeContainer.appendChild(iframe);

            // Add to panel
            if (AL.ui.panel) {
                AL.ui.panel.appendChild(this.iframeContainer);
            }

            return true;
        },

        /**
         * Fallback to opening in new tab
         */
        fallbackToTab(pid, serial) {
            const url = `${this.bwcUrl}?pid=${encodeURIComponent(pid)}&serial=${encodeURIComponent(serial || '')}`;
            console.log('[bwc] Fallback: Opening in new tab:', url);
            window.open(url, '_blank');

            if (AL.ui && AL.ui.showToast) {
                AL.ui.showToast('BWC Opened', 'Opened in new tab (iframe blocked)', 'info');
            }
        },

        /**
         * Close iframe
         */
        closeIframe() {
            if (this.iframeContainer && this.iframeContainer.parentNode) {
                this.iframeContainer.remove();
                this.iframeContainer = null;
            }
        },

        /**
         * Launch BWC helper
         */
        launch(serial) {
            const pid = AL.fields.getFieldValue('user');

            if (!pid) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('BWC Error', 'No user PID found', 'error');
                }
                return false;
            }

            if (this.mode === 'iframe') {
                return this.openBwcInIframe({ pid, serial });
            } else {
                return this.fallbackToTab(pid, serial);
            }
        }
    };

    // ========================================
    // MODULE: X10
    // ========================================
    AL.x10 = {
        // X10 helper - PID extraction, iframe/tab launching, site navigation
        x10Url: 'https://buy.taser.com', // Placeholder - user will configure
        mode: 'iframe', // 'iframe' or 'tab'
        iframeContainer: null,

        init() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            this.x10Url = settings.x10Url || this.x10Url;
            this.mode = settings.x10Mode || this.mode;
            console.log('[x10] Initialized, mode:', this.mode);
        },

        /**
         * Launch X10 in iframe with auto-navigation and fallback
         */
        openX10InIframe(config) {
            const pid = config.pid || AL.fields.getFieldValue('user');
            const serial = config.serial || '';

            if (!pid) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('X10 Error', 'No user PID found', 'error');
                }
                return false;
            }

            const url = `${this.x10Url}`;

            console.log('[x10] Opening in iframe:', url);

            // Create iframe container in panel
            if (!this.iframeContainer) {
                this.iframeContainer = document.createElement('div');
                this.iframeContainer.id = 'al-x10-iframe-container';
                this.iframeContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: white; z-index: 10;';

                const closeBtn = document.createElement('button');
                closeBtn.textContent = '×';
                closeBtn.className = 'al-btn al-btn-danger';
                closeBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; z-index: 11;';
                closeBtn.onclick = () => this.closeIframe();

                this.iframeContainer.appendChild(closeBtn);
            }

            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
            iframe.src = url;

            // Try to load iframe and detect errors
            let iframeFailed = false;

            iframe.onerror = () => {
                iframeFailed = true;
                console.log('[x10] Iframe load error, falling back to new tab');
                this.closeIframe();
                this.fallbackToTab(pid, serial);
            };

            iframe.onload = () => {
                if (iframeFailed) return;

                console.log('[x10] Iframe loaded, attempting auto-navigation');

                // Try to auto-navigate within iframe
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

                    // Wait a bit for page to load, then try to search
                    setTimeout(() => {
                        try {
                            // Look for search field and enter serial number
                            const searchField = iframeDoc.querySelector('input[type="search"], input[name="search"], input[placeholder*="search" i], input[placeholder*="serial" i]');
                            if (searchField) {
                                searchField.value = serial || pid;
                                searchField.dispatchEvent(new Event('input', { bubbles: true }));
                                searchField.dispatchEvent(new Event('change', { bubbles: true }));

                                // Try to find and click search button
                                const searchBtn = iframeDoc.querySelector('button[type="submit"], button.search-btn, input[type="submit"]');
                                if (searchBtn) {
                                    searchBtn.click();
                                }
                            }
                        } catch (navError) {
                            console.log('[x10] Auto-navigation blocked (CORS):', navError.message);
                        }
                    }, 1500);

                } catch (e) {
                    // Cross-origin iframe - cannot navigate
                    console.log('[x10] Cannot auto-navigate (cross-origin):', e.message);
                }
            };

            // Clear existing iframe if any
            const existingIframe = this.iframeContainer.querySelector('iframe');
            if (existingIframe) existingIframe.remove();

            this.iframeContainer.appendChild(iframe);

            // Add to panel
            if (AL.ui.panel) {
                AL.ui.panel.appendChild(this.iframeContainer);
            }

            return true;
        },

        /**
         * Fallback to opening in new tab
         */
        fallbackToTab(pid, serial) {
            const url = `${this.x10Url}?pid=${encodeURIComponent(pid)}&serial=${encodeURIComponent(serial || '')}`;
            console.log('[x10] Fallback: Opening in new tab:', url);
            window.open(url, '_blank');

            if (AL.ui && AL.ui.showToast) {
                AL.ui.showToast('X10 Opened', 'Opened in new tab (iframe blocked)', 'info');
            }
        },

        /**
         * Close iframe
         */
        closeIframe() {
            if (this.iframeContainer && this.iframeContainer.parentNode) {
                this.iframeContainer.remove();
                this.iframeContainer = null;
            }
        },

        /**
         * Launch X10 helper
         */
        launch(serial) {
            const pid = AL.fields.getFieldValue('user');

            if (!pid) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('X10 Error', 'No user PID found', 'error');
                }
                return false;
            }

            if (this.mode === 'iframe') {
                return this.openX10InIframe({ pid, serial });
            } else {
                return this.fallbackToTab(pid, serial);
            }
        }
    };

    // ========================================
    // MODULE: ACTIVE_CONTEXT
    // ========================================
    AL.activeContext = {
        // Detect if active SNOW tab is armory-relevant
        isArmoryContext: false,

        init() {
            this.detect();
            console.log('[activeContext] Initialized, isArmoryContext:', this.isArmoryContext);
        },

        /**
         * Detect if current page is armory-relevant
         */
        detect() {
            // Check URL for armory-related keywords
            const url = window.location.href.toLowerCase();
            const pathname = window.location.pathname.toLowerCase();

            // Common armory-related patterns in ServiceNow
            const armoryPatterns = [
                'armory',
                'equipment',
                'asset',
                'inventory',
                'deployment',
                'checkout'
            ];

            this.isArmoryContext = armoryPatterns.some(pattern =>
                url.includes(pattern) || pathname.includes(pattern)
            );

            // If not detected by URL, you could also check for specific form IDs or table names
            // For now, we'll assume any ServiceNow page could be armory-related
            // User can refine this later
            if (!this.isArmoryContext) {
                // For testing, allow all ServiceNow pages
                this.isArmoryContext = url.includes('service-now.com');
            }

            return this.isArmoryContext;
        },

        /**
         * Check context periodically
         */
        startMonitoring() {
            setInterval(() => {
                const wasArmoryContext = this.isArmoryContext;
                this.detect();

                if (wasArmoryContext !== this.isArmoryContext) {
                    console.log('[activeContext] Context changed:', this.isArmoryContext);

                    // Update UI
                    if (AL.ui && AL.ui.updateStatus) {
                        AL.ui.updateStatus();
                    }
                }
            }, 5000); // Check every 5 seconds
        }
    };

    // ========================================
    // MODULE: PAGE_STATE (PageContextStore)
    // ========================================
    // ⚠️ CRITICAL: This module MUST match the "Tabbed Names" pattern EXACTLY
    // ⚠️ DO NOT change this implementation without reviewing Tabbed Names first
    //
    // Key requirements (DO NOT violate):
    // 1. Contexts are keyed by <a role="tab"> id (NOT by URL or index)
    // 2. apply() updates ONLY the active tab's context from visible fields
    // 3. refreshUI() calls updateAllTabLabels() which updates ALL tabs
    // 4. Each context stores lastTabLabel computed during readFieldsAndUpdate()
    // 5. Tab labels come from ctx.lastTabLabel, not from fresh computation
    // 6. Ticker uses getActiveTabContext() to get visible subpage data
    //
    // This ensures labels/data persist correctly when tabs are reordered
    AL.pageState = {
        // Map<tabId, PageContext> for per-tab state
        store: new Map(),

        // Track the first tab ID for "Home" label
        firstTabId: null,

        // Throttled apply function to avoid excessive calls
        _throttledApply: null,
        _mutationObserver: null,
        _initialIntervalId: null,

        init() {
            // Set up throttled apply
            this._throttledApply = AL.utils.throttle(() => this.apply(), 100);

            // Initial short-term monitoring (first 60 seconds)
            let elapsed = 0;
            this._initialIntervalId = setInterval(() => {
                this.apply();
                elapsed += 300;
                if (elapsed >= 60000) {
                    clearInterval(this._initialIntervalId);
                    console.log('[pageState] Initial monitoring period complete');
                }
            }, 300);

            // Set up throttled mutation observer for tab changes
            // Only check for relevant changes to reduce CPU overhead
            this._mutationObserver = AL.utils.createThrottledObserver((mutations) => {
                // Only apply if we see relevant changes (tabs or tab-related elements)
                const relevant = mutations.some(m =>
                    m.target.classList?.contains('sn-chrome-tabs') ||
                    m.target.querySelector?.('.sn-chrome-tabs') ||
                    m.target.closest?.('a[role="tab"]') ||
                    (m.attributeName === 'aria-selected' && m.target.getAttribute?.('role') === 'tab')
                );

                if (relevant) {
                    this._throttledApply();
                }
            }, 200);

            this._mutationObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: false  // Don't watch all attributes - rely on tab click events instead
            });

            // Listen for clicks on tabs
            document.addEventListener('click', (e) => {
                const tab = e.target.closest('a[role="tab"]') || e.target.closest('.sn-chrome-one-tab-container');
                if (tab) {
                    setTimeout(() => this.apply(), 100);
                }
            }, true);

            console.log('[pageState] Initialized with per-tab context store');
        },

        /**
         * Helper functions following "Tabbed Names" pattern
         */

        // Get document (for consistency with Tabbed Names pattern)
        docs() {
            return [document];
        },

        // Deep query all elements across shadow DOM
        deepQueryAllIn(root, selector) {
            return AL.utils.querySelectorAllDeep(selector, root);
        },

        // Deep query all in all docs
        deepAll(selector) {
            const results = [];
            for (const doc of this.docs()) {
                results.push(...this.deepQueryAllIn(doc, selector));
            }
            return results;
        },

        // Get all tab <li> elements
        tabLis() {
            // Find all workspace tab containers
            return this.deepAll('li.sn-chrome-one-tab-container');
        },

        // Get <a role="tab"> from a tab <li>
        tabA(li) {
            if (!li) return null;
            return li.querySelector('a[role="tab"]');
        },

        // Get stable tab ID from tab <li>
        tabId(li) {
            const a = this.tabA(li);
            return a?.id || null;
        },

        // Check if tab <li> is active/selected
        isActive(li) {
            if (!li) return false;
            // Check for is-selected class
            if (li.classList.contains('is-selected')) return true;
            // Check aria-selected on the <a role="tab">
            const a = this.tabA(li);
            return a?.getAttribute('aria-selected') === 'true';
        },

        /**
         * Create a default page context
         */
        createDefaultContext() {
            return {
                type: null,
                typeIcon: '⚫',
                userFull: null,
                userLast: null,
                vehicle: null,
                weapon: null,
                taser: null,
                patrol: null,
                weaponPills: [],    // Array of pill values for weapon field
                taserPills: [],     // Array of pill values for taser field
                patrolPills: [],    // Array of pill values for patrol field
                controlOneRadio: null,
                updatedOn: null,
                lastTabLabel: '⚫ | NO USER',
                lastTickerState: null
            };
        },

        /**
         * Get or create context for a specific tabId
         */
        getOrCreateContext(tabId) {
            if (!this.store.has(tabId)) {
                this.store.set(tabId, this.createDefaultContext());
                console.log('[pageState] Created context for tab:', tabId);
            }
            return this.store.get(tabId);
        },

        /**
         * Get the active tab context (from currently active tab)
         * Alias for consistency with Tabbed Names pattern
         */
        getActiveTabContext() {
            // Find active tab
            const tabs = this.tabLis();
            const activeTab = tabs.find(li => this.isActive(li));

            if (activeTab) {
                const tid = this.tabId(activeTab);
                if (tid) {
                    return this.getOrCreateContext(tid);
                }
            }

            // Fallback: return a default context
            return this.createDefaultContext();
        },

        /**
         * Get the active page context (backward compatibility alias)
         */
        getActivePageContext() {
            return this.getActiveTabContext();
        },

        /**
         * Find visible field element for the active subpage
         */
        findVisibleField(fieldKey) {
            const field = AL.fields?.getField(fieldKey);
            if (!field || !field.selector) return null;

            try {
                // Get all matching elements
                const elements = AL.utils.querySelectorAllDeep(field.selector);

                // Find the first visible one
                for (const el of elements) {
                    if (this.isElementVisible(el)) {
                        return el;
                    }
                }

                return null;
            } catch (error) {
                console.log('[pageState] Error finding visible field:', fieldKey, error);
                return null;
            }
        },

        /**
         * Check if element is visible
         */
        isElementVisible(el) {
            if (!el) return false;

            // Check basic visibility
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }

            // Check if element has dimensions
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                return false;
            }

            return true;
        },

        /**
         * Read a field value from the active subpage
         */
        readFieldValue(fieldKey) {
            const element = this.findVisibleField(fieldKey);
            if (!element) return null;

            try {
                const field = AL.fields.getField(fieldKey);

                // Special handling for Type field (combobox in shadow DOM)
                if (fieldKey === 'type' && element.getAttribute('role') === 'combobox') {
                    // Get the displayed text from the trigger button
                    const labelElement = element.querySelector('.now-select-trigger-label');
                    if (labelElement) {
                        return labelElement.textContent?.trim() || null;
                    }
                    // Fallback to aria-label or button text
                    return element.textContent?.trim() || element.getAttribute('aria-label') || null;
                }

                // Standard handling for other fields
                if (element.tagName === 'SELECT') {
                    return element.options[element.selectedIndex]?.text || element.value;
                } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                    return element.value;
                } else if (element.tagName === 'BUTTON') {
                    return element.textContent?.trim() || null;
                } else {
                    return element.textContent?.trim() || null;
                }
            } catch (error) {
                console.log('[pageState] Error reading field:', fieldKey, error);
                return null;
            }
        },

        /**
         * Read pill values from a multi-select field
         * Returns an array of pill text values
         */
        readPillValues(fieldKey) {
            const element = this.findVisibleField(fieldKey);
            if (!element) return [];

            try {
                // Find the parent container that holds the pills
                // Pills are typically in a container near the input
                const container = element.closest('.form-field') || element.closest('[data-field-name]') || element.parentElement;
                if (!container) return [];

                // Search for pill elements in the container
                // ServiceNow uses various pill patterns - try multiple selectors
                const pillSelectors = [
                    '.sn-tag-button .sn-tag-label',  // Standard ServiceNow pills
                    '.now-tag .now-tag-label',        // Now Experience pills
                    '[role="button"][class*="tag"] span',  // Generic tag buttons
                    '.token span',                     // Token-based pills
                    '[data-value]'                     // Elements with data-value attribute
                ];

                const pillValues = [];

                for (const selector of pillSelectors) {
                    const pills = AL.utils.querySelectorAllDeep(selector, container);
                    if (pills.length > 0) {
                        pills.forEach(pill => {
                            const text = pill.textContent?.trim();
                            if (text && !text.includes('×') && !text.includes('✕')) {
                                // Filter out close button text
                                pillValues.push(text);
                            }
                        });
                        if (pillValues.length > 0) break; // Found pills, stop searching
                    }
                }

                return pillValues;
            } catch (error) {
                console.log('[pageState] Error reading pill values:', fieldKey, error);
                return [];
            }
        },

        /**
         * Read fields and update the provided context
         *
         * ⚠️ CRITICAL: This function MUST store lastTabLabel in the context
         * ⚠️ DO NOT remove ctx.lastTabLabel assignment - it's used by updateAllTabLabels()
         * ⚠️ This ensures labels persist when tabs are reordered
         */
        readFieldsAndUpdate(ctx, tabId = null) {
            if (!AL.fields) {
                console.log('[pageState] Fields module not ready');
                return;
            }

            try {
                // Read all field values (only from visible/active subpage)
                const typeValue = this.readFieldValue('type');
                const userValue = this.readFieldValue('user');
                const vehicleValue = this.readFieldValue('vehicle');
                const controlOneRadioValue = this.readFieldValue('controlOneRadio');
                const updatedOnValue = this.readFieldValue('updated_on');

                // Read ONLY pill values for weapon, taser, and patrol (multi-select fields)
                const weaponPills = this.readPillValues('weapon');
                const taserPills = this.readPillValues('taser');
                const patrolPills = this.readPillValues('patrol');

                // Update context
                ctx.type = typeValue;
                ctx.userFull = userValue;
                ctx.userLast = this.extractLastName(userValue);
                ctx.vehicle = vehicleValue;
                ctx.weaponPills = weaponPills;  // Array of pill values
                ctx.taserPills = taserPills;    // Array of pill values
                ctx.patrolPills = patrolPills;  // Array of pill values
                ctx.controlOneRadio = controlOneRadioValue;
                ctx.updatedOn = updatedOnValue;

                // Also store legacy single-value versions for backward compatibility
                ctx.weapon = this.readFieldValue('weapon');
                ctx.taser = this.readFieldValue('taser');
                ctx.patrol = this.readFieldValue('patrol');

                // Set type icon for tab titles
                if (typeValue) {
                    const tl = typeValue.toLowerCase();
                    if (tl.includes('deploy')) {
                        ctx.typeIcon = '🟡';  // Deployment → yellow
                    } else if (tl.includes('return')) {
                        ctx.typeIcon = '🟢';  // Return → green
                    } else {
                        ctx.typeIcon = '⚫';  // Default → black
                    }
                } else {
                    ctx.typeIcon = '⚫';  // Default → black
                }

                // ⚠️ CRITICAL: Compute and store tab label in context (Tabbed Names pattern)
                // This stored label is used by updateAllTabLabels() to set all tab labels
                // Special case: First tab is always "Home" with no icons
                if (tabId && tabId === this.firstTabId) {
                    ctx.lastTabLabel = 'Home';
                } else {
                    const icon = ctx.typeIcon || '⚫';
                    const lastName = ctx.userLast || 'NO USER';
                    ctx.lastTabLabel = `${icon} | ${lastName}`;
                }
            } catch (error) {
                console.log('[pageState] Error in readFieldsAndUpdate:', error);
            }
        },

        /**
         * Main apply function - manages per-tab contexts
         * Called on init, tab switches, and DOM changes
         *
         * ⚠️ CRITICAL: This function MUST update ONLY the active tab's context
         * ⚠️ DO NOT change to update all tabs - that would read fields from non-visible pages
         * ⚠️ refreshUI() will then update ALL tab labels from their stored contexts
         */
        apply() {
            try {
                // Get current tabs
                const tabs = this.tabLis();
                if (tabs.length === 0) {
                    return; // No tabs found yet
                }

                // Track the first tab ID for "Home" label (set once, never change)
                if (!this.firstTabId && tabs.length > 0) {
                    const firstTid = this.tabId(tabs[0]);
                    if (firstTid) {
                        this.firstTabId = firstTid;
                        console.log('[pageState] First tab ID set to:', firstTid);
                    }
                }

                // Ensure all visible tabs have contexts
                const currentTabIds = new Set();
                for (const li of tabs) {
                    const tid = this.tabId(li);
                    if (tid) {
                        currentTabIds.add(tid);
                        this.getOrCreateContext(tid);
                    }
                }

                // ⚠️ CRITICAL: Find active tab and update ONLY its context
                // This ensures we only read fields from the currently visible subpage
                const activeTab = tabs.find(li => this.isActive(li));
                if (activeTab) {
                    const tid = this.tabId(activeTab);
                    if (tid) {
                        const ctx = this.getOrCreateContext(tid);
                        this.readFieldsAndUpdate(ctx, tid);  // Only reads visible fields
                    }
                }

                // Clean up contexts for closed tabs
                const tabIdsToDelete = [];
                for (const tid of this.store.keys()) {
                    if (!currentTabIds.has(tid)) {
                        tabIdsToDelete.push(tid);
                    }
                }
                for (const tid of tabIdsToDelete) {
                    this.store.delete(tid);
                    console.log('[pageState] Removed context for closed tab:', tid);
                }

                // Refresh UI
                this.refreshUI();
            } catch (error) {
                console.log('[pageState] Error in apply:', error);
            }
        },

        /**
         * Extract last name from full name string
         * Handles "Last, First" and "First Last" formats
         * Returns uppercase last name or "NO USER" if missing
         */
        extractLastName(userFull) {
            if (!userFull) return 'NO USER';
            const trimmed = String(userFull).trim();
            if (!trimmed) return 'NO USER';

            const comma = trimmed.indexOf(',');
            if (comma > 0) return trimmed.slice(0, comma).trim().toUpperCase();

            const parts = trimmed.split(/\s+/);
            return (parts[parts.length - 1] || 'NO USER').toUpperCase();
        },

        /**
         * Check if record has been updated
         */
        isRecordUpdated(updatedValue) {
            if (!updatedValue) return false;
            const trimmed = String(updatedValue).trim();
            if (!trimmed || trimmed === '—') return false;
            return true;
        },

        /**
         * Derive ticker style from context
         */
        deriveTickerStyle(ctx) {
            if (this.isRecordUpdated(ctx.updatedOn)) {
                return 'updated'; // red / white
            }
            if (ctx.type) {
                const tl = ctx.type.toLowerCase();
                if (tl.includes('deploy')) return 'deploy'; // yellow / black
                if (tl.includes('return')) return 'return'; // green / black
            }
            return 'default';
        },

        /**
         * Refresh active page (for backward compatibility)
         */
        async refreshActivePage(withRetry = false) {
            try {
                if (withRetry) {
                    // For tab switches, retry with delays to wait for fields to load
                    for (let i = 0; i < 3; i++) {
                        await new Promise(resolve => setTimeout(resolve, i === 0 ? 300 : 200));
                        this.apply();

                        // Check if we got meaningful data
                        const ctx = this.getActivePageContext();
                        if (ctx.type || ctx.userFull) {
                            break;
                        }
                    }
                } else {
                    // Immediate apply
                    this.apply();
                }
            } catch (error) {
                console.log('[pageState] Error in refreshActivePage:', error);
            }
        },

        /**
         * Refresh UI components (ticker and ALL tab labels)
         * Like Tabbed Names: updates every tab label from its context
         *
         * ⚠️ CRITICAL: This MUST call updateAllTabLabels(), NOT just update active tab
         * ⚠️ DO NOT change to only update active tab - all tabs need their labels updated
         * ⚠️ This is what makes labels persist correctly when tabs are reordered
         */
        refreshUI() {
            try {
                // ⚠️ CRITICAL: Update ALL tab labels from their contexts
                // This ensures every tab shows the correct label from its stored context
                if (AL.tabTitle && AL.tabTitle.updateAllTabLabels) {
                    AL.tabTitle.updateAllTabLabels();
                }
            } catch (error) {
                console.log('[pageState] Error updating tab labels:', error);
            }

            try {
                // Update ticker from active tab context only
                if (AL.ui && AL.ui.updateTicker) {
                    AL.ui.updateTicker();
                }
            } catch (error) {
                console.log('[pageState] Error updating ticker:', error);
            }
        },

        /**
         * Handle tab switch event (called by tab title monitor)
         */
        onTabSwitch() {
            console.log('[pageState] Tab switch detected, refreshing...');
            this.refreshActivePage(true);
        }
    };

    // ========================================
    // MODULE: TAB_TITLE
    // ========================================
    // Tab title formatting for ServiceNow workspace tabs
    // Exactly like Tabbed Names: updates ALL tab labels from their contexts
    AL.tabTitle = {
        // ServiceNow workspace tab label formatting (TYPE_ICON | LASTNAME)

        init() {
            // Initial update of all tab labels
            this.updateAllTabLabels();
            console.log('[tabTitle] Initialized');
        },

        /**
         * Update ALL tab labels from their contexts
         * This is the Tabbed Names pattern: every tab gets its label from its context
         *
         * ⚠️ CRITICAL: This function MUST iterate through ALL tabs, not just active
         * ⚠️ DO NOT change to only update active tab - that breaks reordering
         * ⚠️ Each tab's label MUST come from ctx.lastTabLabel (stored during readFieldsAndUpdate)
         * ⚠️ DO NOT compute labels fresh here - use the stored value from context
         */
        updateAllTabLabels() {
            if (!AL.pageState) return;

            try {
                // ⚠️ CRITICAL: Get ALL tabs, not just the active one
                const tabs = AL.pageState.tabLis();

                // ⚠️ CRITICAL: Update EACH tab's label from its stored context
                for (const li of tabs) {
                    const tid = AL.pageState.tabId(li);
                    if (!tid) continue;

                    // Get or create context for this tab
                    const ctx = AL.pageState.getOrCreateContext(tid);

                    // Get the label element within this tab
                    const labelEl = li.querySelector('.sn-chrome-one-tab-label');
                    if (!labelEl) continue;

                    // ⚠️ CRITICAL: Use the stored lastTabLabel from context
                    // DO NOT compute it fresh - that would require reading fields from inactive tabs
                    const label = ctx.lastTabLabel || '⚫ | NO USER';

                    // Update the label text and tooltip
                    labelEl.textContent = label;
                    labelEl.setAttribute('data-tooltip', label);
                }
            } catch (error) {
                console.log('[tabTitle] Error updating all tab labels:', error);
            }
        },

        /**
         * Update active tab label (backward compatibility)
         * Now just calls updateAllTabLabels()
         */
        update() {
            this.updateAllTabLabels();
        }
    };

    // ========================================
    // MODULE: DEFAULTS_MANAGER
    // ========================================
    AL.defaultsManager = {
        // Create working default field configs for ServiceNow

        init() {
            // Ensure all defaults are loaded
            this.ensureDefaults();
            console.log('[defaultsManager] Initialized');
        },

        /**
         * Ensure all defaults exist in storage
         */
        ensureDefaults() {
            // Fields - merge defaults with saved configs
            const savedFields = AL.persistence.get('fields');
            if (!savedFields) {
                // No saved fields, use defaults
                AL.persistence.set('fields', AL.stubs.getDefaultFields());
            } else {
                // Merge: add any missing default fields to saved config
                const defaultFields = AL.stubs.getDefaultFields();
                const savedFieldKeys = new Set(savedFields.map(f => f.key));
                let needsUpdate = false;

                // Add missing fields from defaults
                for (const defaultField of defaultFields) {
                    if (!savedFieldKeys.has(defaultField.key)) {
                        savedFields.push(defaultField);
                        needsUpdate = true;
                        console.log(`[defaultsManager] Added missing field: ${defaultField.key}`);
                    }
                }

                // Save merged config if we added any fields
                if (needsUpdate) {
                    AL.persistence.set('fields', savedFields);
                }
            }

            // Rules
            if (!AL.persistence.get('rules')) {
                AL.persistence.set('rules', AL.stubs.getDefaultRules());
            }

            // Prefixes
            if (!AL.persistence.get('prefixes')) {
                AL.persistence.set('prefixes', AL.stubs.getDefaultPrefixes());
            }

            // Macros
            if (!AL.persistence.get('macros')) {
                AL.persistence.set('macros', AL.stubs.getDefaultMacros());
            }

            // Settings
            if (!AL.persistence.get('settings')) {
                AL.persistence.set('settings', AL.stubs.getDefaultSettings());
            }
        },

        /**
         * Reset all defaults
         */
        resetAll() {
            AL.persistence.set('fields', AL.stubs.getDefaultFields());
            AL.persistence.set('rules', AL.stubs.getDefaultRules());
            AL.persistence.set('prefixes', AL.stubs.getDefaultPrefixes());
            AL.persistence.set('macros', AL.stubs.getDefaultMacros());
            AL.persistence.set('settings', AL.stubs.getDefaultSettings());

            console.log('[defaultsManager] All defaults reset');

            // Reload
            location.reload();
        }
    };

    // ========================================
    // MODULE: BROADCAST
    // ========================================
    AL.broadcast = {
        // Multi-tab leader/follower via BroadcastChannel
        isLeader: false,
        channel: null,
        heartbeatInterval: null,
        HEARTBEAT_INTERVAL: 2000,
        LEADER_TIMEOUT: 5000,
        lastLeaderHeartbeat: 0,

        init() {
            try {
                this.channel = new BroadcastChannel('ocsd_armorylink');
                this.channel.onmessage = this.handleMessage.bind(this);

                // Try to become leader
                this.tryBecomeLeader();

                // Check for leader heartbeats
                setInterval(() => this.checkLeader(), 1000);

                console.log('[broadcast] Initialized');
            } catch (error) {
                console.error('[broadcast] Init error:', error);
                // Fallback: assume leadership if BroadcastChannel not available
                this.isLeader = true;
            }
        },

        /**
         * Try to become leader
         */
        tryBecomeLeader() {
            if (!this.isLeader) {
                this.channel.postMessage({ type: 'leader_query' });
                setTimeout(() => {
                    if (!this.isLeader && Date.now() - this.lastLeaderHeartbeat > this.LEADER_TIMEOUT) {
                        this.becomeLeader();
                    }
                }, 500);
            }
        },

        /**
         * Become the leader tab
         */
        becomeLeader() {
            console.log('[broadcast] Becoming leader');
            this.isLeader = true;

            // Start heartbeat
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }
            this.heartbeatInterval = setInterval(() => {
                this.channel.postMessage({ type: 'leader_heartbeat', timestamp: Date.now() });
            }, this.HEARTBEAT_INTERVAL);

            // Update UI
            if (AL.ui && AL.ui.updateStatus) {
                AL.ui.updateStatus();
            }
        },

        /**
         * Step down from leadership
         */
        stepDown() {
            console.log('[broadcast] Stepping down from leader');
            this.isLeader = false;

            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }

            // Update UI
            if (AL.ui && AL.ui.updateStatus) {
                AL.ui.updateStatus();
            }
        },

        /**
         * Check if leader is still alive
         */
        checkLeader() {
            if (!this.isLeader && Date.now() - this.lastLeaderHeartbeat > this.LEADER_TIMEOUT) {
                this.tryBecomeLeader();
            }
        },

        /**
         * Handle incoming messages
         */
        handleMessage(event) {
            const { type, data, timestamp } = event.data;

            switch (type) {
                case 'leader_heartbeat':
                    if (!this.isLeader) {
                        this.lastLeaderHeartbeat = timestamp || Date.now();
                    } else {
                        // Another tab claims leadership - step down if they're newer
                        // (This handles race conditions)
                    }
                    break;

                case 'leader_query':
                    if (this.isLeader) {
                        this.channel.postMessage({ type: 'leader_heartbeat', timestamp: Date.now() });
                    }
                    break;

                case 'scan_forward':
                    // Follower tab forwarding scan to leader
                    if (this.isLeader && data) {
                        AL.capture.enqueue(data.scanText, data.source);
                    }
                    break;

                case 'scan_result':
                    // Leader broadcasting scan result to followers
                    if (!this.isLeader && AL.ui && AL.ui.updateLastScan) {
                        AL.ui.updateLastScan(data);
                    }
                    break;
            }
        },

        /**
         * Send scan from follower to leader
         */
        forwardScan(scanText, source = 'follower') {
            this.channel.postMessage({
                type: 'scan_forward',
                data: { scanText, source }
            });
        },

        /**
         * Broadcast scan result from leader to followers
         */
        broadcastScanResult(result) {
            this.channel.postMessage({
                type: 'scan_result',
                data: result
            });
        }
    };

    // ========================================
    // MODULE: WORKER
    // ========================================
    AL.worker = {
        // Process scans from queue, handle timeouts
        processing: false,
        currentScanTimeout: null,

        init() {
            console.log('[worker] Initialized');
        },

        /**
         * Process next scan in queue
         */
        async processNext() {
            // Already processing
            if (this.processing) return;

            // Queue empty
            if (AL.capture.scanQueue.length === 0) {
                return;
            }

            // Only leader processes
            if (!AL.broadcast.isLeader) return;

            this.processing = true;

            // Dequeue
            const scanItem = AL.capture.scanQueue.shift();
            const { scanText, source, timestamp } = scanItem;

            console.log('[worker] Processing scan:', scanText);

            // Apply timeout
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            const timeoutPromise = new Promise((_, reject) => {
                this.currentScanTimeout = setTimeout(() => {
                    reject(new Error('Scan processing timeout'));
                }, settings.scanTimeout);
            });

            try {
                // Process the scan
                const processPromise = this.processScan(scanText, source, timestamp);
                await Promise.race([processPromise, timeoutPromise]);

                // Clear timeout
                if (this.currentScanTimeout) {
                    clearTimeout(this.currentScanTimeout);
                    this.currentScanTimeout = null;
                }

                console.log('[worker] Scan processed successfully');
            } catch (error) {
                console.error('[worker] Scan processing error:', error);

                // Clear timeout
                if (this.currentScanTimeout) {
                    clearTimeout(this.currentScanTimeout);
                    this.currentScanTimeout = null;
                }

                // Show error toast
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('Scan Error', error.message, 'error');
                }
            } finally {
                this.processing = false;

                // Process next item (throttled)
                if (AL.capture.scanQueue.length > 0) {
                    setTimeout(() => this.processNext(), settings.scanThrottle || 150);
                }
            }
        },

        /**
         * Process a single scan
         */
        async processScan(scanText, source, timestamp) {
            const result = {
                scanText,
                source,
                timestamp,
                success: false,
                matchedRule: null,
                actions: []
            };

            // Apply active prefix if any
            let processedScan = scanText;
            if (AL.prefixes.activePrefix) {
                processedScan = AL.prefixes.activePrefix.value + scanText;
                AL.prefixes.decrementSticky();
            }

            // Run through rules engine
            const matchResult = AL.rules.matchScan(processedScan);

            if (matchResult) {
                result.success = true;
                result.matchedRule = matchResult.rule;
                result.actions = matchResult.actions;

                // Execute actions
                for (const action of matchResult.actions) {
                    await AL.rules.executeAction(action, matchResult.variables);
                }

                // Speech
                if (matchResult.rule.speechLabel && AL.ui && AL.ui.speak) {
                    const last4 = AL.utils.getLastDigits(scanText, 4);
                    AL.ui.speak(matchResult.rule.speechLabel + ' ' + last4);
                }

                // Update ticker
                if (AL.ui && AL.ui.updateTicker) {
                    AL.ui.updateTicker();
                }

                // Update tab title
                if (AL.tabTitle && AL.tabTitle.update) {
                    AL.tabTitle.update();
                }

                // Show success toast
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('Scan Processed', `Rule: ${matchResult.rule.name}`, 'success');
                }
            } else {
                // No matching rule
                result.success = false;

                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('No Match', `No rule matched: ${scanText}`, 'warning');
                }
            }

            // Store last scan
            AL.capture.lastScan = result;
            AL.capture.lastScanTime = timestamp;

            // Broadcast to followers
            AL.broadcast.broadcastScanResult(result);

            // Update UI
            if (AL.ui && AL.ui.updateStatus) {
                AL.ui.updateStatus();
            }

            return result;
        }
    };

    // ========================================
    // MODULE: INIT (ENTRYPOINT)
    // ========================================
    AL.init = function() {
        console.log('=== OCSD ArmoryLink Starting ===');

        // Initialize all modules in order
        try {
            AL.utils.init();
            AL.stubs.init();
            AL.persistence.init();
            AL.defaultsManager.init();
            AL.fields.init();
            AL.broadcast.init();
            AL.activeContext.init();
            AL.pageState.init();
            AL.capture.init();
            AL.worker.init();
            AL.rules.init();
            AL.prefixes.init();
            AL.macros.init();
            AL.exportManager.init();
            AL.bwc.init();
            AL.x10.init();
            AL.tabTitle.init();

            // Wait for body to be available before UI init
            AL.waitForBody();

            console.log('=== OCSD ArmoryLink Ready ===');
        } catch (error) {
            console.error('[init] Fatal error during initialization:', error);
        }
    };

    /**
     * Wait for body to be available, then initialize UI
     */
    AL.waitForBody = function(retries = 0) {
        if (document.body) {
            // Body is ready, initialize UI
            try {
                AL.ui.init();
                AL.elements.init();

                // Start context monitoring
                if (AL.activeContext.startMonitoring) {
                    AL.activeContext.startMonitoring();
                }

                // Refresh active page to load initial state (delayed and safe)
                setTimeout(() => {
                    if (AL.pageState && AL.pageState.refreshActivePage) {
                        AL.pageState.refreshActivePage().catch(err => {
                            console.error('[init] Error in refreshActivePage:', err);
                        });
                    }
                }, 500);

                console.log('[init] UI initialized successfully');
            } catch (error) {
                console.error('[init] UI initialization error:', error);

                // Retry if UI init failed
                if (retries < 3) {
                    console.log('[init] Retrying UI init in 1 second...');
                    setTimeout(() => AL.waitForBody(retries + 1), 1000);
                }
            }
        } else {
            // Body not ready yet, wait
            if (retries < 10) {
                setTimeout(() => AL.waitForBody(retries + 1), 200);
            } else {
                console.error('[init] Timeout waiting for document.body');
            }
        }
    };

    /**
     * Robust initialization with MutationObserver fallback
     */
    AL.robustInit = function() {
        // Primary init
        AL.init();

        // Fallback: Use MutationObserver to ensure panel eventually loads
        if (!document.body) {
            const observer = new MutationObserver((mutations, obs) => {
                if (document.body) {
                    obs.disconnect();
                    console.log('[init] Body detected via MutationObserver');
                    AL.waitForBody();
                }
            });

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                observer.disconnect();
            }, 10000);
        }
    };

    // ========================================
    // BOOTSTRAP
    // ========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', AL.robustInit);
    } else {
        // Document already loaded
        AL.robustInit();
    }

})();
