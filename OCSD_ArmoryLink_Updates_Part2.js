// OCSD ArmoryLink v0.2.0 - Implementation Updates Part 2
// This file contains the ticker, toast, and additional system implementations

// ========================================
// ENHANCED TICKER WITH COLOR STATES
// ========================================
const TickerEnhancements = {
    init() {
        this.createTicker();
        this.startUpdateInterval();
        console.log('[ticker] Enhanced ticker initialized');
    },

    createTicker() {
        // Remove existing ticker if present
        const existing = document.getElementById('al-ticker');
        if (existing) existing.remove();

        const ticker = document.createElement('div');
        ticker.id = 'al-ticker';
        ticker.className = 'al-ticker';
        
        // Apply positioning based on settings
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        if (settings.tickerPosition === 'top') {
            ticker.style.top = '0';
            ticker.style.bottom = 'auto';
            ticker.style.borderTop = 'none';
            ticker.style.borderBottom = '1px solid var(--border-light)';
        } else {
            ticker.style.bottom = '0';
            ticker.style.top = 'auto';
        }

        document.body.appendChild(ticker);
        this.updateTicker();
    },

    updateTicker() {
        const ticker = document.getElementById('al-ticker');
        if (!ticker) return;

        const activeContext = AL.activeContext?.getActiveTabContext();
        if (!activeContext) {
            ticker.innerHTML = this.getEmptyTickerHTML();
            ticker.className = 'al-ticker al-ticker-empty';
            return;
        }

        // Determine ticker state based on type and updated_on
        const type = activeContext.type || '';
        const updatedOn = activeContext.updated_on || '';
        const user = activeContext.user || '';
        
        let tickerClass = 'al-ticker';
        let backgroundColor = '';
        let textColor = '';
        
        if (updatedOn && updatedOn.trim() !== '') {
            // Red background with white text if updated_on has any value
            tickerClass += ' al-ticker-updated';
            backgroundColor = '#ef4444';
            textColor = 'white';
        } else if (type.toLowerCase().includes('deploy')) {
            // Yellow background with black text for deployment
            tickerClass += ' al-ticker-deploy';
            backgroundColor = '#fbbf24';
            textColor = '#000';
        } else if (type.toLowerCase().includes('return')) {
            // Green background with black text for return
            tickerClass += ' al-ticker-return';
            backgroundColor = '#22c55e';
            textColor = '#000';
        } else {
            // Default state
            tickerClass += ' al-ticker-default';
        }

        // Apply styles
        ticker.className = tickerClass;
        if (backgroundColor) {
            ticker.style.backgroundColor = backgroundColor;
            ticker.style.color = textColor;
        }

        // Build ticker content (NO type text, only color indication)
        const tickerParts = [];
        
        // User info
        if (user) {
            const userName = this.extractUserName(user);
            tickerParts.push(`<span class="al-ticker-user">👤 ${AL.utils.escapeHtml(userName)}</span>`);
        }

        // Only show pills for weapon, taser, patrol
        const pillFields = ['weapon', 'taser', 'patrol'];
        pillFields.forEach(field => {
            const value = activeContext[field];
            if (value) {
                const pills = this.extractPills(value);
                if (pills.length > 0) {
                    const label = field.charAt(0).toUpperCase() + field.slice(1);
                    tickerParts.push(`<span class="al-ticker-field">${label}: ${pills.join(', ')}</span>`);
                }
            }
        });

        // Mode and status indicators
        const captureMode = AL.capture?.mode || 'off';
        const queueStatus = AL.capture?.getQueueStatus();
        
        tickerParts.push(`
            <span class="al-ticker-status">
                <span class="al-ticker-status-dot mode-${captureMode}"></span>
                ${AL.capture?.getModeLabel() || 'Unknown'}
                ${queueStatus && queueStatus.length > 0 ? ` (${queueStatus.length} queued)` : ''}
            </span>
        `);

        // Leader/Follower indicator
        if (AL.broadcast?.isLeader) {
            tickerParts.push('<span class="al-ticker-leader">👑 Leader</span>');
        } else {
            tickerParts.push('<span class="al-ticker-follower">👥 Follower</span>');
        }

        // Last scan info
        if (AL.capture?.lastScan) {
            const timeSince = Date.now() - AL.capture.lastScanTime;
            if (timeSince < 60000) { // Show for 1 minute
                tickerParts.push(`
                    <span class="al-ticker-last-scan">
                        Last: ${AL.utils.escapeHtml(AL.capture.lastScan.scanText)} 
                        (${AL.utils.formatTimestamp(AL.capture.lastScanTime)})
                    </span>
                `);
            }
        }

        ticker.innerHTML = tickerParts.join(' • ');
    },

    extractUserName(userField) {
        // Extract name from ServiceNow user field format
        // Could be "Last, First [PID]" or similar
        const match = userField.match(/([^,\[]+)/);
        return match ? match[1].trim() : userField;
    },

    extractPills(fieldValue) {
        // Extract pill values from ServiceNow pill field
        // Pills typically appear as "Value1, Value2" or in special format
        if (!fieldValue) return [];
        
        return fieldValue
            .split(',')
            .map(v => v.trim())
            .filter(v => v.length > 0);
    },

    getEmptyTickerHTML() {
        return `
            <span class="al-ticker-empty">
                No active ServiceNow tab • ${AL.capture?.getModeLabel() || 'Unknown'} Mode
            </span>
        `;
    },

    startUpdateInterval() {
        // Update ticker every 2 seconds
        setInterval(() => {
            this.updateTicker();
        }, 2000);
    },

    destroy() {
        const ticker = document.getElementById('al-ticker');
        if (ticker) ticker.remove();
    }
};

// ========================================
// ENHANCED TOAST SYSTEM WITH POSITIONS AND SOUND
// ========================================
const ToastEnhancements = {
    toastContainer: null,
    toastSound: null,

    init() {
        this.createContainer();
        this.initSound();
        console.log('[toast] Enhanced toast system initialized');
    },

    createContainer() {
        // Remove existing container if present
        const existing = document.getElementById('al-toast-container');
        if (existing) existing.remove();

        const container = document.createElement('div');
        container.id = 'al-toast-container';
        container.className = 'al-toast-container';
        
        this.updateContainerPosition();
        document.body.appendChild(container);
        this.toastContainer = container;
    },

    updateContainerPosition() {
        const container = document.getElementById('al-toast-container');
        if (!container) return;

        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        const position = settings.toasterPosition || 'tr';

        // Reset all positions
        container.style.top = 'auto';
        container.style.bottom = 'auto';
        container.style.left = 'auto';
        container.style.right = 'auto';
        container.style.transform = 'none';
        
        switch (position) {
            case 'tl': // Top Left
                container.style.top = 'var(--space-lg)';
                container.style.left = 'var(--space-lg)';
                break;
            case 'tr': // Top Right
                container.style.top = 'var(--space-lg)';
                container.style.right = 'var(--space-lg)';
                break;
            case 'bl': // Bottom Left
                container.style.bottom = 'var(--space-lg)';
                container.style.left = 'var(--space-lg)';
                break;
            case 'br': // Bottom Right
                container.style.bottom = 'var(--space-lg)';
                container.style.right = 'var(--space-lg)';
                break;
            case 'tc': // Top Center
                container.style.top = 'var(--space-lg)';
                container.style.left = '50%';
                container.style.transform = 'translateX(-50%)';
                break;
            case 'bc': // Bottom Center
                container.style.bottom = 'var(--space-lg)';
                container.style.left = '50%';
                container.style.transform = 'translateX(-50%)';
                break;
        }
    },

    initSound() {
        // Create audio element for toast sound
        this.toastSound = new Audio('data:audio/wav;base64,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');
    },

    showToast(title, message, type = 'info', options = {}) {
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `al-toast al-toast-${type} al-toast-${settings.toasterSize || 'medium'}`;
        
        // Add content
        toast.innerHTML = `
            <div class="al-toast-header">
                <span class="al-toast-icon">${this.getToastIcon(type)}</span>
                <span class="al-toast-title">${AL.utils.escapeHtml(title)}</span>
                <button class="al-toast-close">✕</button>
            </div>
            ${message ? `<div class="al-toast-message">${AL.utils.escapeHtml(message)}</div>` : ''}
        `;

        // Add to container
        if (!this.toastContainer) {
            this.createContainer();
        }
        this.toastContainer.appendChild(toast);

        // Play sound if enabled
        if (settings.toasterSound && this.toastSound) {
            this.toastSound.play().catch(() => {}); // Ignore autoplay errors
        }

        // Animate in
        setTimeout(() => {
            toast.classList.add('al-toast-show');
        }, 10);

        // Handle click to close
        const closeBtn = toast.querySelector('.al-toast-close');
        closeBtn.onclick = () => this.dismissToast(toast);
        
        // Click anywhere on toast to close
        if (!options.sticky) {
            toast.onclick = () => this.dismissToast(toast);
        }

        // Auto-dismiss if not sticky
        if (!options.sticky) {
            const dismissTime = options.duration || settings.toasterAutoDismiss || 3000;
            setTimeout(() => {
                this.dismissToast(toast);
            }, dismissTime);
        }

        return toast;
    },

    dismissToast(toast) {
        if (!toast) return;
        
        toast.classList.remove('al-toast-show');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300);
    },

    getToastIcon(type) {
        switch (type) {
            case 'success': return '✓';
            case 'error': return '✕';
            case 'warning': return '⚠';
            case 'info': return 'ℹ';
            default: return '•';
        }
    },

    clearAll() {
        if (this.toastContainer) {
            this.toastContainer.innerHTML = '';
        }
    }
};

// ========================================
// PREFIX SYSTEM WITH HOTKEYS
// ========================================
const PrefixEnhancements = {
    activePrefix: null,
    prefixes: [],
    hotkeyListener: null,

    init() {
        this.loadPrefixes();
        this.setupHotkeys();
        console.log('[prefixes] Enhanced prefix system initialized');
    },

    loadPrefixes() {
        this.prefixes = AL.persistence.get('prefixes', AL.stubs.getDefaultPrefixes());
    },

    savePrefixes() {
        AL.persistence.set('prefixes', this.prefixes);
    },

    setupHotkeys() {
        if (this.hotkeyListener) {
            document.removeEventListener('keydown', this.hotkeyListener);
        }

        this.hotkeyListener = (event) => {
            // Check if Alt is pressed
            if (!event.altKey) return;
            
            // Check if we're in an input field
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return;
            }

            // Check for number keys 1-9
            const key = event.key;
            if (key >= '1' && key <= '9') {
                event.preventDefault();
                const prefix = this.prefixes.find(p => p.key === key && p.enabled);
                if (prefix) {
                    this.activatePrefix(prefix);
                }
            } else if (key === '0' || key === 'Escape') {
                event.preventDefault();
                this.deactivatePrefix();
            }
        };

        document.addEventListener('keydown', this.hotkeyListener);
    },

    activatePrefix(prefix) {
        this.activePrefix = prefix;
        
        // Apply sticky count if set
        if (prefix.sticky > 0) {
            this.activePrefix.remainingSticky = prefix.sticky;
        }

        // Update UI
        this.updatePrefixIndicator();
        
        // Show toast
        AL.ui?.showToast?.('Prefix Active', 
            `${prefix.label} (${prefix.value})${prefix.sticky > 0 ? ` - ${prefix.sticky} uses` : ''}`, 
            'info');

        console.log('[prefixes] Activated prefix:', prefix.label);
    },

    deactivatePrefix() {
        this.activePrefix = null;
        this.updatePrefixIndicator();
        AL.ui?.showToast?.('Prefix Cleared', 'No active prefix', 'info');
        console.log('[prefixes] Deactivated prefix');
    },

    decrementSticky() {
        if (!this.activePrefix || !this.activePrefix.remainingSticky) return;
        
        this.activePrefix.remainingSticky--;
        
        if (this.activePrefix.remainingSticky <= 0) {
            this.deactivatePrefix();
        } else {
            this.updatePrefixIndicator();
        }
    },

    updatePrefixIndicator() {
        const indicator = document.getElementById('al-prefix-indicator');
        if (!indicator) return;

        if (this.activePrefix) {
            indicator.innerHTML = `
                <span style="
                    background: ${this.activePrefix.color || 'var(--accent-primary)'};
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-weight: bold;
                ">
                    ${AL.utils.escapeHtml(this.activePrefix.label)} 
                    (${AL.utils.escapeHtml(this.activePrefix.value)})
                    ${this.activePrefix.remainingSticky ? ` - ${this.activePrefix.remainingSticky} left` : ''}
                </span>
            `;
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    },

    addPrefix(prefix) {
        prefix.id = prefix.id || AL.utils.generateId();
        this.prefixes.push(prefix);
        this.savePrefixes();
    },

    updatePrefix(id, updates) {
        const index = this.prefixes.findIndex(p => p.id === id);
        if (index >= 0) {
            this.prefixes[index] = { ...this.prefixes[index], ...updates };
            this.savePrefixes();
        }
    },

    deletePrefix(id) {
        this.prefixes = this.prefixes.filter(p => p.id !== id);
        this.savePrefixes();
        
        // Deactivate if it was active
        if (this.activePrefix && this.activePrefix.id === id) {
            this.deactivatePrefix();
        }
    }
};

// ========================================
// DEBUG PANEL WITH CONSOLE INTERCEPTS
// ========================================
const DebugPanel = {
    logs: [],
    maxLogs: 1000,
    originalConsole: {},

    init() {
        this.interceptConsole();
        console.log('[debug] Debug panel initialized');
    },

    interceptConsole() {
        // Store original console methods
        this.originalConsole.log = console.log;
        this.originalConsole.warn = console.warn;
        this.originalConsole.error = console.error;

        // Override console methods
        console.log = (...args) => {
            this.addLog('log', args.join(' '));
            this.originalConsole.log.apply(console, args);
        };

        console.warn = (...args) => {
            this.addLog('warn', args.join(' '));
            this.originalConsole.warn.apply(console, args);
        };

        console.error = (...args) => {
            this.addLog('error', args.join(' '));
            this.originalConsole.error.apply(console, args);
        };
    },

    addLog(level, message) {
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        if (!settings.debugEnabled) return;

        this.logs.push({
            timestamp: Date.now(),
            level: level,
            message: message
        });

        // Trim logs if too many
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Update UI if debug tab is active
        this.updateDebugOutput(level, message);
    },

    updateDebugOutput(level, message) {
        const output = document.getElementById('al-debug-output');
        if (!output) return;

        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        
        // Create new log line
        const logLine = document.createElement('div');
        logLine.className = 'al-debug-line';
        logLine.dataset.level = level;
        logLine.style.color = level === 'error' ? '#f44' : 
                              level === 'warn' ? '#fa0' : '#0f0';
        logLine.style.marginBottom = '2px';
        
        logLine.innerHTML = `
            <span style="color: #888;">[${new Date().toLocaleTimeString()}]</span>
            <span style="color: ${
                level === 'error' ? '#f44' :
                level === 'warn' ? '#fa0' : '#0a0'
            };">[${level.toUpperCase()}]</span>
            ${AL.utils.escapeHtml(message)}
        `;
        
        output.appendChild(logLine);
        
        // Auto-scroll if enabled
        if (settings.debugAutoScroll) {
            output.scrollTop = output.scrollHeight;
        }
        
        // Limit displayed lines
        while (output.children.length > 500) {
            output.removeChild(output.firstChild);
        }
    },

    clear() {
        this.logs = [];
        const output = document.getElementById('al-debug-output');
        if (output) {
            output.innerHTML = '';
        }
        console.log('[debug] Logs cleared');
    },

    export() {
        if (this.logs.length === 0) {
            AL.ui?.showToast?.('No Logs', 'No debug logs to export', 'warning');
            return;
        }

        const logText = this.logs.map(log => {
            const time = new Date(log.timestamp).toISOString();
            return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
        }).join('\n');

        const blob = new Blob([logText], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `armorylink_debug_${Date.now()}.log`;
        a.click();
        window.URL.revokeObjectURL(url);

        AL.ui?.showToast?.('Export Complete', 'Debug logs exported', 'success');
    }
};

// ========================================
// EXPORT/IMPORT MANAGER
// ========================================
const ExportImportManager = {
    exportAll() {
        const data = {
            version: '0.2.0',
            timestamp: Date.now(),
            settings: AL.persistence.get('settings', {}),
            fields: AL.persistence.get('fields', []),
            rules: AL.persistence.get('rules', []),
            prefixes: AL.persistence.get('prefixes', []),
            macros: AL.persistence.get('macros', []),
            favorites: AL.persistence.get('favorites', []),
            bwcDevices: AL.persistence.get('bwcDevices', []),
            x10Devices: AL.persistence.get('x10Devices', []),
            scanHistory: AL.persistence.get('scanHistory', [])
        };

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `armorylink_backup_${Date.now()}.json`;
        a.click();
        window.URL.revokeObjectURL(url);

        AL.ui?.showToast?.('Export Complete', 'All data exported successfully', 'success');
    },

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    
                    if (!data.version) {
                        throw new Error('Invalid backup file');
                    }

                    // Confirm import
                    if (!confirm('This will replace all current settings and data. Continue?')) {
                        return;
                    }

                    // Import all data
                    if (data.settings) AL.persistence.set('settings', data.settings);
                    if (data.fields) AL.persistence.set('fields', data.fields);
                    if (data.rules) AL.persistence.set('rules', data.rules);
                    if (data.prefixes) AL.persistence.set('prefixes', data.prefixes);
                    if (data.macros) AL.persistence.set('macros', data.macros);
                    if (data.favorites) AL.persistence.set('favorites', data.favorites);
                    if (data.bwcDevices) AL.persistence.set('bwcDevices', data.bwcDevices);
                    if (data.x10Devices) AL.persistence.set('x10Devices', data.x10Devices);
                    if (data.scanHistory) AL.persistence.set('scanHistory', data.scanHistory);

                    AL.ui?.showToast?.('Import Complete', 'All data imported successfully. Refreshing...', 'success');
                    
                    // Reload page to apply changes
                    setTimeout(() => {
                        location.reload();
                    }, 2000);
                    
                } catch (error) {
                    console.error('[export] Import error:', error);
                    AL.ui?.showToast?.('Import Failed', error.message, 'error');
                }
            };
            
            reader.readAsText(file);
        };
        
        input.click();
    }
};

// ========================================
// WORKER MODULE ENHANCEMENT
// ========================================
const WorkerEnhancements = {
    async processScan(scanText, source, timestamp, metadata = {}) {
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        const timeout = settings.scanTimeout || 10000;
        
        return new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Scan processing timeout'));
            }, timeout);

            try {
                const result = {
                    scanText,
                    source,
                    timestamp,
                    success: false,
                    matchedRule: null,
                    actions: [],
                    metadata
                };

                // Apply active prefix if any
                let processedScan = scanText;
                if (AL.prefixes?.activePrefix) {
                    processedScan = AL.prefixes.activePrefix.value + scanText;
                    AL.prefixes.decrementSticky();
                }

                // Check for directive override in metadata
                if (metadata.directive) {
                    // Set type field based on directive
                    await AL.fields?.setFieldValue('type', 
                        metadata.directive === 'Deployment' ? 'Deploy' : 'Return'
                    );
                }

                // Run through rules engine
                const matchResult = AL.rules?.matchScan(processedScan);

                if (matchResult) {
                    result.success = true;
                    result.matchedRule = matchResult.rule;
                    result.actions = matchResult.actions;

                    // Execute actions
                    for (const action of matchResult.actions) {
                        await AL.rules.executeAction(action, matchResult.variables);
                    }

                    // Speech
                    if (matchResult.rule.speechLabel && AL.ui?.speak) {
                        const last4 = AL.utils.getLastDigits(scanText, 4);
                        AL.ui.speak(matchResult.rule.speechLabel + ' ' + last4);
                    }

                    // Update UI components
                    AL.ui?.updateTicker?.();
                    AL.tabTitle?.update?.();

                    // Show success toast
                    AL.ui?.showToast?.('Scan Processed', `Rule: ${matchResult.rule.name}`, 'success');
                    
                    // Add to history
                    AL.capture?.addToHistory(scanText, source, 1, 'success', matchResult.rule.name);
                } else {
                    // No matching rule
                    result.success = false;
                    AL.ui?.showToast?.('No Match', `No rule matched: ${scanText}`, 'warning');
                    
                    // Add to history
                    AL.capture?.addToHistory(scanText, source, 0, 'warning', 'No match');
                }

                // Store last scan
                AL.capture.lastScan = result;
                AL.capture.lastScanTime = timestamp;

                // Broadcast to followers
                AL.broadcast?.broadcastScanResult(result);

                // Update UI
                AL.ui?.updateStatus?.();

                clearTimeout(timeoutId);
                resolve(result);
                
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }
};

// Export all enhancements
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TickerEnhancements,
        ToastEnhancements,
        PrefixEnhancements,
        DebugPanel,
        ExportImportManager,
        WorkerEnhancements
    };
}