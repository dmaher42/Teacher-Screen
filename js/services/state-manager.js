const STATE_MIGRATIONS = [
    {
        from: 0,
        to: 1,
        migrate(state) {
            // Ensure state.layout exists and is well-formed.
            if (!state.layout || typeof state.layout !== 'object' || !Array.isArray(state.layout.widgets)) {
                state.layout = { mode: 'dashboard', widgets: [] };
            }
            state.layout = normalizeMigratedLayout(state.layout);
            state.layout.widgets = state.layout.widgets.map((widget) => normalizeMigratedWidget(widget));

            state.schemaVersion = 1;
            console.log('Migrated state from schema v0 to v1');
            return state;
        }
    }
];


function normalizeMigratedWidget(widget) {
    if (!widget || typeof widget !== 'object') return widget;

    if (typeof widget.width !== 'number' || widget.width <= 0) {
        widget.width = 320;
    }

    if (typeof widget.height !== 'number' || widget.height <= 0) {
        widget.height = 240;
    }

    if (typeof widget.x !== 'number') {
        widget.x = 0;
    }

    if (typeof widget.y !== 'number') {
        widget.y = 0;
    }

    if (widget.x < 0) {
        widget.x = 0;
    }

    if (widget.y < 0) {
        widget.y = 0;
    }

    return widget;
}

function normalizeMigratedLayout(layout) {
    if (!layout || typeof layout !== 'object') {
        return { mode: 'dashboard', widgets: [] };
    }

    if (!Array.isArray(layout.widgets)) {
        layout.widgets = [];
    }

    if (!['dashboard', 'stage'].includes(layout.mode)) {
        layout.mode = 'dashboard';
    }

    return layout;
}

export function safeParseLocalStorage(key) {
    try {
        const value = localStorage.getItem(key);
        if (!value) return null;
        return JSON.parse(value);
    } catch (error) {
        console.warn('Invalid localStorage data detected for:', key);
        localStorage.removeItem(key);
        return null;
    }
}

export function isValidLayout(layout) {
    if (!layout || typeof layout !== 'object') return false;
    if (!['dashboard', 'stage'].includes(layout.mode)) return false;
    if (!Array.isArray(layout.widgets)) return false;

    for (const widget of layout.widgets) {
        if (!widget || typeof widget !== 'object') return false;
        if (typeof widget.id !== 'string') return false;
        if (typeof widget.type !== 'string') return false;
        if (typeof widget.x !== 'number') return false;
        if (typeof widget.y !== 'number') return false;
        if (typeof widget.width !== 'number') return false;
        if (typeof widget.height !== 'number') return false;
    }

    return true;
}

export function captureLocalStorageState() {
    const snapshot = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('layouts_')) continue;
        snapshot[key] = localStorage.getItem(key);
    }
    return snapshot;
}

export function restoreLocalStorageState(snapshot = {}) {
    Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string') {
            localStorage.setItem(key, value);
        }
    });
}

export function runMigrations(state, schemaVersion = 1) {
    // Default to schema 0 if it's a legacy state object.
    state.schemaVersion = state.schemaVersion || 0;

    if (state.layout && typeof state.layout === 'object') {
        state.layout = normalizeMigratedLayout(state.layout);
    }

    if (state.layout && Array.isArray(state.layout.widgets)) {
        state.layout.widgets = state.layout.widgets.map((widget) => normalizeMigratedWidget(widget));
    }

    while (state.schemaVersion < schemaVersion) {
        const migration = STATE_MIGRATIONS.find(m => m.from === state.schemaVersion);
        if (!migration) {
            console.warn(`No migration found for schema version ${state.schemaVersion}. Halting migration.`);
            // Potentially discard incompatible layout, or handle error gracefully.
            state.layout = { widgets: [] };
            break;
        }
        state = migration.migrate(state);
    }
    return state;
}

export function saveState(layout, options = {}) {
    const source = options.source || 'teacher';
    const projectorChannel = options.projectorChannel;
    const syncToken = options.syncToken || null;

    const stateJSON = JSON.stringify(layout);
    localStorage.setItem('classroomScreenState', stateJSON);

    // Rotate backups
    try {
        const backup1 = localStorage.getItem('classroomScreenState.backup1');
        const backup2 = localStorage.getItem('classroomScreenState.backup2');

        if (backup2) {
            localStorage.setItem('classroomScreenState.backup3', backup2);
        }
        if (backup1) {
            localStorage.setItem('classroomScreenState.backup2', backup1);
        }
        localStorage.setItem('classroomScreenState.backup1', stateJSON);
    } catch (e) {
        console.error('Backup rotation failed:', e);
    }

    if (projectorChannel) {
        projectorChannel.postMessage({
            type: 'layout-update',
            state: layout,
            source,
            syncToken
        });
    }
}

export function loadSavedState(options = {}) {
    const {
        applyState,
        resetAppState,
        showNotification,
        schemaVersion = 1
    } = options;

    const attemptLoad = (key) => {
        const parsed = safeParseLocalStorage(key);
        if (parsed && typeof parsed === 'object') {
            const migratedState = runMigrations(parsed, schemaVersion);
            if (!isValidLayout(migratedState.layout)) {
                console.warn('Invalid layout detected. Resetting layout state.');
                resetAppState();
                return null;
            }
            return migratedState;
        }
        return null;
    };

    // Try loading primary state
    let state = attemptLoad('classroomScreenState');
    if (state) {
        applyState(state);
        return;
    }

    // If primary failed, try backups
    const backupKeys = [
        'classroomScreenState.backup1',
        'classroomScreenState.backup2',
        'classroomScreenState.backup3'
    ];

    for (const key of backupKeys) {
        state = attemptLoad(key);
        if (state) {
            console.log(`Restoring state from ${key}`);
            applyState(state);
            showNotification('Your layout was restored from a backup.');
            return;
        }
    }

    // If all fail, ensure corrupt state is cleared so defaults can load
    if (localStorage.getItem('classroomScreenState')) {
        console.warn('Corrupt state detected and no backups available; clearing.');
        resetAppState();
    }

    console.log('No saved layout found — loading default layout');
}
