// OCSD ArmoryLink v0.2.0 - Implementation Updates Part 1
// This file contains the core module updates for the missing spec items

// ========================================
// ENHANCED RULES ENGINE WITH ALL PATTERN TYPES
// ========================================
const RulesEngineEnhancements = {
    // Complete pattern matching implementation
    matchScan(scanText) {
        const rules = this.getRules();
        const enabledRules = rules.filter(r => r.enabled);
        
        for (const rule of enabledRules) {
            const match = this.matchPattern(scanText, rule);
            if (match) {
                return {
                    rule: rule,
                    variables: match.variables,
                    actions: rule.actions || []
                };
            }
        }
        
        return null;
    },

    matchPattern(scanText, rule) {
        const variables = {
            scanRaw: scanText,
            cleanScan: scanText.replace(/[^A-Z0-9]/gi, ''),
            last4: AL.utils.getLastDigits(scanText, 4),
            timestamp: Date.now(),
            directive: null,
            prefix: AL.prefixes?.activePrefix?.value || ''
        };

        // Check for directive
        if (rule.useDirective) {
            const directiveMatch = scanText.match(/^([*\/])(.+?)([*\/])?$/);
            if (directiveMatch) {
                variables.directive = directiveMatch[1] === '*' ? 'Deployment' : 'Return';
                variables.cleanScan = directiveMatch[2];
                
                // Update scanText to the clean version for pattern matching
                scanText = directiveMatch[2];
            }
        }

        let isMatch = false;
        
        switch (rule.patternType) {
            case 'regex':
                const regex = new RegExp(rule.pattern);
                const regexMatch = scanText.match(regex);
                if (regexMatch) {
                    isMatch = true;
                    // Capture groups
                    for (let i = 0; i < regexMatch.length; i++) {
                        variables[`group${i}`] = regexMatch[i];
                    }
                }
                break;
                
            case 'string':
                isMatch = scanText === rule.pattern;
                break;
                
            case 'startsWith':
                isMatch = scanText.startsWith(rule.pattern);
                break;
                
            case 'endsWith':
                isMatch = scanText.endsWith(rule.pattern);
                break;
                
            case 'contains':
                isMatch = scanText.includes(rule.pattern);
                break;
                
            default:
                console.warn('[rules] Unknown pattern type:', rule.patternType);
        }

        return isMatch ? { variables } : null;
    },

    async executeAction(action, variables) {
        console.log('[rules] Executing action:', action.type, 'with variables:', variables);
        
        // Replace template variables in action values
        const processedAction = this.processTemplateVariables(action, variables);
        
        switch (action.type) {
            case 'setField':
                await AL.fields.setFieldValue(processedAction.field, processedAction.value);
                break;
                
            case 'setType':
                const typeValue = processedAction.value === 'Deployment' ? 'Deploy' : 
                                 processedAction.value === 'Return' ? 'Return' : processedAction.value;
                await AL.fields.setFieldValue('type', typeValue);
                break;
                
            case 'click':
                const element = AL.utils.querySelectorDeep(processedAction.selector);
                if (element) element.click();
                break;
                
            case 'wait':
                const ms = parseInt(processedAction.ms) || 1000;
                await new Promise(resolve => setTimeout(resolve, ms));
                break;
                
            case 'toast':
                AL.ui?.showToast?.(processedAction.title || 'Notification', 
                                  processedAction.message || '', 
                                  processedAction.type || 'info');
                break;
                
            case 'speech':
                AL.ui?.speak?.(processedAction.text || '');
                break;
                
            case 'bwc':
                AL.bwc?.launch?.(processedAction.serial || variables.cleanScan);
                break;
                
            case 'x10':
                AL.x10?.launch?.(processedAction.serial || variables.cleanScan);
                break;
                
            case 'openURL':
                const url = processedAction.url;
                if (url) window.open(url, '_blank');
                break;
                
            default:
                console.warn('[rules] Unknown action type:', action.type);
        }
    },

    processTemplateVariables(action, variables) {
        const processed = { ...action };
        
        // Process all string values in the action
        Object.keys(processed).forEach(key => {
            if (typeof processed[key] === 'string') {
                processed[key] = processed[key].replace(/\$\{(\w+)\}/g, (match, varName) => {
                    return variables[varName] || match;
                });
            }
        });
        
        return processed;
    }
};

// ========================================
// ENHANCED UI PANEL WITH ALL TABS
// ========================================
const UIPanelEnhancements = {
    // Batch tab implementation
    renderBatch(content) {
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        
        content.innerHTML = `
            <div class="al-batch-container">
                <h3>Batch Processing</h3>
                <p style="margin-bottom: 15px; color: var(--text-secondary);">
                    Process multiple barcodes at once
                </p>
                
                <div class="al-form-group">
                    <label>Paste barcodes (one per line):</label>
                    <textarea 
                        id="al-batch-input" 
                        rows="10" 
                        class="al-textarea"
                        placeholder="Enter barcodes here...\n*PID123456\n/PID789012\nW12345678"
                        style="font-family: monospace; width: 100%;">
                    </textarea>
                </div>
                
                <div class="al-form-group">
                    <label>Options:</label>
                    <div class="al-checkbox-group">
                        <input type="checkbox" id="al-batch-ignore-duplicates" class="al-checkbox" checked>
                        <label for="al-batch-ignore-duplicates">Ignore duplicates</label>
                    </div>
                    <div class="al-checkbox-group">
                        <input type="checkbox" id="al-batch-auto-clear" class="al-checkbox">
                        <label for="al-batch-auto-clear">Clear after processing</label>
                    </div>
                </div>
                
                <div class="al-form-group">
                    <label>Processing delay (ms):</label>
                    <input type="number" id="al-batch-delay" class="al-input" 
                           value="${settings.scanThrottle || 150}" min="50" max="5000">
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="al-batch-process-btn" class="al-btn al-btn-primary">
                        ⚡ Process Batch
                    </button>
                    <button id="al-batch-clear-btn" class="al-btn al-btn-secondary">
                        Clear
                    </button>
                    <button id="al-batch-sample-btn" class="al-btn al-btn-secondary">
                        Load Sample
                    </button>
                </div>
                
                <div id="al-batch-status" style="margin-top: 20px; padding: 10px; 
                     background: var(--bg-secondary); border-radius: var(--radius-md);
                     display: none;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span id="al-batch-status-text">Ready to process...</span>
                        <span id="al-batch-progress" style="font-weight: bold;">0/0</span>
                    </div>
                    <div style="margin-top: 10px;">
                        <div style="height: 4px; background: var(--bg-primary); border-radius: 2px; overflow: hidden;">
                            <div id="al-batch-progress-bar" style="height: 100%; background: var(--accent-primary); 
                                 width: 0%; transition: width 0.3s ease;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Event handlers
        document.getElementById('al-batch-process-btn').onclick = () => this.processBatch();
        document.getElementById('al-batch-clear-btn').onclick = () => {
            document.getElementById('al-batch-input').value = '';
            this.hideBatchStatus();
        };
        document.getElementById('al-batch-sample-btn').onclick = () => {
            document.getElementById('al-batch-input').value = 
                '*PID123456\n' +
                '/PID789012\n' +
                'W12345678\n' +
                'X87654321\n' +
                'V1234';
        };
    },

    async processBatch() {
        const input = document.getElementById('al-batch-input');
        const ignoreDuplicates = document.getElementById('al-batch-ignore-duplicates').checked;
        const autoClear = document.getElementById('al-batch-auto-clear').checked;
        const delay = parseInt(document.getElementById('al-batch-delay').value) || 150;
        
        const barcodes = input.value
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        if (barcodes.length === 0) {
            AL.ui.showToast('No Barcodes', 'Please enter at least one barcode', 'warning');
            return;
        }

        // Remove duplicates if needed
        const processQueue = ignoreDuplicates ? 
            [...new Set(barcodes)] : barcodes;

        this.showBatchStatus(0, processQueue.length);

        // Process each barcode
        for (let i = 0; i < processQueue.length; i++) {
            const barcode = processQueue[i];
            
            // Update progress
            this.updateBatchStatus(i + 1, processQueue.length);
            
            // Process barcode
            AL.capture.handleManualInput(barcode);
            
            // Wait before next
            if (i < processQueue.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        AL.ui.showToast('Batch Complete', 
            `Processed ${processQueue.length} barcode${processQueue.length !== 1 ? 's' : ''}`, 
            'success');

        if (autoClear) {
            input.value = '';
        }

        setTimeout(() => this.hideBatchStatus(), 3000);
    },

    showBatchStatus(current, total) {
        const statusDiv = document.getElementById('al-batch-status');
        statusDiv.style.display = 'block';
        this.updateBatchStatus(current, total);
    },

    updateBatchStatus(current, total) {
        document.getElementById('al-batch-status-text').textContent = 
            current === total ? 'Processing complete!' : `Processing barcode ${current} of ${total}...`;
        document.getElementById('al-batch-progress').textContent = `${current}/${total}`;
        
        const percentage = (current / total) * 100;
        document.getElementById('al-batch-progress-bar').style.width = percentage + '%';
    },

    hideBatchStatus() {
        document.getElementById('al-batch-status').style.display = 'none';
    },

    // History tab implementation
    renderHistory(content) {
        const history = AL.capture.scanHistory || [];
        const recentHistory = history.slice(-100).reverse(); // Show last 100, newest first
        
        content.innerHTML = `
            <div class="al-history-container">
                <h3>Scan History</h3>
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <span style="color: var(--text-secondary);">
                        ${history.length} total scan${history.length !== 1 ? 's' : ''}
                    </span>
                    <div style="display: flex; gap: 10px;">
                        <button id="al-history-clear-btn" class="al-btn al-btn-danger">
                            Clear History
                        </button>
                        <button id="al-history-export-btn" class="al-btn al-btn-secondary">
                            Export CSV
                        </button>
                    </div>
                </div>
                
                <div style="max-height: 500px; overflow-y: auto;">
                    ${recentHistory.length === 0 ? `
                        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                            <div style="font-size: 48px; margin-bottom: 10px;">📋</div>
                            <div>No scan history yet</div>
                        </div>
                    ` : `
                        <div class="al-history-list">
                            ${recentHistory.map(entry => `
                                <div class="al-history-item" style="
                                    padding: 10px;
                                    margin-bottom: 8px;
                                    background: var(--bg-secondary);
                                    border-left: 3px solid ${
                                        entry.status === 'success' ? 'var(--accent-success)' :
                                        entry.status === 'error' ? 'var(--accent-danger)' :
                                        entry.status === 'warning' ? 'var(--accent-warning)' :
                                        'var(--accent-info)'
                                    };
                                    border-radius: var(--radius-md);
                                ">
                                    <div style="display: flex; justify-content: space-between; align-items: start;">
                                        <div>
                                            <div style="font-weight: 600; font-family: monospace;">
                                                ${AL.utils.escapeHtml(entry.scan)}
                                            </div>
                                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                                                ${entry.type} • ${AL.utils.formatTimestamp(entry.timestamp)}
                                                ${entry.rulesMatched > 0 ? ` • ${entry.rulesMatched} rule${entry.rulesMatched !== 1 ? 's' : ''} matched` : ''}
                                            </div>
                                        </div>
                                        <div style="text-align: right;">
                                            <span class="al-badge" style="
                                                background: ${
                                                    entry.status === 'success' ? 'var(--accent-success)' :
                                                    entry.status === 'error' ? 'var(--accent-danger)' :
                                                    entry.status === 'warning' ? 'var(--accent-warning)' :
                                                    'var(--accent-info)'
                                                };
                                                color: white;
                                                padding: 2px 8px;
                                                border-radius: 12px;
                                                font-size: 11px;
                                                font-weight: 600;
                                            ">
                                                ${entry.statusText || entry.status}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            </div>
        `;

        // Event handlers
        if (document.getElementById('al-history-clear-btn')) {
            document.getElementById('al-history-clear-btn').onclick = () => {
                if (confirm('Clear all scan history? This cannot be undone.')) {
                    AL.capture.clearHistory();
                    this.renderHistory(content);
                }
            };
        }

        if (document.getElementById('al-history-export-btn')) {
            document.getElementById('al-history-export-btn').onclick = () => {
                this.exportHistoryCSV();
            };
        }
    },

    exportHistoryCSV() {
        const history = AL.capture.scanHistory || [];
        
        if (history.length === 0) {
            AL.ui.showToast('No Data', 'No history to export', 'warning');
            return;
        }

        // Create CSV content
        const headers = ['Timestamp', 'Scan', 'Type', 'Rules Matched', 'Status', 'Status Text'];
        const rows = history.map(entry => [
            new Date(entry.timestamp).toISOString(),
            entry.scan,
            entry.type,
            entry.rulesMatched || 0,
            entry.status,
            entry.statusText || ''
        ]);

        let csvContent = headers.join(',') + '\n';
        rows.forEach(row => {
            csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
        });

        // Download CSV
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `armorylink_history_${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        AL.ui.showToast('Export Complete', 'History exported to CSV', 'success');
    },

    // Settings tab implementation
    renderSettings(content) {
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        const themes = AL.stubs.getDefaultThemes();
        
        content.innerHTML = `
            <div class="al-settings-container">
                <h3>Settings</h3>
                
                <div class="al-settings-sections" style="max-height: 500px; overflow-y: auto;">
                    <!-- Capture Settings -->
                    <div class="al-settings-section">
                        <h4>Capture</h4>
                        <div class="al-form-group">
                            <label>Default Mode:</label>
                            <select id="al-settings-capture-mode" class="al-select">
                                <option value="on" ${settings.captureMode === 'on' ? 'selected' : ''}>Activate</option>
                                <option value="standby" ${settings.captureMode === 'standby' ? 'selected' : ''}>Standby</option>
                                <option value="off" ${settings.captureMode === 'off' ? 'selected' : ''}>Disable</option>
                            </select>
                        </div>
                        <div class="al-form-group">
                            <label>Duplicate Window (ms):</label>
                            <input type="number" id="al-settings-duplicate-window" class="al-input" 
                                   value="${settings.duplicateWindow}" min="1000" max="30000">
                        </div>
                        <div class="al-form-group">
                            <label>Scan Throttle (ms):</label>
                            <input type="number" id="al-settings-scan-throttle" class="al-input" 
                                   value="${settings.scanThrottle}" min="50" max="1000">
                        </div>
                    </div>
                    
                    <!-- Toast Settings -->
                    <div class="al-settings-section">
                        <h4>Toast Notifications</h4>
                        <div class="al-form-group">
                            <label>Position:</label>
                            <select id="al-settings-toast-position" class="al-select">
                                <option value="tl" ${settings.toasterPosition === 'tl' ? 'selected' : ''}>Top Left</option>
                                <option value="tr" ${settings.toasterPosition === 'tr' ? 'selected' : ''}>Top Right</option>
                                <option value="bl" ${settings.toasterPosition === 'bl' ? 'selected' : ''}>Bottom Left</option>
                                <option value="br" ${settings.toasterPosition === 'br' ? 'selected' : ''}>Bottom Right</option>
                                <option value="tc" ${settings.toasterPosition === 'tc' ? 'selected' : ''}>Top Center</option>
                                <option value="bc" ${settings.toasterPosition === 'bc' ? 'selected' : ''}>Bottom Center</option>
                            </select>
                        </div>
                        <div class="al-form-group">
                            <label>Size:</label>
                            <select id="al-settings-toast-size" class="al-select">
                                <option value="small" ${settings.toasterSize === 'small' ? 'selected' : ''}>Small</option>
                                <option value="medium" ${settings.toasterSize === 'medium' ? 'selected' : ''}>Medium</option>
                                <option value="large" ${settings.toasterSize === 'large' ? 'selected' : ''}>Large</option>
                            </select>
                        </div>
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-settings-toast-sound" class="al-checkbox" 
                                   ${settings.toasterSound ? 'checked' : ''}>
                            <label for="al-settings-toast-sound">Play sound</label>
                        </div>
                        <div class="al-form-group">
                            <label>Auto-dismiss (ms):</label>
                            <input type="number" id="al-settings-toast-dismiss" class="al-input" 
                                   value="${settings.toasterAutoDismiss}" min="1000" max="10000">
                        </div>
                    </div>
                    
                    <!-- Theme Settings -->
                    <div class="al-settings-section">
                        <h4>Theme</h4>
                        <div class="al-form-group">
                            <label>Color Theme:</label>
                            <select id="al-settings-theme" class="al-select">
                                ${Object.keys(themes).map(themeName => `
                                    <option value="${themeName}" ${settings.theme === themeName ? 'selected' : ''}>
                                        ${themeName}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Panel Settings -->
                    <div class="al-settings-section">
                        <h4>Panel</h4>
                        <div class="al-form-group">
                            <label>Default Position:</label>
                            <select id="al-settings-panel-position" class="al-select">
                                <option value="left" ${settings.panelPosition === 'left' ? 'selected' : ''}>Left</option>
                                <option value="right" ${settings.panelPosition === 'right' ? 'selected' : ''}>Right</option>
                                <option value="bottom" ${settings.panelPosition === 'bottom' ? 'selected' : ''}>Bottom</option>
                                <option value="floating" ${settings.panelPosition === 'floating' ? 'selected' : ''}>Floating</option>
                            </select>
                        </div>
                        <div class="al-form-group">
                            <label>Width (px):</label>
                            <input type="number" id="al-settings-panel-width" class="al-input" 
                                   value="${settings.panelWidth}" min="300" max="600">
                        </div>
                        <div class="al-form-group">
                            <label>Top Gap (px):</label>
                            <input type="number" id="al-settings-panel-gap" class="al-input" 
                                   value="${settings.panelTopGap}" min="0" max="200">
                        </div>
                    </div>
                    
                    <!-- Debug Settings -->
                    <div class="al-settings-section">
                        <h4>Debug</h4>
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-settings-debug-enabled" class="al-checkbox" 
                                   ${settings.debugEnabled ? 'checked' : ''}>
                            <label for="al-settings-debug-enabled">Enable debug logging</label>
                        </div>
                        <div class="al-checkbox-group">
                            <input type="checkbox" id="al-settings-debug-autoscroll" class="al-checkbox" 
                                   ${settings.debugAutoScroll ? 'checked' : ''}>
                            <label for="al-settings-debug-autoscroll">Auto-scroll debug output</label>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 20px; padding-top: 15px; 
                     border-top: 1px solid var(--border-light);">
                    <button id="al-settings-save-btn" class="al-btn al-btn-primary">
                        💾 Save Settings
                    </button>
                    <button id="al-settings-reset-btn" class="al-btn al-btn-danger">
                        Reset to Defaults
                    </button>
                    <button id="al-settings-export-btn" class="al-btn al-btn-secondary">
                        Export All Data
                    </button>
                    <button id="al-settings-import-btn" class="al-btn al-btn-secondary">
                        Import Data
                    </button>
                </div>
            </div>
        `;

        // Event handlers
        document.getElementById('al-settings-save-btn').onclick = () => this.saveSettings();
        document.getElementById('al-settings-reset-btn').onclick = () => {
            if (confirm('Reset all settings to defaults? This cannot be undone.')) {
                this.resetSettings();
            }
        };
        document.getElementById('al-settings-export-btn').onclick = () => AL.exportManager?.exportAll();
        document.getElementById('al-settings-import-btn').onclick = () => AL.exportManager?.importData();
    },

    saveSettings() {
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        
        // Gather all settings
        settings.captureMode = document.getElementById('al-settings-capture-mode').value;
        settings.duplicateWindow = parseInt(document.getElementById('al-settings-duplicate-window').value);
        settings.scanThrottle = parseInt(document.getElementById('al-settings-scan-throttle').value);
        settings.toasterPosition = document.getElementById('al-settings-toast-position').value;
        settings.toasterSize = document.getElementById('al-settings-toast-size').value;
        settings.toasterSound = document.getElementById('al-settings-toast-sound').checked;
        settings.toasterAutoDismiss = parseInt(document.getElementById('al-settings-toast-dismiss').value);
        settings.theme = document.getElementById('al-settings-theme').value;
        settings.panelPosition = document.getElementById('al-settings-panel-position').value;
        settings.panelWidth = parseInt(document.getElementById('al-settings-panel-width').value);
        settings.panelTopGap = parseInt(document.getElementById('al-settings-panel-gap').value);
        settings.debugEnabled = document.getElementById('al-settings-debug-enabled').checked;
        settings.debugAutoScroll = document.getElementById('al-settings-debug-autoscroll').checked;
        
        // Save
        AL.persistence.set('settings', settings);
        
        // Apply theme
        if (AL.ui && AL.ui.applyTheme) {
            AL.ui.applyTheme(settings.theme);
        }
        
        // Apply capture mode
        if (AL.capture) {
            AL.capture.setMode(settings.captureMode);
        }
        
        AL.ui.showToast('Settings Saved', 'All settings have been updated', 'success');
    },

    resetSettings() {
        const defaults = AL.stubs.getDefaultSettings();
        AL.persistence.set('settings', defaults);
        
        // Refresh the settings tab
        const content = document.getElementById('al-content');
        if (content) {
            this.renderSettings(content);
        }
        
        AL.ui.showToast('Reset Complete', 'Settings restored to defaults', 'success');
    },

    // Debug tab implementation
    renderDebug(content) {
        const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
        const logs = AL.debugPanel?.logs || [];
        
        content.innerHTML = `
            <div class="al-debug-container">
                <h3>Debug Console</h3>
                
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <button id="al-debug-clear-btn" class="al-btn al-btn-secondary">Clear</button>
                    <button id="al-debug-export-btn" class="al-btn al-btn-secondary">Export Logs</button>
                    <div style="flex: 1;"></div>
                    <label style="display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" id="al-debug-autoscroll" class="al-checkbox" 
                               ${settings.debugAutoScroll ? 'checked' : ''}>
                        Auto-scroll
                    </label>
                    <label style="display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" id="al-debug-wrap" class="al-checkbox" 
                               ${settings.debugWrapText ? 'checked' : ''}>
                        Wrap text
                    </label>
                </div>
                
                <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                    <button class="al-debug-filter al-btn al-btn-secondary" data-level="all">All</button>
                    <button class="al-debug-filter al-btn al-btn-secondary" data-level="log">Log</button>
                    <button class="al-debug-filter al-btn al-btn-secondary" data-level="warn">Warn</button>
                    <button class="al-debug-filter al-btn al-btn-secondary" data-level="error">Error</button>
                </div>
                
                <div id="al-debug-output" style="
                    background: #000;
                    color: #0f0;
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    padding: 10px;
                    height: 400px;
                    overflow-y: auto;
                    border-radius: var(--radius-md);
                    white-space: ${settings.debugWrapText ? 'normal' : 'nowrap'};
                ">
                    ${logs.map(log => `
                        <div class="al-debug-line" data-level="${log.level}" style="
                            color: ${
                                log.level === 'error' ? '#f44' :
                                log.level === 'warn' ? '#fa0' :
                                '#0f0'
                            };
                            margin-bottom: 2px;
                        ">
                            <span style="color: #888;">[${new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span style="color: ${
                                log.level === 'error' ? '#f44' :
                                log.level === 'warn' ? '#fa0' :
                                '#0a0'
                            };">[${log.level.toUpperCase()}]</span>
                            ${AL.utils.escapeHtml(log.message)}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Event handlers
        document.getElementById('al-debug-clear-btn').onclick = () => {
            AL.debugPanel?.clear();
            document.getElementById('al-debug-output').innerHTML = '';
        };
        
        document.getElementById('al-debug-export-btn').onclick = () => {
            AL.debugPanel?.export();
        };
        
        document.getElementById('al-debug-autoscroll').onchange = (e) => {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            settings.debugAutoScroll = e.target.checked;
            AL.persistence.set('settings', settings);
        };
        
        document.getElementById('al-debug-wrap').onchange = (e) => {
            const settings = AL.persistence.get('settings', AL.stubs.getDefaultSettings());
            settings.debugWrapText = e.target.checked;
            AL.persistence.set('settings', settings);
            document.getElementById('al-debug-output').style.whiteSpace = 
                e.target.checked ? 'normal' : 'nowrap';
        };
        
        // Filter buttons
        document.querySelectorAll('.al-debug-filter').forEach(btn => {
            btn.onclick = () => {
                const level = btn.dataset.level;
                const lines = document.querySelectorAll('.al-debug-line');
                
                lines.forEach(line => {
                    if (level === 'all' || line.dataset.level === level) {
                        line.style.display = 'block';
                    } else {
                        line.style.display = 'none';
                    }
                });
                
                // Update button states
                document.querySelectorAll('.al-debug-filter').forEach(b => {
                    b.classList.remove('al-btn-primary');
                    b.classList.add('al-btn-secondary');
                });
                btn.classList.remove('al-btn-secondary');
                btn.classList.add('al-btn-primary');
            };
        });
    }
};

// Export the enhancements
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RulesEngineEnhancements, UIPanelEnhancements };
}