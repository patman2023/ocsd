// ==UserScript==
// @name         OCSD ArmoryLink
// @namespace    https://ocsheriff.servicenowservices.com/
// @version      0.0.1
// @description  OCSD ArmoryLink Utility
// @match        https://ocsheriff.servicenowservices.com/x/g/loaner-workspace/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// ==/UserScript==

// >>> MODULE: utils START

const ThemeEngine = (() => {
    // OCSD Official Colors
    const SHERIFF_GREEN = '#2C5234';
    const CALIFORNIA_GOLD = '#B19A55';

    // Theme definitions
    const themes = {
        ocsd: {
            id: 'ocsd',
            name: 'OCSD Official',
            colors: {
                primary: SHERIFF_GREEN,
                primaryDark: '#1e3924',
                primaryLight: '#3b6c43',
                secondary: CALIFORNIA_GOLD,
                secondaryDark: '#8f7a42',
                secondaryLight: '#c9b576',
                background: '#ffffff',
                surface: '#f5f5f5',
                surfaceDark: '#e0e0e0',
                text: '#212121',
                textLight: '#757575',
                textInverse: '#ffffff',
                border: '#cccccc',
                borderLight: '#e0e0e0',
                error: '#d32f2f',
                warning: '#f57c00',
                success: '#388e3c',
                info: '#1976d2'
            },
            fonts: {
                primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                monospace: '"Courier New", Consolas, Monaco, monospace'
            },
            spacing: {
                xs: '4px',
                sm: '8px',
                md: '16px',
                lg: '24px',
                xl: '32px'
            },
            shadows: {
                sm: '0 1px 3px rgba(0,0,0,0.12)',
                md: '0 4px 12px rgba(0,0,0,0.15)',
                lg: '0 8px 24px rgba(0,0,0,0.2)'
            },
            radii: {
                sm: '4px',
                md: '8px',
                lg: '12px',
                full: '9999px'
            }
        }
    };

    let activeTheme = themes.ocsd;

    /**
     * Get current theme
     */
    function getTheme() {
        return { ...activeTheme };
    }

    /**
     * Get a specific color from the current theme
     */
    function getColor(key) {
        return activeTheme.colors[key] || '#000000';
    }

    /**
     * Get all available themes
     */
    function getThemes() {
        return Object.values(themes).map(t => ({ id: t.id, name: t.name }));
    }

    /**
     * Set active theme by ID
     */
    function setTheme(themeId) {
        if (themes[themeId]) {
            activeTheme = themes[themeId];
            return true;
        }
        return false;
    }

    /**
     * Generate CSS variable declarations for current theme
     */
    function getCSSVariables() {
        const vars = [];

        // Colors
        Object.entries(activeTheme.colors).forEach(([key, value]) => {
            vars.push(`--ocsd-color-${key}: ${value};`);
        });

        // Spacing
        Object.entries(activeTheme.spacing).forEach(([key, value]) => {
            vars.push(`--ocsd-space-${key}: ${value};`);
        });

        // Shadows
        Object.entries(activeTheme.shadows).forEach(([key, value]) => {
            vars.push(`--ocsd-shadow-${key}: ${value};`);
        });

        // Radii
        Object.entries(activeTheme.radii).forEach(([key, value]) => {
            vars.push(`--ocsd-radius-${key}: ${value};`);
        });

        // Fonts
        vars.push(`--ocsd-font-primary: ${activeTheme.fonts.primary};`);
        vars.push(`--ocsd-font-monospace: ${activeTheme.fonts.monospace};`);

        return `:root {\n  ${vars.join('\n  ')}\n}`;
    }

    /**
     * Inject theme CSS variables into the document
     */
    function injectThemeStyles() {
        const styleId = 'ocsd-theme-variables';
        let styleEl = document.getElementById(styleId);

        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = getCSSVariables();
    }

    return {
        getTheme,
        getColor,
        getThemes,
        setTheme,
        getCSSVariables,
        injectThemeStyles,
        // Expose constants
        SHERIFF_GREEN,
        CALIFORNIA_GOLD
    };
})();

const LayoutEngine = (() => {
    // Layout modes
    const LAYOUTS = {
        DOCK_RIGHT: 'dock-right',
        LEFT_STRIP: 'left-strip',
        DOCK_BOTTOM: 'dock-bottom',
        FLOAT: 'float'
    };

    let currentLayout = LAYOUTS.DOCK_RIGHT;
    let panelElement = null;

    /**
     * Get layout configurations
     */
    function getLayoutConfig(layout) {
        const configs = {
            [LAYOUTS.DOCK_RIGHT]: {
                position: 'fixed',
                top: '0',
                right: '0',
                bottom: '0',
                left: 'auto',
                width: '400px',
                height: '100vh',
                maxHeight: '100vh',
                transform: 'none',
                borderRadius: '0',
                boxShadow: '-2px 0 8px rgba(0,0,0,0.1)'
            },
            [LAYOUTS.LEFT_STRIP]: {
                position: 'fixed',
                top: '0',
                left: '0',
                bottom: '0',
                right: 'auto',
                width: '80px',
                height: '100vh',
                maxHeight: '100vh',
                transform: 'none',
                borderRadius: '0',
                boxShadow: '2px 0 8px rgba(0,0,0,0.1)'
            },
            [LAYOUTS.DOCK_BOTTOM]: {
                position: 'fixed',
                bottom: '0',
                left: '0',
                right: '0',
                top: 'auto',
                width: '100vw',
                height: '300px',
                maxHeight: '300px',
                transform: 'none',
                borderRadius: '0',
                boxShadow: '0 -2px 8px rgba(0,0,0,0.1)'
            },
            [LAYOUTS.FLOAT]: {
                position: 'fixed',
                top: '50%',
                left: '50%',
                bottom: 'auto',
                right: 'auto',
                width: '600px',
                height: 'auto',
                maxHeight: '80vh',
                transform: 'translate(-50%, -50%)',
                borderRadius: '8px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.2)'
            }
        };

        return configs[layout] || configs[LAYOUTS.DOCK_RIGHT];
    }

    /**
     * Apply layout to panel element
     */
    function applyLayout(layout, element) {
        if (!element) return false;

        if (!Object.values(LAYOUTS).includes(layout)) {
            console.warn('[LayoutEngine] Invalid layout:', layout);
            return false;
        }

        const config = getLayoutConfig(layout);

        // Apply styles
        Object.entries(config).forEach(([property, value]) => {
            element.style[property] = value;
        });

        // Update data attribute
        element.setAttribute('data-layout', layout);

        currentLayout = layout;

        // Broadcast layout change
        if (window.OCSDArmoryLink?.broadcast) {
            window.OCSDArmoryLink.broadcast.send('layout:changed', { layout });
        }

        return true;
    }

    /**
     * Set current layout
     */
    function setLayout(layout) {
        if (panelElement) {
            return applyLayout(layout, panelElement);
        }
        currentLayout = layout;
        return true;
    }

    /**
     * Get current layout
     */
    function getLayout() {
        return currentLayout;
    }

    /**
     * Cycle to next layout
     */
    function cycleLayout() {
        const layoutsArray = Object.values(LAYOUTS);
        const currentIndex = layoutsArray.indexOf(currentLayout);
        const nextIndex = (currentIndex + 1) % layoutsArray.length;
        const nextLayout = layoutsArray[nextIndex];

        setLayout(nextLayout);

        if (window.OCSDArmoryLink?.stubs?.toast) {
            const layoutNames = {
                [LAYOUTS.DOCK_RIGHT]: 'Dock Right',
                [LAYOUTS.LEFT_STRIP]: 'Left Strip',
                [LAYOUTS.DOCK_BOTTOM]: 'Dock Bottom',
                [LAYOUTS.FLOAT]: 'Float'
            };
            window.OCSDArmoryLink.stubs.toast(
                `Layout: ${layoutNames[nextLayout]}`,
                'info',
                { duration: 1500 }
            );
        }

        return nextLayout;
    }

    /**
     * Register panel element
     */
    function registerPanel(element) {
        panelElement = element;
        if (currentLayout) {
            applyLayout(currentLayout, element);
        }
    }

    /**
     * Get all available layouts
     */
    function getAvailableLayouts() {
        return Object.values(LAYOUTS).map(layout => ({
            id: layout,
            name: layout.split('-').map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ')
        }));
    }

    return {
        LAYOUTS,
        setLayout,
        getLayout,
        cycleLayout,
        registerPanel,
        getAvailableLayouts,
        applyLayout
    };
})();

const TickerUI = (() => {
    let tickerElement = null;
    let updateInterval = null;
    let enabled = false;
    const UPDATE_INTERVAL = 1000; // 1 second

    /**
     * Create ticker element
     */
    function createTicker() {
        if (tickerElement) return tickerElement;

        tickerElement = document.createElement('div');
        tickerElement.id = 'ocsd-ticker';
        tickerElement.className = 'ocsd-ticker';
        tickerElement.style.cssText = `
            position: fixed;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            background: var(--ocsd-color-primary, #2C5234);
            color: var(--ocsd-color-textInverse, #ffffff);
            padding: 8px 16px;
            border-radius: 0 0 8px 8px;
            box-shadow: var(--ocsd-shadow-md, 0 4px 12px rgba(0,0,0,0.15));
            z-index: 999998;
            font-family: var(--ocsd-font-primary);
            font-size: 13px;
            display: none;
            gap: 16px;
            align-items: center;
        `;

        document.body.appendChild(tickerElement);
        return tickerElement;
    }

    /**
     * Update ticker content
     */
    function update() {
        if (!enabled || !tickerElement) return;

        const fields = window.OCSDArmoryLink?.fields;
        if (!fields) return;

        const tickerFields = fields.forRole('ticker');
        const items = [];

        tickerFields.forEach(field => {
            const value = fields.read(field.key);
            if (value && value.trim()) {
                items.push(`<span class="ocsd-ticker-item">
                    <strong>${field.label}:</strong> ${value}
                </span>`);
            }
        });

        if (items.length > 0) {
            tickerElement.innerHTML = items.join('');
            tickerElement.style.display = 'flex';
        } else {
            tickerElement.style.display = 'none';
        }
    }

    /**
     * Show ticker
     */
    function show() {
        if (!tickerElement) {
            createTicker();
        }

        enabled = true;
        update();

        // Start auto-update
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        updateInterval = setInterval(update, UPDATE_INTERVAL);
    }

    /**
     * Hide ticker
     */
    function hide() {
        enabled = false;
        if (tickerElement) {
            tickerElement.style.display = 'none';
        }
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
    }

    /**
     * Toggle ticker visibility
     */
    function toggle() {
        if (enabled) {
            hide();
        } else {
            show();
        }
        return enabled;
    }

    /**
     * Check if ticker is enabled
     */
    function isEnabled() {
        return enabled;
    }

    /**
     * Inject ticker styles
     */
    function injectStyles() {
        const css = `
            .ocsd-ticker {
                pointer-events: auto;
            }

            .ocsd-ticker-item {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                white-space: nowrap;
            }

            .ocsd-ticker-item strong {
                font-weight: 600;
                opacity: 0.9;
            }

            .ocsd-ticker-item + .ocsd-ticker-item {
                margin-left: 16px;
                padding-left: 16px;
                border-left: 1px solid rgba(255,255,255,0.3);
            }
        `;

        GM_addStyle(css);
    }

    /**
     * Initialize ticker
     */
    function init() {
        injectStyles();
        createTicker();

        // Listen for field changes
        window.addEventListener('capture:processed', () => {
            if (enabled) {
                update();
            }
        });
    }

    return {
        init,
        show,
        hide,
        toggle,
        update,
        isEnabled
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.theme = ThemeEngine;
    window.OCSDArmoryLink.layout = LayoutEngine;
    window.OCSDArmoryLink.ticker = TickerUI;
}

// <<< MODULE: utils END

// >>> MODULE: stubs START

const StubsModule = (() => {
    /**
     * Debug Logger System with log storage
     */
    const DebugLogger = (() => {
        const MAX_LOGS = 1000;
        let logs = [];
        let logIdCounter = 0;
        let enabled = true;

        /**
         * Add log entry
         */
        function addLog(level, source, message, data = {}) {
            const logEntry = {
                id: ++logIdCounter,
                level,
                source,
                message,
                data,
                timestamp: Date.now(),
                timestampISO: new Date().toISOString()
            };

            logs.push(logEntry);

            // Trim if exceeds max
            if (logs.length > MAX_LOGS) {
                logs = logs.slice(-MAX_LOGS);
            }

            return logEntry;
        }

        /**
         * Get all logs
         */
        function getLogs(options = {}) {
            const {
                level = null,
                source = null,
                search = null,
                limit = null
            } = options;

            let filtered = [...logs];

            // Filter by level
            if (level) {
                filtered = filtered.filter(log => log.level === level);
            }

            // Filter by source
            if (source) {
                filtered = filtered.filter(log => log.source === source);
            }

            // Search in message
            if (search) {
                const searchLower = search.toLowerCase();
                filtered = filtered.filter(log =>
                    log.message.toLowerCase().includes(searchLower) ||
                    log.source.toLowerCase().includes(searchLower)
                );
            }

            // Apply limit
            if (limit && limit > 0) {
                filtered = filtered.slice(-limit);
            }

            return filtered;
        }

        /**
         * Clear all logs
         */
        function clearLogs() {
            logs = [];
            logIdCounter = 0;
        }

        /**
         * Get unique sources
         */
        function getSources() {
            const sources = new Set(logs.map(log => log.source));
            return Array.from(sources).sort();
        }

        /**
         * Export logs to JSON
         */
        function exportLogs() {
            return {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                totalLogs: logs.length,
                logs: logs
            };
        }

        /**
         * Enable/disable logging
         */
        function setEnabled(state) {
            enabled = state;
        }

        /**
         * Check if enabled
         */
        function isEnabled() {
            return enabled;
        }

        return {
            addLog,
            getLogs,
            clearLogs,
            getSources,
            exportLogs,
            setEnabled,
            isEnabled
        };
    })();

    /**
     * Debug log function
     * @param {string} level - Log level: "info", "warn", or "error"
     * @param {string} source - Module or source identifier
     * @param {string} message - Log message
     * @param {any} data - Optional data object
     */
    function debugLog(level, source, message, data = {}) {
        const timestamp = new Date().toISOString();
        const prefix = `[ArmoryLink][${timestamp}][${source}]`;

        // Add to debug logger
        DebugLogger.addLog(level, source, message, data);

        // Console output
        if (DebugLogger.isEnabled()) {
            switch (level) {
                case 'info':
                    console.info(prefix, message, data);
                    break;
                case 'warn':
                    console.warn(prefix, message, data);
                    break;
                case 'error':
                    console.error(prefix, message, data);
                    break;
                default:
                    console.log(prefix, message, data);
            }
        }
    }

    /**
     * Toast notification system
     */
    const ToastSystem = (() => {
        let container = null;
        let toastCounter = 0;

        // Default configuration
        const defaultConfig = {
            duration: 3000,
            position: 'bottom-right',
            dismissible: true,
            pauseOnHover: true,
            showProgress: true,
            maxToasts: 5,
            animation: 'slide',
            sound: false
        };

        let config = { ...defaultConfig };

        /**
         * Initialize toast container
         */
        function initContainer() {
            if (container) return;

            container = document.createElement('div');
            container.id = 'ocsd-toast-container';
            container.className = `ocsd-toast-container ${config.position}`;
            document.body.appendChild(container);

            // Inject toast styles
            injectToastStyles();
        }

        /**
         * Inject toast CSS
         */
        function injectToastStyles() {
            const css = `
                .ocsd-toast-container {
                    position: fixed;
                    z-index: 999999;
                    pointer-events: none;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-width: 400px;
                }

                .ocsd-toast-container.top-left { top: 20px; left: 20px; }
                .ocsd-toast-container.top-center { top: 20px; left: 50%; transform: translateX(-50%); }
                .ocsd-toast-container.top-right { top: 20px; right: 20px; }
                .ocsd-toast-container.bottom-left { bottom: 20px; left: 20px; }
                .ocsd-toast-container.bottom-center { bottom: 20px; left: 50%; transform: translateX(-50%); }
                .ocsd-toast-container.bottom-right { bottom: 20px; right: 20px; }

                .ocsd-toast {
                    pointer-events: auto;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    padding: 12px 16px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    min-width: 250px;
                    max-width: 400px;
                    position: relative;
                    overflow: hidden;
                    opacity: 0;
                    transform: translateY(20px);
                    animation: ocsd-toast-slide-in 0.3s forwards;
                }

                .ocsd-toast.removing {
                    animation: ocsd-toast-slide-out 0.3s forwards;
                }

                @keyframes ocsd-toast-slide-in {
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                @keyframes ocsd-toast-slide-out {
                    to {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                }

                .ocsd-toast-icon {
                    font-size: 20px;
                    flex-shrink: 0;
                }

                .ocsd-toast-content {
                    flex: 1;
                    font-size: 14px;
                    line-height: 1.4;
                    color: #333;
                }

                .ocsd-toast-close {
                    background: none;
                    border: none;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #999;
                    flex-shrink: 0;
                }

                .ocsd-toast-close:hover {
                    color: #333;
                }

                .ocsd-toast-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    height: 3px;
                    background: currentColor;
                    opacity: 0.3;
                    transition: width linear;
                }

                .ocsd-toast.info { border-left: 4px solid #1976d2; }
                .ocsd-toast.info .ocsd-toast-progress { color: #1976d2; }
                .ocsd-toast.success { border-left: 4px solid #388e3c; }
                .ocsd-toast.success .ocsd-toast-progress { color: #388e3c; }
                .ocsd-toast.warn { border-left: 4px solid #f57c00; }
                .ocsd-toast.warn .ocsd-toast-progress { color: #f57c00; }
                .ocsd-toast.error { border-left: 4px solid #d32f2f; }
                .ocsd-toast.error .ocsd-toast-progress { color: #d32f2f; }
            `;

            GM_addStyle(css);
        }

        /**
         * Show a toast notification
         */
        function show(message, type = 'info', options = {}) {
            initContainer();

            const opts = { ...config, ...options };
            const toastId = `toast-${++toastCounter}`;

            // Icons for each type
            const icons = {
                info: 'ℹ️',
                success: '✓',
                warn: '⚠️',
                error: '❌'
            };

            // Create toast element
            const toast = document.createElement('div');
            toast.id = toastId;
            toast.className = `ocsd-toast ${type}`;

            // Build toast HTML
            let html = `
                <div class="ocsd-toast-icon">${icons[type] || icons.info}</div>
                <div class="ocsd-toast-content">${message}</div>
            `;

            if (opts.dismissible) {
                html += `<button class="ocsd-toast-close" data-toast-id="${toastId}">×</button>`;
            }

            if (opts.showProgress && opts.duration > 0) {
                html += `<div class="ocsd-toast-progress"></div>`;
            }

            toast.innerHTML = html;

            // Enforce max toasts limit
            if (container.children.length >= opts.maxToasts) {
                const oldest = container.firstChild;
                if (oldest) removeToast(oldest);
            }

            container.appendChild(toast);

            // Set up dismissible button
            if (opts.dismissible) {
                const closeBtn = toast.querySelector('.ocsd-toast-close');
                closeBtn.addEventListener('click', () => removeToast(toast));
            }

            // Set up auto-dismiss
            let timeout;
            let progressBar;
            let startTime;

            if (opts.duration > 0) {
                progressBar = toast.querySelector('.ocsd-toast-progress');

                const startProgress = () => {
                    if (progressBar) {
                        startTime = Date.now();
                        progressBar.style.width = '100%';
                        progressBar.style.transition = `width ${opts.duration}ms linear`;
                        setTimeout(() => {
                            progressBar.style.width = '0%';
                        }, 10);
                    }

                    timeout = setTimeout(() => {
                        removeToast(toast);
                    }, opts.duration);
                };

                const pauseProgress = () => {
                    if (timeout) clearTimeout(timeout);
                    if (progressBar) {
                        const elapsed = Date.now() - startTime;
                        const remaining = Math.max(0, opts.duration - elapsed);
                        const percentRemaining = (remaining / opts.duration) * 100;
                        progressBar.style.transition = 'none';
                        progressBar.style.width = `${percentRemaining}%`;
                    }
                };

                const resumeProgress = () => {
                    if (progressBar) {
                        const currentWidth = parseFloat(progressBar.style.width || '0');
                        const remaining = (currentWidth / 100) * opts.duration;
                        progressBar.style.transition = `width ${remaining}ms linear`;
                        setTimeout(() => {
                            progressBar.style.width = '0%';
                        }, 10);

                        timeout = setTimeout(() => {
                            removeToast(toast);
                        }, remaining);
                    }
                };

                startProgress();

                if (opts.pauseOnHover) {
                    toast.addEventListener('mouseenter', pauseProgress);
                    toast.addEventListener('mouseleave', resumeProgress);
                }
            }

            // Console log for debugging
            console.log(`[TOAST][${type}] ${icons[type]} ${message}`);

            return toastId;
        }

        /**
         * Remove a toast element
         */
        function removeToast(toastElement) {
            if (!toastElement || !toastElement.parentNode) return;

            toastElement.classList.add('removing');
            setTimeout(() => {
                if (toastElement.parentNode) {
                    toastElement.parentNode.removeChild(toastElement);
                }
            }, 300);
        }

        /**
         * Configure toast system
         */
        function configure(newConfig) {
            Object.assign(config, newConfig);
        }

        /**
         * Get current configuration
         */
        function getConfig() {
            return { ...config };
        }

        /**
         * Clear all toasts
         */
        function clearAll() {
            if (container) {
                Array.from(container.children).forEach(toast => removeToast(toast));
            }
        }

        return {
            show,
            configure,
            getConfig,
            clearAll,
            // Convenience methods
            info: (msg, opts) => show(msg, 'info', opts),
            success: (msg, opts) => show(msg, 'success', opts),
            warn: (msg, opts) => show(msg, 'warn', opts),
            error: (msg, opts) => show(msg, 'error', opts)
        };
    })();

    /**
     * Show a toast notification (legacy API)
     * @param {string} message - Toast message
     * @param {string} type - Toast type: "info", "success", "warn", or "error"
     */
    function toast(message, type = 'info') {
        ToastSystem.show(message, type);
    }

    return {
        debugLog,
        toast,
        ToastSystem,
        DebugLogger
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.stubs = StubsModule;
}

// <<< MODULE: stubs END

// >>> MODULE: capture START

const CaptureModule = (() => {
    // Internal state
    let mode = 'standby'; // "on", "standby", or "off"
    let queue = [];
    let locked = false;
    let keyBuffer = '';
    let keyTimer = null;

    // Configuration
    const config = {
        throttleMs: 100,
        keyTimeout: 50,
        clearQueueOnOff: true,
        allowManualInOff: true,
        minScanLength: 3
    };

    /**
     * Debug log helper
     */
    function debugLog(level, source, message, data = {}) {
        if (window.OCSDArmoryLink?.stubs?.debugLog) {
            window.OCSDArmoryLink.stubs.debugLog(level, source, message, data);
        }
    }

    /**
     * Broadcast event helper
     */
    function broadcast(type, data) {
        const event = new CustomEvent(type, {
            detail: data,
            bubbles: true
        });
        window.dispatchEvent(event);
    }

    /**
     * Get current capture mode
     * @returns {string} Current mode: "on", "standby", or "off"
     */
    function getMode() {
        return mode;
    }

    /**
     * Set capture mode
     * @param {string} newMode - Mode to set: "on", "standby", or "off"
     */
    function setMode(newMode) {
        if (!['on', 'standby', 'off'].includes(newMode)) {
            debugLog('error', 'capture', 'Invalid capture mode', { mode: newMode });
            return;
        }

        const oldMode = mode;
        mode = newMode;

        switch (newMode) {
            case 'on':
                attachKeyboardListener();
                debugLog('info', 'capture', 'Capture mode set to ON');
                broadcast('capture:mode', { mode: 'on', previous: oldMode });
                // Start processing queue if items exist
                if (queue.length > 0) {
                    processNextFromQueue();
                }
                break;

            case 'standby':
                detachKeyboardListener();
                debugLog('info', 'capture', 'Capture mode set to STANDBY');
                broadcast('capture:mode', { mode: 'standby', previous: oldMode });
                break;

            case 'off':
                detachKeyboardListener();
                if (config.clearQueueOnOff) {
                    queue = [];
                    debugLog('info', 'capture', 'Queue cleared');
                }
                debugLog('info', 'capture', 'Capture mode set to OFF');
                broadcast('capture:mode', { mode: 'off', previous: oldMode });
                break;
        }
    }

    /**
     * Toggle capture mode to ON
     */
    function toggleOn() {
        setMode('on');
    }

    /**
     * Toggle capture mode to STANDBY
     */
    function toggleStandby() {
        setMode('standby');
    }

    /**
     * Toggle capture mode to OFF
     */
    function toggleOff() {
        setMode('off');
    }

    /**
     * Keyboard event handler
     */
    function handleKeydown(event) {
        // Don't capture if user is typing in an input field
        const target = event.target;
        if (target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable
        )) {
            return;
        }

        // Check for hotkeys: Alt+Shift+O/S/X
        if (event.altKey && event.shiftKey) {
            if (event.key === 'O' || event.key === 'o') {
                event.preventDefault();
                toggleOn();
                return;
            }
            if (event.key === 'S' || event.key === 's') {
                event.preventDefault();
                toggleStandby();
                return;
            }
            if (event.key === 'X' || event.key === 'x') {
                event.preventDefault();
                toggleOff();
                return;
            }
        }

        // Only capture if in "on" mode and is leader
        const leaderStatus = window.OCSDArmoryLink?.broadcast?.getLeaderStatus();
        const isLeader = leaderStatus ? leaderStatus.isLeader : true;

        if (mode !== 'on' || !isLeader) {
            return;
        }

        // Accumulate key input (scanner behavior)
        if (event.key === 'Enter') {
            // End of scan
            if (keyBuffer.length >= config.minScanLength) {
                enqueueScan(keyBuffer);
            }
            keyBuffer = '';
            clearTimeout(keyTimer);
        } else if (event.key.length === 1) {
            // Printable character
            keyBuffer += event.key;

            // Reset timeout
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => {
                // Timeout - treat as incomplete scan
                keyBuffer = '';
            }, config.keyTimeout);
        }
    }

    /**
     * Attach keyboard listener
     */
    function attachKeyboardListener() {
        document.addEventListener('keydown', handleKeydown, true);
        debugLog('info', 'capture', 'Keyboard listener attached');
    }

    /**
     * Detach keyboard listener
     */
    function detachKeyboardListener() {
        document.removeEventListener('keydown', handleKeydown, true);
        keyBuffer = '';
        clearTimeout(keyTimer);
        debugLog('info', 'capture', 'Keyboard listener detached');
    }

    /**
     * Enqueue a scan for processing
     * @param {string} scan - Scanned value
     */
    function enqueueScan(scan) {
        if (!scan || typeof scan !== 'string') {
            return;
        }

        // Log symbol directive hints
        const firstChar = scan.charAt(0);
        let directiveHint = null;
        if (firstChar === '/') directiveHint = 'Return';
        if (firstChar === '*') directiveHint = 'Deployment';

        if (directiveHint) {
            debugLog('info', 'capture', `Captured scan with directive symbol: ${firstChar} → ${directiveHint}`, { scan });
        } else {
            debugLog('info', 'capture', 'Captured scan', { scan });
        }

        queue.push(scan);
        broadcast('capture:enqueued', { scan, queueLength: queue.length });

        // Start processing if not locked and in "on" mode
        if (!locked && mode === 'on') {
            processNextFromQueue();
        }
    }

    /**
     * Process the next scan from the queue
     */
    async function processNextFromQueue() {
        if (!queue.length || locked || mode !== 'on') {
            return;
        }

        locked = true;

        try {
            let scan = queue.shift();
            debugLog('info', 'capture', 'Processing scan from queue', { scan, remaining: queue.length });

            // Apply active prefix if configured
            const prefixes = window.OCSDArmoryLink?.prefixes;
            if (prefixes && typeof prefixes.getActive === 'function') {
                const active = prefixes.getActive();
                if (active && active.value) {
                    const originalScan = scan;
                    scan = String(active.value) + String(scan);
                    debugLog('info', 'capture', 'Prepended active prefix', {
                        prefix: active.value,
                        original: originalScan,
                        modified: scan
                    });
                }
            }

            // Process through rules engine
            const rules = window.OCSDArmoryLink?.rules;
            if (rules && typeof rules.process === 'function') {
                // Get current field values for context
                const fields = window.OCSDArmoryLink?.fields;
                let currentFields = {};
                if (fields && typeof fields.keys === 'function') {
                    const fieldKeys = fields.keys();
                    fieldKeys.forEach(key => {
                        currentFields[key] = fields.read(key) || '';
                    });
                }

                const result = await rules.process(scan, currentFields);

                if (result.matched) {
                    debugLog('info', 'capture', 'Rule matched', {
                        scan,
                        rule: result.rule?.name,
                        directive: result.directive
                    });

                    // Write fields back to DOM
                    if (result.fields && fields) {
                        for (const [key, value] of Object.entries(result.fields)) {
                            if (currentFields[key] !== value) {
                                fields.write(key, value);
                                debugLog('info', 'capture', `Updated field: ${key}`, { value });
                            }
                        }
                    }

                    broadcast('capture:processed', {
                        scan,
                        matched: true,
                        rule: result.rule?.name,
                        directive: result.directive
                    });
                } else {
                    debugLog('warn', 'capture', 'No rule matched', { scan });
                    broadcast('capture:processed', { scan, matched: false });
                }
            } else {
                debugLog('error', 'capture', 'Rules engine not available');
            }

        } catch (err) {
            debugLog('error', 'capture', 'Error processing scan', { error: err.message, stack: err.stack });
            broadcast('capture:error', { error: err.message });
        } finally {
            locked = false;

            // Schedule next item with throttle
            if (queue.length > 0 && mode === 'on') {
                setTimeout(() => {
                    processNextFromQueue();
                }, config.throttleMs);
            }
        }
    }

    /**
     * Process a manual scan (from UI input)
     * @param {string} scan - Manually entered scan value
     */
    async function processManualScan(scan) {
        if (!scan || typeof scan !== 'string') {
            debugLog('warn', 'capture', 'Invalid manual scan input');
            return;
        }

        // Check if manual scans are allowed in OFF mode
        if (mode === 'off' && !config.allowManualInOff) {
            debugLog('warn', 'capture', 'Manual scan rejected - capture is OFF');
            broadcast('capture:error', {
                message: 'Capture is Off. Enable capture or allow manual scans in Off mode.'
            });
            return;
        }

        debugLog('info', 'capture', 'Processing manual scan', { scan });
        broadcast('capture:manual', { scan });

        // Enqueue and process
        enqueueScan(scan);

        // If in standby or off (but allowManualInOff), process directly
        if (mode !== 'on') {
            // Temporarily allow processing
            const wasLocked = locked;
            locked = false;
            await processNextFromQueue();
            locked = wasLocked;
        }
    }

    /**
     * Get queue status
     * @returns {object} Queue information
     */
    function getQueueStatus() {
        const leaderStatus = window.OCSDArmoryLink?.broadcast?.getLeaderStatus();
        return {
            length: queue.length,
            locked: locked,
            mode: mode,
            isLeader: leaderStatus ? leaderStatus.isLeader : true,
            queue: [...queue] // Return copy of queue array
        };
    }

    /**
     * Update configuration
     * @param {object} newConfig - Configuration updates
     */
    function updateConfig(newConfig) {
        Object.assign(config, newConfig);
        debugLog('info', 'capture', 'Configuration updated', { config });
    }

    /**
     * Initialize capture module
     */
    function init() {
        debugLog('info', 'capture', 'Capture module initialized', { mode });
        broadcast('capture:init', { mode });

        // Start in standby mode by default
        setMode('standby');
    }

    return {
        init,
        getMode,
        setMode,
        toggleOn,
        toggleStandby,
        toggleOff,
        processManualScan,
        getQueueStatus,
        updateConfig
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.capture = CaptureModule;
}

// <<< MODULE: capture END

// >>> MODULE: scanHistory START

const ScanHistoryModule = (() => {
    let history = [];
    const MAX_HISTORY = 100; // Keep last 100 scans
    let initialized = false;

    /**
     * Initialize - load history from persistence
     */
    function init() {
        if (initialized) return;

        const AL = window.OCSDArmoryLink;
        if (AL?.persistence) {
            const stored = AL.persistence.load('scanHistory');
            if (stored && Array.isArray(stored)) {
                history = stored.slice(-MAX_HISTORY); // Keep only last MAX_HISTORY items
            }
        }

        initialized = true;
    }

    /**
     * Add scan to history
     * @param {object} scan - Scan object with data and metadata
     */
    function add(scan) {
        const entry = {
            id: 'history-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
            scan: scan.scan || '',
            directive: scan.directive || null,
            ruleMatched: scan.ruleMatched || null,
            fieldsSet: scan.fieldsSet || [],
            success: scan.success !== false, // Default to true
            error: scan.error || null
        };

        history.push(entry);

        // Trim to MAX_HISTORY
        if (history.length > MAX_HISTORY) {
            history = history.slice(-MAX_HISTORY);
        }

        save();
    }

    /**
     * Get all history entries
     * @param {object} options - Filter options
     * @returns {array} History entries
     */
    function getAll(options = {}) {
        let filtered = [...history];

        // Filter by success/error
        if (options.success !== undefined) {
            filtered = filtered.filter(e => e.success === options.success);
        }

        // Filter by directive
        if (options.directive) {
            filtered = filtered.filter(e => e.directive === options.directive);
        }

        // Filter by search query
        if (options.query) {
            const query = options.query.toLowerCase();
            filtered = filtered.filter(e =>
                e.scan.toLowerCase().includes(query) ||
                (e.ruleMatched && e.ruleMatched.toLowerCase().includes(query))
            );
        }

        // Sort (newest first by default)
        filtered.sort((a, b) => b.timestamp - a.timestamp);

        // Limit
        if (options.limit && options.limit > 0) {
            filtered = filtered.slice(0, options.limit);
        }

        return filtered;
    }

    /**
     * Clear all history
     */
    function clear() {
        history = [];
        save();
    }

    /**
     * Export history to JSON
     * @returns {string} JSON string
     */
    function exportJSON() {
        return JSON.stringify(history, null, 2);
    }

    /**
     * Export history to CSV
     * @returns {string} CSV string
     */
    function exportCSV() {
        if (history.length === 0) return '';

        const headers = ['Timestamp', 'Scan', 'Directive', 'Rule Matched', 'Success', 'Fields Set', 'Error'];
        const rows = history.map(entry => [
            new Date(entry.timestamp).toISOString(),
            entry.scan,
            entry.directive || '',
            entry.ruleMatched || '',
            entry.success ? 'Yes' : 'No',
            entry.fieldsSet.length,
            entry.error || ''
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        return csvContent;
    }

    /**
     * Save history to persistence
     */
    function save() {
        const AL = window.OCSDArmoryLink;
        if (AL?.persistence) {
            AL.persistence.save('scanHistory', history);
        }
    }

    /**
     * Get history statistics
     * @returns {object} Statistics object
     */
    function getStats() {
        const total = history.length;
        const successful = history.filter(e => e.success).length;
        const failed = total - successful;
        const byDirective = {};

        history.forEach(entry => {
            const dir = entry.directive || 'none';
            byDirective[dir] = (byDirective[dir] || 0) + 1;
        });

        return {
            total,
            successful,
            failed,
            successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : 0,
            byDirective
        };
    }

    return {
        init,
        add,
        getAll,
        clear,
        exportJSON,
        exportCSV,
        getStats
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.scanHistory = ScanHistoryModule;
}

// <<< MODULE: scanHistory END

// >>> MODULE: elements START

const ElementsModule = (() => {
    // Cache of found elements
    const cache = new Map();
    let cacheEnabled = true;
    let cacheTimeout = 5000; // 5 seconds

    /**
     * Find an element using a field definition
     */
    function find(fieldKey) {
        const fields = window.OCSDArmoryLink?.fields;
        if (!fields || !fields.exists(fieldKey)) {
            return null;
        }

        const field = fields.get(fieldKey);
        if (!field || !field.selector) {
            return null;
        }

        return findBySelector(field.selector);
    }

    /**
     * Find element by selector with caching
     */
    function findBySelector(selector) {
        // Check cache
        if (cacheEnabled && cache.has(selector)) {
            const cached = cache.get(selector);
            if (Date.now() - cached.timestamp < cacheTimeout) {
                // Verify element is still in DOM
                if (document.contains(cached.element)) {
                    return cached.element;
                }
            }
            cache.delete(selector);
        }

        // Find element
        const element = document.querySelector(selector);

        // Cache result
        if (element && cacheEnabled) {
            cache.set(selector, {
                element,
                timestamp: Date.now()
            });
        }

        return element;
    }

    /**
     * Find all elements matching a selector
     */
    function findAll(selector) {
        return Array.from(document.querySelectorAll(selector));
    }

    /**
     * Wait for an element to appear in the DOM
     */
    function waitFor(selector, options = {}) {
        const {
            timeout = 10000,
            interval = 100
        } = options;

        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const checkElement = () => {
                const element = document.querySelector(selector);

                if (element) {
                    resolve(element);
                    return;
                }

                if (Date.now() - startTime >= timeout) {
                    reject(new Error(`Timeout waiting for element: ${selector}`));
                    return;
                }

                setTimeout(checkElement, interval);
            };

            checkElement();
        });
    }

    /**
     * Check if element is visible
     */
    function isVisible(element) {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               element.offsetParent !== null;
    }

    /**
     * Check if element is in viewport
     */
    function isInViewport(element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    /**
     * Scroll element into view smoothly
     */
    function scrollIntoView(element, options = {}) {
        if (!element) return;

        const {
            behavior = 'smooth',
            block = 'center',
            inline = 'nearest'
        } = options;

        element.scrollIntoView({
            behavior,
            block,
            inline
        });
    }

    /**
     * Focus an element
     */
    function focus(element) {
        if (!element) return false;

        try {
            element.focus();
            return true;
        } catch (err) {
            console.error('[Elements] Focus error:', err);
            return false;
        }
    }

    /**
     * Get or set element value
     */
    function value(element, newValue) {
        if (!element) return null;

        if (newValue !== undefined) {
            // Set value
            if ('value' in element) {
                element.value = newValue;
            } else {
                element.textContent = newValue;
            }
            return newValue;
        } else {
            // Get value
            if ('value' in element) {
                return element.value;
            } else {
                return element.textContent || '';
            }
        }
    }

    /**
     * Clear element cache
     */
    function clearCache() {
        cache.clear();
    }

    /**
     * Configure cache settings
     */
    function configureCache(options = {}) {
        if (options.enabled !== undefined) {
            cacheEnabled = options.enabled;
        }
        if (options.timeout !== undefined) {
            cacheTimeout = options.timeout;
        }
    }

    /**
     * Observe DOM mutations for an element
     */
    function observe(element, callback, options = {}) {
        if (!element || typeof callback !== 'function') {
            return null;
        }

        const {
            attributes = true,
            childList = false,
            subtree = false,
            characterData = false
        } = options;

        const observer = new MutationObserver((mutations) => {
            callback(mutations, element);
        });

        observer.observe(element, {
            attributes,
            childList,
            subtree,
            characterData
        });

        return observer;
    }

    return {
        find,
        findBySelector,
        findAll,
        waitFor,
        isVisible,
        isInViewport,
        scrollIntoView,
        focus,
        value,
        clearCache,
        configureCache,
        observe
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.elements = ElementsModule;
}

// <<< MODULE: elements END

// >>> MODULE: rules START

const RulesEngine = (() => {
    // Directive mapping for symbol-based directives
    const directiveMap = {
        "/": "Return",
        "*": "Deployment"
    };

    // Rules storage
    let rules = [];

    /**
     * Test if a pattern matches the input value
     * @param {string} patternType - Type: "regex", "string", "startsWith", "contains", "endsWith"
     * @param {string} pattern - The pattern to match
     * @param {string} value - The input value to test
     * @returns {object|null} Match result with groups or null
     */
    function testPattern(patternType, pattern, value) {
        if (!value) return null;

        switch (patternType) {
            case "regex":
                try {
                    const regex = new RegExp(pattern);
                    const match = value.match(regex);
                    if (match) {
                        return {
                            matched: true,
                            groups: match,
                            fullMatch: match[0]
                        };
                    }
                } catch (e) {
                    console.error("Invalid regex pattern:", pattern, e);
                }
                return null;

            case "string":
                if (value === pattern) {
                    return {
                        matched: true,
                        groups: [value],
                        fullMatch: value
                    };
                }
                return null;

            case "startsWith":
                if (value.startsWith(pattern)) {
                    return {
                        matched: true,
                        groups: [value],
                        fullMatch: value
                    };
                }
                return null;

            case "contains":
                if (value.includes(pattern)) {
                    return {
                        matched: true,
                        groups: [value],
                        fullMatch: value
                    };
                }
                return null;

            case "endsWith":
                if (value.endsWith(pattern)) {
                    return {
                        matched: true,
                        groups: [value],
                        fullMatch: value
                    };
                }
                return null;

            default:
                console.warn("Unknown pattern type:", patternType);
                return null;
        }
    }

    /**
     * Extract directive from matched groups if directiveGroupIndex is specified
     * @param {object} matchResult - Result from testPattern
     * @param {number} directiveGroupIndex - Index of the capture group containing directive symbol
     * @returns {string|null} Directive name or null
     */
    function extractDirective(matchResult, directiveGroupIndex) {
        if (!matchResult || directiveGroupIndex === undefined || directiveGroupIndex === null) {
            return null;
        }

        const symbol = matchResult.groups[directiveGroupIndex];
        if (symbol && directiveMap[symbol]) {
            return directiveMap[symbol];
        }

        return null;
    }

    /**
     * Substitute tokens in a string
     * @param {string} template - Template string with tokens
     * @param {object} context - Context object containing substitution values
     * @returns {string} String with tokens replaced
     */
    function substituteTokens(template, context) {
        if (!template || typeof template !== 'string') return template;

        let result = template;

        // Replace ${scan}
        if (context.scan !== undefined) {
            result = result.replace(/\$\{scan\}/g, context.scan);
        }

        // Replace ${directive}
        if (context.directive !== undefined) {
            result = result.replace(/\$\{directive\}/g, context.directive);
        }

        // Replace regex groups ${0}, ${1}, ${2}, etc.
        if (context.groups && Array.isArray(context.groups)) {
            context.groups.forEach((group, index) => {
                const token = `\$\{${index}\}`;
                const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                result = result.replace(regex, group || '');
            });
        }

        // Replace ${field:<key>} tokens
        // This will read from the Fields module when implemented
        result = result.replace(/\$\{field:([^}]+)\}/g, (match, fieldKey) => {
            if (context.fields && context.fields[fieldKey] !== undefined) {
                return context.fields[fieldKey];
            }
            return match; // Keep token if field not found
        });

        return result;
    }

    /**
     * Match a rule against scan value
     * @param {object} rule - Rule object
     * @param {string} scanValue - Scanned input value
     * @returns {object|null} Match result with extracted data or null
     */
    function _matchRule(rule, scanValue) {
        if (!rule || !rule.enabled) return null;

        const matchResult = testPattern(rule.patternType, rule.pattern, scanValue);
        if (!matchResult) return null;

        // Extract directive if specified
        let directive = null;
        if (rule.directiveGroupIndex !== undefined && rule.directiveGroupIndex !== null) {
            directive = extractDirective(matchResult, rule.directiveGroupIndex);
        }

        return {
            rule: rule,
            matchResult: matchResult,
            directive: directive
        };
    }

    /**
     * Execute actions for a matched rule
     * @param {object} matchData - Match data from _matchRule
     * @param {string} scanValue - Original scan value
     * @param {object} fields - Current field values
     * @returns {object} Execution result with updated fields
     */
    function _executeActions(matchData, scanValue, fields = {}) {
        if (!matchData || !matchData.rule || !matchData.rule.actions) {
            return { fields: fields };
        }

        const updatedFields = { ...fields };
        const context = {
            scan: scanValue,
            directive: matchData.directive || '',
            groups: matchData.matchResult.groups,
            fields: updatedFields
        };

        matchData.rule.actions.forEach(action => {
            if (!action || !action.enabled) return;

            switch (action.type) {
                case "setField":
                    if (action.field && action.value !== undefined) {
                        const substitutedValue = substituteTokens(action.value, context);
                        updatedFields[action.field] = substitutedValue;
                        // Update context fields for subsequent actions
                        context.fields = updatedFields;
                    }
                    break;

                case "clearField":
                    if (action.field) {
                        updatedFields[action.field] = '';
                        context.fields = updatedFields;
                    }
                    break;

                case "appendField":
                    if (action.field && action.value !== undefined) {
                        const currentValue = updatedFields[action.field] || '';
                        const substitutedValue = substituteTokens(action.value, context);
                        updatedFields[action.field] = currentValue + substitutedValue;
                        context.fields = updatedFields;
                    }
                    break;

                default:
                    console.warn("Unknown action type:", action.type);
            }
        });

        return {
            fields: updatedFields,
            directive: matchData.directive
        };
    }

    /**
     * Process a scan value through the rule engine
     * @param {string} scanValue - The scanned input
     * @param {object} currentFields - Current field values
     * @returns {object} Processing result with updated fields and matched rule info
     */
    function process(scanValue, currentFields = {}) {
        if (!scanValue) {
            return {
                matched: false,
                fields: currentFields
            };
        }

        // Try to match rules in order
        for (let i = 0; i < rules.length; i++) {
            const matchData = _matchRule(rules[i], scanValue);
            if (matchData) {
                const executionResult = _executeActions(matchData, scanValue, currentFields);
                return {
                    matched: true,
                    rule: matchData.rule,
                    directive: executionResult.directive,
                    fields: executionResult.fields
                };
            }
        }

        // No rule matched
        return {
            matched: false,
            fields: currentFields
        };
    }

    /**
     * Set the rules array
     * @param {array} newRules - Array of rule objects
     */
    function setRules(newRules) {
        rules = newRules || [];
    }

    /**
     * Get the current rules array
     * @returns {array} Current rules
     */
    function getRules() {
        return rules;
    }

    return {
        testPattern,
        process,
        setRules,
        getRules,
        substituteTokens,
        // Expose internal functions for testing/debugging
        _matchRule,
        _executeActions,
        extractDirective
    };
})();

// Register rules engine
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.rules = RulesEngine;
}

// <<< MODULE: rules END

// >>> MODULE: ui START

const UIModule = (() => {
    let panelEl = null;
    let bubbleEl = null;
    let minimized = false;
    let currentTab = 'dashboard';

    /**
     * Inject CSS styles for the UI panel
     */
    function injectStyles() {
        const css = `
            .ocsd-armorylink-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 600px;
                max-height: 80vh;
                background: #ffffff;
                border: 1px solid #ccc;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: block;
                overflow: hidden;
            }

            .ocsd-armorylink-panel.ocsd-hidden {
                display: none !important;
            }

            .ocsd-panel-header {
                background: #0066cc;
                color: white;
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .ocsd-panel-header h2 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
            }

            .ocsd-close-btn {
                background: transparent;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                line-height: 1;
            }

            .ocsd-close-btn:hover {
                background: rgba(255,255,255,0.2);
                border-radius: 4px;
            }

            #ocsd-armorylink-bubble {
                position: fixed;
                right: 20px;
                bottom: 20px;
                width: 52px;
                height: 52px;
                border-radius: 50%;
                background: #253025;
                color: #ffffff;
                z-index: 1000000 !important;
                border: 2px solid #3b5c3b;
                box-shadow: 0 10px 26px rgba(0,0,0,0.4);
                display: none;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                text-align: center;
                user-select: none;
            }

            #ocsd-armorylink-bubble:hover {
                background: #3b5c3b;
            }

            #ocsd-armorylink-panel .ocsd-header-controls {
                float: right;
                display: flex;
                gap: 6px;
                align-items: center;
            }

            #ocsd-armorylink-panel .ocsd-header-button {
                width: 20px;
                height: 20px;
                border-radius: 4px;
                border: 1px solid #4b6c4b;
                background: rgba(0,0,0,0.15);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 12px;
                font-weight: bold;
                color: #d4d4d4;
            }

            #ocsd-armorylink-panel .ocsd-header-button:hover {
                background: #3b5c3b;
                color: #ffffff;
            }

            .ocsd-panel-tabs {
                display: flex;
                background: #f5f5f5;
                border-bottom: 1px solid #ddd;
                overflow-x: auto;
            }

            .ocsd-tab-btn {
                padding: 10px 16px;
                border: none;
                background: transparent;
                cursor: pointer;
                font-size: 14px;
                border-bottom: 2px solid transparent;
                white-space: nowrap;
            }

            .ocsd-tab-btn.active {
                background: white;
                border-bottom-color: #0066cc;
                font-weight: 600;
            }

            .ocsd-tab-btn:hover {
                background: rgba(0,102,204,0.1);
            }

            .ocsd-panel-content {
                padding: 16px;
                max-height: calc(80vh - 120px);
                overflow-y: auto;
            }

            .ocsd-help-section {
                margin-bottom: 20px;
            }

            .ocsd-help-section h4 {
                margin-top: 16px;
                margin-bottom: 8px;
                font-size: 16px;
                color: #333;
            }

            .ocsd-help-section p {
                margin: 8px 0;
                line-height: 1.5;
                color: #666;
            }

            .ocsd-help-section ul {
                margin: 8px 0;
                padding-left: 24px;
            }

            .ocsd-help-section li {
                margin: 4px 0;
                line-height: 1.5;
            }

            .ocsd-code-block {
                background: #f5f5f5;
                padding: 12px;
                border-radius: 4px;
                font-family: "Courier New", monospace;
                font-size: 13px;
                margin: 8px 0;
            }

            .ocsd-example-item {
                margin: 8px 0;
                padding: 8px;
                background: #f9f9f9;
                border-left: 3px solid #0066cc;
            }

            .ocsd-example-item code {
                background: #e8e8e8;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: "Courier New", monospace;
            }

            .ocsd-field-item {
                padding: 12px;
                margin: 8px 0;
                background: #f9f9f9;
                border-radius: 4px;
                border-left: 3px solid #0066cc;
            }

            .ocsd-field-item strong {
                display: block;
                margin-bottom: 4px;
                color: #333;
            }

            .ocsd-field-item span {
                display: block;
                margin-bottom: 4px;
                color: #666;
                font-size: 13px;
            }

            .ocsd-field-item code {
                display: block;
                background: #e8e8e8;
                padding: 4px 8px;
                border-radius: 3px;
                font-family: "Courier New", monospace;
                font-size: 12px;
            }

            .ocsd-empty-state {
                text-align: center;
                padding: 40px 20px;
                color: #999;
            }

            .ocsd-btn {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                margin: 4px;
            }

            .ocsd-btn-primary {
                background: #0066cc;
                color: white;
            }

            .ocsd-btn-primary:hover {
                background: #0052a3;
            }

            .ocsd-btn-secondary {
                background: #6c757d;
                color: white;
            }

            .ocsd-btn-secondary:hover {
                background: #5a6268;
            }

            .ocsd-btn-danger {
                background: #dc3545;
                color: white;
            }

            .ocsd-btn-danger:hover {
                background: #c82333;
            }

            .ocsd-form-group {
                margin: 16px 0;
            }

            .ocsd-form-group label {
                display: block;
                margin-bottom: 4px;
                font-weight: 600;
                color: #333;
            }

            .ocsd-form-group small {
                display: block;
                margin-top: 4px;
                color: #666;
                font-size: 12px;
            }

            .ocsd-input {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
                box-sizing: border-box;
            }

            .ocsd-input:focus {
                outline: none;
                border-color: #0066cc;
            }

            /* Status Badges */
            .ocsd-status-badges {
                display: inline-flex;
                gap: 6px;
                margin-left: 12px;
            }

            .ocsd-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 0.5px;
            }

            .ocsd-badge-leader {
                background: var(--ocsd-color-secondary, #B19A55);
                color: #000;
            }

            .ocsd-badge-active {
                background: var(--ocsd-color-success, #388e3c);
                color: white;
            }

            /* Status Grid */
            .ocsd-status-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 12px;
                margin-bottom: 16px;
            }

            .ocsd-status-card {
                background: #f9f9f9;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 12px;
                text-align: center;
            }

            .ocsd-status-label {
                font-size: 11px;
                color: #666;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 4px;
            }

            .ocsd-status-value {
                font-size: 20px;
                font-weight: 600;
                color: #333;
            }

            /* Debug Logs */
            .ocsd-debug-controls {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
                flex-wrap: wrap;
            }

            .ocsd-debug-controls select,
            .ocsd-debug-controls input {
                flex: 1;
                min-width: 150px;
            }

            .ocsd-log-list {
                max-height: 500px;
                overflow-y: auto;
                border: 1px solid #e0e0e0;
                border-radius: 4px;
                padding: 8px;
                background: #f9f9f9;
                font-family: monospace;
                font-size: 12px;
            }

            .ocsd-log-entry {
                padding: 6px;
                margin-bottom: 4px;
                border-left: 3px solid #ccc;
                background: white;
                border-radius: 2px;
            }

            .ocsd-log-entry.ocsd-log-info {
                border-left-color: #1976d2;
            }

            .ocsd-log-entry.ocsd-log-warn {
                border-left-color: #f57c00;
            }

            .ocsd-log-entry.ocsd-log-error {
                border-left-color: #d32f2f;
            }

            .ocsd-log-time {
                color: #666;
                margin-right: 8px;
            }

            .ocsd-log-source {
                color: #1976d2;
                font-weight: 600;
                margin-right: 8px;
            }

            .ocsd-log-message {
                color: #333;
            }

            /* Settings */
            .ocsd-settings-category {
                margin-bottom: 24px;
                padding-bottom: 16px;
                border-bottom: 1px solid #e0e0e0;
            }

            .ocsd-settings-category:last-of-type {
                border-bottom: none;
            }

            .ocsd-settings-category h4 {
                color: var(--ocsd-color-primary, #2C5234);
                margin-bottom: 12px;
            }

            .ocsd-form-group {
                margin-bottom: 16px;
            }

            .ocsd-form-group label {
                display: block;
                margin-bottom: 4px;
                font-weight: 500;
                color: #333;
            }

            .ocsd-form-group small {
                display: block;
                margin-top: 4px;
                color: #666;
                font-size: 12px;
            }

            .ocsd-select {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
                background: white;
                box-sizing: border-box;
            }

            .ocsd-button-group {
                display: flex;
                gap: 8px;
                margin-top: 16px;
            }

            .ocsd-queue-list {
                margin-top: 16px;
                padding: 12px;
                border: 1px solid #e0e0e0;
                border-radius: 4px;
                background: #f9f9f9;
                min-height: 100px;
                max-height: 400px;
                overflow-y: auto;
            }

            .ocsd-queue-item {
                display: flex;
                align-items: center;
                padding: 8px;
                margin-bottom: 6px;
                background: white;
                border: 1px solid #e0e0e0;
                border-radius: 4px;
            }

            .ocsd-queue-index {
                flex-shrink: 0;
                width: 40px;
                font-weight: 600;
                color: var(--ocsd-color-primary, #2C5234);
                font-size: 12px;
            }

            .ocsd-queue-scan {
                flex: 1;
                font-family: monospace;
                font-size: 14px;
                color: #333;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            /* Dashboard */
            .ocsd-status-active {
                border-color: var(--ocsd-color-primary, #2C5234) !important;
                background: #e8f5e9 !important;
            }

            .ocsd-dashboard-stats {
                margin-bottom: 24px;
            }

            .ocsd-dashboard-stats h4 {
                margin-bottom: 12px;
                color: var(--ocsd-color-primary, #2C5234);
            }

            .ocsd-stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
                gap: 16px;
                margin-bottom: 16px;
            }

            .ocsd-stat-item {
                text-align: center;
                padding: 16px;
                background: #f9f9f9;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
            }

            .ocsd-stat-value {
                font-size: 32px;
                font-weight: 700;
                color: var(--ocsd-color-primary, #2C5234);
                line-height: 1;
                margin-bottom: 8px;
            }

            .ocsd-stat-label {
                font-size: 12px;
                color: #666;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .ocsd-stat-error {
                color: #d32f2f !important;
            }

            .ocsd-stat-warning {
                color: #f57c00 !important;
            }

            .ocsd-quick-actions {
                margin-bottom: 24px;
            }

            .ocsd-quick-actions h4 {
                margin-bottom: 12px;
                color: var(--ocsd-color-primary, #2C5234);
            }

            .ocsd-button-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 8px;
            }

            /* Rules Tab */
            .ocsd-rules-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
            }

            .ocsd-rules-header h4 {
                margin: 0;
                color: var(--ocsd-color-primary, #2C5234);
            }

            .ocsd-rule-card {
                background: white;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                margin-bottom: 12px;
                padding: 16px;
            }

            .ocsd-rule-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 12px;
            }

            .ocsd-rule-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                margin-left: 8px;
                text-transform: uppercase;
            }

            .ocsd-rule-enabled {
                background: #e8f5e9;
                color: #2e7d32;
            }

            .ocsd-rule-disabled {
                background: #ffebee;
                color: #c62828;
            }

            .ocsd-rule-actions {
                display: flex;
                gap: 4px;
            }

            .ocsd-btn-icon {
                background: none;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 16px;
                color: #666;
            }

            .ocsd-btn-icon:hover {
                background: #f5f5f5;
                border-color: #bbb;
            }

            .ocsd-rule-body {
                font-size: 14px;
                line-height: 1.6;
            }

            .ocsd-rule-pattern,
            .ocsd-rule-directive {
                margin-bottom: 8px;
            }

            .ocsd-rule-type {
                color: #666;
                font-size: 12px;
                font-style: italic;
            }

            .ocsd-rule-actions-list ul {
                margin: 8px 0 0 0;
                padding-left: 20px;
            }

            .ocsd-rule-actions-list li {
                margin-bottom: 4px;
            }

            /* Pattern Tester */
            .ocsd-pattern-tester {
                background: #f9f9f9;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 16px;
                margin: 24px 0;
            }

            .ocsd-pattern-tester h4 {
                margin-top: 0;
                margin-bottom: 12px;
                color: var(--ocsd-color-primary, #2C5234);
            }

            .ocsd-tester-inputs {
                display: grid;
                grid-template-columns: 1fr 1fr 1fr auto;
                gap: 12px;
                align-items: end;
            }

            .ocsd-test-results {
                margin-top: 16px;
            }

            .ocsd-test-result {
                padding: 12px;
                border-radius: 4px;
                border-left: 4px solid;
            }

            .ocsd-test-success {
                background: #e8f5e9;
                border-left-color: #2e7d32;
                color: #1b5e20;
            }

            .ocsd-test-failure {
                background: #fff3e0;
                border-left-color: #f57c00;
                color: #e65100;
            }

            .ocsd-test-error {
                background: #ffebee;
                border-left-color: #c62828;
                color: #b71c1c;
            }

            .ocsd-capture-groups {
                margin-top: 8px;
            }

            .ocsd-capture-groups ul {
                margin: 8px 0 0 0;
                padding-left: 20px;
            }

            .ocsd-capture-groups li {
                margin-bottom: 4px;
            }

            /* Fields Tab */
            .ocsd-fields-summary {
                background: #f9f9f9;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 16px;
            }

            .ocsd-fields-summary p {
                margin-bottom: 12px;
            }

            .ocsd-field-card {
                background: white;
                border: 1px solid #e0e0e0;
                border-left: 4px solid #ccc;
                border-radius: 4px;
                padding: 12px;
                margin-bottom: 12px;
            }

            .ocsd-field-detected {
                border-left-color: #2e7d32;
                background: #f1f8f4;
            }

            .ocsd-field-not-detected {
                border-left-color: #f57c00;
            }

            .ocsd-field-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 4px;
            }

            .ocsd-field-status {
                font-size: 12px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 12px;
            }

            .ocsd-field-detected .ocsd-field-status {
                background: #e8f5e9;
                color: #2e7d32;
            }

            .ocsd-field-not-detected .ocsd-field-status {
                background: #fff3e0;
                color: #e65100;
            }

            .ocsd-field-description {
                font-size: 13px;
                color: #666;
                margin-bottom: 6px;
            }

            .ocsd-field-selector {
                font-size: 12px;
            }

            .ocsd-field-selector code {
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: monospace;
            }

            /* Modal Overlay */
            .ocsd-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                z-index: 20000;
                display: none;
                align-items: center;
                justify-content: center;
            }

            .ocsd-modal-overlay.ocsd-modal-visible {
                display: flex;
            }

            .ocsd-modal {
                background: white;
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                max-width: 700px;
                width: 90%;
                max-height: 90vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }

            .ocsd-modal-header {
                background: var(--ocsd-color-primary, #2C5234);
                color: white;
                padding: 16px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .ocsd-modal-header h3 {
                margin: 0;
                font-size: 18px;
            }

            .ocsd-modal-close {
                background: transparent;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                line-height: 1;
            }

            .ocsd-modal-close:hover {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }

            .ocsd-modal-body {
                padding: 20px;
                overflow-y: auto;
                flex: 1;
            }

            .ocsd-modal-footer {
                padding: 16px 20px;
                border-top: 1px solid #e0e0e0;
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }

            .ocsd-form-row {
                margin-bottom: 16px;
            }

            .ocsd-form-row label {
                display: block;
                margin-bottom: 4px;
                font-weight: 500;
                color: #333;
            }

            .ocsd-form-row .ocsd-form-hint {
                display: block;
                margin-top: 4px;
                font-size: 12px;
                color: #666;
            }

            .ocsd-actions-list {
                border: 1px solid #e0e0e0;
                border-radius: 4px;
                padding: 12px;
                background: #f9f9f9;
            }

            .ocsd-action-item {
                background: white;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 12px;
                margin-bottom: 8px;
                display: grid;
                grid-template-columns: 1fr 2fr auto;
                gap: 8px;
                align-items: center;
            }

            .ocsd-action-item:last-child {
                margin-bottom: 0;
            }

            .ocsd-btn-danger {
                background: #d32f2f;
                color: white;
            }

            .ocsd-btn-danger:hover {
                background: #b71c1c;
            }

            .ocsd-btn-sm {
                padding: 4px 12px;
                font-size: 13px;
            }

            /* Prefixes Tab */
            .ocsd-prefixes-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
            }

            .ocsd-prefixes-header h4 {
                margin: 0;
                color: var(--ocsd-color-primary, #2C5234);
            }

            .ocsd-prefix-card {
                background: white;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                margin-bottom: 12px;
                padding: 16px;
            }

            .ocsd-prefix-card.ocsd-prefix-active {
                border-left: 4px solid var(--ocsd-color-gold, #B19A55);
                background: #fffbf0;
            }

            .ocsd-prefix-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 12px;
            }

            .ocsd-prefix-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                margin-left: 8px;
                text-transform: uppercase;
                background: var(--ocsd-color-gold, #B19A55);
                color: white;
            }

            .ocsd-prefix-actions {
                display: flex;
                gap: 4px;
            }

            .ocsd-prefix-body {
                font-size: 14px;
                line-height: 1.6;
            }

            .ocsd-prefix-value {
                margin-bottom: 8px;
            }

            .ocsd-prefix-value code {
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: monospace;
                font-weight: 600;
                color: var(--ocsd-color-primary, #2C5234);
            }

            .ocsd-prefix-description {
                color: #666;
                font-size: 13px;
                font-style: italic;
            }

            /* Fields Tab */
            .ocsd-fields-summary {
                background: #f9f9f9;
                padding: 16px;
                border-radius: 8px;
                margin-bottom: 20px;
            }

            .ocsd-fields-summary p {
                margin: 0 0 12px 0;
            }

            .ocsd-field-card {
                background: white;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                margin-bottom: 12px;
                padding: 16px;
                transition: border-color 0.2s;
            }

            .ocsd-field-card.ocsd-field-detected {
                border-left: 4px solid #4caf50;
            }

            .ocsd-field-card.ocsd-field-not-detected {
                border-left: 4px solid #ccc;
            }

            .ocsd-field-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 12px;
            }

            .ocsd-field-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                margin-left: 8px;
                text-transform: uppercase;
                background: var(--ocsd-color-gold, #B19A55);
                color: white;
            }

            .ocsd-field-actions {
                display: flex;
                gap: 4px;
            }

            .ocsd-field-body {
                font-size: 14px;
                line-height: 1.6;
            }

            .ocsd-field-meta {
                display: flex;
                gap: 16px;
                margin-bottom: 8px;
            }

            .ocsd-field-status {
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                background: #e0e0e0;
            }

            .ocsd-field-detected .ocsd-field-status {
                background: #4caf50;
                color: white;
            }

            .ocsd-field-roles {
                color: #666;
                font-size: 13px;
            }

            .ocsd-field-selector,
            .ocsd-field-commit {
                margin-bottom: 6px;
                font-size: 13px;
            }

            .ocsd-field-selector code,
            .ocsd-field-commit code {
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: monospace;
                color: var(--ocsd-color-primary, #2C5234);
            }

            .ocsd-field-description {
                margin-top: 8px;
                color: #666;
                font-size: 13px;
                font-style: italic;
            }

            .ocsd-button-group {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }

            /* Queue Tab */
            .ocsd-queue-controls {
                margin-bottom: 20px;
            }

            .ocsd-queue-section,
            .ocsd-history-section {
                margin-top: 24px;
                background: white;
                border-radius: 8px;
                padding: 16px;
                border: 1px solid #e0e0e0;
            }

            .ocsd-queue-list,
            .ocsd-history-list {
                max-height: 400px;
                overflow-y: auto;
                margin-top: 12px;
            }

            .ocsd-queue-item {
                background: #f9f9f9;
                border: 1px solid #e0e0e0;
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .ocsd-queue-item-header {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .ocsd-queue-item-scan {
                font-family: monospace;
                background: white;
                padding: 4px 8px;
                border-radius: 4px;
                color: var(--ocsd-color-primary, #2C5234);
                font-weight: 600;
            }

            .ocsd-history-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
            }

            .ocsd-history-filters {
                display: flex;
                gap: 12px;
                margin-bottom: 16px;
            }

            .ocsd-history-filters .ocsd-select,
            .ocsd-history-filters .ocsd-input {
                flex: 1;
            }

            .ocsd-history-item {
                background: white;
                border: 1px solid #e0e0e0;
                border-left: 4px solid #ccc;
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
            }

            .ocsd-history-item.ocsd-history-success {
                border-left-color: #4caf50;
            }

            .ocsd-history-item.ocsd-history-error {
                border-left-color: #f44336;
            }

            .ocsd-history-item .ocsd-history-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 8px;
            }

            .ocsd-history-status {
                font-size: 18px;
                font-weight: bold;
            }

            .ocsd-history-success .ocsd-history-status {
                color: #4caf50;
            }

            .ocsd-history-error .ocsd-history-status {
                color: #f44336;
            }

            .ocsd-history-scan {
                font-family: monospace;
                background: #f5f5f5;
                padding: 4px 8px;
                border-radius: 4px;
                flex: 1;
                font-weight: 600;
            }

            .ocsd-history-time {
                color: #666;
                font-size: 12px;
            }

            .ocsd-history-meta {
                font-size: 13px;
                color: #666;
                margin-top: 4px;
                padding-left: 30px;
            }

            .ocsd-history-error {
                font-size: 13px;
                color: #f44336;
                margin-top: 4px;
                padding-left: 30px;
                font-style: italic;
            }

            .ocsd-history-stats {
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid #e0e0e0;
                color: #666;
                font-size: 14px;
            }

            .ocsd-status-mode-on {
                color: #4caf50;
                font-weight: 600;
            }

            .ocsd-status-mode-standby {
                color: #ff9800;
                font-weight: 600;
            }

            .ocsd-status-mode-off {
                color: #f44336;
                font-weight: 600;
            }

            .ocsd-btn-danger {
                background: #f44336;
                color: white;
            }

            .ocsd-btn-danger:hover {
                background: #d32f2f;
            }

            /* Help Tab */
            .ocsd-help-table {
                width: 100%;
                border-collapse: collapse;
                margin: 16px 0;
                background: white;
                border-radius: 8px;
                overflow: hidden;
                border: 1px solid #e0e0e0;
            }

            .ocsd-help-table th,
            .ocsd-help-table td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #e0e0e0;
            }

            .ocsd-help-table th {
                background: var(--ocsd-color-primary, #2C5234);
                color: white;
                font-weight: 600;
            }

            .ocsd-help-table tr:last-child td {
                border-bottom: none;
            }

            .ocsd-help-table tr:hover {
                background: #f9f9f9;
            }

            .ocsd-help-table code {
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: monospace;
                color: var(--ocsd-color-primary, #2C5234);
                font-weight: 600;
            }
        `;

        GM_addStyle(css);
    }

    /**
     * Initialize the UI
     */
    function init() {
        injectStyles();
        createPanel();
        attachEventListeners();
        loadCurrentTab();

        // Register panel with layout engine
        if (window.OCSDArmoryLink?.layout && panelEl) {
            window.OCSDArmoryLink.layout.registerPanel(panelEl);
        }

        // Update status badges periodically
        setInterval(updateStatusBadges, 2000);

        // Make the panel visible on load
        show();
    }

    /**
     * Create the main panel structure
     */
    function createPanel() {
        // Check if panel already exists
        panelEl = document.getElementById('ocsd-armorylink-panel');
        if (panelEl) return;

        // Create main container
        panelEl = document.createElement('div');
        panelEl.id = 'ocsd-armorylink-panel';
        panelEl.className = 'ocsd-armorylink-panel';
        panelEl.innerHTML = `
            <div class="ocsd-panel-header">
                <div>
                    <h2>OCSD ArmoryLink</h2>
                    <span class="ocsd-status-badges" id="ocsd-status-badges"></span>
                </div>
                <span class="ocsd-header-controls">
                    <span class="ocsd-header-button" id="ocsd-ticker-toggle-btn" title="Toggle Ticker">T</span>
                    <span class="ocsd-header-button" id="ocsd-layout-cycle-btn" title="Cycle Layout">L</span>
                    <span class="ocsd-header-button" id="ocsd-armorylink-minimize-btn" title="Minimize">–</span>
                    <button class="ocsd-close-btn" title="Close Panel">×</button>
                </span>
            </div>
            <div class="ocsd-panel-tabs">
                <button class="ocsd-tab-btn active" data-tab="dashboard">Dashboard</button>
                <button class="ocsd-tab-btn" data-tab="queue">Queue</button>
                <button class="ocsd-tab-btn" data-tab="debug">Debug</button>
                <button class="ocsd-tab-btn" data-tab="settings">Settings</button>
                <button class="ocsd-tab-btn" data-tab="rules">Rules</button>
                <button class="ocsd-tab-btn" data-tab="fields">Fields</button>
                <button class="ocsd-tab-btn" data-tab="prefixes">Prefixes</button>
                <button class="ocsd-tab-btn" data-tab="bwc">BWC</button>
                <button class="ocsd-tab-btn" data-tab="x10">X10</button>
                <button class="ocsd-tab-btn" data-tab="help">Help</button>
            </div>
            <div class="ocsd-panel-content">
                <div id="ocsd-tab-content"></div>
            </div>
        `;

        document.body.appendChild(panelEl);

        // Create bubble if it doesn't exist
        if (!bubbleEl) {
            bubbleEl = document.createElement('div');
            bubbleEl.id = 'ocsd-armorylink-bubble';
            bubbleEl.textContent = 'AL';
            bubbleEl.title = 'Open ArmoryLink';
            document.body.appendChild(bubbleEl);
        }
    }

    /**
     * Minimize the panel and show the bubble
     */
    function minimizePanel() {
        if (!panelEl || !bubbleEl) return;
        minimized = true;
        panelEl.style.display = 'none';
        bubbleEl.style.display = 'flex';
    }

    /**
     * Restore the panel and hide the bubble
     */
    function restorePanel() {
        if (!panelEl || !bubbleEl) return;
        minimized = false;
        panelEl.style.display = 'flex';
        bubbleEl.style.display = 'none';
    }

    /**
     * Attach event listeners
     */
    function attachEventListeners() {
        // Tab switching
        const tabButtons = panelEl.querySelectorAll('.ocsd-tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                switchTab(tab);
            });
        });

        // Close button
        const closeBtn = panelEl.querySelector('.ocsd-close-btn');
        closeBtn.addEventListener('click', () => {
            hide();
        });

        // Minimize button
        const minimizeBtn = document.getElementById('ocsd-armorylink-minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                minimizePanel();
            });
        }

        // Bubble click to restore
        if (bubbleEl) {
            bubbleEl.addEventListener('click', (e) => {
                e.preventDefault();
                restorePanel();
            });
        }

        // Ticker toggle button
        const tickerToggleBtn = document.getElementById('ocsd-ticker-toggle-btn');
        if (tickerToggleBtn) {
            tickerToggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const AL = window.OCSDArmoryLink;
                if (AL.ticker) {
                    AL.ticker.toggle();
                    AL.stubs?.toast(
                        `Ticker ${AL.ticker.isEnabled() ? 'enabled' : 'disabled'}`,
                        'info',
                        { duration: 1500 }
                    );
                }
            });
        }

        // Layout cycle button
        const layoutCycleBtn = document.getElementById('ocsd-layout-cycle-btn');
        if (layoutCycleBtn) {
            layoutCycleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const AL = window.OCSDArmoryLink;
                if (AL.layout) {
                    AL.layout.cycleLayout();
                }
            });
        }
    }

    /**
     * Switch to a different tab
     */
    function switchTab(tabName) {
        currentTab = tabName;

        // Update tab button states
        const tabButtons = panelEl.querySelectorAll('.ocsd-tab-btn');
        tabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        loadCurrentTab();
    }

    /**
     * Load the current tab content
     */
    function loadCurrentTab() {
        const contentDiv = panelEl.querySelector('#ocsd-tab-content');

        switch (currentTab) {
            case 'dashboard':
                contentDiv.innerHTML = getDashboardHTML();
                attachDashboardHandlers();
                break;
            case 'queue':
                contentDiv.innerHTML = getQueueHTML();
                attachQueueHandlers();
                break;
            case 'debug':
                contentDiv.innerHTML = getDebugHTML();
                attachDebugHandlers();
                break;
            case 'settings':
                contentDiv.innerHTML = getSettingsHTML();
                attachSettingsHandlers();
                break;
            case 'rules':
                contentDiv.innerHTML = getRulesHTML();
                attachRulesHandlers();
                break;
            case 'fields':
                contentDiv.innerHTML = getFieldsHTML();
                attachFieldsHandlers();
                break;
            case 'prefixes':
                contentDiv.innerHTML = getPrefixesHTML();
                attachPrefixesHandlers();
                break;
            case 'bwc':
                contentDiv.innerHTML = getBWCHTML();
                attachBWCHandlers();
                break;
            case 'x10':
                contentDiv.innerHTML = getX10HTML();
                attachX10Handlers();
                break;
            case 'help':
                contentDiv.innerHTML = getHelpHTML();
                // No handlers needed for help tab
                break;
        }

        // Update status badges after tab load
        updateStatusBadges();
    }

    /**
     * Dashboard tab HTML
     */
    function getDashboardHTML() {
        const AL = window.OCSDArmoryLink;

        // Get system statistics
        const queueStatus = AL.capture?.getQueueStatus() || { length: 0, mode: 'standby', isLeader: false };
        const leaderStatus = AL.broadcast?.getLeaderStatus() || { isLeader: false, leaderId: null };
        const contextInfo = AL.context?.getContextInfo() || { isServiceNow: false, formType: 'unknown' };
        const logger = AL.stubs?.DebugLogger;
        const logStats = logger ? {
            total: logger.getLogs().length,
            errors: logger.getLogs({ level: 'error' }).length,
            warnings: logger.getLogs({ level: 'warn' }).length
        } : { total: 0, errors: 0, warnings: 0 };

        // Get settings
        const settings = AL.settings?.getAll() || {};
        const captureEnabled = settings.captureEnabled !== false;
        const currentLayout = AL.layout?.getCurrentLayout() || 'dock-right';

        return `
            <h3>Dashboard</h3>

            <!-- System Status Cards -->
            <div class="ocsd-status-grid">
                <div class="ocsd-status-card ${queueStatus.mode === 'on' ? 'ocsd-status-active' : ''}">
                    <div class="ocsd-status-label">Capture Mode</div>
                    <div class="ocsd-status-value">${queueStatus.mode.toUpperCase()}</div>
                </div>
                <div class="ocsd-status-card ${leaderStatus.isLeader ? 'ocsd-status-active' : ''}">
                    <div class="ocsd-status-label">Tab Role</div>
                    <div class="ocsd-status-value">${leaderStatus.isLeader ? 'LEADER' : 'WORKER'}</div>
                </div>
                <div class="ocsd-status-card ${contextInfo.isServiceNow ? 'ocsd-status-active' : ''}">
                    <div class="ocsd-status-label">Context</div>
                    <div class="ocsd-status-value">${contextInfo.isServiceNow ? 'ServiceNow' : 'Unknown'}</div>
                </div>
                <div class="ocsd-status-card">
                    <div class="ocsd-status-label">Layout</div>
                    <div class="ocsd-status-value">${currentLayout.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</div>
                </div>
            </div>

            <!-- Statistics Grid -->
            <div class="ocsd-dashboard-stats">
                <h4>Session Statistics</h4>
                <div class="ocsd-stats-grid">
                    <div class="ocsd-stat-item">
                        <div class="ocsd-stat-value">${queueStatus.length}</div>
                        <div class="ocsd-stat-label">Queue Items</div>
                    </div>
                    <div class="ocsd-stat-item">
                        <div class="ocsd-stat-value">${logStats.total}</div>
                        <div class="ocsd-stat-label">Log Entries</div>
                    </div>
                    <div class="ocsd-stat-item">
                        <div class="ocsd-stat-value ${logStats.errors > 0 ? 'ocsd-stat-error' : ''}">${logStats.errors}</div>
                        <div class="ocsd-stat-label">Errors</div>
                    </div>
                    <div class="ocsd-stat-item">
                        <div class="ocsd-stat-value ${logStats.warnings > 0 ? 'ocsd-stat-warning' : ''}">${logStats.warnings}</div>
                        <div class="ocsd-stat-label">Warnings</div>
                    </div>
                </div>
            </div>

            <!-- Quick Actions -->
            <div class="ocsd-quick-actions">
                <h4>Quick Actions</h4>
                <div class="ocsd-button-grid">
                    <button class="ocsd-btn ocsd-btn-primary" onclick="window.OCSDArmoryLink.capture?.setMode('${queueStatus.mode === 'on' ? 'standby' : 'on'}')">
                        ${queueStatus.mode === 'on' ? 'Pause Capture' : 'Start Capture'}
                    </button>
                    <button class="ocsd-btn ocsd-btn-secondary" onclick="window.OCSDArmoryLink.ticker?.toggle()">
                        Toggle Ticker
                    </button>
                    <button class="ocsd-btn ocsd-btn-secondary" onclick="window.OCSDArmoryLink.layout?.cycleLayout()">
                        Cycle Layout
                    </button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-dashboard-export-config">
                        Export Config
                    </button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-dashboard-clear-logs">
                        Clear Logs
                    </button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-dashboard-refresh">
                        Refresh Dashboard
                    </button>
                </div>
            </div>

            <div class="ocsd-help-section">
                <h4>ArmoryLink Overview</h4>
                <p>ArmoryLink uses <strong>symbol-based directives</strong> to process scanned input:</p>
                <ul>
                    <li><strong>/</strong> → Return</li>
                    <li><strong>*</strong> → Deployment</li>
                </ul>

                <h4>Example Scans</h4>
                <div class="ocsd-examples">
                    <div class="ocsd-example-item">
                        <code>/01234</code>
                        <span>→ Type: Return, User: 01234</span>
                    </div>
                    <div class="ocsd-example-item">
                        <code>*99999</code>
                        <span>→ Type: Deployment, User: 99999</span>
                    </div>
                    <div class="ocsd-example-item">
                        <code>ABC123XYZ</code>
                        <span>→ Weapon: ABC123XYZ (if rule matches)</span>
                    </div>
                </div>

                <h4>Quick Reference</h4>
                <ul>
                    <li><strong>Queue:</strong> View live scan queue and control capture modes</li>
                    <li><strong>Debug:</strong> Monitor system logs with filtering and export</li>
                    <li><strong>Settings:</strong> Configure all 27 system options</li>
                    <li><strong>Rules:</strong> Configure pattern matching and field actions</li>
                    <li><strong>Fields:</strong> Manage the 10 ServiceNow field mappings</li>
                    <li><strong>Prefixes:</strong> Create custom scan prefixes</li>
                    <li><strong>BWC:</strong> Open Axon portal using current User PID</li>
                    <li><strong>X10:</strong> Open TASER portal using current User PID</li>
                </ul>
            </div>
        `;
    }

    /**
     * Rules tab HTML
     */
    function getRulesHTML() {
        const AL = window.OCSDArmoryLink;

        // Get all rules from rules engine
        const rules = AL.rules?.getRules() || [];

        let rulesListHTML = '';
        if (rules.length === 0) {
            rulesListHTML = '<p class="ocsd-empty-state">No rules configured. Click "Add New Rule" to create one.</p>';
        } else {
            rulesListHTML = rules.map(rule => `
                <div class="ocsd-rule-card" data-rule-id="${rule.id}">
                    <div class="ocsd-rule-header">
                        <div>
                            <strong>${rule.name}</strong>
                            <span class="ocsd-rule-badge ${rule.enabled ? 'ocsd-rule-enabled' : 'ocsd-rule-disabled'}">
                                ${rule.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                        <div class="ocsd-rule-actions">
                            <button class="ocsd-btn-icon ocsd-rule-edit" data-rule-id="${rule.id}" title="Edit">✎</button>
                            <button class="ocsd-btn-icon ocsd-rule-delete" data-rule-id="${rule.id}" title="Delete">×</button>
                        </div>
                    </div>
                    <div class="ocsd-rule-body">
                        <div class="ocsd-rule-pattern">
                            <strong>Pattern:</strong> <code>${rule.pattern}</code>
                            <span class="ocsd-rule-type">(${rule.patternType})</span>
                        </div>
                        ${rule.directiveGroupIndex !== undefined ? `
                            <div class="ocsd-rule-directive">
                                <strong>Directive Group:</strong> ${rule.directiveGroupIndex}
                            </div>
                        ` : ''}
                        <div class="ocsd-rule-actions-list">
                            <strong>Actions:</strong>
                            <ul>
                                ${rule.actions.map(action => `
                                    <li>Set <strong>${action.field}</strong> to <code>${action.value}</code></li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        return `
            <h3>Rules Configuration</h3>

            <div class="ocsd-rules-list">
                <div class="ocsd-rules-header">
                    <h4>Current Rules (${rules.length})</h4>
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-add-rule-btn">Add New Rule</button>
                </div>
                <div id="ocsd-rules-container">
                    ${rulesListHTML}
                </div>
            </div>

            <!-- Pattern Tester -->
            <div class="ocsd-pattern-tester">
                <h4>Pattern Tester</h4>
                <div class="ocsd-tester-inputs">
                    <div class="ocsd-form-group">
                        <label>Test Input</label>
                        <input type="text" id="ocsd-test-input" class="ocsd-input" placeholder="/01234" />
                    </div>
                    <div class="ocsd-form-group">
                        <label>Pattern</label>
                        <input type="text" id="ocsd-test-pattern" class="ocsd-input" placeholder="^([/*])(\\d{5})$" />
                    </div>
                    <div class="ocsd-form-group">
                        <label>Pattern Type</label>
                        <select id="ocsd-test-pattern-type" class="ocsd-select">
                            <option value="regex">Regex</option>
                            <option value="string">String</option>
                            <option value="startsWith">Starts With</option>
                            <option value="contains">Contains</option>
                            <option value="endsWith">Ends With</option>
                        </select>
                    </div>
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-test-pattern-btn">Test Pattern</button>
                </div>
                <div id="ocsd-test-results" class="ocsd-test-results"></div>
            </div>

            <div class="ocsd-help-section">
                <h4>About Rules</h4>
                <p>Rules use pattern matching to automatically fill ServiceNow fields based on scanned input.</p>

                <h4>Symbol-Based Directives</h4>
                <p>ArmoryLink uses symbol-based directives. The rule engine extracts symbols from your scan and maps them to directives:</p>
                <ul>
                    <li><strong>/</strong> → Return</li>
                    <li><strong>*</strong> → Deployment</li>
                </ul>

                <h4>Supported Pattern Types</h4>
                <ul>
                    <li><strong>regex</strong> - Regular expression matching</li>
                    <li><strong>string</strong> - Exact string match</li>
                    <li><strong>startsWith</strong> - Prefix matching</li>
                    <li><strong>contains</strong> - Substring matching</li>
                    <li><strong>endsWith</strong> - Suffix matching</li>
                </ul>

                <h4>Token Substitution</h4>
                <p>Use these tokens in action values:</p>
                <ul>
                    <li><code>\${scan}</code> - The full scanned value</li>
                    <li><code>\${directive}</code> - Extracted directive (Return or Deployment)</li>
                    <li><code>\${0}</code>, <code>\${1}</code>, <code>\${2}</code> ... - Regex capture groups</li>
                    <li><code>\${field:user}</code> - Read value from another field</li>
                </ul>
            </div>
        `;
    }

    /**
     * Fields tab HTML
     */
    function getFieldsHTML() {
        const AL = window.OCSDArmoryLink;
        const allFields = AL.fields?.getAll() || {};
        const fieldKeys = Object.keys(allFields);

        const fieldsHTML = fieldKeys.map(key => {
            const field = allFields[key];
            const detected = AL.fields?.detect(key) || false;
            const statusClass = detected ? 'ocsd-field-detected' : 'ocsd-field-not-detected';
            const statusText = detected ? '✓ Detected' : '✗ Not Found';
            const isModified = field.modified || !field.isDefault;
            const rolesText = field.roles ? field.roles.join(', ') : 'none';

            return `
                <div class="ocsd-field-card ${statusClass}" data-field-key="${key}">
                    <div class="ocsd-field-header">
                        <div>
                            <strong>${field.label}</strong>
                            ${isModified ? '<span class="ocsd-field-badge">CUSTOM</span>' : ''}
                        </div>
                        <div class="ocsd-field-actions">
                            <button class="ocsd-btn-icon ocsd-field-test" data-field-key="${key}" title="Test Detection">🔍</button>
                            <button class="ocsd-btn-icon ocsd-field-edit" data-field-key="${key}" title="Edit">✎</button>
                            ${isModified ? `<button class="ocsd-btn-icon ocsd-field-reset" data-field-key="${key}" title="Reset to Default">↺</button>` : ''}
                            ${!field.isDefault ? `<button class="ocsd-btn-icon ocsd-field-delete" data-field-key="${key}" title="Delete">×</button>` : ''}
                        </div>
                    </div>
                    <div class="ocsd-field-body">
                        <div class="ocsd-field-meta">
                            <span class="ocsd-field-status">${statusText}</span>
                            <span class="ocsd-field-roles"><strong>Roles:</strong> ${rolesText}</span>
                        </div>
                        <div class="ocsd-field-selector">
                            <strong>Selector:</strong> <code>${field.selector || 'none'}</code>
                        </div>
                        <div class="ocsd-field-commit">
                            <strong>Commit Event:</strong> <code>${field.commitEvent || 'change'}</code>
                        </div>
                        ${field.description ? `<div class="ocsd-field-description">${field.description}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <h3>Field Mappings</h3>

            <div class="ocsd-fields-summary">
                <p>ArmoryLink manages <strong>${fieldKeys.length} fields</strong> for ServiceNow integration. Field detection status is shown below based on the current page.</p>
                <div class="ocsd-button-group">
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-add-field-btn">Add Field</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-refresh-fields-btn">Refresh Detection</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-reset-all-fields-btn">Reset All to Defaults</button>
                </div>
            </div>

            <div class="ocsd-fields-list">
                ${fieldsHTML || '<p class="ocsd-empty-state">No fields defined.</p>'}
            </div>

            <div class="ocsd-help-section">
                <h4>About Field Mappings</h4>
                <p>Fields are mapped to ServiceNow form input elements using CSS selectors. The system automatically detects and validates field presence on the current page.</p>

                <h4>Field Detection Status</h4>
                <p>✓ <strong>Detected</strong> - Field element found on current page</p>
                <p>✗ <strong>Not Found</strong> - Field element not present (may appear on different form types)</p>

                <h4>Field Roles</h4>
                <ul>
                    <li><strong>ticker</strong> - Included in quick ticker display</li>
                    <li><strong>read</strong> - Can be read from ServiceNow forms</li>
                    <li><strong>write</strong> - Can be written to ServiceNow forms</li>
                </ul>

                <h4>Custom Fields</h4>
                <p>You can add custom field mappings for your specific ServiceNow forms. Custom fields are persisted and will be available across sessions.</p>
            </div>
        `;
    }

    /**
     * Prefixes tab HTML
     */
    function getPrefixesHTML() {
        const AL = window.OCSDArmoryLink;
        const prefixes = AL.prefixes?.getAll() || [];
        const activePrefix = AL.prefixes?.getActive();

        let prefixesListHTML = '';
        if (prefixes.length === 0) {
            prefixesListHTML = '<p class="ocsd-empty-state">No prefixes defined. Click "Add Prefix" to create one.</p>';
        } else {
            prefixesListHTML = prefixes.map(prefix => {
                const isActive = activePrefix && activePrefix.id === prefix.id;
                return `
                    <div class="ocsd-prefix-card ${isActive ? 'ocsd-prefix-active' : ''}" data-prefix-id="${prefix.id}">
                        <div class="ocsd-prefix-header">
                            <div>
                                <strong>${prefix.name}</strong>
                                ${isActive ? '<span class="ocsd-prefix-badge">ACTIVE</span>' : ''}
                            </div>
                            <div class="ocsd-prefix-actions">
                                <button class="ocsd-btn-icon ocsd-prefix-set-active" data-prefix-id="${prefix.id}" title="Set as Active">⭐</button>
                                <button class="ocsd-btn-icon ocsd-prefix-edit" data-prefix-id="${prefix.id}" title="Edit">✎</button>
                                <button class="ocsd-btn-icon ocsd-prefix-delete" data-prefix-id="${prefix.id}" title="Delete">×</button>
                            </div>
                        </div>
                        <div class="ocsd-prefix-body">
                            <div class="ocsd-prefix-value">
                                <strong>Value:</strong> <code>${prefix.value}</code>
                            </div>
                            ${prefix.description ? `
                                <div class="ocsd-prefix-description">
                                    ${prefix.description}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        return `
            <h3>Prefix Configuration</h3>

            <div class="ocsd-prefixes-list">
                <div class="ocsd-prefixes-header">
                    <h4>Current Prefixes (${prefixes.length})</h4>
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-add-prefix-btn">Add Prefix</button>
                </div>
                <div id="ocsd-prefixes-container">
                    ${prefixesListHTML}
                </div>
            </div>

            <div class="ocsd-help-section">
                <h4>About Prefixes</h4>
                <p>Prefixes are automatically prepended to all scanned values when active. This is useful for adding department codes, location identifiers, or other consistent metadata.</p>

                <h4>How Prefixes Work</h4>
                <ul>
                    <li><strong>Active Prefix:</strong> The prefix marked as active (⭐) will be prepended to every scan</li>
                    <li><strong>Example:</strong> If active prefix value is "DEPT-A-", scanning "12345" becomes "DEPT-A-12345"</li>
                    <li><strong>Rule Matching:</strong> Rules match against the prefixed value</li>
                </ul>

                <h4>Use Cases</h4>
                <ul>
                    <li><strong>Department Codes:</strong> "NORTH-", "SOUTH-", "WEST-"</li>
                    <li><strong>Location Tags:</strong> "HQ-", "FIELD-", "MOBILE-"</li>
                    <li><strong>Shift Identifiers:</strong> "DAY-", "SWING-", "GRAVE-"</li>
                </ul>

                <h4>Managing Prefixes</h4>
                <p>Click the ⭐ star icon to set a prefix as active. Only one prefix can be active at a time. Click it again to deactivate.</p>
            </div>
        `;
    }

    /**
     * BWC tab HTML
     */
    function getBWCHTML() {
        const AL = window.OCSDArmoryLink;
        const settings = AL.settings?.getAll() || {};
        const baseUrl = settings.bwcBaseUrl || 'https://axon-portal-url.com/inventory';
        const queryTemplate = settings.bwcQueryTemplate || '?filter=user:${field:user}';
        const enabled = settings.bwcEnabled !== false;

        return `
            <h3>BWC (Axon Body Camera)</h3>
            <div class="ocsd-help-section">
                <h4>About BWC Module</h4>
                <p>The BWC module uses the current User PID to open the Axon inventory portal.</p>
                <p><strong>Important:</strong> No information is written back into ServiceNow.</p>

                <h4>How It Works</h4>
                <ol>
                    <li>Reads the User PID from the current form</li>
                    <li>Builds a URL using the configured base URL and query template</li>
                    <li>Opens the Axon portal in a new tab</li>
                </ol>

                <h4>Configuration</h4>
                <div class="ocsd-form-group">
                    <label>Base URL</label>
                    <input type="text" id="ocsd-bwc-base-url" class="ocsd-input" value="${baseUrl}" />
                    <small>The base URL of your Axon portal</small>
                </div>

                <div class="ocsd-form-group">
                    <label>Query Template</label>
                    <input type="text" id="ocsd-bwc-query-template" class="ocsd-input" value="${queryTemplate}" />
                    <small>Query string with token substitution</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" id="ocsd-bwc-enabled" ${enabled ? 'checked' : ''} /> Enabled
                    </label>
                </div>

                <h4>Example Query Templates</h4>
                <ul>
                    <li><code>?pid=\${field:user}</code></li>
                    <li><code>?filter=user:\${field:user}</code></li>
                    <li><code>?search=\${field:user}&type=equipment</code></li>
                </ul>

                <div class="ocsd-button-group">
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-bwc-save-btn">Save Configuration</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-bwc-test-btn">Test BWC Link</button>
                </div>
            </div>
        `;
    }

    /**
     * X10 tab HTML
     */
    function getX10HTML() {
        const AL = window.OCSDArmoryLink;
        const settings = AL.settings?.getAll() || {};
        const baseUrl = settings.x10BaseUrl || 'https://taser-portal.com/inventory';
        const queryTemplate = settings.x10QueryTemplate || '?pid=${field:user}';
        const enabled = settings.x10Enabled !== false;

        return `
            <h3>X10 (TASER)</h3>
            <div class="ocsd-help-section">
                <h4>About X10 Module</h4>
                <p>The X10 module uses the current User PID to open the TASER/X10 portal.</p>
                <p><strong>Important:</strong> No information is written back into ServiceNow.</p>

                <h4>How It Works</h4>
                <ol>
                    <li>Reads the User PID from the current form</li>
                    <li>Builds a URL using the configured base URL and query template</li>
                    <li>Opens the TASER portal in a new tab</li>
                </ol>

                <h4>Configuration</h4>
                <div class="ocsd-form-group">
                    <label>Base URL</label>
                    <input type="text" id="ocsd-x10-base-url" class="ocsd-input" value="${baseUrl}" />
                    <small>The base URL of your TASER portal</small>
                </div>

                <div class="ocsd-form-group">
                    <label>Query Template</label>
                    <input type="text" id="ocsd-x10-query-template" class="ocsd-input" value="${queryTemplate}" />
                    <small>Query string with token substitution</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" id="ocsd-x10-enabled" ${enabled ? 'checked' : ''} /> Enabled
                    </label>
                </div>

                <h4>Example Query Templates</h4>
                <ul>
                    <li><code>?pid=\${field:user}</code></li>
                    <li><code>?user=\${field:user}&device=taser</code></li>
                    <li><code>?search=\${field:user}</code></li>
                </ul>

                <div class="ocsd-button-group">
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-x10-save-btn">Save Configuration</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-x10-test-btn">Test X10 Link</button>
                </div>
            </div>
        `;
    }

    /**
     * Help tab HTML
     */
    function getHelpHTML() {
        return `
            <h3>ArmoryLink Help & Documentation</h3>

            <div class="ocsd-help-section">
                <h4>Welcome to OCSD ArmoryLink</h4>
                <p>ArmoryLink is a comprehensive Tampermonkey userscript that automates ServiceNow form filling using barcode scanner input. This help guide covers all features and functionality.</p>
            </div>

            <div class="ocsd-help-section">
                <h4>🔑 Keyboard Shortcuts</h4>
                <table class="ocsd-help-table">
                    <tr>
                        <th>Shortcut</th>
                        <th>Action</th>
                    </tr>
                    <tr>
                        <td><code>Ctrl + Shift + B</code></td>
                        <td>Toggle ArmoryLink panel visibility</td>
                    </tr>
                    <tr>
                        <td><code>/</code> (slash prefix)</td>
                        <td>Return directive - marks scan as a return transaction</td>
                    </tr>
                    <tr>
                        <td><code>*</code> (star prefix)</td>
                        <td>Deployment directive - marks scan as a deployment</td>
                    </tr>
                </table>
            </div>

            <div class="ocsd-help-section">
                <h4>📋 How It Works</h4>
                <ol>
                    <li><strong>Scan Capture:</strong> ArmoryLink listens for barcode scanner input (simulated keyboard events)</li>
                    <li><strong>Rules Processing:</strong> Scans are matched against configured rules using pattern matching</li>
                    <li><strong>Field Injection:</strong> Matched data is automatically written to ServiceNow form fields</li>
                    <li><strong>Queue Management:</strong> All scans are queued and processed sequentially</li>
                </ol>
            </div>

            <div class="ocsd-help-section">
                <h4>🔧 Token Substitution</h4>
                <p>Rules and actions support powerful token substitution for dynamic field mapping:</p>

                <table class="ocsd-help-table">
                    <tr>
                        <th>Token</th>
                        <th>Description</th>
                        <th>Example</th>
                    </tr>
                    <tr>
                        <td><code>\${scan}</code></td>
                        <td>The full scanned value</td>
                        <td>ABC123</td>
                    </tr>
                    <tr>
                        <td><code>\${directive}</code></td>
                        <td>The directive (/, *)</td>
                        <td>/</td>
                    </tr>
                    <tr>
                        <td><code>\${0}</code></td>
                        <td>Full regex match</td>
                        <td>ABC123</td>
                    </tr>
                    <tr>
                        <td><code>\${1}</code>, <code>\${2}</code>, etc.</td>
                        <td>Regex capture groups</td>
                        <td>ABC (from pattern ^([A-Z]+))</td>
                    </tr>
                    <tr>
                        <td><code>\${field:user}</code></td>
                        <td>Read value from field</td>
                        <td>Current user PID</td>
                    </tr>
                </table>

                <p><strong>Example Rule Action:</strong></p>
                <code>vehicle = \${1}-DEPT-\${field:department}</code>
                <p>This would set the vehicle field to something like "V123-DEPT-PATROL"</p>
            </div>

            <div class="ocsd-help-section">
                <h4>📊 Tabs Overview</h4>
                <ul>
                    <li><strong>Dashboard:</strong> Quick overview of system status and recent activity</li>
                    <li><strong>Queue:</strong> View pending scans, scan history, and export data</li>
                    <li><strong>Debug:</strong> View system logs for troubleshooting</li>
                    <li><strong>Settings:</strong> Configure global preferences and behavior</li>
                    <li><strong>Rules:</strong> Create and manage pattern matching rules</li>
                    <li><strong>Fields:</strong> Configure ServiceNow field mappings and selectors</li>
                    <li><strong>Prefixes:</strong> Manage scan prefixes for categorization</li>
                    <li><strong>BWC:</strong> Body camera integration configuration</li>
                    <li><strong>X10:</strong> TASER/X10 portal integration</li>
                    <li><strong>Help:</strong> This help documentation</li>
                </ul>
            </div>

            <div class="ocsd-help-section">
                <h4>❓ Troubleshooting</h4>

                <h5>Panel doesn't appear</h5>
                <ul>
                    <li>Press <code>Ctrl + Shift + B</code> to toggle panel visibility</li>
                    <li>Check that Tampermonkey is enabled for this page</li>
                    <li>Refresh the page and check the browser console for errors</li>
                </ul>

                <h5>Scans not being captured</h5>
                <ul>
                    <li>Check Queue tab - mode should be "on" (green)</li>
                    <li>Ensure barcode scanner is configured as keyboard wedge</li>
                    <li>Check Debug tab for capture events</li>
                    <li>Verify no other script is intercepting keyboard events</li>
                </ul>

                <h5>Fields not being filled</h5>
                <ul>
                    <li>Check Rules tab - ensure appropriate rule exists and is enabled</li>
                    <li>Check Fields tab - verify field selectors are correct for current form</li>
                    <li>Use field detection test button (🔍) to check if fields are found</li>
                    <li>Check Debug tab for field write errors</li>
                </ul>

                <h5>Rules not matching</h5>
                <ul>
                    <li>Verify pattern syntax (regex vs exact match)</li>
                    <li>Check pattern type setting (regex/string/startsWith/etc)</li>
                    <li>Test pattern against sample scans</li>
                    <li>Check rule priority order</li>
                </ul>

                <h5>Data persistence issues</h5>
                <ul>
                    <li>Check browser localStorage is enabled</li>
                    <li>Verify Tampermonkey has storage permissions</li>
                    <li>Check for localStorage quota exceeded errors</li>
                    <li>Try export/import to backup/restore configuration</li>
                </ul>
            </div>

            <div class="ocsd-help-section">
                <h4>💡 Tips & Best Practices</h4>
                <ul>
                    <li><strong>Test rules:</strong> Create and test rules with known good data before production use</li>
                    <li><strong>Use prefixes:</strong> Leverage prefixes for scan categorization and routing</li>
                    <li><strong>Monitor history:</strong> Check Queue > History regularly to ensure scans are processing correctly</li>
                    <li><strong>Export configs:</strong> Regularly export your rules and settings as backup</li>
                    <li><strong>Check logs:</strong> Use Debug tab to investigate issues and verify behavior</li>
                    <li><strong>Field detection:</strong> Always test field detection before deploying to new form types</li>
                </ul>
            </div>

            <div class="ocsd-help-section">
                <h4>🔒 Privacy & Security</h4>
                <p>ArmoryLink operates entirely client-side within your browser:</p>
                <ul>
                    <li>No data is transmitted to external servers</li>
                    <li>All configuration is stored locally in browser storage</li>
                    <li>Only interacts with ServiceNow pages you visit</li>
                    <li>Does not intercept or log credentials</li>
                </ul>
            </div>

            <div class="ocsd-help-section">
                <h4>📝 Version Information</h4>
                <p><strong>ArmoryLink Version:</strong> 1.0.0</p>
                <p><strong>Author:</strong> OCSD Development Team</p>
                <p><strong>License:</strong> Internal Use Only</p>
            </div>
        `;
    }

    /**
     * Settings tab HTML
     */
    /**
     * Queue tab HTML
     */
    function getQueueHTML() {
        const AL = window.OCSDArmoryLink;
        const queueStatus = AL.capture?.getQueueStatus() || { length: 0, locked: false, mode: 'standby', isLeader: false, queue: [] };
        const queue = queueStatus.queue || [];
        const history = AL.scanHistory?.getAll({ limit: 20 }) || [];
        const stats = AL.scanHistory?.getStats() || { total: 0, successful: 0, failed: 0, successRate: 0 };

        // Build queue items HTML
        let queueItemsHTML = queue.length > 0
            ? queue.map((item, index) => `
                <div class="ocsd-queue-item" data-index="${index}">
                    <div class="ocsd-queue-item-header">
                        <strong>#${index + 1}</strong>
                        <span class="ocsd-queue-item-scan">${item}</span>
                    </div>
                </div>
            `).join('')
            : '<p class="ocsd-empty-state">Queue is empty</p>';

        // Build history items HTML
        let historyItemsHTML = history.length > 0
            ? history.map(entry => {
                const timestamp = new Date(entry.timestamp).toLocaleTimeString();
                const statusClass = entry.success ? 'ocsd-history-success' : 'ocsd-history-error';
                const statusIcon = entry.success ? '✓' : '✗';
                return `
                    <div class="ocsd-history-item ${statusClass}">
                        <div class="ocsd-history-header">
                            <span class="ocsd-history-status">${statusIcon}</span>
                            <span class="ocsd-history-scan">${entry.scan}</span>
                            <span class="ocsd-history-time">${timestamp}</span>
                        </div>
                        ${entry.directive ? `<div class="ocsd-history-meta">Directive: ${entry.directive}</div>` : ''}
                        ${entry.ruleMatched ? `<div class="ocsd-history-meta">Rule: ${entry.ruleMatched}</div>` : ''}
                        ${entry.fieldsSet.length > 0 ? `<div class="ocsd-history-meta">Fields set: ${entry.fieldsSet.length}</div>` : ''}
                        ${entry.error ? `<div class="ocsd-history-error">Error: ${entry.error}</div>` : ''}
                    </div>
                `;
            }).join('')
            : '<p class="ocsd-empty-state">No scan history</p>';

        return `
            <h3>Scan Queue & History</h3>

            <!-- Status Overview -->
            <div class="ocsd-status-grid">
                <div class="ocsd-status-card">
                    <div class="ocsd-status-label">Queue Length</div>
                    <div class="ocsd-status-value">${queueStatus.length}</div>
                </div>
                <div class="ocsd-status-card">
                    <div class="ocsd-status-label">Mode</div>
                    <div class="ocsd-status-value ocsd-status-mode-${queueStatus.mode}">${queueStatus.mode}</div>
                </div>
                <div class="ocsd-status-card">
                    <div class="ocsd-status-label">History Total</div>
                    <div class="ocsd-status-value">${stats.total}</div>
                </div>
                <div class="ocsd-status-card">
                    <div class="ocsd-status-label">Success Rate</div>
                    <div class="ocsd-status-value">${stats.successRate}%</div>
                </div>
            </div>

            <!-- Queue Controls -->
            <div class="ocsd-queue-controls">
                <div class="ocsd-button-group">
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-queue-enable-btn">Enable Capture</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-queue-standby-btn">Standby</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-queue-disable-btn">Disable</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-queue-clear-btn">Clear Queue</button>
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-queue-refresh-btn">Refresh</button>
                </div>
            </div>

            <!-- Current Queue -->
            <div class="ocsd-queue-section">
                <h4>Pending Scans (${queue.length})</h4>
                <div class="ocsd-queue-list">
                    ${queueItemsHTML}
                </div>
            </div>

            <!-- History Section -->
            <div class="ocsd-history-section">
                <div class="ocsd-history-header">
                    <h4>Scan History (${stats.total} total)</h4>
                    <div class="ocsd-button-group">
                        <button class="ocsd-btn ocsd-btn-sm" id="ocsd-history-export-json-btn">Export JSON</button>
                        <button class="ocsd-btn ocsd-btn-sm" id="ocsd-history-export-csv-btn">Export CSV</button>
                        <button class="ocsd-btn ocsd-btn-sm ocsd-btn-danger" id="ocsd-history-clear-btn">Clear History</button>
                    </div>
                </div>

                <!-- History Filters -->
                <div class="ocsd-history-filters">
                    <select id="ocsd-history-filter-status" class="ocsd-select">
                        <option value="">All Status</option>
                        <option value="success">Success Only</option>
                        <option value="error">Errors Only</option>
                    </select>
                    <input type="text" id="ocsd-history-search" class="ocsd-input" placeholder="Search scans..." />
                </div>

                <!-- History List -->
                <div class="ocsd-history-list">
                    ${historyItemsHTML}
                </div>

                <!-- History Stats -->
                <div class="ocsd-history-stats">
                    <p><strong>Statistics:</strong> ${stats.successful} successful, ${stats.failed} failed</p>
                </div>
            </div>
        `;
    }

    /**
     * Debug tab HTML
     */
    function getDebugHTML() {
        const AL = window.OCSDArmoryLink;
        const logger = AL.stubs?.DebugLogger;
        const logs = logger ? logger.getLogs({ limit: 100 }) : [];
        const sources = logger ? logger.getSources() : [];

        let logsHTML = '<p><em>No log entries</em></p>';
        if (logs.length > 0) {
            logsHTML = logs.slice().reverse().map(log => `
                <div class="ocsd-log-entry ocsd-log-${log.level}">
                    <span class="ocsd-log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span class="ocsd-log-source">[${log.source}]</span>
                    <span class="ocsd-log-message">${log.message}</span>
                </div>
            `).join('');
        }

        return `
            <h3>Debug Logs</h3>
            <div class="ocsd-debug-controls">
                <select id="ocsd-log-level-filter" class="ocsd-select">
                    <option value="">All Levels</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                </select>
                <select id="ocsd-log-source-filter" class="ocsd-select">
                    <option value="">All Sources</option>
                    ${sources.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <input type="text" id="ocsd-log-search" class="ocsd-input" placeholder="Search logs..." />
                <button class="ocsd-btn ocsd-btn-primary" id="ocsd-log-export-btn">Export</button>
                <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-log-clear-btn">Clear</button>
            </div>
            <div id="ocsd-log-list" class="ocsd-log-list">
                ${logsHTML}
            </div>
        `;
    }

    /**
     * Settings tab HTML
     */
    function getSettingsHTML() {
        const AL = window.OCSDArmoryLink;
        const schema = AL.settings?.getSchema() || {};
        const currentSettings = AL.settings?.getAll() || {};

        let html = '<h3>Settings</h3>';

        Object.entries(schema).forEach(([categoryKey, categoryData]) => {
            html += `<div class="ocsd-settings-category">
                <h4>${categoryData.label}</h4>`;

            Object.entries(categoryData.settings).forEach(([settingKey, setting]) => {
                const value = currentSettings[settingKey];

                html += `<div class="ocsd-form-group">`;

                switch (setting.type) {
                    case 'boolean':
                        html += `
                            <label>
                                <input type="checkbox"
                                       class="ocsd-setting-input"
                                       data-setting="${settingKey}"
                                       ${value ? 'checked' : ''} />
                                ${setting.label}
                            </label>
                            <small>${setting.description}</small>
                        `;
                        break;

                    case 'number':
                        html += `
                            <label>${setting.label}</label>
                            <input type="number"
                                   class="ocsd-setting-input ocsd-input"
                                   data-setting="${settingKey}"
                                   value="${value}"
                                   min="${setting.min || 0}"
                                   max="${setting.max || 999999}" />
                            <small>${setting.description}</small>
                        `;
                        break;

                    case 'select':
                        html += `
                            <label>${setting.label}</label>
                            <select class="ocsd-setting-input ocsd-select" data-setting="${settingKey}">
                                ${setting.options.map(opt => `
                                    <option value="${opt.value}" ${value === opt.value ? 'selected' : ''}>
                                        ${opt.label}
                                    </option>
                                `).join('')}
                            </select>
                            <small>${setting.description}</small>
                        `;
                        break;
                }

                html += `</div>`;
            });

            html += `</div>`;
        });

        html += `
            <div class="ocsd-button-group">
                <button class="ocsd-btn ocsd-btn-primary" id="ocsd-settings-export-btn">Export Config</button>
                <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-settings-import-btn">Import Config</button>
                <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-settings-reset-btn">Reset to Defaults</button>
            </div>
        `;

        return html;
    }

    /**
     * Attach handlers for dashboard tab
     */
    function attachDashboardHandlers() {
        const AL = window.OCSDArmoryLink;

        // Export config button
        const exportBtn = document.getElementById('ocsd-dashboard-export-config');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                AL.exportManager?.exportToFile();
            });
        }

        // Clear logs button
        const clearBtn = document.getElementById('ocsd-dashboard-clear-logs');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Clear all debug logs?')) {
                    AL.stubs?.DebugLogger?.clearLogs();
                    AL.stubs?.toast('Debug logs cleared', 'success', { duration: 1500 });
                    loadCurrentTab(); // Refresh dashboard to show updated stats
                }
            });
        }

        // Refresh dashboard button
        const refreshBtn = document.getElementById('ocsd-dashboard-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                loadCurrentTab();
                AL.stubs?.toast('Dashboard refreshed', 'info', { duration: 1000 });
            });
        }
    }

    /**
     * Attach handlers for queue tab
     */
    function attachQueueHandlers() {
        const AL = window.OCSDArmoryLink;

        // Queue control buttons
        const enableBtn = document.getElementById('ocsd-queue-enable-btn');
        if (enableBtn) {
            enableBtn.addEventListener('click', () => {
                AL.capture?.setMode('on');
                AL.stubs?.toast('Capture enabled', 'success');
                setTimeout(() => loadCurrentTab(), 100);
            });
        }

        const standbyBtn = document.getElementById('ocsd-queue-standby-btn');
        if (standbyBtn) {
            standbyBtn.addEventListener('click', () => {
                AL.capture?.setMode('standby');
                AL.stubs?.toast('Capture in standby', 'info');
                setTimeout(() => loadCurrentTab(), 100);
            });
        }

        const disableBtn = document.getElementById('ocsd-queue-disable-btn');
        if (disableBtn) {
            disableBtn.addEventListener('click', () => {
                AL.capture?.setMode('off');
                AL.stubs?.toast('Capture disabled', 'info');
                setTimeout(() => loadCurrentTab(), 100);
            });
        }

        const clearQueueBtn = document.getElementById('ocsd-queue-clear-btn');
        if (clearQueueBtn) {
            clearQueueBtn.addEventListener('click', () => {
                if (confirm('Clear all pending scans from queue?')) {
                    AL.capture?.clearQueue?.();
                    AL.stubs?.toast('Queue cleared', 'success');
                    loadCurrentTab();
                }
            });
        }

        const refreshBtn = document.getElementById('ocsd-queue-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                loadCurrentTab();
                AL.stubs?.toast('Refreshed', 'success', { duration: 1000 });
            });
        }

        // History export buttons
        const exportJSONBtn = document.getElementById('ocsd-history-export-json-btn');
        if (exportJSONBtn) {
            exportJSONBtn.addEventListener('click', () => {
                const json = AL.scanHistory?.exportJSON();
                if (json) {
                    downloadFile('scan-history.json', json, 'application/json');
                    AL.stubs?.toast('History exported as JSON', 'success');
                } else {
                    AL.stubs?.toast('No history to export', 'warn');
                }
            });
        }

        const exportCSVBtn = document.getElementById('ocsd-history-export-csv-btn');
        if (exportCSVBtn) {
            exportCSVBtn.addEventListener('click', () => {
                const csv = AL.scanHistory?.exportCSV();
                if (csv) {
                    downloadFile('scan-history.csv', csv, 'text/csv');
                    AL.stubs?.toast('History exported as CSV', 'success');
                } else {
                    AL.stubs?.toast('No history to export', 'warn');
                }
            });
        }

        const clearHistoryBtn = document.getElementById('ocsd-history-clear-btn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => {
                if (confirm('Clear all scan history? This cannot be undone.')) {
                    AL.scanHistory?.clear();
                    AL.stubs?.toast('History cleared', 'success');
                    loadCurrentTab();
                }
            });
        }

        // History filters
        const filterStatus = document.getElementById('ocsd-history-filter-status');
        const searchInput = document.getElementById('ocsd-history-search');

        function applyHistoryFilters() {
            const status = filterStatus?.value;
            const query = searchInput?.value;

            const options = { limit: 20 };
            if (status === 'success') options.success = true;
            else if (status === 'error') options.success = false;
            if (query) options.query = query;

            const history = AL.scanHistory?.getAll(options) || [];
            const historyList = document.querySelector('.ocsd-history-list');

            if (historyList) {
                if (history.length === 0) {
                    historyList.innerHTML = '<p class="ocsd-empty-state">No matching history entries</p>';
                } else {
                    historyList.innerHTML = history.map(entry => {
                        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
                        const statusClass = entry.success ? 'ocsd-history-success' : 'ocsd-history-error';
                        const statusIcon = entry.success ? '✓' : '✗';
                        return `
                            <div class="ocsd-history-item ${statusClass}">
                                <div class="ocsd-history-header">
                                    <span class="ocsd-history-status">${statusIcon}</span>
                                    <span class="ocsd-history-scan">${entry.scan}</span>
                                    <span class="ocsd-history-time">${timestamp}</span>
                                </div>
                                ${entry.directive ? `<div class="ocsd-history-meta">Directive: ${entry.directive}</div>` : ''}
                                ${entry.ruleMatched ? `<div class="ocsd-history-meta">Rule: ${entry.ruleMatched}</div>` : ''}
                                ${entry.fieldsSet.length > 0 ? `<div class="ocsd-history-meta">Fields set: ${entry.fieldsSet.length}</div>` : ''}
                                ${entry.error ? `<div class="ocsd-history-error">Error: ${entry.error}</div>` : ''}
                            </div>
                        `;
                    }).join('');
                }
            }
        }

        if (filterStatus) {
            filterStatus.addEventListener('change', applyHistoryFilters);
        }

        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(applyHistoryFilters, 300);
            });
        }

        /**
         * Helper function to download file
         */
        function downloadFile(filename, content, mimeType) {
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    /**
     * Attach handlers for debug tab
     */
    function attachDebugHandlers() {
        const AL = window.OCSDArmoryLink;

        // Export button
        const exportBtn = document.getElementById('ocsd-log-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const logger = AL.stubs?.DebugLogger;
                if (logger) {
                    const data = logger.exportLogs();
                    const json = JSON.stringify(data, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `armorylink_logs_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                }
            });
        }

        // Clear button
        const clearBtn = document.getElementById('ocsd-log-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Clear all debug logs?')) {
                    AL.stubs?.DebugLogger?.clearLogs();
                    loadCurrentTab();
                }
            });
        }

        // Filter handlers
        ['ocsd-log-level-filter', 'ocsd-log-source-filter', 'ocsd-log-search'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => filterLogs());
                el.addEventListener('input', () => filterLogs());
            }
        });
    }

    /**
     * Attach handlers for settings tab
     */
    function attachSettingsHandlers() {
        const AL = window.OCSDArmoryLink;

        // All setting inputs
        const settingInputs = document.querySelectorAll('.ocsd-setting-input');
        settingInputs.forEach(input => {
            input.addEventListener('change', (e) => {
                const key = e.target.dataset.setting;
                let value;

                if (e.target.type === 'checkbox') {
                    value = e.target.checked;
                } else if (e.target.type === 'number') {
                    value = parseInt(e.target.value, 10);
                } else {
                    value = e.target.value;
                }

                AL.settings?.set(key, value);
                AL.stubs?.toast(`Setting updated: ${key}`, 'success', { duration: 1500 });
            });
        });

        // Export button
        const exportBtn = document.getElementById('ocsd-settings-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                AL.exportManager?.exportToFile();
            });
        }

        // Import button
        const importBtn = document.getElementById('ocsd-settings-import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                AL.exportManager?.importFromFile();
            });
        }

        // Reset button
        const resetBtn = document.getElementById('ocsd-settings-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Reset all settings to defaults?')) {
                    AL.settings?.reset();
                    loadCurrentTab();
                    AL.stubs?.toast('Settings reset to defaults', 'success');
                }
            });
        }
    }

    /**
     * Attach handlers for rules tab
     */
    function attachRulesHandlers() {
        const AL = window.OCSDArmoryLink;

        // Add rule button
        const addRuleBtn = document.getElementById('ocsd-add-rule-btn');
        if (addRuleBtn) {
            addRuleBtn.addEventListener('click', () => {
                showRuleEditor();
            });
        }

        // Edit rule buttons
        document.querySelectorAll('.ocsd-rule-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ruleId = e.target.dataset.ruleId;
                const rules = AL.rules?.getRules() || [];
                const rule = rules.find(r => r.id === ruleId);
                if (rule) {
                    showRuleEditor(rule);
                }
            });
        });

        // Delete rule buttons
        document.querySelectorAll('.ocsd-rule-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ruleId = e.target.dataset.ruleId;
                const rules = AL.rules?.getRules() || [];
                const rule = rules.find(r => r.id === ruleId);

                if (rule && confirm(`Delete rule "${rule.name}"?`)) {
                    deleteRule(ruleId);
                    AL.stubs?.toast(`Rule deleted: ${rule.name}`, 'success', { duration: 2000 });
                }
            });
        });

        // Test pattern button
        const testPatternBtn = document.getElementById('ocsd-test-pattern-btn');
        if (testPatternBtn) {
            testPatternBtn.addEventListener('click', () => {
                const input = document.getElementById('ocsd-test-input')?.value;
                const pattern = document.getElementById('ocsd-test-pattern')?.value;
                const patternType = document.getElementById('ocsd-test-pattern-type')?.value;

                if (!input || !pattern) {
                    AL.stubs?.toast('Please enter both test input and pattern', 'warn', { duration: 2000 });
                    return;
                }

                testPattern(input, pattern, patternType);
            });
        }
    }

    /**
     * Test pattern matching
     */
    function testPattern(input, pattern, patternType) {
        const resultsDiv = document.getElementById('ocsd-test-results');
        if (!resultsDiv) return;

        let matches = false;
        let groups = [];
        let error = null;

        try {
            switch (patternType) {
                case 'regex':
                    const regex = new RegExp(pattern);
                    const match = input.match(regex);
                    matches = match !== null;
                    if (match) {
                        groups = match.slice(1); // Capture groups
                    }
                    break;
                case 'string':
                    matches = input === pattern;
                    break;
                case 'startsWith':
                    matches = input.startsWith(pattern);
                    break;
                case 'contains':
                    matches = input.includes(pattern);
                    break;
                case 'endsWith':
                    matches = input.endsWith(pattern);
                    break;
            }
        } catch (e) {
            error = e.message;
        }

        if (error) {
            resultsDiv.innerHTML = `
                <div class="ocsd-test-result ocsd-test-error">
                    <strong>Error:</strong> ${error}
                </div>
            `;
        } else if (matches) {
            let groupsHTML = '';
            if (groups.length > 0) {
                groupsHTML = `
                    <div class="ocsd-capture-groups">
                        <strong>Capture Groups:</strong>
                        <ul>
                            ${groups.map((g, i) => `<li>Group ${i + 1}: <code>${g}</code></li>`).join('')}
                        </ul>
                    </div>
                `;
            }
            resultsDiv.innerHTML = `
                <div class="ocsd-test-result ocsd-test-success">
                    <strong>✓ Match Found</strong>
                    ${groupsHTML}
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `
                <div class="ocsd-test-result ocsd-test-failure">
                    <strong>✗ No Match</strong>
                    <p>The pattern did not match the test input.</p>
                </div>
            `;
        }
    }

    /**
     * Attach handlers for fields tab
     */
    function attachFieldsHandlers() {
        const refreshBtn = document.getElementById('ocsd-refresh-fields-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                loadCurrentTab();
                window.OCSDArmoryLink.stubs?.toast('Field detection refreshed', 'info', { duration: 1500 });
            });
        }
    }

    /**
     * Attach handlers for prefixes tab
     */
    function attachPrefixesHandlers() {
        const AL = window.OCSDArmoryLink;

        // Add prefix button
        const addPrefixBtn = document.getElementById('ocsd-add-prefix-btn');
        if (addPrefixBtn) {
            addPrefixBtn.addEventListener('click', () => {
                showPrefixEditor();
            });
        }

        // Edit prefix buttons
        document.querySelectorAll('.ocsd-prefix-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const prefixId = e.target.dataset.prefixId;
                const prefixes = AL.prefixes?.getAll() || [];
                const prefix = prefixes.find(p => p.id === prefixId);
                if (prefix) {
                    showPrefixEditor(prefix);
                }
            });
        });

        // Delete prefix buttons
        document.querySelectorAll('.ocsd-prefix-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const prefixId = e.target.dataset.prefixId;
                const prefixes = AL.prefixes?.getAll() || [];
                const prefix = prefixes.find(p => p.id === prefixId);

                if (prefix && confirm(`Delete prefix "${prefix.name}"?`)) {
                    deletePrefix(prefixId);
                    AL.stubs?.toast(`Prefix deleted: ${prefix.name}`, 'success', { duration: 2000 });
                }
            });
        });

        // Set active prefix buttons
        document.querySelectorAll('.ocsd-prefix-set-active').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const prefixId = e.target.dataset.prefixId;
                togglePrefixActive(prefixId);
            });
        });
    }

    /**
     * Attach handlers for Fields tab
     */
    function attachFieldsHandlers() {
        const AL = window.OCSDArmoryLink;

        // Add field button
        const addFieldBtn = document.getElementById('ocsd-add-field-btn');
        if (addFieldBtn) {
            addFieldBtn.addEventListener('click', () => {
                showFieldEditor();
            });
        }

        // Refresh fields button
        const refreshFieldsBtn = document.getElementById('ocsd-refresh-fields-btn');
        if (refreshFieldsBtn) {
            refreshFieldsBtn.addEventListener('click', () => {
                loadCurrentTab();
                AL.stubs?.toast('Field detection refreshed', 'success', { duration: 1500 });
            });
        }

        // Reset all fields button
        const resetAllFieldsBtn = document.getElementById('ocsd-reset-all-fields-btn');
        if (resetAllFieldsBtn) {
            resetAllFieldsBtn.addEventListener('click', () => {
                resetAllFields();
            });
        }

        // Edit field buttons
        document.querySelectorAll('.ocsd-field-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const fieldKey = e.target.dataset.fieldKey;
                showFieldEditor(fieldKey);
            });
        });

        // Delete field buttons
        document.querySelectorAll('.ocsd-field-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const fieldKey = e.target.dataset.fieldKey;
                const field = AL.fields?.get(fieldKey);

                if (field && confirm(`Delete field "${field.label}"?`)) {
                    deleteField(fieldKey);
                }
            });
        });

        // Reset field buttons
        document.querySelectorAll('.ocsd-field-reset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const fieldKey = e.target.dataset.fieldKey;
                const field = AL.fields?.get(fieldKey);

                if (field && confirm(`Reset field "${field.label}" to default?`)) {
                    resetField(fieldKey);
                }
            });
        });

        // Test field detection buttons
        document.querySelectorAll('.ocsd-field-test').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const fieldKey = e.target.dataset.fieldKey;
                testFieldDetection(fieldKey);
            });
        });
    }

    /**
     * Attach handlers for BWC tab
     */
    function attachBWCHandlers() {
        const AL = window.OCSDArmoryLink;

        // Save configuration button
        const saveBtn = document.getElementById('ocsd-bwc-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const baseUrl = document.getElementById('ocsd-bwc-base-url')?.value;
                const queryTemplate = document.getElementById('ocsd-bwc-query-template')?.value;
                const enabled = document.getElementById('ocsd-bwc-enabled')?.checked;

                // Save to settings
                AL.settings?.set('bwcBaseUrl', baseUrl);
                AL.settings?.set('bwcQueryTemplate', queryTemplate);
                AL.settings?.set('bwcEnabled', enabled);

                AL.stubs?.toast('BWC configuration saved', 'success', { duration: 2000 });
            });
        }

        // Test BWC link button
        const testBtn = document.getElementById('ocsd-bwc-test-btn');
        if (testBtn) {
            testBtn.addEventListener('click', () => {
                const baseUrl = document.getElementById('ocsd-bwc-base-url')?.value;
                const queryTemplate = document.getElementById('ocsd-bwc-query-template')?.value;
                const enabled = document.getElementById('ocsd-bwc-enabled')?.checked;

                if (!enabled) {
                    AL.stubs?.toast('BWC is disabled', 'warn', { duration: 2000 });
                    return;
                }

                if (!baseUrl) {
                    AL.stubs?.toast('Please enter a base URL', 'warn', { duration: 2000 });
                    return;
                }

                // Build test URL (using placeholder for user field)
                const testUrl = baseUrl + (queryTemplate || '').replace(/\$\{field:user\}/g, 'TEST_USER');
                window.open(testUrl, '_blank');
                AL.stubs?.toast('Opening BWC portal...', 'info', { duration: 2000 });
            });
        }
    }

    /**
     * Attach handlers for X10 tab
     */
    function attachX10Handlers() {
        const AL = window.OCSDArmoryLink;

        // Save configuration button
        const saveBtn = document.getElementById('ocsd-x10-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const baseUrl = document.getElementById('ocsd-x10-base-url')?.value;
                const queryTemplate = document.getElementById('ocsd-x10-query-template')?.value;
                const enabled = document.getElementById('ocsd-x10-enabled')?.checked;

                // Save to settings
                AL.settings?.set('x10BaseUrl', baseUrl);
                AL.settings?.set('x10QueryTemplate', queryTemplate);
                AL.settings?.set('x10Enabled', enabled);

                AL.stubs?.toast('X10 configuration saved', 'success', { duration: 2000 });
            });
        }

        // Test X10 link button
        const testBtn = document.getElementById('ocsd-x10-test-btn');
        if (testBtn) {
            testBtn.addEventListener('click', () => {
                const baseUrl = document.getElementById('ocsd-x10-base-url')?.value;
                const queryTemplate = document.getElementById('ocsd-x10-query-template')?.value;
                const enabled = document.getElementById('ocsd-x10-enabled')?.checked;

                if (!enabled) {
                    AL.stubs?.toast('X10 is disabled', 'warn', { duration: 2000 });
                    return;
                }

                if (!baseUrl) {
                    AL.stubs?.toast('Please enter a base URL', 'warn', { duration: 2000 });
                    return;
                }

                // Build test URL (using placeholder for user field)
                const testUrl = baseUrl + (queryTemplate || '').replace(/\$\{field:user\}/g, 'TEST_USER');
                window.open(testUrl, '_blank');
                AL.stubs?.toast('Opening X10 portal...', 'info', { duration: 2000 });
            });
        }
    }

    /**
     * Filter logs
     */
    function filterLogs() {
        const AL = window.OCSDArmoryLink;
        const logger = AL.stubs?.DebugLogger;
        if (!logger) return;

        const level = document.getElementById('ocsd-log-level-filter')?.value;
        const source = document.getElementById('ocsd-log-source-filter')?.value;
        const search = document.getElementById('ocsd-log-search')?.value;

        const logs = logger.getLogs({
            level: level || null,
            source: source || null,
            search: search || null,
            limit: 100
        });

        const logList = document.getElementById('ocsd-log-list');
        if (logList) {
            if (logs.length === 0) {
                logList.innerHTML = '<p><em>No matching log entries</em></p>';
            } else {
                logList.innerHTML = logs.slice().reverse().map(log => `
                    <div class="ocsd-log-entry ocsd-log-${log.level}">
                        <span class="ocsd-log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span class="ocsd-log-source">[${log.source}]</span>
                        <span class="ocsd-log-message">${log.message}</span>
                    </div>
                `).join('');
            }
        }
    }

    /**
     * Update status badges in header
     */
    function updateStatusBadges() {
        const badgesEl = document.getElementById('ocsd-status-badges');
        if (!badgesEl) return;

        const AL = window.OCSDArmoryLink;
        const leaderStatus = AL.broadcast?.getLeaderStatus();
        const queueStatus = AL.capture?.getQueueStatus();

        let badges = '';

        if (leaderStatus && leaderStatus.isLeader) {
            badges += '<span class="ocsd-badge ocsd-badge-leader">LEADER</span>';
        }

        if (queueStatus && queueStatus.mode === 'on') {
            badges += '<span class="ocsd-badge ocsd-badge-active">ACTIVE</span>';
        }

        badgesEl.innerHTML = badges;
    }

    /**
     * Create and show a modal
     */
    function showModal(title, bodyHTML, onSave, onCancel) {
        // Remove existing modal if any
        let overlay = document.getElementById('ocsd-modal-overlay');
        if (overlay) {
            overlay.remove();
        }

        // Create modal overlay
        overlay = document.createElement('div');
        overlay.id = 'ocsd-modal-overlay';
        overlay.className = 'ocsd-modal-overlay ocsd-modal-visible';

        overlay.innerHTML = `
            <div class="ocsd-modal">
                <div class="ocsd-modal-header">
                    <h3>${title}</h3>
                    <button class="ocsd-modal-close" id="ocsd-modal-close-btn">×</button>
                </div>
                <div class="ocsd-modal-body" id="ocsd-modal-body">
                    ${bodyHTML}
                </div>
                <div class="ocsd-modal-footer">
                    <button class="ocsd-btn ocsd-btn-secondary" id="ocsd-modal-cancel-btn">Cancel</button>
                    <button class="ocsd-btn ocsd-btn-primary" id="ocsd-modal-save-btn">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Close button
        document.getElementById('ocsd-modal-close-btn').addEventListener('click', () => {
            overlay.remove();
            if (onCancel) onCancel();
        });

        // Cancel button
        document.getElementById('ocsd-modal-cancel-btn').addEventListener('click', () => {
            overlay.remove();
            if (onCancel) onCancel();
        });

        // Save button
        document.getElementById('ocsd-modal-save-btn').addEventListener('click', () => {
            if (onSave) {
                const result = onSave();
                if (result !== false) {
                    overlay.remove();
                }
            }
        });

        // Click outside to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                if (onCancel) onCancel();
            }
        });

        return overlay;
    }

    /**
     * Show rule editor modal
     */
    function showRuleEditor(rule = null) {
        const isEdit = !!rule;
        const ruleData = rule || {
            id: 'rule-' + Date.now(),
            name: '',
            description: '',
            enabled: true,
            patternType: 'regex',
            pattern: '',
            directiveGroupIndex: null,
            continueOnMatch: false,
            actions: []
        };

        const bodyHTML = `
            <div class="ocsd-form-row">
                <label>Rule Name *</label>
                <input type="text" id="ocsd-rule-name" class="ocsd-input" value="${ruleData.name || ''}" placeholder="My Rule" />
                <span class="ocsd-form-hint">A descriptive name for this rule</span>
            </div>

            <div class="ocsd-form-row">
                <label>Description</label>
                <input type="text" id="ocsd-rule-description" class="ocsd-input" value="${ruleData.description || ''}" placeholder="What this rule does" />
            </div>

            <div class="ocsd-form-row">
                <label>
                    <input type="checkbox" id="ocsd-rule-enabled" ${ruleData.enabled ? 'checked' : ''} />
                    Enabled
                </label>
            </div>

            <div class="ocsd-form-row">
                <label>Pattern Type *</label>
                <select id="ocsd-rule-pattern-type" class="ocsd-select">
                    <option value="regex" ${ruleData.patternType === 'regex' ? 'selected' : ''}>Regex</option>
                    <option value="string" ${ruleData.patternType === 'string' ? 'selected' : ''}>String (exact match)</option>
                    <option value="startsWith" ${ruleData.patternType === 'startsWith' ? 'selected' : ''}>Starts With</option>
                    <option value="contains" ${ruleData.patternType === 'contains' ? 'selected' : ''}>Contains</option>
                    <option value="endsWith" ${ruleData.patternType === 'endsWith' ? 'selected' : ''}>Ends With</option>
                </select>
            </div>

            <div class="ocsd-form-row">
                <label>Pattern *</label>
                <input type="text" id="ocsd-rule-pattern" class="ocsd-input" value="${ruleData.pattern || ''}" placeholder="^([/*])(\\d{5})$" />
                <span class="ocsd-form-hint">The pattern to match against scanned input</span>
            </div>

            <div class="ocsd-form-row">
                <label>Directive Group Index (optional)</label>
                <input type="number" id="ocsd-rule-directive-index" class="ocsd-input" value="${ruleData.directiveGroupIndex !== null && ruleData.directiveGroupIndex !== undefined ? ruleData.directiveGroupIndex : ''}" placeholder="1" min="0" />
                <span class="ocsd-form-hint">Capture group index containing / or * symbol (for regex patterns)</span>
            </div>

            <div class="ocsd-form-row">
                <label>
                    <input type="checkbox" id="ocsd-rule-continue" ${ruleData.continueOnMatch ? 'checked' : ''} />
                    Continue matching other rules after this one
                </label>
            </div>

            <div class="ocsd-form-row">
                <label>Actions</label>
                <div id="ocsd-rule-actions-container" class="ocsd-actions-list">
                    ${(ruleData.actions || []).map((action, idx) => `
                        <div class="ocsd-action-item" data-action-index="${idx}">
                            <select class="ocsd-select ocsd-action-field">
                                <option value="type" ${action.field === 'type' ? 'selected' : ''}>Type</option>
                                <option value="user" ${action.field === 'user' ? 'selected' : ''}>User</option>
                                <option value="externalContact" ${action.field === 'externalContact' ? 'selected' : ''}>External Contact</option>
                                <option value="department" ${action.field === 'department' ? 'selected' : ''}>Department</option>
                                <option value="vehicle" ${action.field === 'vehicle' ? 'selected' : ''}>Vehicle</option>
                                <option value="weapon" ${action.field === 'weapon' ? 'selected' : ''}>Weapon</option>
                                <option value="taser" ${action.field === 'taser' ? 'selected' : ''}>Taser</option>
                                <option value="patrol" ${action.field === 'patrol' ? 'selected' : ''}>Patrol</option>
                                <option value="controlOneRadio" ${action.field === 'controlOneRadio' ? 'selected' : ''}>Control One Radio</option>
                                <option value="comments" ${action.field === 'comments' ? 'selected' : ''}>Comments</option>
                            </select>
                            <input type="text" class="ocsd-input ocsd-action-value" value="${action.value || ''}" placeholder="\${directive} or \${1}" />
                            <button class="ocsd-btn ocsd-btn-danger ocsd-btn-sm ocsd-action-remove">Remove</button>
                        </div>
                    `).join('')}
                </div>
                <button class="ocsd-btn ocsd-btn-secondary ocsd-btn-sm" id="ocsd-add-action-btn" style="margin-top: 8px;">Add Action</button>
                <span class="ocsd-form-hint">Actions set field values. Use tokens: \${scan}, \${directive}, \${0}-\${9}, \${field:key}</span>
            </div>
        `;

        showModal(isEdit ? 'Edit Rule' : 'Create New Rule', bodyHTML, () => {
            // Validate and save
            const name = document.getElementById('ocsd-rule-name').value.trim();
            const pattern = document.getElementById('ocsd-rule-pattern').value.trim();

            if (!name) {
                window.OCSDArmoryLink.stubs?.toast('Rule name is required', 'error', { duration: 2000 });
                return false;
            }

            if (!pattern) {
                window.OCSDArmoryLink.stubs?.toast('Pattern is required', 'error', { duration: 2000 });
                return false;
            }

            // Build rule object
            const newRule = {
                id: ruleData.id,
                name: name,
                description: document.getElementById('ocsd-rule-description').value.trim(),
                enabled: document.getElementById('ocsd-rule-enabled').checked,
                patternType: document.getElementById('ocsd-rule-pattern-type').value,
                pattern: pattern,
                directiveGroupIndex: document.getElementById('ocsd-rule-directive-index').value ? parseInt(document.getElementById('ocsd-rule-directive-index').value) : null,
                continueOnMatch: document.getElementById('ocsd-rule-continue').checked,
                actions: []
            };

            // Collect actions
            const actionItems = document.querySelectorAll('.ocsd-action-item');
            actionItems.forEach(item => {
                const field = item.querySelector('.ocsd-action-field').value;
                const value = item.querySelector('.ocsd-action-value').value;
                if (field && value) {
                    newRule.actions.push({
                        id: 'action-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                        type: 'setField',
                        enabled: true,
                        field: field,
                        value: value
                    });
                }
            });

            // Save rule
            if (isEdit) {
                updateRule(newRule);
            } else {
                addRule(newRule);
            }

            window.OCSDArmoryLink.stubs?.toast(`Rule ${isEdit ? 'updated' : 'created'}: ${name}`, 'success', { duration: 2000 });
            loadCurrentTab(); // Refresh rules list
        });

        // Add action button handler
        document.getElementById('ocsd-add-action-btn').addEventListener('click', () => {
            const container = document.getElementById('ocsd-rule-actions-container');
            const newAction = document.createElement('div');
            newAction.className = 'ocsd-action-item';
            newAction.innerHTML = `
                <select class="ocsd-select ocsd-action-field">
                    <option value="type">Type</option>
                    <option value="user">User</option>
                    <option value="externalContact">External Contact</option>
                    <option value="department">Department</option>
                    <option value="vehicle">Vehicle</option>
                    <option value="weapon">Weapon</option>
                    <option value="taser">Taser</option>
                    <option value="patrol">Patrol</option>
                    <option value="controlOneRadio">Control One Radio</option>
                    <option value="comments">Comments</option>
                </select>
                <input type="text" class="ocsd-input ocsd-action-value" placeholder="\${directive} or \${1}" />
                <button class="ocsd-btn ocsd-btn-danger ocsd-btn-sm ocsd-action-remove">Remove</button>
            `;
            container.appendChild(newAction);

            // Attach remove handler
            newAction.querySelector('.ocsd-action-remove').addEventListener('click', () => {
                newAction.remove();
            });
        });

        // Remove action handlers
        document.querySelectorAll('.ocsd-action-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.ocsd-action-item').remove();
            });
        });
    }

    /**
     * Add a new rule
     */
    function addRule(rule) {
        const AL = window.OCSDArmoryLink;
        if (!AL.rules) return;

        const rules = AL.rules.getRules();
        rules.push(rule);
        AL.rules.setRules(rules);

        // Save to persistence
        saveRulesToPersistence(rules);
    }

    /**
     * Update an existing rule
     */
    function updateRule(updatedRule) {
        const AL = window.OCSDArmoryLink;
        if (!AL.rules) return;

        const rules = AL.rules.getRules();
        const index = rules.findIndex(r => r.id === updatedRule.id);
        if (index !== -1) {
            rules[index] = updatedRule;
            AL.rules.setRules(rules);

            // Save to persistence
            saveRulesToPersistence(rules);
        }
    }

    /**
     * Delete a rule
     */
    function deleteRule(ruleId) {
        const AL = window.OCSDArmoryLink;
        if (!AL.rules) return;

        const rules = AL.rules.getRules().filter(r => r.id !== ruleId);
        AL.rules.setRules(rules);

        // Save to persistence
        saveRulesToPersistence(rules);

        loadCurrentTab(); // Refresh rules list
    }

    /**
     * Save rules to persistence
     */
    function saveRulesToPersistence(rules) {
        const AL = window.OCSDArmoryLink;
        if (AL.persistence) {
            AL.persistence.save('rules', rules);
        }
    }

    /**
     * Load rules from persistence
     */
    function loadRulesFromPersistence() {
        const AL = window.OCSDArmoryLink;
        if (AL.persistence) {
            const stored = AL.persistence.load('rules');
            if (stored && Array.isArray(stored)) {
                return stored;
            }
        }
        return null;
    }

    /**
     * Show prefix editor modal
     */
    function showPrefixEditor(prefix = null) {
        const isEdit = !!prefix;
        const prefixData = prefix || {
            id: 'prefix-' + Date.now(),
            name: '',
            value: '',
            description: '',
            active: false
        };

        const bodyHTML = `
            <div class="ocsd-form-row">
                <label>Prefix Name *</label>
                <input type="text" id="ocsd-prefix-name" class="ocsd-input" value="${prefixData.name || ''}" placeholder="Department A" />
                <span class="ocsd-form-hint">A descriptive name for this prefix</span>
            </div>

            <div class="ocsd-form-row">
                <label>Prefix Value *</label>
                <input type="text" id="ocsd-prefix-value" class="ocsd-input" value="${prefixData.value || ''}" placeholder="DEPT-A-" />
                <span class="ocsd-form-hint">The text to prepend to all scans (e.g., "DEPT-A-", "NORTH-", "BWC-")</span>
            </div>

            <div class="ocsd-form-row">
                <label>Description</label>
                <input type="text" id="ocsd-prefix-description" class="ocsd-input" value="${prefixData.description || ''}" placeholder="Used for Department A operations" />
                <span class="ocsd-form-hint">Optional description of when to use this prefix</span>
            </div>

            <div class="ocsd-form-row">
                <label>
                    <input type="checkbox" id="ocsd-prefix-active" ${prefixData.active ? 'checked' : ''} />
                    Set as active prefix immediately
                </label>
                <span class="ocsd-form-hint">Active prefix will be prepended to all scans</span>
            </div>
        `;

        showModal(isEdit ? 'Edit Prefix' : 'Create New Prefix', bodyHTML, () => {
            // Validate and save
            const name = document.getElementById('ocsd-prefix-name').value.trim();
            const value = document.getElementById('ocsd-prefix-value').value.trim();

            if (!name) {
                window.OCSDArmoryLink.stubs?.toast('Prefix name is required', 'error', { duration: 2000 });
                return false;
            }

            if (!value) {
                window.OCSDArmoryLink.stubs?.toast('Prefix value is required', 'error', { duration: 2000 });
                return false;
            }

            // Build prefix object
            const newPrefix = {
                id: prefixData.id,
                name: name,
                value: value,
                description: document.getElementById('ocsd-prefix-description').value.trim(),
                active: document.getElementById('ocsd-prefix-active').checked
            };

            // Save prefix
            if (isEdit) {
                updatePrefix(newPrefix);
            } else {
                addPrefix(newPrefix);
            }

            window.OCSDArmoryLink.stubs?.toast(`Prefix ${isEdit ? 'updated' : 'created'}: ${name}`, 'success', { duration: 2000 });
            loadCurrentTab(); // Refresh prefixes list
        });
    }

    /**
     * Add a new prefix
     */
    function addPrefix(prefix) {
        const AL = window.OCSDArmoryLink;
        if (!AL.prefixes) return;

        // If this prefix is being set as active, deactivate others
        if (prefix.active) {
            const prefixes = AL.prefixes.getAll();
            prefixes.forEach(p => p.active = false);
            AL.prefixes.setAll(prefixes);
        }

        AL.prefixes.add(prefix);
    }

    /**
     * Update an existing prefix
     */
    function updatePrefix(updatedPrefix) {
        const AL = window.OCSDArmoryLink;
        if (!AL.prefixes) return;

        // If this prefix is being set as active, deactivate others
        if (updatedPrefix.active) {
            const prefixes = AL.prefixes.getAll();
            prefixes.forEach(p => {
                if (p.id !== updatedPrefix.id) {
                    p.active = false;
                }
            });
            AL.prefixes.setAll(prefixes);
        }

        AL.prefixes.update(updatedPrefix);
    }

    /**
     * Delete a prefix
     */
    function deletePrefix(prefixId) {
        const AL = window.OCSDArmoryLink;
        if (!AL.prefixes) return;

        AL.prefixes.remove(prefixId);
        loadCurrentTab(); // Refresh prefixes list
    }

    /**
     * Toggle prefix active status
     */
    function togglePrefixActive(prefixId) {
        const AL = window.OCSDArmoryLink;
        if (!AL.prefixes) return;

        const prefixes = AL.prefixes.getAll();
        const prefix = prefixes.find(p => p.id === prefixId);

        if (!prefix) return;

        // If toggling on, deactivate all others
        if (!prefix.active) {
            prefixes.forEach(p => p.active = false);
            prefix.active = true;
            AL.stubs?.toast(`Active prefix: ${prefix.name}`, 'success', { duration: 2000 });
        } else {
            // Toggling off
            prefix.active = false;
            AL.stubs?.toast('No active prefix', 'info', { duration: 2000 });
        }

        AL.prefixes.setAll(prefixes);
        loadCurrentTab(); // Refresh to show updated active state
    }

    // >>> FIELD EDITOR FUNCTIONS START

    /**
     * Show field editor modal (for create or edit)
     * @param {string|null} fieldKey - Field key for editing, null for creating
     */
    function showFieldEditor(fieldKey = null) {
        const AL = window.OCSDArmoryLink;
        const isEdit = !!fieldKey;
        const field = isEdit ? AL.fields?.get(fieldKey) : null;

        const fieldData = field || {
            key: '',
            label: '',
            selector: '',
            commitEvent: 'change',
            roles: ['read', 'write'],
            description: ''
        };

        // Build roles checkboxes
        const roles = ['ticker', 'read', 'write'];
        const rolesHTML = roles.map(role => `
            <label style="display: inline-block; margin-right: 16px;">
                <input type="checkbox" class="ocsd-field-role-checkbox" value="${role}" ${fieldData.roles && fieldData.roles.includes(role) ? 'checked' : ''} />
                ${role}
            </label>
        `).join('');

        const bodyHTML = `
            <div class="ocsd-form-row">
                <label>Field Key * ${isEdit ? '(cannot be changed)' : ''}</label>
                <input type="text" id="ocsd-field-key" class="ocsd-input" value="${fieldData.key || ''}" placeholder="myField" ${isEdit ? 'disabled' : ''} />
                <small>Unique identifier for this field (camelCase recommended)</small>
            </div>

            <div class="ocsd-form-row">
                <label>Field Label *</label>
                <input type="text" id="ocsd-field-label" class="ocsd-input" value="${fieldData.label || ''}" placeholder="My Field" />
                <small>Human-readable label displayed in UI</small>
            </div>

            <div class="ocsd-form-row">
                <label>CSS Selector *</label>
                <input type="text" id="ocsd-field-selector" class="ocsd-input" value="${fieldData.selector || ''}" placeholder="input[name='x_loaner.my_field']" />
                <small>CSS selector to locate the field element on ServiceNow forms</small>
            </div>

            <div class="ocsd-form-row">
                <label>Commit Event</label>
                <select id="ocsd-field-commit-event" class="ocsd-select">
                    <option value="change" ${fieldData.commitEvent === 'change' ? 'selected' : ''}>change</option>
                    <option value="blur" ${fieldData.commitEvent === 'blur' ? 'selected' : ''}>blur</option>
                    <option value="input" ${fieldData.commitEvent === 'input' ? 'selected' : ''}>input</option>
                </select>
                <small>DOM event to dispatch after writing to field</small>
            </div>

            <div class="ocsd-form-row">
                <label>Roles</label>
                <div id="ocsd-field-roles">
                    ${rolesHTML}
                </div>
                <small>ticker: Shown in quick display | read: Can read value | write: Can write value</small>
            </div>

            <div class="ocsd-form-row">
                <label>Description (optional)</label>
                <textarea id="ocsd-field-description" class="ocsd-input" rows="2" placeholder="Brief description of this field">${fieldData.description || ''}</textarea>
            </div>
        `;

        showModal(
            isEdit ? `Edit Field: ${fieldData.label}` : 'Create New Field',
            bodyHTML,
            () => {
                // Validation
                const key = isEdit ? fieldKey : document.getElementById('ocsd-field-key').value.trim();
                const label = document.getElementById('ocsd-field-label').value.trim();
                const selector = document.getElementById('ocsd-field-selector').value.trim();
                const commitEvent = document.getElementById('ocsd-field-commit-event').value;
                const description = document.getElementById('ocsd-field-description').value.trim();

                // Get selected roles
                const selectedRoles = Array.from(document.querySelectorAll('.ocsd-field-role-checkbox:checked'))
                    .map(cb => cb.value);

                if (!key) {
                    AL.stubs?.toast('Field key is required', 'error');
                    return false; // Keep modal open
                }

                if (!label) {
                    AL.stubs?.toast('Field label is required', 'error');
                    return false;
                }

                if (!selector) {
                    AL.stubs?.toast('CSS selector is required', 'error');
                    return false;
                }

                const newField = {
                    key,
                    label,
                    selector,
                    commitEvent,
                    roles: selectedRoles,
                    description
                };

                if (isEdit) {
                    updateField(key, newField);
                } else {
                    addField(newField);
                }

                return true; // Close modal
            },
            () => {
                // Cancel - just close modal
            }
        );
    }

    /**
     * Add new field
     * @param {object} field - Field definition object
     */
    function addField(field) {
        const AL = window.OCSDArmoryLink;
        const success = AL.fields?.add(field);

        if (success) {
            AL.stubs?.toast(`Field added: ${field.label}`, 'success');
            loadCurrentTab(); // Refresh to show new field
        } else {
            AL.stubs?.toast(`Failed to add field (key may already exist)`, 'error');
        }
    }

    /**
     * Update existing field
     * @param {string} key - Field key
     * @param {object} updates - Field properties to update
     */
    function updateField(key, updates) {
        const AL = window.OCSDArmoryLink;
        const success = AL.fields?.update(key, updates);

        if (success) {
            AL.stubs?.toast(`Field updated: ${updates.label}`, 'success');
            loadCurrentTab(); // Refresh to show updated field
        } else {
            AL.stubs?.toast(`Failed to update field`, 'error');
        }
    }

    /**
     * Delete field
     * @param {string} key - Field key
     */
    function deleteField(key) {
        const AL = window.OCSDArmoryLink;
        const field = AL.fields?.get(key);

        if (!field) return;

        if (field.isDefault && !field.modified) {
            AL.stubs?.toast('Cannot delete default fields', 'error');
            return;
        }

        const success = AL.fields?.remove(key);

        if (success) {
            AL.stubs?.toast(`Field deleted: ${field.label}`, 'success');
            loadCurrentTab(); // Refresh to remove deleted field
        } else {
            AL.stubs?.toast(`Failed to delete field`, 'error');
        }
    }

    /**
     * Reset field to default
     * @param {string} key - Field key
     */
    function resetField(key) {
        const AL = window.OCSDArmoryLink;
        const success = AL.fields?.reset(key);

        if (success) {
            AL.stubs?.toast(`Field reset to default: ${key}`, 'success');
            loadCurrentTab(); // Refresh to show reset field
        } else {
            AL.stubs?.toast(`Cannot reset field (not a default field)`, 'error');
        }
    }

    /**
     * Reset all fields to defaults
     */
    function resetAllFields() {
        const AL = window.OCSDArmoryLink;

        if (!confirm('Reset all fields to defaults? This will remove all customizations.')) {
            return;
        }

        AL.fields?.resetAll();
        AL.stubs?.toast('All fields reset to defaults', 'success');
        loadCurrentTab(); // Refresh to show reset fields
    }

    /**
     * Test field detection
     * @param {string} key - Field key
     */
    function testFieldDetection(key) {
        const AL = window.OCSDArmoryLink;
        const field = AL.fields?.get(key);

        if (!field) return;

        const detected = AL.fields?.detect(key);

        if (detected) {
            AL.stubs?.toast(`✓ Field detected: ${field.label}`, 'success');
        } else {
            AL.stubs?.toast(`✗ Field not found: ${field.label}`, 'error');
        }
    }

    // <<< FIELD EDITOR FUNCTIONS END

    /**
     * Old settings HTML (replaced)
     */
    function getSettingsHTML_OLD() {
        return `
            <h3>Settings</h3>
            <div class="ocsd-help-section">
                <h4>General Configuration</h4>

                <div class="ocsd-form-group">
                    <h4>Directives</h4>
                    <p>ArmoryLink uses <strong>symbol-based directives</strong>. Slash / and star * symbols are used as directive prefixes:</p>
                    <ul>
                        <li><strong>/</strong> = Return</li>
                        <li><strong>*</strong> = Deployment</li>
                    </ul>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" checked /> Enable Scan Capture
                    </label>
                    <small>Automatically capture barcode scanner input</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" checked /> Enable Rules Engine
                    </label>
                    <small>Process scans through pattern matching rules</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" checked /> Enable Auto-Fill
                    </label>
                    <small>Automatically fill fields based on rule matches</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" checked /> Enable BWC Integration
                    </label>
                    <small>Allow opening Axon portal links</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" checked /> Enable X10 Integration
                    </label>
                    <small>Allow opening TASER portal links</small>
                </div>

                <div class="ocsd-form-group">
                    <label>Scan Delay (ms)</label>
                    <input type="number" class="ocsd-input" value="100" />
                    <small>Time to wait for complete scan input</small>
                </div>

                <div class="ocsd-form-group">
                    <label>Commit Delay (ms)</label>
                    <input type="number" class="ocsd-input" value="250" />
                    <small>Time to wait before committing field changes</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" checked /> Show Notifications
                    </label>
                    <small>Display toast notifications for actions</small>
                </div>

                <div class="ocsd-form-group">
                    <label>
                        <input type="checkbox" /> Debug Mode
                    </label>
                    <small>Enable detailed console logging</small>
                </div>

                <button class="ocsd-btn ocsd-btn-primary">Save Settings</button>
                <button class="ocsd-btn ocsd-btn-secondary">Reset to Defaults</button>
                <button class="ocsd-btn ocsd-btn-danger">Clear All Data</button>
            </div>
        `;
    }

    /**
     * Show the panel
     */
    function show() {
        if (panelEl) {
            panelEl.classList.remove('ocsd-hidden');
            if (bubbleEl) {
                bubbleEl.style.display = 'none';
            }
        }
    }

    /**
     * Hide the panel
     */
    function hide() {
        if (panelEl) {
            panelEl.classList.add('ocsd-hidden');
        }
        if (bubbleEl) {
            bubbleEl.style.display = 'none';
        }
    }

    /**
     * Toggle panel visibility
     */
    function toggle() {
        if (panelEl) {
            if (panelEl.classList.contains('ocsd-hidden')) {
                show();
            } else {
                hide();
            }
        }
    }

    return {
        init,
        show,
        hide,
        toggle,
        switchTab
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.ui = UIModule;
}

// <<< MODULE: ui END

// >>> MODULE: persistence START

const PersistenceModule = (() => {
    // Namespace prefix for all keys
    const NAMESPACE = 'ocsdArmoryLink_';

    /**
     * Get namespaced key
     * @param {string} key - Original key
     * @returns {string} Namespaced key
     */
    function getNamespacedKey(key) {
        return NAMESPACE + key;
    }

    /**
     * Strip namespace from key
     * @param {string} namespacedKey - Namespaced key
     * @returns {string} Original key
     */
    function stripNamespace(namespacedKey) {
        return namespacedKey.startsWith(NAMESPACE)
            ? namespacedKey.substring(NAMESPACE.length)
            : namespacedKey;
    }

    /**
     * Save data to persistent storage
     * @param {string} key - Storage key
     * @param {any} value - Value to store (will be JSON serialized)
     */
    function save(key, value) {
        try {
            const namespacedKey = getNamespacedKey(key);
            const serialized = JSON.stringify(value);
            GM_setValue(namespacedKey, serialized);
        } catch (error) {
            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('error', 'persistence',
                    `Failed to save key: ${key}`, { error: error.message });
            }
        }
    }

    /**
     * Load data from persistent storage
     * @param {string} key - Storage key
     * @param {any} defaultValue - Default value if key doesn't exist
     * @returns {any} Loaded value or default
     */
    function load(key, defaultValue = null) {
        try {
            const namespacedKey = getNamespacedKey(key);
            const serialized = GM_getValue(namespacedKey);

            if (serialized === undefined || serialized === null) {
                return defaultValue;
            }

            return JSON.parse(serialized);
        } catch (error) {
            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('error', 'persistence',
                    `Failed to load key: ${key}`, { error: error.message });
            }
            return defaultValue;
        }
    }

    /**
     * Remove a key from persistent storage
     * @param {string} key - Storage key
     */
    function remove(key) {
        try {
            const namespacedKey = getNamespacedKey(key);
            GM_deleteValue(namespacedKey);
        } catch (error) {
            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('error', 'persistence',
                    `Failed to remove key: ${key}`, { error: error.message });
            }
        }
    }

    /**
     * List all keys in storage (without namespace prefix)
     * @returns {string[]} Array of storage keys
     */
    function listKeys() {
        try {
            const allKeys = GM_listValues();
            return allKeys
                .filter(key => key.startsWith(NAMESPACE))
                .map(key => stripNamespace(key));
        } catch (error) {
            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('error', 'persistence',
                    'Failed to list keys', { error: error.message });
            }
            return [];
        }
    }

    /**
     * Clear all storage (or just namespaced keys)
     * @param {boolean} prefixOnly - If true, only clear namespaced keys
     */
    function clearAll(prefixOnly = true) {
        try {
            const allKeys = GM_listValues();

            if (prefixOnly) {
                // Only clear our namespaced keys
                allKeys
                    .filter(key => key.startsWith(NAMESPACE))
                    .forEach(key => GM_deleteValue(key));
            } else {
                // Clear all keys
                allKeys.forEach(key => GM_deleteValue(key));
            }

            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('info', 'persistence',
                    `Cleared ${prefixOnly ? 'namespaced' : 'all'} keys`);
            }
        } catch (error) {
            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('error', 'persistence',
                    'Failed to clear storage', { error: error.message });
            }
        }
    }

    return {
        save,
        load,
        remove,
        listKeys,
        clearAll
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.persistence = PersistenceModule;
}

// <<< MODULE: persistence END

// >>> MODULE: exportManager START

const ExportManagerModule = (() => {
    /**
     * Export all configuration to JSON
     */
    function exportAll() {
        const AL = window.OCSDArmoryLink;

        const data = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            data: {
                rules: AL.rules?.getRules() || [],
                prefixes: AL.prefixes?.getAll() || [],
                macros: AL.macros?.getAll() || [],
                bwcConfig: AL.bwc?.getConfig() || {},
                x10Config: AL.x10?.getConfig() || {},
                settings: AL.persistence?.load('settings') || {}
            }
        };

        return data;
    }

    /**
     * Import configuration from JSON
     */
    function importAll(data) {
        const AL = window.OCSDArmoryLink;

        if (!data || !data.data) {
            throw new Error('Invalid import data');
        }

        const results = {
            success: true,
            imported: {},
            errors: []
        };

        try {
            // Import rules
            if (data.data.rules && Array.isArray(data.data.rules)) {
                AL.rules?.setRules(data.data.rules);
                results.imported.rules = data.data.rules.length;
            }

            // Import prefixes
            if (data.data.prefixes && Array.isArray(data.data.prefixes)) {
                AL.prefixes?.setAll(data.data.prefixes);
                results.imported.prefixes = data.data.prefixes.length;
            }

            // Import macros
            if (data.data.macros && Array.isArray(data.data.macros)) {
                AL.macros?.setAll(data.data.macros);
                results.imported.macros = data.data.macros.length;
            }

            // Import BWC config
            if (data.data.bwcConfig) {
                AL.bwc?.setConfig(data.data.bwcConfig);
                results.imported.bwcConfig = true;
            }

            // Import X10 config
            if (data.data.x10Config) {
                AL.x10?.setConfig(data.data.x10Config);
                results.imported.x10Config = true;
            }

            // Import settings
            if (data.data.settings) {
                AL.persistence?.save('settings', data.data.settings);
                results.imported.settings = true;
            }

        } catch (err) {
            results.success = false;
            results.errors.push(err.message);
        }

        return results;
    }

    /**
     * Export configuration to downloadable JSON file
     */
    function exportToFile(filename = 'ocsd_armorylink_backup.json') {
        const data = exportAll();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);

        if (window.OCSDArmoryLink?.stubs?.toast) {
            window.OCSDArmoryLink.stubs.toast('Configuration exported successfully', 'success');
        }
    }

    /**
     * Import configuration from file
     */
    function importFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) {
                    reject(new Error('No file selected'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        const result = importAll(data);
                        resolve(result);

                        if (window.OCSDArmoryLink?.stubs?.toast) {
                            window.OCSDArmoryLink.stubs.toast('Configuration imported successfully', 'success');
                        }
                    } catch (err) {
                        reject(err);
                        if (window.OCSDArmoryLink?.stubs?.toast) {
                            window.OCSDArmoryLink.stubs.toast(`Import failed: ${err.message}`, 'error');
                        }
                    }
                };

                reader.onerror = () => {
                    reject(new Error('Failed to read file'));
                };

                reader.readAsText(file);
            };

            input.click();
        });
    }

    /**
     * Create a backup in localStorage
     */
    function createBackup() {
        const AL = window.OCSDArmoryLink;
        const data = exportAll();

        // Store backup
        AL.persistence?.save('backup', data);
        AL.persistence?.save('backup_timestamp', Date.now());

        if (AL.stubs?.toast) {
            AL.stubs.toast('Backup created successfully', 'success');
        }

        return data;
    }

    /**
     * Restore from backup
     */
    function restoreBackup() {
        const AL = window.OCSDArmoryLink;
        const backup = AL.persistence?.load('backup');

        if (!backup) {
            if (AL.stubs?.toast) {
                AL.stubs.toast('No backup found', 'error');
            }
            return { success: false, error: 'No backup found' };
        }

        const result = importAll(backup);

        if (result.success && AL.stubs?.toast) {
            AL.stubs.toast('Configuration restored from backup', 'success');
        }

        return result;
    }

    /**
     * Get backup info
     */
    function getBackupInfo() {
        const AL = window.OCSDArmoryLink;
        const backup = AL.persistence?.load('backup');
        const timestamp = AL.persistence?.load('backup_timestamp');

        if (!backup) {
            return null;
        }

        return {
            exists: true,
            timestamp: timestamp || null,
            version: backup.version || 'unknown'
        };
    }

    return {
        exportAll,
        importAll,
        exportToFile,
        importFromFile,
        createBackup,
        restoreBackup,
        getBackupInfo
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.exportManager = ExportManagerModule;
}

// <<< MODULE: exportManager END

// >>> MODULE: prefixes START

const PrefixesModule = (() => {
    // Internal prefixes storage (starts empty, loaded from persistence)
    let prefixes = [];
    let initialized = false;

    /**
     * Initialize prefixes from persistence or defaults
     */
    function init() {
        if (initialized) return;

        // Try to load from persistence if available
        if (window.OCSDArmoryLink?.persistence) {
            const stored = window.OCSDArmoryLink.persistence.load('prefixes');
            if (stored && Array.isArray(stored)) {
                prefixes = stored;
            } else {
                // Load from defaults (which returns empty array)
                if (window.OCSDArmoryLink?.defaultsManager) {
                    const defaults = window.OCSDArmoryLink.defaultsManager.getDefaults();
                    prefixes = defaults.prefixes || [];
                }
            }
        }

        initialized = true;
    }

    /**
     * Get all prefixes
     * @returns {array} Array of prefix objects
     */
    function getAll() {
        init();
        return [...prefixes];
    }

    /**
     * Get prefix by ID
     * @param {string} id - Prefix ID
     * @returns {object|null} Prefix object or null
     */
    function get(id) {
        init();
        return prefixes.find(p => p.id === id) || null;
    }

    /**
     * Add a new prefix
     * @param {object} prefix - Prefix object
     * @returns {boolean} Success status
     */
    function add(prefix) {
        init();

        if (!prefix || !prefix.id) {
            return false;
        }

        // Check if ID already exists
        if (prefixes.some(p => p.id === prefix.id)) {
            return false;
        }

        prefixes.push(prefix);
        save();
        return true;
    }

    /**
     * Update an existing prefix
     * @param {string} id - Prefix ID
     * @param {object} updates - Updated values
     * @returns {boolean} Success status
     */
    function update(id, updates) {
        init();

        const index = prefixes.findIndex(p => p.id === id);
        if (index === -1) {
            return false;
        }

        prefixes[index] = { ...prefixes[index], ...updates, id };
        save();
        return true;
    }

    /**
     * Remove a prefix by ID
     * @param {string} id - Prefix ID
     * @returns {boolean} Success status
     */
    function remove(id) {
        init();

        const initialLength = prefixes.length;
        prefixes = prefixes.filter(p => p.id !== id);

        if (prefixes.length < initialLength) {
            save();
            return true;
        }

        return false;
    }

    /**
     * Clear all prefixes
     */
    function clear() {
        prefixes = [];
        save();
    }

    /**
     * Save prefixes to persistence
     */
    function save() {
        if (window.OCSDArmoryLink?.persistence) {
            window.OCSDArmoryLink.persistence.save('prefixes', prefixes);
        }
    }

    /**
     * Match a scan against all prefixes
     * @param {string} scan - Scanned value
     * @returns {object|null} Matched prefix info or null
     */
    function match(scan) {
        init();

        if (!scan) return null;

        for (const prefix of prefixes) {
            if (!prefix.enabled) continue;

            // Check if scan starts with prefix pattern
            if (scan.startsWith(prefix.pattern)) {
                return {
                    prefix: prefix,
                    matched: prefix.pattern,
                    remainder: scan.substring(prefix.pattern.length)
                };
            }
        }

        return null;
    }

    /**
     * Set prefixes from array (useful for imports/resets)
     * @param {array} newPrefixes - Array of prefix objects
     */
    function setAll(newPrefixes) {
        if (Array.isArray(newPrefixes)) {
            prefixes = newPrefixes;
            initialized = true;
            save();
        }
    }

    return {
        init,
        getAll,
        get,
        add,
        update,
        remove,
        clear,
        match,
        setAll
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.prefixes = PrefixesModule;
}

// <<< MODULE: prefixes END

// >>> MODULE: macros START

const MacrosModule = (() => {
    let macros = [];
    let initialized = false;

    /**
     * Execute a macro by ID
     */
    async function execute(macroId) {
        const macro = macros.find(m => m.id === macroId);

        if (!macro) {
            console.error(`[Macros] Macro not found: ${macroId}`);
            return { success: false, error: 'Macro not found' };
        }

        if (!macro.enabled) {
            console.warn(`[Macros] Macro is disabled: ${macroId}`);
            return { success: false, error: 'Macro is disabled' };
        }

        // Log start
        if (window.OCSDArmoryLink?.stubs?.debugLog) {
            window.OCSDArmoryLink.stubs.debugLog('info', 'macros',
                `Executing macro: ${macro.name}`, { macroId });
        }

        const results = [];
        let success = true;

        // Execute actions in sequence
        for (let i = 0; i < macro.actions.length; i++) {
            const action = macro.actions[i];

            try {
                const result = await executeAction(action);
                results.push({ action, result, success: true });

                // If action has a delay, wait
                if (action.delay && action.delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, action.delay));
                }
            } catch (err) {
                console.error(`[Macros] Action failed:`, err);
                results.push({ action, error: err.message, success: false });
                success = false;

                // Stop on error if configured
                if (macro.stopOnError) {
                    break;
                }
            }
        }

        return {
            success,
            macro,
            results
        };
    }

    /**
     * Execute a single action
     */
    async function executeAction(action) {
        const fields = window.OCSDArmoryLink?.fields;

        switch (action.type) {
            case 'setField':
                if (!fields || !action.field) {
                    throw new Error('Invalid setField action');
                }
                return fields.write(action.field, action.value || '');

            case 'clearField':
                if (!fields || !action.field) {
                    throw new Error('Invalid clearField action');
                }
                return fields.write(action.field, '');

            case 'appendField':
                if (!fields || !action.field) {
                    throw new Error('Invalid appendField action');
                }
                const currentValue = fields.read(action.field) || '';
                return fields.write(action.field, currentValue + (action.value || ''));

            case 'toast':
                if (window.OCSDArmoryLink?.stubs?.toast) {
                    window.OCSDArmoryLink.stubs.toast(action.message, action.toastType || 'info');
                }
                return true;

            case 'openBWC':
                if (window.OCSDArmoryLink?.bwc?.process) {
                    window.OCSDArmoryLink.bwc.process();
                }
                return true;

            case 'openX10':
                if (window.OCSDArmoryLink?.x10?.process) {
                    window.OCSDArmoryLink.x10.process();
                }
                return true;

            case 'delay':
                await new Promise(resolve => setTimeout(resolve, action.duration || 1000));
                return true;

            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }

    /**
     * Get all macros
     */
    function getAll() {
        return [...macros];
    }

    /**
     * Get macro by ID
     */
    function get(macroId) {
        return macros.find(m => m.id === macroId) || null;
    }

    /**
     * Add a new macro
     */
    function add(macro) {
        if (!macro || !macro.id) {
            return false;
        }

        // Check if ID already exists
        if (macros.some(m => m.id === macro.id)) {
            return false;
        }

        macros.push(macro);
        save();
        return true;
    }

    /**
     * Update an existing macro
     */
    function update(macroId, updates) {
        const index = macros.findIndex(m => m.id === macroId);
        if (index === -1) {
            return false;
        }

        macros[index] = { ...macros[index], ...updates, id: macroId };
        save();
        return true;
    }

    /**
     * Remove a macro by ID
     */
    function remove(macroId) {
        const initialLength = macros.length;
        macros = macros.filter(m => m.id !== macroId);

        if (macros.length < initialLength) {
            save();
            return true;
        }

        return false;
    }

    /**
     * Clear all macros
     */
    function clear() {
        macros = [];
        save();
    }

    /**
     * Save macros to persistence
     */
    function save() {
        if (window.OCSDArmoryLink?.persistence) {
            window.OCSDArmoryLink.persistence.save('macros', macros);
        }
    }

    /**
     * Set all macros (useful for imports/resets)
     */
    function setAll(newMacros) {
        if (Array.isArray(newMacros)) {
            macros = newMacros;
            save();
        }
    }

    /**
     * Initialize macros from persistence or defaults
     */
    function init() {
        if (initialized) return;

        // Try to load from persistence
        if (window.OCSDArmoryLink?.persistence) {
            const stored = window.OCSDArmoryLink.persistence.load('macros');
            if (stored && Array.isArray(stored)) {
                macros = stored;
            } else {
                // Load from defaults
                if (window.OCSDArmoryLink?.defaultsManager) {
                    const defaults = window.OCSDArmoryLink.defaultsManager.getDefaults();
                    macros = defaults.macros || [];
                }
            }
        }

        initialized = true;
    }

    return {
        init,
        execute,
        getAll,
        get,
        add,
        update,
        remove,
        clear,
        setAll
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.macros = MacrosModule;
}

// <<< MODULE: macros END

// >>> MODULE: fields START

const FieldsModule = (() => {
    // Default field definitions (immutable reference)
    const defaultFieldDefinitions = {
        type: {
            key: "type",
            label: "Type",
            selector: "input[name='x_loaner.type']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        user: {
            key: "user",
            label: "User",
            selector: "input[name='x_loaner.user']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        externalContact: {
            key: "externalContact",
            label: "External Contact",
            selector: "input[name='x_loaner.external_contact']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        department: {
            key: "department",
            label: "Department",
            selector: "input[name='x_loaner.department']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        vehicle: {
            key: "vehicle",
            label: "Vehicle",
            selector: "input[name='x_loaner.vehicle']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        weapon: {
            key: "weapon",
            label: "Weapon",
            selector: "input[name='x_loaner.weapon']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        taser: {
            key: "taser",
            label: "Taser",
            selector: "input[name='x_loaner.taser']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        patrol: {
            key: "patrol",
            label: "Patrol",
            selector: "input[name='x_loaner.patrol']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        controlOneRadio: {
            key: "controlOneRadio",
            label: "Control One Radio",
            selector: "input[name='x_loaner.control_one_radio']",
            commitEvent: "change",
            roles: ["ticker", "read", "write"],
            isDefault: true
        },
        comments: {
            key: "comments",
            label: "Comments",
            selector: "textarea[name='x_loaner.comments']",
            commitEvent: "blur",
            roles: ["read", "write"],
            isDefault: true
        }
    };

    // Current field definitions (mutable, can be customized)
    let fieldDefinitions = { ...defaultFieldDefinitions };
    let initialized = false;

    /**
     * Initialize fields module - load custom mappings from persistence
     */
    function init() {
        if (initialized) return;

        // Load custom field mappings from persistence if available
        const AL = window.OCSDArmoryLink;
        if (AL?.persistence) {
            const customFields = AL.persistence.load('fieldMappings');
            if (customFields && typeof customFields === 'object') {
                // Merge custom fields with defaults
                fieldDefinitions = { ...defaultFieldDefinitions, ...customFields };
                console.log('[Fields] Loaded custom field mappings from persistence');
            }
        }

        initialized = true;
    }

    /**
     * Save current field mappings to persistence
     */
    function save() {
        const AL = window.OCSDArmoryLink;
        if (AL?.persistence) {
            // Only save custom (non-default) fields
            const customFields = {};
            for (const key in fieldDefinitions) {
                if (!fieldDefinitions[key].isDefault || fieldDefinitions[key].modified) {
                    customFields[key] = fieldDefinitions[key];
                }
            }
            AL.persistence.save('fieldMappings', customFields);
        }
    }

    /**
     * Get field definition by key
     * @param {string} key - Field key
     * @returns {object|null} Field definition or null
     */
    function get(key) {
        return fieldDefinitions[key] || null;
    }

    /**
     * Get all field definitions (shallow copy)
     * @returns {object} Shallow copy of field definitions
     */
    function getAll() {
        return { ...fieldDefinitions };
    }

    /**
     * Get all field keys
     * @returns {string[]} Array of field keys
     */
    function keys() {
        return Object.keys(fieldDefinitions);
    }

    /**
     * Check if field key exists
     * @param {string} key - Field key
     * @returns {boolean} True if field exists
     */
    function exists(key) {
        return key in fieldDefinitions;
    }

    /**
     * Update field definition
     * @param {string} key - Field key
     * @param {object} updates - Field properties to update
     * @returns {boolean} True if successful
     */
    function update(key, updates) {
        if (!exists(key)) return false;

        fieldDefinitions[key] = {
            ...fieldDefinitions[key],
            ...updates,
            key: key, // Ensure key is not changed
            modified: true
        };

        save();
        return true;
    }

    /**
     * Add new custom field definition
     * @param {object} fieldDef - Field definition object
     * @returns {boolean} True if successful
     */
    function add(fieldDef) {
        if (!fieldDef.key || exists(fieldDef.key)) return false;

        fieldDefinitions[fieldDef.key] = {
            key: fieldDef.key,
            label: fieldDef.label || fieldDef.key,
            selector: fieldDef.selector || '',
            commitEvent: fieldDef.commitEvent || 'change',
            roles: fieldDef.roles || ['read', 'write'],
            isDefault: false,
            description: fieldDef.description || ''
        };

        save();
        return true;
    }

    /**
     * Remove custom field definition
     * @param {string} key - Field key
     * @returns {boolean} True if successful (only custom fields can be removed)
     */
    function remove(key) {
        if (!exists(key)) return false;
        if (fieldDefinitions[key].isDefault && !fieldDefinitions[key].modified) {
            return false; // Cannot remove unmodified default fields
        }

        delete fieldDefinitions[key];
        save();
        return true;
    }

    /**
     * Reset field to default definition
     * @param {string} key - Field key
     * @returns {boolean} True if successful
     */
    function reset(key) {
        if (defaultFieldDefinitions[key]) {
            fieldDefinitions[key] = { ...defaultFieldDefinitions[key] };
            save();
            return true;
        }
        return false;
    }

    /**
     * Reset all fields to defaults
     */
    function resetAll() {
        fieldDefinitions = { ...defaultFieldDefinitions };
        save();
    }

    /**
     * Read value from DOM element
     * @param {string} key - Field key
     * @returns {string} Field value or empty string
     */
    function read(key) {
        const field = fieldDefinitions[key];
        if (!field) return "";

        const element = document.querySelector(field.selector);
        if (!element) return "";

        // Check if element has .value property (input, textarea, select)
        if ('value' in element) {
            return element.value || "";
        }

        // Otherwise return textContent
        return element.textContent ? element.textContent.trim() : "";
    }

    /**
     * Write value to DOM element and dispatch events
     * @param {string} key - Field key
     * @param {string} value - Value to write
     * @param {object} options - Options object
     * @param {string} options.commitEvent - Override commit event
     * @returns {boolean} True if successful, false otherwise
     */
    function write(key, value, options = {}) {
        const field = fieldDefinitions[key];
        if (!field) return false;

        const element = document.querySelector(field.selector);
        if (!element) return false;

        // Set value
        if ('value' in element) {
            element.value = value;
        } else {
            element.textContent = value;
        }

        // Dispatch input event (default)
        const inputEvent = new Event('input', { bubbles: true });
        element.dispatchEvent(inputEvent);

        // Dispatch commit event
        const commitEventType = options.commitEvent || field.commitEvent;
        if (commitEventType) {
            const commitEvent = new Event(commitEventType, { bubbles: true });
            element.dispatchEvent(commitEvent);
        }

        return true;
    }

    /**
     * Test field detection on current page
     * @param {string} key - Field key
     * @returns {boolean} True if field element found
     */
    function detect(key) {
        const field = fieldDefinitions[key];
        if (!field) return false;

        return document.querySelector(field.selector) !== null;
    }

    /**
     * Get fields by role
     * @param {string} role - Role name (e.g., "ticker", "read", "write")
     * @returns {object[]} Array of field definitions with that role
     */
    function forRole(role) {
        return Object.values(fieldDefinitions).filter(field =>
            field.roles && field.roles.includes(role)
        );
    }

    /**
     * Get ticker model (fields with "ticker" role)
     * @returns {object[]} Array of {key, label} objects
     */
    function toTickerModel() {
        return forRole("ticker").map(field => ({
            key: field.key,
            label: field.label
        }));
    }

    return {
        init,
        map: fieldDefinitions,
        get,
        getAll,
        keys,
        exists,
        update,
        add,
        remove,
        reset,
        resetAll,
        read,
        write,
        detect,
        forRole,
        toTickerModel,
        save
    };
})();

// Initialize window.OCSDArmoryLink namespace if not exists
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.fields = FieldsModule;
}

// <<< MODULE: fields END

// >>> MODULE: bwc START

const BWCModule = (() => {
    // Configuration for BWC (Axon Body Camera)
    const config = {
        enabled: true,
        baseUrl: "https://axon-portal-url.com/inventory",
        queryTemplate: "?filter=user:${field:user}"
    };

    /**
     * Replace tokens in template string
     * @param {string} template - Template with tokens
     * @param {object} env - Environment with scan and fields
     * @returns {string} String with tokens replaced
     */
    function replaceTokens(template, env) {
        if (!template || typeof template !== 'string') return '';

        let result = template;

        // Replace ${scan}
        if (env.scan !== undefined) {
            result = result.replace(/\$\{scan\}/g, env.scan);
        }

        // Replace ${field:user}
        if (env.fields && env.fields.user !== undefined) {
            result = result.replace(/\$\{field:user\}/g, env.fields.user);
        }

        // Replace any other ${field:<key>} tokens with empty string
        result = result.replace(/\$\{field:[^}]+\}/g, '');

        return result;
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type: "info", "error", "success"
     */
    function showToast(message, type = 'info') {
        // Simple console log for now - can be enhanced with actual toast UI later
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✓' : 'ℹ️';
        console.log(`${prefix} ${message}`);
    }

    /**
     * Broadcast an event
     * @param {string} type - Event type
     * @param {object} data - Event data
     */
    function broadcast(type, data) {
        // Dispatch custom event on window
        const event = new CustomEvent(type, {
            detail: data,
            bubbles: true
        });
        window.dispatchEvent(event);
    }

    /**
     * Process scan and open BWC portal
     * @param {string} scan - Scanned value (optional, for URL building only)
     */
    function process(scan = '') {
        if (!config.enabled) {
            return;
        }

        // Read user PID from fields
        const pid = window.OCSDArmoryLink?.fields?.read('user') || '';

        // Check if PID is empty
        if (!pid || pid.trim() === '') {
            showToast('Cannot open BWC — User field is empty', 'error');
            console.error('BWC: Cannot open - User field is empty');
            return;
        }

        // Build URL with token replacement
        const env = {
            scan: scan,
            fields: {
                user: pid
            }
        };

        const queryString = replaceTokens(config.queryTemplate, env);
        const url = config.baseUrl + queryString;

        // Open URL in new tab
        window.open(url, '_blank');

        // Broadcast event
        broadcast('bwc:opened', { pid, url });

        showToast(`BWC portal opened for user: ${pid}`, 'success');
    }

    /**
     * Get current configuration
     * @returns {object} Current config
     */
    function getConfig() {
        return { ...config };
    }

    /**
     * Update configuration
     * @param {object} newConfig - New configuration values
     */
    function setConfig(newConfig) {
        Object.assign(config, newConfig);
    }

    return {
        process,
        getConfig,
        setConfig
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.bwc = BWCModule;
}

// <<< MODULE: bwc END

// >>> MODULE: x10 START

const X10Module = (() => {
    // Configuration for X10 (TASER)
    const config = {
        enabled: true,
        baseUrl: "https://taser-portal.com/inventory",
        queryTemplate: "?pid=${field:user}"
    };

    /**
     * Replace tokens in template string
     * @param {string} template - Template with tokens
     * @param {object} env - Environment with scan and fields
     * @returns {string} String with tokens replaced
     */
    function replaceTokens(template, env) {
        if (!template || typeof template !== 'string') return '';

        let result = template;

        // Replace ${scan}
        if (env.scan !== undefined) {
            result = result.replace(/\$\{scan\}/g, env.scan);
        }

        // Replace ${field:user}
        if (env.fields && env.fields.user !== undefined) {
            result = result.replace(/\$\{field:user\}/g, env.fields.user);
        }

        // Replace any other ${field:<key>} tokens with empty string
        result = result.replace(/\$\{field:[^}]+\}/g, '');

        return result;
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type: "info", "error", "success"
     */
    function showToast(message, type = 'info') {
        // Simple console log for now - can be enhanced with actual toast UI later
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✓' : 'ℹ️';
        console.log(`${prefix} ${message}`);
    }

    /**
     * Broadcast an event
     * @param {string} type - Event type
     * @param {object} data - Event data
     */
    function broadcast(type, data) {
        // Dispatch custom event on window
        const event = new CustomEvent(type, {
            detail: data,
            bubbles: true
        });
        window.dispatchEvent(event);
    }

    /**
     * Process scan and open X10 portal
     * @param {string} scan - Scanned value (optional, for URL building only)
     */
    function process(scan = '') {
        if (!config.enabled) {
            return;
        }

        // Read user PID from fields
        const pid = window.OCSDArmoryLink?.fields?.read('user') || '';

        // Check if PID is empty
        if (!pid || pid.trim() === '') {
            showToast('Cannot open X10 — User field is empty', 'error');
            console.error('X10: Cannot open - User field is empty');
            return;
        }

        // Build URL with token replacement
        const env = {
            scan: scan,
            fields: {
                user: pid
            }
        };

        const queryString = replaceTokens(config.queryTemplate, env);
        const url = config.baseUrl + queryString;

        // Open URL in new tab
        window.open(url, '_blank');

        // Broadcast event
        broadcast('x10:opened', { pid, url });

        showToast(`X10 portal opened for user: ${pid}`, 'success');
    }

    /**
     * Get current configuration
     * @returns {object} Current config
     */
    function getConfig() {
        return { ...config };
    }

    /**
     * Update configuration
     * @param {object} newConfig - New configuration values
     */
    function setConfig(newConfig) {
        Object.assign(config, newConfig);
    }

    return {
        process,
        getConfig,
        setConfig
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.x10 = X10Module;
}

// <<< MODULE: x10 END

// >>> MODULE: activeContext START

const ActiveContextModule = (() => {
    let currentContext = null;
    let lastDetection = null;
    let observers = [];

    /**
     * Detect active context based on URL and DOM
     */
    function detect() {
        const url = window.location.href;
        const pathname = window.location.pathname;

        let context = {
            type: 'unknown',
            url: url,
            pathname: pathname,
            timestamp: Date.now()
        };

        // Check if we're on a ServiceNow page
        if (url.includes('servicenowservices.com')) {
            context.platform = 'servicenow';

            // Check for loaner workspace
            if (pathname.includes('/x/g/loaner-workspace/')) {
                context.type = 'loaner-workspace';
                context.formType = detectFormType();
            }
            // Add more context detection as needed
        }

        // Update current context if changed
        const changed = !currentContext || JSON.stringify(currentContext) !== JSON.stringify(context);
        if (changed) {
            const previousContext = currentContext;
            currentContext = context;
            lastDetection = Date.now();

            // Notify observers
            notifyObservers({
                previous: previousContext,
                current: currentContext
            });

            // Broadcast to other tabs
            if (window.OCSDArmoryLink?.broadcast) {
                window.OCSDArmoryLink.broadcast.send('context:changed', {
                    context: currentContext
                });
            }

            // Log context change
            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('info', 'activeContext',
                    'Context changed', { previous: previousContext, current: currentContext });
            }
        }

        return context;
    }

    /**
     * Detect form type from DOM
     */
    function detectFormType() {
        // Check URL params
        const params = new URLSearchParams(window.location.search);
        const sys_id = params.get('sys_id');

        if (sys_id) {
            return 'edit';
        }

        // Check for new record indicators
        const newRecordIndicators = [
            'sys_id=-1',
            'sysparm_query=',
            document.querySelector('[data-form-mode="insert"]')
        ];

        if (newRecordIndicators.some(indicator => {
            if (typeof indicator === 'string') {
                return window.location.href.includes(indicator);
            }
            return !!indicator;
        })) {
            return 'new';
        }

        return 'view';
    }

    /**
     * Get current context
     */
    function get() {
        if (!currentContext) {
            detect();
        }
        return currentContext;
    }

    /**
     * Check if context is a specific type
     */
    function is(type) {
        const ctx = get();
        return ctx && ctx.type === type;
    }

    /**
     * Watch for context changes
     */
    function observe(callback) {
        const observerId = observers.length;
        observers.push(callback);
        return observerId;
    }

    /**
     * Remove observer
     */
    function unobserve(observerId) {
        delete observers[observerId];
    }

    /**
     * Notify all observers of context change
     */
    function notifyObservers(change) {
        observers.forEach(callback => {
            if (typeof callback === 'function') {
                try {
                    callback(change);
                } catch (err) {
                    console.error('[ActiveContext] Observer error:', err);
                }
            }
        });
    }

    /**
     * Initialize active context detection
     */
    function init() {
        // Initial detection
        detect();

        // Watch for URL changes
        let lastUrl = window.location.href;
        setInterval(() => {
            const currentUrl = window.location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                detect();
            }
        }, 1000);

        // Watch for visibility changes
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                detect();
            }
        });

        if (window.OCSDArmoryLink?.stubs?.debugLog) {
            window.OCSDArmoryLink.stubs.debugLog('info', 'activeContext',
                'Active context detection initialized');
        }
    }

    return {
        init,
        detect,
        get,
        is,
        observe,
        unobserve
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.activeContext = ActiveContextModule;
}

// <<< MODULE: activeContext END

// >>> MODULE: tabTitle START

const TabTitleModule = (() => {
    let originalTitle = document.title;
    let enabled = true;
    let updateInterval = null;

    /**
     * Update tab title based on current context and field values
     */
    function update() {
        if (!enabled) return;

        const context = window.OCSDArmoryLink?.activeContext?.get();
        const fields = window.OCSDArmoryLink?.fields;

        if (!context || !fields) {
            return;
        }

        let title = originalTitle;

        // Update title based on context type
        if (context.type === 'loaner-workspace') {
            const userPID = fields.read('user');
            const type = fields.read('type');

            const parts = [];

            if (type) {
                parts.push(type);
            }

            if (userPID) {
                parts.push(`#${userPID}`);
            }

            if (parts.length > 0) {
                title = parts.join(' - ') + ' | OCSD ArmoryLink';
            } else {
                title = 'OCSD ArmoryLink - Loaner Workspace';
            }
        }

        // Only update if changed
        if (document.title !== title) {
            document.title = title;
        }
    }

    /**
     * Reset title to original
     */
    function reset() {
        document.title = originalTitle;
    }

    /**
     * Enable automatic title updates
     */
    function enable() {
        enabled = true;
        startAutoUpdate();
    }

    /**
     * Disable automatic title updates
     */
    function disable() {
        enabled = false;
        stopAutoUpdate();
        reset();
    }

    /**
     * Start automatic title updates
     */
    function startAutoUpdate() {
        if (updateInterval) return;

        updateInterval = setInterval(() => {
            update();
        }, 2000);
    }

    /**
     * Stop automatic title updates
     */
    function stopAutoUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
    }

    /**
     * Initialize tab title module
     */
    function init() {
        originalTitle = document.title;

        // Listen for context changes
        if (window.OCSDArmoryLink?.activeContext) {
            window.OCSDArmoryLink.activeContext.observe(() => {
                update();
            });
        }

        // Listen for field changes via CustomEvents
        window.addEventListener('capture:processed', () => {
            update();
        });

        // Start auto-update
        startAutoUpdate();

        if (window.OCSDArmoryLink?.stubs?.debugLog) {
            window.OCSDArmoryLink.stubs.debugLog('info', 'tabTitle',
                'Tab title module initialized');
        }
    }

    return {
        init,
        update,
        reset,
        enable,
        disable
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.tabTitle = TabTitleModule;
}

// <<< MODULE: tabTitle END

// >>> MODULE: defaultsManager START

const DefaultsManager = (() => {
    /**
     * Get default configuration for the application
     * @returns {object} Default configuration with rules, prefixes, fields, etc.
     */
    function getDefaults() {
        return {
            // Default rules using symbol directives (/ and *)
            rules: [
                {
                    id: "rule-symbol-pid",
                    name: "Symbol + PID → Type & User",
                    description: "Interpret /01234 (Return) and *29232 (Deployment) style scans",
                    enabled: true,
                    patternType: "regex",
                    pattern: "^([/*])(\\d{5})$",
                    directiveGroupIndex: 1,
                    continueOnMatch: false,
                    actions: [
                        {
                            id: "action-fill-type",
                            type: "setField",
                            enabled: true,
                            field: "type",
                            value: "${directive}"
                        },
                        {
                            id: "action-fill-user",
                            type: "setField",
                            enabled: true,
                            field: "user",
                            value: "${2}"
                        }
                    ]
                },
                {
                    id: "rule-weapon-serial",
                    name: "Weapon Serial → Weapon Field",
                    description: "Match weapon serial numbers (6-12 alphanumeric characters)",
                    enabled: true,
                    patternType: "regex",
                    pattern: "^[A-Z0-9]{6,12}$",
                    continueOnMatch: false,
                    actions: [
                        {
                            id: "action-fill-weapon",
                            type: "setField",
                            enabled: true,
                            field: "weapon",
                            value: "${scan}"
                        }
                    ]
                }
            ],

            // Empty prefixes array - admins will create their own
            prefixes: [],

            // Default field definitions (mirrors the 10 canonical keys)
            fields: [
                { key: "type", label: "Type", enabled: true },
                { key: "user", label: "User", enabled: true },
                { key: "externalContact", label: "External Contact", enabled: true },
                { key: "department", label: "Department", enabled: true },
                { key: "vehicle", label: "Vehicle", enabled: true },
                { key: "weapon", label: "Weapon", enabled: true },
                { key: "taser", label: "Taser", enabled: true },
                { key: "patrol", label: "Patrol", enabled: true },
                { key: "controlOneRadio", label: "Control One Radio", enabled: true },
                { key: "comments", label: "Comments", enabled: true }
            ],

            // Default macros (empty - to be configured by admins)
            macros: [],

            // Default favorites (empty)
            favorites: [],

            // Default configuration settings
            config: {
                enableScanCapture: true,
                enableRulesEngine: true,
                enableAutoFill: true,
                enableBWC: true,
                enableX10: true,
                scanDelay: 100,
                commitDelay: 250,
                showNotifications: true,
                debugMode: false
            },

            // Default BWC configuration
            bwc: {
                enabled: true,
                baseUrl: "https://axon-portal-url.com/inventory",
                queryTemplate: "?filter=user:${field:user}"
            },

            // Default X10 configuration
            x10: {
                enabled: true,
                baseUrl: "https://taser-portal.com/inventory",
                queryTemplate: "?pid=${field:user}"
            }
        };
    }

    /**
     * Reset configuration to defaults
     * @returns {object} Fresh copy of defaults
     */
    function resetToDefaults() {
        return getDefaults();
    }

    return {
        getDefaults,
        resetToDefaults
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.defaultsManager = DefaultsManager;
}

// <<< MODULE: defaultsManager END

// >>> MODULE: settingsCatalog START

const SettingsCatalog = (() => {
    let settings = {};
    let listeners = [];

    // Settings schema with 20+ configuration options
    const schema = {
        general: {
            label: 'General',
            settings: {
                enableScript: { type: 'boolean', default: true, label: 'Enable Script', description: 'Master toggle for ArmoryLink functionality' },
                debugMode: { type: 'boolean', default: false, label: 'Debug Mode', description: 'Enable verbose logging to console' },
                autoInit: { type: 'boolean', default: true, label: 'Auto Initialize', description: 'Automatically initialize on page load' }
            }
        },
        capture: {
            label: 'Scan Capture',
            settings: {
                enableScanCapture: { type: 'boolean', default: true, label: 'Enable Scan Capture', description: 'Capture barcode scanner input' },
                scanDelay: { type: 'number', default: 100, label: 'Scan Delay (ms)', description: 'Delay between scan characters', min: 50, max: 500 },
                commitDelay: { type: 'number', default: 300, label: 'Commit Delay (ms)', description: 'Delay before committing field', min: 100, max: 2000 },
                queueProcessingDelay: { type: 'number', default: 200, label: 'Queue Processing (ms)', description: 'Delay between queue items', min: 100, max: 1000 }
            }
        },
        rules: {
            label: 'Rules Engine',
            settings: {
                enableRulesEngine: { type: 'boolean', default: true, label: 'Enable Rules Engine', description: 'Process scans through rules' },
                stopOnFirstMatch: { type: 'boolean', default: true, label: 'Stop on First Match', description: 'Stop processing after first rule match' }
            }
        },
        ui: {
            label: 'User Interface',
            settings: {
                showPanelOnLoad: { type: 'boolean', default: true, label: 'Show Panel on Load', description: 'Auto-show panel when page loads' },
                panelLayout: { type: 'select', default: 'dock-right', label: 'Panel Layout', description: 'Default panel layout mode', options: [
                    { value: 'dock-right', label: 'Dock Right' },
                    { value: 'left-strip', label: 'Left Strip' },
                    { value: 'dock-bottom', label: 'Dock Bottom' },
                    { value: 'float', label: 'Float' }
                ]},
                theme: { type: 'select', default: 'ocsd', label: 'Theme', description: 'Color theme', options: [
                    { value: 'ocsd', label: 'OCSD Official' }
                ]}
            }
        },
        ticker: {
            label: 'Ticker Display',
            settings: {
                enableTicker: { type: 'boolean', default: false, label: 'Enable Ticker', description: 'Show live field ticker at top' },
                tickerUpdateInterval: { type: 'number', default: 1000, label: 'Update Interval (ms)', description: 'Ticker refresh rate', min: 500, max: 5000 }
            }
        },
        toast: {
            label: 'Notifications',
            settings: {
                enableToasts: { type: 'boolean', default: true, label: 'Enable Toasts', description: 'Show toast notifications' },
                toastDuration: { type: 'number', default: 3000, label: 'Duration (ms)', description: 'How long toasts display', min: 1000, max: 10000 },
                toastPosition: { type: 'select', default: 'bottom-right', label: 'Position', description: 'Toast position on screen', options: [
                    { value: 'top-left', label: 'Top Left' },
                    { value: 'top-center', label: 'Top Center' },
                    { value: 'top-right', label: 'Top Right' },
                    { value: 'bottom-left', label: 'Bottom Left' },
                    { value: 'bottom-center', label: 'Bottom Center' },
                    { value: 'bottom-right', label: 'Bottom Right' }
                ]},
                toastPauseOnHover: { type: 'boolean', default: true, label: 'Pause on Hover', description: 'Pause toast timer when hovering' },
                toastShowProgress: { type: 'boolean', default: true, label: 'Show Progress', description: 'Show progress bar on toasts' },
                maxToasts: { type: 'number', default: 5, label: 'Max Toasts', description: 'Maximum simultaneous toasts', min: 1, max: 10 }
            }
        },
        bwc: {
            label: 'BWC (Axon)',
            settings: {
                enableBWC: { type: 'boolean', default: true, label: 'Enable BWC', description: 'Enable Axon BWC integration' },
                bwcAutoOpen: { type: 'boolean', default: false, label: 'Auto Open', description: 'Automatically open BWC portal' }
            }
        },
        x10: {
            label: 'X10 (TASER)',
            settings: {
                enableX10: { type: 'boolean', default: true, label: 'Enable X10', description: 'Enable TASER X10 integration' },
                x10AutoOpen: { type: 'boolean', default: false, label: 'Auto Open', description: 'Automatically open X10 portal' }
            }
        },
        advanced: {
            label: 'Advanced',
            settings: {
                enableMultiTab: { type: 'boolean', default: true, label: 'Multi-Tab Coordination', description: 'Enable leader election system' },
                broadcastMessages: { type: 'boolean', default: true, label: 'Broadcast Messages', description: 'Send messages to other tabs' },
                maxLogEntries: { type: 'number', default: 1000, label: 'Max Log Entries', description: 'Maximum debug log entries', min: 100, max: 5000 },
                elementCacheTimeout: { type: 'number', default: 5000, label: 'Element Cache (ms)', description: 'Element cache timeout', min: 1000, max: 30000 }
            }
        }
    };

    /**
     * Get default settings from schema
     */
    function getDefaults() {
        const defaults = {};
        Object.entries(schema).forEach(([category, categoryData]) => {
            Object.entries(categoryData.settings).forEach(([key, setting]) => {
                defaults[key] = setting.default;
            });
        });
        return defaults;
    }

    /**
     * Initialize settings
     */
    function init() {
        // Load from persistence or use defaults
        const persistence = window.OCSDArmoryLink?.persistence;
        if (persistence) {
            const stored = persistence.load('settings');
            settings = { ...getDefaults(), ...(stored || {}) };
        } else {
            settings = getDefaults();
        }
    }

    /**
     * Get a setting value
     */
    function get(key) {
        return settings[key];
    }

    /**
     * Get all settings
     */
    function getAll() {
        return { ...settings };
    }

    /**
     * Set a setting value
     */
    function set(key, value) {
        const oldValue = settings[key];
        settings[key] = value;

        // Save to persistence
        save();

        // Notify listeners
        notifyListeners(key, value, oldValue);

        // Instant apply
        applyInstant(key, value);

        return true;
    }

    /**
     * Set multiple settings at once
     */
    function setMultiple(updates) {
        Object.entries(updates).forEach(([key, value]) => {
            set(key, value);
        });
    }

    /**
     * Reset to defaults
     */
    function reset() {
        settings = getDefaults();
        save();
        notifyListeners('*', settings, {});
        applyAll();
    }

    /**
     * Save settings to persistence
     */
    function save() {
        const persistence = window.OCSDArmoryLink?.persistence;
        if (persistence) {
            persistence.save('settings', settings);
        }
    }

    /**
     * Get schema
     */
    function getSchema() {
        return JSON.parse(JSON.stringify(schema));
    }

    /**
     * Register change listener
     */
    function onChange(callback) {
        listeners.push(callback);
        return listeners.length - 1;
    }

    /**
     * Remove change listener
     */
    function offChange(listenerId) {
        delete listeners[listenerId];
    }

    /**
     * Notify all listeners
     */
    function notifyListeners(key, newValue, oldValue) {
        listeners.forEach(callback => {
            if (typeof callback === 'function') {
                try {
                    callback(key, newValue, oldValue);
                } catch (err) {
                    console.error('[SettingsCatalog] Listener error:', err);
                }
            }
        });
    }

    /**
     * Apply setting instantly
     */
    function applyInstant(key, value) {
        const AL = window.OCSDArmoryLink;

        switch (key) {
            case 'debugMode':
                AL.stubs?.DebugLogger?.setEnabled(value);
                break;

            case 'panelLayout':
                AL.layout?.setLayout(value);
                break;

            case 'theme':
                AL.theme?.setTheme(value);
                AL.theme?.injectThemeStyles();
                break;

            case 'enableTicker':
                if (value) {
                    AL.ticker?.show();
                } else {
                    AL.ticker?.hide();
                }
                break;

            case 'toastDuration':
            case 'toastPosition':
            case 'toastPauseOnHover':
            case 'toastShowProgress':
            case 'maxToasts':
                AL.stubs?.ToastSystem?.configure({
                    duration: get('toastDuration'),
                    position: get('toastPosition'),
                    pauseOnHover: get('toastPauseOnHover'),
                    showProgress: get('toastShowProgress'),
                    maxToasts: get('maxToasts')
                });
                break;

            case 'elementCacheTimeout':
                AL.elements?.configureCache({ timeout: value });
                break;
        }
    }

    /**
     * Apply all settings
     */
    function applyAll() {
        Object.keys(settings).forEach(key => {
            applyInstant(key, settings[key]);
        });
    }

    return {
        init,
        get,
        getAll,
        set,
        setMultiple,
        reset,
        getSchema,
        onChange,
        offChange,
        applyAll
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.settings = SettingsCatalog;
}

// <<< MODULE: settingsCatalog END

// >>> MODULE: broadcast START

const BroadcastModule = (() => {
    const CHANNEL_NAME = 'ocsd_armorylink_channel';
    const STORAGE_KEY = 'ocsd_armorylink_broadcast';
    const LEADER_KEY = 'ocsd_armorylink_leader';
    const HEARTBEAT_INTERVAL = 5000; // 5 seconds
    const LEADER_TIMEOUT = 10000; // 10 seconds

    let channel = null;
    let useFallback = false;
    let listeners = new Map();
    let listenerIdCounter = 0;
    let isLeader = false;
    let heartbeatInterval = null;
    let leaderCheckInterval = null;

    /**
     * Initialize broadcast system
     */
    function init() {
        // Try to use BroadcastChannel if available
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                channel = new BroadcastChannel(CHANNEL_NAME);
                channel.onmessage = handleMessage;
                useFallback = false;

                if (window.OCSDArmoryLink?.stubs?.debugLog) {
                    window.OCSDArmoryLink.stubs.debugLog('info', 'broadcast',
                        'BroadcastChannel initialized');
                }
            } catch (e) {
                console.warn('[Broadcast] BroadcastChannel failed, using localStorage fallback', e);
                initFallback();
            }
        } else {
            initFallback();
        }
    }

    /**
     * Initialize localStorage fallback for older browsers
     */
    function initFallback() {
        useFallback = true;

        // Listen for storage events (messages from other tabs)
        window.addEventListener('storage', (e) => {
            if (e.key === STORAGE_KEY && e.newValue) {
                try {
                    const message = JSON.parse(e.newValue);
                    handleMessage({ data: message });
                } catch (err) {
                    console.error('[Broadcast] Failed to parse storage message', err);
                }
            }
        });

        if (window.OCSDArmoryLink?.stubs?.debugLog) {
            window.OCSDArmoryLink.stubs.debugLog('info', 'broadcast',
                'localStorage fallback initialized');
        }
    }

    /**
     * Handle incoming messages
     */
    function handleMessage(event) {
        const message = event.data;

        if (!message || !message.type) return;

        // Call registered listeners
        listeners.forEach((callback, listenerId) => {
            try {
                callback(message);
            } catch (err) {
                console.error('[Broadcast] Listener error:', err);
            }
        });

        // Dispatch as CustomEvent on window for legacy compatibility
        const customEvent = new CustomEvent('armorylink:broadcast', {
            detail: message,
            bubbles: true
        });
        window.dispatchEvent(customEvent);
    }

    /**
     * Send a message to all tabs
     */
    function send(type, data = {}) {
        const message = {
            type,
            data,
            timestamp: Date.now(),
            tabId: getTabId()
        };

        if (useFallback) {
            // Use localStorage
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
                // Clear immediately to allow same message to be sent again
                setTimeout(() => {
                    try {
                        localStorage.removeItem(STORAGE_KEY);
                    } catch (e) {
                        // Ignore
                    }
                }, 50);
            } catch (err) {
                console.error('[Broadcast] Failed to send via localStorage', err);
            }
        } else if (channel) {
            // Use BroadcastChannel
            try {
                channel.postMessage(message);
            } catch (err) {
                console.error('[Broadcast] Failed to send via BroadcastChannel', err);
            }
        }
    }

    /**
     * Register a listener for broadcast messages
     */
    function on(callback) {
        const listenerId = ++listenerIdCounter;
        listeners.set(listenerId, callback);
        return listenerId;
    }

    /**
     * Unregister a listener
     */
    function off(listenerId) {
        return listeners.delete(listenerId);
    }

    /**
     * Get or create a unique tab ID
     */
    function getTabId() {
        let tabId = sessionStorage.getItem('ocsd_tab_id');
        if (!tabId) {
            tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            sessionStorage.setItem('ocsd_tab_id', tabId);
        }
        return tabId;
    }

    /**
     * Leader Election System
     */

    /**
     * Attempt to become leader
     */
    function becomeLeader() {
        const tabId = getTabId();
        const leaderInfo = {
            tabId,
            timestamp: Date.now()
        };

        try {
            localStorage.setItem(LEADER_KEY, JSON.stringify(leaderInfo));
            isLeader = true;

            // Start heartbeat
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

            // Broadcast leader change
            send('leader:elected', { tabId, isLeader: true });

            if (window.OCSDArmoryLink?.stubs?.debugLog) {
                window.OCSDArmoryLink.stubs.debugLog('info', 'broadcast',
                    'Became leader tab', { tabId });
            }
        } catch (err) {
            console.error('[Broadcast] Failed to become leader:', err);
        }
    }

    /**
     * Send heartbeat to maintain leadership
     */
    function sendHeartbeat() {
        if (!isLeader) return;

        const tabId = getTabId();
        const leaderInfo = {
            tabId,
            timestamp: Date.now()
        };

        try {
            localStorage.setItem(LEADER_KEY, JSON.stringify(leaderInfo));
            send('leader:heartbeat', { tabId });
        } catch (err) {
            console.error('[Broadcast] Failed to send heartbeat:', err);
        }
    }

    /**
     * Check if current leader is still alive
     */
    function checkLeader() {
        try {
            const leaderData = localStorage.getItem(LEADER_KEY);
            if (!leaderData) {
                // No leader, become one
                becomeLeader();
                return;
            }

            const leaderInfo = JSON.parse(leaderData);
            const now = Date.now();
            const timeSinceHeartbeat = now - leaderInfo.timestamp;

            // Check if leader has timed out
            if (timeSinceHeartbeat > LEADER_TIMEOUT) {
                // Leader is dead, try to become leader
                if (window.OCSDArmoryLink?.stubs?.debugLog) {
                    window.OCSDArmoryLink.stubs.debugLog('warn', 'broadcast',
                        'Leader timeout detected, attempting to become leader');
                }
                becomeLeader();
            } else {
                // Leader is alive, check if it's us
                const myTabId = getTabId();
                if (leaderInfo.tabId === myTabId) {
                    if (!isLeader) {
                        isLeader = true;
                        sendHeartbeat();
                    }
                } else {
                    if (isLeader) {
                        // We thought we were leader but we're not
                        isLeader = false;
                        if (heartbeatInterval) {
                            clearInterval(heartbeatInterval);
                            heartbeatInterval = null;
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[Broadcast] Leader check error:', err);
        }
    }

    /**
     * Initialize leader election
     */
    function initLeaderElection() {
        // Initial check
        checkLeader();

        // Periodic check
        leaderCheckInterval = setInterval(checkLeader, HEARTBEAT_INTERVAL);

        // Listen for leader messages
        on((message) => {
            if (message.type === 'leader:elected' && message.data.tabId !== getTabId()) {
                // Another tab became leader
                if (isLeader) {
                    isLeader = false;
                    if (heartbeatInterval) {
                        clearInterval(heartbeatInterval);
                        heartbeatInterval = null;
                    }
                }
            }
        });

        // Handle page unload
        window.addEventListener('beforeunload', () => {
            if (isLeader) {
                try {
                    localStorage.removeItem(LEADER_KEY);
                } catch (err) {
                    // Ignore
                }
            }
        });
    }

    /**
     * Get leader status
     */
    function getLeaderStatus() {
        return {
            isLeader,
            tabId: getTabId(),
            leaderInfo: (() => {
                try {
                    const data = localStorage.getItem(LEADER_KEY);
                    return data ? JSON.parse(data) : null;
                } catch (err) {
                    return null;
                }
            })()
        };
    }

    /**
     * Close broadcast channel
     */
    function close() {
        if (channel && !useFallback) {
            channel.close();
            channel = null;
        }
        listeners.clear();

        // Clear leader intervals
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        if (leaderCheckInterval) {
            clearInterval(leaderCheckInterval);
            leaderCheckInterval = null;
        }

        // Relinquish leadership
        if (isLeader) {
            try {
                localStorage.removeItem(LEADER_KEY);
            } catch (err) {
                // Ignore
            }
            isLeader = false;
        }
    }

    return {
        init,
        send,
        on,
        off,
        getTabId,
        close,
        // Leader election
        initLeaderElection,
        getLeaderStatus,
        checkLeader
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.broadcast = BroadcastModule;
}

// <<< MODULE: broadcast END

// >>> MODULE: worker START

const WorkerModule = (() => {
    /**
     * Validate a scan value
     */
    function validateScan(scan) {
        const errors = [];
        const warnings = [];

        if (!scan || typeof scan !== 'string') {
            errors.push('Scan value must be a non-empty string');
            return { valid: false, errors, warnings };
        }

        if (scan.length < 3) {
            warnings.push('Scan value is very short (< 3 characters)');
        }

        if (scan.length > 100) {
            warnings.push('Scan value is unusually long (> 100 characters)');
        }

        // Check for directive symbols
        const firstChar = scan.charAt(0);
        if (firstChar === '/' || firstChar === '*') {
            // Valid directive symbol
        } else {
            // No directive - this is fine, just informational
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate field data
     */
    function validateField(key, value) {
        const errors = [];
        const warnings = [];

        // Get field definition
        const fields = window.OCSDArmoryLink?.fields;
        if (!fields || !fields.exists(key)) {
            errors.push(`Unknown field key: ${key}`);
            return { valid: false, errors, warnings };
        }

        const field = fields.get(key);

        // Check value type
        if (value !== null && value !== undefined && typeof value !== 'string') {
            errors.push(`Field value must be a string, got ${typeof value}`);
        }

        // Field-specific validation
        switch (key) {
            case 'type':
                if (value && !['Return', 'Deployment'].includes(value)) {
                    warnings.push(`Type value "${value}" is not a standard directive (Return/Deployment)`);
                }
                break;

            case 'user':
                if (value && value.length > 0 && !/^[0-9]{4,6}$/.test(value)) {
                    warnings.push('User PID should be 4-6 digits');
                }
                break;

            // Add more field-specific validation as needed
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate a rule object
     */
    function validateRule(rule) {
        const errors = [];
        const warnings = [];

        if (!rule || typeof rule !== 'object') {
            errors.push('Rule must be an object');
            return { valid: false, errors, warnings };
        }

        // Required fields
        if (!rule.id) errors.push('Rule missing required field: id');
        if (!rule.name) errors.push('Rule missing required field: name');
        if (!rule.patternType) errors.push('Rule missing required field: patternType');
        if (!rule.pattern) errors.push('Rule missing required field: pattern');

        // Pattern type validation
        const validPatternTypes = ['regex', 'string', 'startsWith', 'contains', 'endsWith'];
        if (rule.patternType && !validPatternTypes.includes(rule.patternType)) {
            errors.push(`Invalid patternType: ${rule.patternType}`);
        }

        // Regex validation
        if (rule.patternType === 'regex') {
            try {
                new RegExp(rule.pattern);
            } catch (e) {
                errors.push(`Invalid regex pattern: ${e.message}`);
            }
        }

        // Actions validation
        if (!rule.actions || !Array.isArray(rule.actions)) {
            warnings.push('Rule has no actions array');
        } else if (rule.actions.length === 0) {
            warnings.push('Rule has zero actions');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate configuration object
     */
    function validateConfig(config) {
        const errors = [];
        const warnings = [];

        if (!config || typeof config !== 'object') {
            errors.push('Config must be an object');
            return { valid: false, errors, warnings };
        }

        // Validate numeric fields
        if (config.scanDelay !== undefined) {
            if (typeof config.scanDelay !== 'number' || config.scanDelay < 0) {
                errors.push('scanDelay must be a non-negative number');
            }
        }

        if (config.commitDelay !== undefined) {
            if (typeof config.commitDelay !== 'number' || config.commitDelay < 0) {
                errors.push('commitDelay must be a non-negative number');
            }
        }

        // Validate boolean fields
        const booleanFields = [
            'enableScanCapture', 'enableRulesEngine', 'enableAutoFill',
            'enableBWC', 'enableX10', 'showNotifications', 'debugMode'
        ];

        booleanFields.forEach(field => {
            if (config[field] !== undefined && typeof config[field] !== 'boolean') {
                errors.push(`${field} must be a boolean`);
            }
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Sanitize HTML to prevent XSS
     */
    function sanitizeHTML(html) {
        if (!html || typeof html !== 'string') return '';

        // Basic sanitization - remove script tags and event handlers
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/\son\w+\s*=\s*[^\s>]*/gi, '');
    }

    /**
     * Sanitize user input for safe display
     */
    function sanitizeInput(input) {
        if (!input || typeof input !== 'string') return '';

        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Batch validate multiple items
     */
    function validateBatch(items, validator) {
        const results = items.map((item, index) => ({
            index,
            item,
            result: validator(item)
        }));

        const allValid = results.every(r => r.result.valid);
        const errors = results.filter(r => !r.result.valid);

        return {
            valid: allValid,
            results,
            errorCount: errors.length,
            warningCount: results.reduce((sum, r) => sum + r.result.warnings.length, 0)
        };
    }

    return {
        validateScan,
        validateField,
        validateRule,
        validateConfig,
        sanitizeHTML,
        sanitizeInput,
        validateBatch
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.worker = WorkerModule;
}

// <<< MODULE: worker END

// >>> MODULE: init START

const InitModule = (() => {
    let initialized = false;

    /**
     * Inject basic CSS styles for the UI
     */
    function injectStyles() {
        const css = `
            .ocsd-armorylink-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 600px;
                max-height: 80vh;
                background: #ffffff;
                border: 1px solid #ccc;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: block;
                overflow: hidden;
            }

            .ocsd-armorylink-panel.ocsd-hidden {
                display: none !important;
            }

            .ocsd-panel-header {
                background: #0066cc;
                color: white;
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .ocsd-panel-header h2 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
            }

            .ocsd-close-btn {
                background: transparent;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                line-height: 1;
            }

            .ocsd-close-btn:hover {
                background: rgba(255,255,255,0.2);
                border-radius: 4px;
            }

            .ocsd-panel-tabs {
                display: flex;
                background: #f5f5f5;
                border-bottom: 1px solid #ddd;
                overflow-x: auto;
            }

            .ocsd-tab-btn {
                padding: 10px 16px;
                border: none;
                background: transparent;
                cursor: pointer;
                font-size: 14px;
                border-bottom: 2px solid transparent;
                white-space: nowrap;
            }

            .ocsd-tab-btn.active {
                background: white;
                border-bottom-color: #0066cc;
                font-weight: 600;
            }

            .ocsd-tab-btn:hover {
                background: rgba(0,102,204,0.1);
            }

            .ocsd-panel-content {
                padding: 16px;
                max-height: calc(80vh - 120px);
                overflow-y: auto;
            }

            .ocsd-help-section {
                margin-bottom: 20px;
            }

            .ocsd-help-section h4 {
                margin-top: 16px;
                margin-bottom: 8px;
                font-size: 16px;
                color: #333;
            }

            .ocsd-help-section p {
                margin: 8px 0;
                line-height: 1.5;
                color: #666;
            }

            .ocsd-help-section ul {
                margin: 8px 0;
                padding-left: 24px;
            }

            .ocsd-help-section li {
                margin: 4px 0;
                line-height: 1.5;
            }

            .ocsd-code-block {
                background: #f5f5f5;
                padding: 12px;
                border-radius: 4px;
                font-family: "Courier New", monospace;
                font-size: 13px;
                margin: 8px 0;
            }

            .ocsd-example-item {
                margin: 8px 0;
                padding: 8px;
                background: #f9f9f9;
                border-left: 3px solid #0066cc;
            }

            .ocsd-example-item code {
                background: #e8e8e8;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: "Courier New", monospace;
            }

            .ocsd-field-item {
                padding: 12px;
                margin: 8px 0;
                background: #f9f9f9;
                border-radius: 4px;
                border-left: 3px solid #0066cc;
            }

            .ocsd-field-item strong {
                display: block;
                margin-bottom: 4px;
                color: #333;
            }

            .ocsd-field-item span {
                display: block;
                margin-bottom: 4px;
                color: #666;
                font-size: 13px;
            }

            .ocsd-field-item code {
                display: block;
                background: #e8e8e8;
                padding: 4px 8px;
                border-radius: 3px;
                font-family: "Courier New", monospace;
                font-size: 12px;
            }

            .ocsd-empty-state {
                text-align: center;
                padding: 40px 20px;
                color: #999;
            }

            .ocsd-btn {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                margin: 4px;
            }

            .ocsd-btn-primary {
                background: #0066cc;
                color: white;
            }

            .ocsd-btn-primary:hover {
                background: #0052a3;
            }

            .ocsd-btn-secondary {
                background: #6c757d;
                color: white;
            }

            .ocsd-btn-secondary:hover {
                background: #5a6268;
            }

            .ocsd-btn-danger {
                background: #dc3545;
                color: white;
            }

            .ocsd-btn-danger:hover {
                background: #c82333;
            }

            .ocsd-form-group {
                margin: 16px 0;
            }

            .ocsd-form-group label {
                display: block;
                margin-bottom: 4px;
                font-weight: 600;
                color: #333;
            }

            .ocsd-form-group small {
                display: block;
                margin-top: 4px;
                color: #666;
                font-size: 12px;
            }

            .ocsd-input {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
                box-sizing: border-box;
            }

            .ocsd-input:focus {
                outline: none;
                border-color: #0066cc;
            }
        `;

        GM_addStyle(css);
    }

    /**
     * Initialize the application
     */
    function init() {
        if (initialized) return;
        initialized = true;

        const AL = window.OCSDArmoryLink;

        if (!AL) {
            console.error('[ArmoryLink] Global namespace not found');
            return;
        }

        // Log initialization
        if (AL.stubs?.debugLog) {
            AL.stubs.debugLog('info', 'init', 'Initializing OCSD ArmoryLink');
        }

        // Initialize theme engine
        if (AL.theme?.injectThemeStyles) {
            AL.theme.injectThemeStyles();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Theme engine initialized');
            }
        }

        // Initialize broadcast system
        if (AL.broadcast?.init) {
            AL.broadcast.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Broadcast system initialized');
            }
        }

        // Initialize leader election
        if (AL.broadcast?.initLeaderElection) {
            AL.broadcast.initLeaderElection();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Leader election initialized');
            }
        }

        // Initialize settings catalog
        if (AL.settings?.init) {
            AL.settings.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Settings catalog initialized');
            }
        }

        // Initialize ticker UI
        if (AL.ticker?.init) {
            AL.ticker.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Ticker UI initialized');
            }
        }

        // Inject CSS styles
        injectStyles();

        // Load defaults
        const defaults = AL.defaultsManager?.getDefaults();

        if (!defaults) {
            console.error('[ArmoryLink] Failed to load defaults');
            return;
        }

        // Seed the rules engine with rules from persistence or defaults
        if (AL.rules?.setRules) {
            let rules = defaults.rules || [];

            // Try to load user-created rules from persistence
            if (AL.persistence) {
                const storedRules = AL.persistence.load('rules');
                if (storedRules && Array.isArray(storedRules) && storedRules.length > 0) {
                    rules = storedRules;
                    if (AL.stubs?.debugLog) {
                        AL.stubs.debugLog('info', 'init', `Loaded ${storedRules.length} rules from persistence`);
                    }
                }
            }

            AL.rules.setRules(rules);
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', `Rules engine initialized with ${rules.length} rules`);
            }
        }

        // Initialize fields module (loads custom field mappings from persistence)
        if (AL.fields?.init) {
            AL.fields.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Fields module initialized');
            }
        }

        // Initialize scan history module
        if (AL.scanHistory?.init) {
            AL.scanHistory.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Scan history module initialized');
            }
        }

        // Configure BWC module
        if (defaults.bwc && AL.bwc?.setConfig) {
            AL.bwc.setConfig(defaults.bwc);
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Configured BWC module');
            }
        }

        // Configure X10 module
        if (defaults.x10 && AL.x10?.setConfig) {
            AL.x10.setConfig(defaults.x10);
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Configured X10 module');
            }
        }

        // Initialize prefixes
        if (AL.prefixes?.setAll) {
            AL.prefixes.setAll(defaults.prefixes || []);
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', `Loaded ${defaults.prefixes?.length || 0} prefixes`);
            }
        }

        // Initialize UI
        if (AL.ui?.init) {
            AL.ui.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'UI initialized');
            }
        }

        // Initialize capture
        if (AL.capture?.init) {
            AL.capture.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Capture module initialized');
            }
        }

        // Initialize macros
        if (AL.macros?.init) {
            AL.macros.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Macros module initialized');
            }
        }

        // Initialize active context detection
        if (AL.activeContext?.init) {
            AL.activeContext.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Active context detection initialized');
            }
        }

        // Initialize tab title module
        if (AL.tabTitle?.init) {
            AL.tabTitle.init();
            if (AL.stubs?.debugLog) {
                AL.stubs.debugLog('info', 'init', 'Tab title module initialized');
            }
        }

        // Add global hotkey to toggle panel (Ctrl+Shift+B)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                AL.ui?.toggle();
            }
        });

        // Show success toast
        if (AL.stubs?.toast) {
            AL.stubs.toast('OCSD ArmoryLink initialized successfully', 'success');
        }

        // Log completion
        if (AL.stubs?.debugLog) {
            AL.stubs.debugLog('info', 'init', 'Initialization complete');
        }
    }

    // Wait for DOM to be ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // DOM is already ready, initialize with slight delay
        setTimeout(init, 0);
    } else {
        // Wait for DOMContentLoaded
        document.addEventListener('DOMContentLoaded', init, { once: true });
    }

    return {
        init
    };
})();

// Initialize window.OCSDArmoryLink namespace
if (typeof window !== 'undefined') {
    window.OCSDArmoryLink = window.OCSDArmoryLink || {};
    window.OCSDArmoryLink.init = InitModule;
}

// <<< MODULE: init END