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
         * Query selector that pierces shadow DOM boundaries
         */
        querySelectorDeep(selector, root = document) {
            if (!selector) return null;

            try {
                // First try normal query
                let element = root.querySelector(selector);
                if (element) return element;

                // If not found, recursively search shadow roots
                const allElements = root.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.shadowRoot) {
                        element = this.querySelectorDeep(selector, el.shadowRoot);
                        if (element) return element;
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

                // Recursively search shadow roots
                const allElements = root.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.shadowRoot) {
                        const shadowResults = this.querySelectorAllDeep(selector, el.shadowRoot);
                        results.push(...shadowResults);
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
            if (!fullName) return { first: '', last: '', lastUpper: 'NO USER' };

            const trimmed = fullName.trim();

            // Check for "Last, First" format
            if (trimmed.includes(',')) {
                const parts = trimmed.split(',').map(p => p.trim());
                return {
                    first: parts[1] || '',
                    last: parts[0] || '',
                    lastUpper: (parts[0] || 'NO USER').toUpperCase()
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
                topGap: 0,
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

            // Set up keyboard listener for scanner input
            document.addEventListener('keydown', this.handleKeydown.bind(this));

            console.log('[capture] Initialized, mode:', this.mode);
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
        toast: null,
        stripLauncher: null,

        init() {
            this.loadSettings();
            this.injectStyles();
            this.createPanel();
            this.createTicker();
            console.log('[ui] Initialized');
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
                    bottom: 0;
                    width: 400px;
                }
                #al-panel.dock-right {
                    right: 0;
                    top: 0;
                    bottom: 0;
                    width: 400px;
                }
                #al-panel.dock-bottom {
                    left: 0;
                    right: 0;
                    bottom: 0;
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
                }

                /* Ticker */
                #al-ticker {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    background: #2a2a2a;
                    color: #e0e0e0;
                    padding: 6px 12px;
                    font-size: 12px;
                    z-index: 999998;
                    border-bottom: 1px solid #444;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
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
            `);
        },

        /**
         * Create main panel
         */
        createPanel() {
            this.panel = document.createElement('div');
            this.panel.id = 'al-panel';
            this.panel.className = this.dockMode;

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

            // Render current tab
            this.renderTab(this.currentTab);
        },

        /**
         * Create ticker
         */
        createTicker() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            if (!settings.tickerEnabled) return;

            this.ticker = document.createElement('div');
            this.ticker.id = 'al-ticker';
            document.body.appendChild(this.ticker);

            this.updateTicker();
        },

        /**
         * Update ticker
         */
        updateTicker() {
            if (!this.ticker) return;

            const mode = AL.capture.getModeLabel();
            const leader = AL.broadcast.isLeader ? 'Leader' : 'Follower';
            const typeValue = AL.fields.getFieldValue('type') || 'N/A';
            const userValue = AL.fields.getFieldValue('user') || 'N/A';
            const prefixText = AL.prefixes.activePrefix ? `Prefix: ${AL.prefixes.activePrefix.label} (${AL.prefixes.activeStickyCount})` : '';

            this.ticker.innerHTML = `
                <span>Mode: ${mode}</span>
                <span>Role: ${leader}</span>
                <span>Type: ${typeValue}</span>
                <span>User: ${userValue}</span>
                ${prefixText ? `<span style="color: #ff9800;">${prefixText}</span>` : ''}
            `;
        },

        /**
         * Show toast notification
         */
        showToast(title, message, level = 'info', duration = 3000) {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            const position = settings.toastPosition || 'top-right';

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

                case 'settings':
                    this.renderSettings(content);
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
                            <option value="top-right" ${settings.toastPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                            <option value="bottom-left" ${settings.toastPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
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

            // Layout settings - auto-save on change
            document.getElementById('al-setting-dock-mode').onchange = autoSave;
            document.getElementById('al-setting-panel-width').onchange = autoSave;
            document.getElementById('al-setting-panel-height').onchange = autoSave;

            // Capture settings - auto-save on change
            document.getElementById('al-setting-scan-throttle').onchange = autoSave;
            document.getElementById('al-setting-duplicate-window').onchange = autoSave;
            document.getElementById('al-setting-scan-timeout').onchange = autoSave;

            // Toast settings - auto-save on change
            document.getElementById('al-setting-toast-position').onchange = autoSave;
            document.getElementById('al-setting-toast-duration').onchange = autoSave;
            document.getElementById('al-setting-toast-sticky').onchange = autoSave;

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
         * Save settings from form
         */
        saveSettingsFromForm(silent = false) {
            const settings = {
                // Layout
                dockMode: document.getElementById('al-setting-dock-mode').value,
                panelWidth: parseInt(document.getElementById('al-setting-panel-width').value),
                panelHeight: parseInt(document.getElementById('al-setting-panel-height').value),
                topGap: 0,

                // Capture
                captureMode: AL.capture.mode,
                scanThrottle: parseInt(document.getElementById('al-setting-scan-throttle').value),
                duplicateWindow: parseInt(document.getElementById('al-setting-duplicate-window').value),
                scanTimeout: parseInt(document.getElementById('al-setting-scan-timeout').value),

                // Toast
                toastPosition: document.getElementById('al-setting-toast-position').value,
                toastDuration: parseInt(document.getElementById('al-setting-toast-duration').value),
                toastSticky: document.getElementById('al-setting-toast-sticky').checked,
                toastSound: false,

                // Speech
                speechEnabled: document.getElementById('al-setting-speech-enabled').checked,
                speechRate: parseFloat(document.getElementById('al-setting-speech-rate').value),
                speechPitch: parseFloat(document.getElementById('al-setting-speech-pitch').value),

                // Ticker
                tickerEnabled: document.getElementById('al-setting-ticker-enabled').checked,

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

            // Apply dock mode change
            if (this.panel) {
                this.panel.className = settings.dockMode;
            }

            // Apply ticker visibility
            if (settings.tickerEnabled && !this.ticker) {
                this.createTicker();
            } else if (!settings.tickerEnabled && this.ticker) {
                this.ticker.remove();
                this.ticker = null;
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
         * Show add action dialog
         */
        showAddActionDialog() {
            const actionType = prompt('Select action type:\n\n1. setField - Set a field value\n2. setType - Set the Type field\n3. toast - Show toast notification\n4. speech - Speak text\n\nEnter number (1-4):');

            if (!actionType) return;

            let action = null;

            switch (actionType) {
                case '1': // setField
                    const fieldKey = prompt('Enter field key (e.g., user, external_contact, department):');
                    if (!fieldKey) return;
                    const fieldValue = prompt('Enter field value (use ${group1}, ${group2}, ${directive}, etc.):');
                    if (fieldValue === null) return;
                    action = { type: 'setField', field: fieldKey, value: fieldValue };
                    break;

                case '2': // setType
                    const typeValue = prompt('Enter Type value (use ${directive} for dynamic value):');
                    if (typeValue === null) return;
                    action = { type: 'setType', value: typeValue };
                    break;

                case '3': // toast
                    const toastMsg = prompt('Enter toast message:');
                    if (!toastMsg) return;
                    action = { type: 'toast', title: 'Notification', message: toastMsg, level: 'info' };
                    break;

                case '4': // speech
                    const speechText = prompt('Enter speech text:');
                    if (!speechText) return;
                    action = { type: 'speech', text: speechText };
                    break;

                default:
                    this.showToast('Invalid Action', 'Unknown action type', 'error');
                    return;
            }

            // Get current actions from modal state
            const actionsListEl = document.getElementById('al-rule-actions-list');
            const currentActions = this._modalActions || [];
            currentActions.push(action);
            this._modalActions = currentActions;
            this.renderRuleActions(currentActions);
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
                this.panel.style.display = this.panel.style.display === 'none' ? 'flex' : 'none';
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
         */
        setFieldValue(key, value) {
            const field = this.getField(key);
            if (!field || !field.enabled) {
                console.warn('[fields] Field not found or disabled:', key);
                return false;
            }

            const element = AL.utils.findElement(field.selector, field.selectorPath);
            if (!element) {
                console.warn('[fields] Element not found for field:', key, field.selector);
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
         */
        getFieldValue(key) {
            const field = this.getField(key);
            if (!field) return null;

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
                console.error('[fields] Error getting field:', key, error);
                return null;
            }
        },

        /**
         * Test field (highlight and scroll into view)
         */
        testField(key) {
            const field = this.getField(key);
            if (!field) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('Test Failed', 'Field not found', 'error');
                }
                return false;
            }

            const element = AL.utils.findElement(field.selector, field.selectorPath);
            if (!element) {
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('Test Failed', `Element not found: ${field.selector}`, 'error');
                }
                return false;
            }

            // Highlight element
            AL.utils.highlightElement(element);

            if (AL.ui && AL.ui.showToast) {
                AL.ui.showToast('Test Success', `Found: ${field.label}`, 'success');
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
        mode: 'tab', // 'iframe' or 'tab'

        init() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            this.bwcUrl = settings.bwcUrl || this.bwcUrl;
            this.mode = settings.bwcMode || this.mode;
            console.log('[bwc] Initialized, mode:', this.mode);
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

            const url = `${this.bwcUrl}?pid=${encodeURIComponent(pid)}&serial=${encodeURIComponent(serial || '')}`;

            console.log('[bwc] Launching:', url);

            if (this.mode === 'iframe') {
                // Create iframe modal (simplified - full implementation would be more complex)
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('BWC Launch', 'Opening in new tab (iframe mode not fully implemented)', 'info');
                }
                window.open(url, '_blank');
            } else {
                // Open in new tab
                window.open(url, '_blank');
            }

            if (AL.ui && AL.ui.showToast) {
                AL.ui.showToast('BWC Launched', `PID: ${pid}`, 'success');
            }

            return true;
        }
    };

    // ========================================
    // MODULE: X10
    // ========================================
    AL.x10 = {
        // X10 helper - PID extraction, iframe/tab launching, site navigation
        x10Url: 'https://buy.taser.com', // Placeholder - user will configure
        mode: 'tab', // 'iframe' or 'tab'

        init() {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            this.x10Url = settings.x10Url || this.x10Url;
            this.mode = settings.x10Mode || this.mode;
            console.log('[x10] Initialized, mode:', this.mode);
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

            const url = `${this.x10Url}?pid=${encodeURIComponent(pid)}&serial=${encodeURIComponent(serial || '')}`;

            console.log('[x10] Launching:', url);

            if (this.mode === 'iframe') {
                // Create iframe modal (simplified - full implementation would be more complex)
                if (AL.ui && AL.ui.showToast) {
                    AL.ui.showToast('X10 Launch', 'Opening in new tab (iframe mode not fully implemented)', 'info');
                }
                window.open(url, '_blank');
            } else {
                // Open in new tab
                window.open(url, '_blank');
            }

            if (AL.ui && AL.ui.showToast) {
                AL.ui.showToast('X10 Launched', `PID: ${pid}`, 'success');
            }

            return true;
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
    // MODULE: TAB_TITLE
    // ========================================
    AL.tabTitle = {
        // ServiceNow workspace tab label formatting (TYPE_ICON | LASTNAME)
        originalTitle: null,
        originalTooltip: null,
        typeIcons: {
            'Deployment': '🟢',
            'Return': '🟡',
            'default': '⚙️'
        },

        init() {
            // Store original tab label text
            const tabLabel = this.getTabLabelElement();
            if (tabLabel) {
                this.originalTitle = tabLabel.textContent;
                this.originalTooltip = tabLabel.getAttribute('data-tooltip');
            }
            this.update();
            this.startMonitoring();
            console.log('[tabTitle] Initialized');
        },

        /**
         * Start monitoring field changes for automatic updates
         */
        startMonitoring() {
            // Monitor Type and User fields for changes
            const monitorField = (fieldKey) => {
                const field = AL.fields.getField(fieldKey);
                if (!field) return;

                const element = AL.utils.findElement(field.selector, field.selectorPath);
                if (!element) return;

                // For Type field (combobox in shadow DOM), monitor the button text changes
                if (fieldKey === 'type' && element.getAttribute('role') === 'combobox') {
                    // Create a MutationObserver to watch for text changes in the combobox
                    const observer = new MutationObserver(() => {
                        console.log('[tabTitle] Type field changed, updating...');
                        this.update();
                        if (AL.ui && AL.ui.updateTicker) {
                            AL.ui.updateTicker();
                        }
                    });

                    observer.observe(element, {
                        childList: true,
                        subtree: true,
                        characterData: true
                    });

                    console.log('[tabTitle] Monitoring Type field for changes');
                    return;
                }

                // For regular input fields, listen to change and input events
                if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
                    element.addEventListener('change', () => {
                        console.log(`[tabTitle] ${fieldKey} field changed, updating...`);
                        this.update();
                        if (AL.ui && AL.ui.updateTicker) {
                            AL.ui.updateTicker();
                        }
                    });

                    element.addEventListener('input', () => {
                        console.log(`[tabTitle] ${fieldKey} field input, updating...`);
                        this.update();
                        if (AL.ui && AL.ui.updateTicker) {
                            AL.ui.updateTicker();
                        }
                    });

                    console.log(`[tabTitle] Monitoring ${fieldKey} field for changes`);
                }
            };

            // Monitor key fields
            monitorField('type');
            monitorField('user');

            // Also set up a periodic update every 2 seconds as a backup
            setInterval(() => {
                this.update();
                if (AL.ui && AL.ui.updateTicker) {
                    AL.ui.updateTicker();
                }
            }, 2000);

            console.log('[tabTitle] Field monitoring started');
        },

        /**
         * Get ServiceNow workspace tab label element
         */
        getTabLabelElement() {
            // Try to find the SELECTED/ACTIVE tab label in ServiceNow Workspace
            // The selected tab has class "is-selected"
            let tabLabel = AL.utils.querySelectorDeep('.sn-chrome-one-tab.is-selected .sn-chrome-one-tab-label');

            // Fallback: try to find tab with aria-selected="true"
            if (!tabLabel) {
                tabLabel = AL.utils.querySelectorDeep('[aria-selected="true"] .sn-chrome-one-tab-label');
            }

            // Fallback: try to find focused tab
            if (!tabLabel) {
                tabLabel = AL.utils.querySelectorDeep('.sn-chrome-one-tab.focused .sn-chrome-one-tab-label');
            }

            // Last resort: try standard query selector for selected tab
            if (!tabLabel) {
                tabLabel = document.querySelector('.sn-chrome-one-tab.is-selected .sn-chrome-one-tab-label');
            }

            return tabLabel;
        },

        /**
         * Update ServiceNow workspace tab label
         */
        update() {
            const tabLabel = this.getTabLabelElement();
            if (!tabLabel) {
                console.warn('[tabTitle] Could not find ServiceNow tab label element');
                return;
            }

            const typeValue = AL.fields.getFieldValue('type');
            const userValue = AL.fields.getFieldValue('user');

            // Get icon
            const icon = this.typeIcons[typeValue] || this.typeIcons['default'];

            // Get last name
            let lastName = 'NO USER';
            if (userValue) {
                const parsed = AL.utils.parseName(userValue);
                lastName = parsed.lastUpper;
            }

            // Format title
            const newTitle = `${icon} | ${lastName}`;

            // Update the tab label text
            tabLabel.textContent = newTitle;

            // Update the tooltip as well
            tabLabel.setAttribute('data-tooltip', newTitle);

            console.log('[tabTitle] Updated tab label to:', newTitle);
        },

        /**
         * Reset to original title
         */
        reset() {
            const tabLabel = this.getTabLabelElement();
            if (tabLabel && this.originalTitle) {
                tabLabel.textContent = this.originalTitle;
                if (this.originalTooltip) {
                    tabLabel.setAttribute('data-tooltip', this.originalTooltip);
                }
            }
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
            // Fields
            if (!AL.persistence.get('fields')) {
                AL.persistence.set('fields', AL.stubs.getDefaultFields());
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
