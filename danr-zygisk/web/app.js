// DANR Zygisk Configuration UI
let allPackages = [];
let selectedPackages = new Set();
let config = {};
let autoSaveTimeout = null;
let isSaving = false;
let autoRefreshInterval = null;
let allLogs = [];
let seenLogs = new Set(); // Track logs we've already displayed

// DOM Elements
const appListEl = document.getElementById('appList');
const searchInput = document.getElementById('searchInput');
const selectedCountEl = document.getElementById('selectedCount');
const backendUrlEl = document.getElementById('backendUrl');
const anrThresholdEl = document.getElementById('anrThreshold');
const enableInReleaseEl = document.getElementById('enableInRelease');
const enableInDebugEl = document.getElementById('enableInDebug');
const autoStartEl = document.getElementById('autoStart');
const statusEl = document.getElementById('status');
const logViewerEl = document.getElementById('logViewer');
const logSearchEl = document.getElementById('logSearch');
const refreshLogsBtn = document.getElementById('refreshLogs');
const clearLogsBtn = document.getElementById('clearLogs');
const autoRefreshEl = document.getElementById('autoRefresh');
const maxLogLinesEl = document.getElementById('maxLogLines');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadConfiguration();
    loadPackages();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('saveConfig').addEventListener('click', () => saveConfiguration(false));
    document.getElementById('reloadConfig').addEventListener('click', loadConfiguration);
    document.getElementById('selectAll').addEventListener('click', selectAll);
    document.getElementById('deselectAll').addEventListener('click', deselectAll);
    searchInput.addEventListener('input', filterPackages);

    // Auto-save on configuration changes
    backendUrlEl.addEventListener('input', () => scheduleAutoSave());
    anrThresholdEl.addEventListener('input', () => scheduleAutoSave());
    enableInReleaseEl.addEventListener('change', () => scheduleAutoSave());
    enableInDebugEl.addEventListener('change', () => scheduleAutoSave());
    autoStartEl.addEventListener('change', () => scheduleAutoSave());

    // Log viewer event listeners
    refreshLogsBtn.addEventListener('click', loadLogs);
    clearLogsBtn.addEventListener('click', clearLogs);
    logSearchEl.addEventListener('input', filterLogs);
    autoRefreshEl.addEventListener('change', toggleAutoRefresh);
}

function scheduleAutoSave() {
    // Clear existing timeout
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }

    // Show saving indicator
    showStatus('Changes will be saved...', 'info');

    // Schedule save after 1 second of inactivity
    autoSaveTimeout = setTimeout(() => {
        saveConfiguration(true);
    }, 1000);
}

async function loadConfiguration() {
    try {
        showStatus('Loading configuration...', 'info');
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Failed to load config');

        config = await response.json();

        // Populate form fields
        backendUrlEl.value = config.danrConfig?.backendUrl || '';
        anrThresholdEl.value = config.danrConfig?.anrThresholdMs || 5000;
        enableInReleaseEl.checked = config.danrConfig?.enableInRelease !== false;
        enableInDebugEl.checked = config.danrConfig?.enableInDebug !== false;
        autoStartEl.checked = config.danrConfig?.autoStart !== false;

        // Load whitelist
        selectedPackages = new Set(config.whitelist || []);

        hideStatus();
        renderPackageList();
    } catch (error) {
        showStatus('Failed to load configuration: ' + error.message, 'error');
    }
}

async function loadPackages() {
    try {
        appListEl.innerHTML = '<div class="loading">Loading installed apps... This may take a moment.</div>';

        const response = await fetch('/api/packages');
        if (!response.ok) throw new Error('Failed to load packages');

        const packages = await response.json();

        // Handle both old format (strings) and new format (objects)
        allPackages = packages.map(pkg => {
            if (typeof pkg === 'string') {
                return { package: pkg, label: null };
            }
            return pkg;
        });

        // Sort by label if available, otherwise by package name
        allPackages.sort((a, b) => {
            const nameA = (a.label || a.package).toLowerCase();
            const nameB = (b.label || b.package).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        renderPackageList();
    } catch (error) {
        appListEl.innerHTML = `<div class="loading">Error loading packages: ${error.message}</div>`;
    }
}

function getAppDisplayName(appInfo) {
    // Use real label if available, otherwise extract from package name
    if (appInfo.label) {
        return appInfo.label;
    }
    const parts = appInfo.package.split('.');
    return parts[parts.length - 1] || appInfo.package;
}

function getAppInitial(appInfo) {
    const displayName = getAppDisplayName(appInfo);
    return displayName.charAt(0).toUpperCase();
}

function getAvatarColor(packageName) {
    // Generate consistent color based on package name
    let hash = 0;
    for (let i = 0; i < packageName.length; i++) {
        hash = packageName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 65%, 55%)`;
}

function renderPackageList(filter = '') {
    if (allPackages.length === 0) {
        appListEl.innerHTML = '<div class="loading">Loading installed apps...</div>';
        return;
    }

    const filteredPackages = filter
        ? allPackages.filter(app => {
            const searchTerm = filter.toLowerCase();
            const packageMatch = app.package.toLowerCase().includes(searchTerm);
            const labelMatch = app.label && app.label.toLowerCase().includes(searchTerm);
            return packageMatch || labelMatch;
        })
        : allPackages;

    if (filteredPackages.length === 0) {
        appListEl.innerHTML = '<div class="loading">No apps found matching your search</div>';
        return;
    }

    appListEl.innerHTML = filteredPackages.map(app => `
        <div class="app-item">
            <input type="checkbox"
                   id="pkg-${escapeHtml(app.package)}"
                   ${selectedPackages.has(app.package) ? 'checked' : ''}
                   onchange="togglePackage('${escapeHtml(app.package)}')">
            <div class="app-icon" style="background-color: ${getAvatarColor(app.package)}">
                ${getAppInitial(app)}
            </div>
            <div class="app-info">
                <div class="app-name">${escapeHtml(getAppDisplayName(app))}</div>
                <div class="app-package">${escapeHtml(app.package)}</div>
            </div>
        </div>
    `).join('');

    updateSelectedCount();
}

function togglePackage(packageName) {
    if (selectedPackages.has(packageName)) {
        selectedPackages.delete(packageName);
    } else {
        selectedPackages.add(packageName);
    }
    updateSelectedCount();
    // Auto-save when app selection changes
    scheduleAutoSave();
}

function selectAll() {
    const visiblePackages = getCurrentVisiblePackages();
    visiblePackages.forEach(pkg => selectedPackages.add(pkg));
    renderPackageList(searchInput.value);
    scheduleAutoSave();
}

function deselectAll() {
    const visiblePackages = getCurrentVisiblePackages();
    visiblePackages.forEach(pkg => selectedPackages.delete(pkg));
    renderPackageList(searchInput.value);
    scheduleAutoSave();
}

function getCurrentVisiblePackages() {
    const filter = searchInput.value.toLowerCase();
    if (!filter) return allPackages.map(app => app.package);

    return allPackages
        .filter(app => {
            const packageMatch = app.package.toLowerCase().includes(filter);
            const labelMatch = app.label && app.label.toLowerCase().includes(filter);
            return packageMatch || labelMatch;
        })
        .map(app => app.package);
}

function filterPackages() {
    renderPackageList(searchInput.value);
}

function updateSelectedCount() {
    selectedCountEl.textContent = selectedPackages.size;
}

async function saveConfiguration(isAutoSave = false) {
    if (isSaving) return; // Prevent concurrent saves

    try {
        isSaving = true;
        showStatus(isAutoSave ? 'Auto-saving...' : 'Saving configuration...', 'info');

        const newConfig = {
            whitelist: Array.from(selectedPackages).sort(),
            danrConfig: {
                backendUrl: backendUrlEl.value.trim(),
                anrThresholdMs: parseInt(anrThresholdEl.value) || 5000,
                enableInRelease: enableInReleaseEl.checked,
                enableInDebug: enableInDebugEl.checked,
                autoStart: autoStartEl.checked
            }
        };

        // Validate
        if (!newConfig.danrConfig.backendUrl) {
            showStatus('Please enter a backend URL', 'error');
            isSaving = false;
            return;
        }

        if (!isAutoSave && newConfig.whitelist.length === 0) {
            if (!confirm('No apps selected. DANR will not monitor any apps. Continue?')) {
                hideStatus();
                isSaving = false;
                return;
            }
        }

        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newConfig)
        });

        if (!response.ok) {
            throw new Error('Failed to save configuration');
        }

        const result = await response.json();

        if (isAutoSave) {
            showStatus('✓ Saved', 'success');
            // Auto-hide after 2 seconds for auto-save
            setTimeout(hideStatus, 2000);
        } else {
            showStatus(result.message || 'Configuration saved successfully!', 'success');
            // Auto-hide after 5 seconds for manual save
            setTimeout(hideStatus, 5000);
        }

        config = newConfig;
        isSaving = false;
    } catch (error) {
        showStatus('Failed to save: ' + error.message, 'error');
        isSaving = false;
    }
}

function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
}

function hideStatus() {
    statusEl.className = 'status hidden';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Log Viewer Functions
// ============================================

async function loadLogs() {
    try {
        const response = await fetch('/api/logs');
        if (!response.ok) throw new Error('Failed to load logs');

        const logs = await response.text();
        const newLines = logs.split('\n').filter(line => line.trim());

        // Track whether we should auto-scroll (only if already at bottom)
        const shouldAutoScroll = logViewerEl.scrollHeight - logViewerEl.scrollTop <= logViewerEl.clientHeight + 100;

        // Only add new logs we haven't seen before
        let addedNew = false;
        for (const line of newLines) {
            if (!seenLogs.has(line)) {
                allLogs.push(line);
                seenLogs.add(line);
                addedNew = true;
            }
        }

        // Trim to max lines
        const maxLines = parseInt(maxLogLinesEl.value) || 100;
        if (allLogs.length > maxLines) {
            const removed = allLogs.splice(0, allLogs.length - maxLines);
            // Remove from seen set
            removed.forEach(line => seenLogs.delete(line));
        }

        // Only re-render if we added new logs or if filter is active
        if (addedNew || logSearchEl.value) {
            renderLogs(shouldAutoScroll);
        }
    } catch (error) {
        if (allLogs.length === 0) {
            logViewerEl.innerHTML = `<div class="loading">Error loading logs: ${error.message}</div>`;
        }
    }
}

function parseLogLine(line) {
    // Parse Android logcat format: timestamp level/tag(pid): message
    // Example: 12-11 10:23:45.678  1234  1234 D DANR-Zygisk: Module loaded

    const logcatRegex = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\d+\s+\d+\s+([A-Z])\/([^:]+):\s*(.*)$/;
    const simpleRegex = /^([A-Z])\s+([^:]+):\s*(.*)$/;

    let match = line.match(logcatRegex);
    if (match) {
        return {
            timestamp: match[1],
            level: match[2],
            tag: match[3].trim(),
            message: match[4]
        };
    }

    match = line.match(simpleRegex);
    if (match) {
        return {
            timestamp: '',
            level: match[1],
            tag: match[2].trim(),
            message: match[3]
        };
    }

    // Fallback for unparsed lines
    return {
        timestamp: '',
        level: 'I',
        tag: '',
        message: line
    };
}

function renderLogs(shouldAutoScroll = true) {
    if (allLogs.length === 0) {
        logViewerEl.innerHTML = '<div class="loading">No logs available. Click Refresh to load.</div>';
        return;
    }

    const filter = logSearchEl.value.toLowerCase();
    const filteredLogs = filter
        ? allLogs.filter(line => line.toLowerCase().includes(filter))
        : allLogs;

    if (filteredLogs.length === 0) {
        logViewerEl.innerHTML = '<div class="loading">No logs match your filter</div>';
        return;
    }

    logViewerEl.innerHTML = filteredLogs.map(line => {
        const parsed = parseLogLine(line);
        const levelClass = `log-level-${parsed.level}`;

        return `<div class="log-line ${levelClass}">` +
            (parsed.timestamp ? `<span class="log-timestamp">${escapeHtml(parsed.timestamp)}</span>` : '') +
            `<span class="log-level ${levelClass}">${parsed.level}</span>` +
            (parsed.tag ? `<span class="log-tag">${escapeHtml(parsed.tag)}</span>` : '') +
            `<span class="log-message">${escapeHtml(parsed.message)}</span>` +
        `</div>`;
    }).join('');

    // Auto-scroll to bottom only if we should
    if (shouldAutoScroll) {
        logViewerEl.scrollTop = logViewerEl.scrollHeight;
    }
}

function filterLogs() {
    renderLogs(false); // Don't auto-scroll when filtering
}

function clearLogs() {
    allLogs = [];
    seenLogs.clear();
    logViewerEl.innerHTML = '<div class="loading">Logs cleared. Click Refresh to load new logs.</div>';
}

function toggleAutoRefresh() {
    if (autoRefreshEl.checked) {
        // Refresh every 3 seconds
        autoRefreshInterval = setInterval(loadLogs, 3000);
        loadLogs(); // Load immediately
    } else {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }
}
