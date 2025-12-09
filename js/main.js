/**
 * Main application class for the Custom Classroom Screen.
 * This class initializes the app, manages widgets, and handles user interactions.
 */

function debounce(fn, delay = 250) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

const STATE_MIGRATIONS = [
    {
        from: 0,
        to: 1,
        migrate(state) {
            // Ensure state.layout exists and is well-formed.
            if (!state.layout || typeof state.layout !== 'object' || !Array.isArray(state.layout.widgets)) {
                state.layout = { widgets: [] };
            }
            // Future-proofing: Normalize widget types if they ever change format.
            // For now, this is a placeholder for more complex migrations.

            state.schemaVersion = 1;
            console.log('Migrated state from schema v0 to v1');
            return state;
        }
    }
];
class ClassroomScreenApp {
    constructor() {
        // DOM Elements
        this.appContainer = document.getElementById('app-container');
        this.studentView = document.getElementById('student-main'); // Using the new landmark ID
        this.teacherPanel = document.getElementById('teacher-panel');
        this.widgetsContainer = document.getElementById('widgets-container');
        this.closeTeacherPanelBtn = document.getElementById('close-teacher-panel');
        this.themeSelector = document.getElementById('theme-selector');
        this.backgroundSelector = document.getElementById('background-selector');
        this.presetNameInput = document.getElementById('preset-name');
        this.presetListElement = document.getElementById('preset-list');
        this.helpDialog = document.getElementById('help-dialog');
        this.tourDialog = document.getElementById('tour-dialog');
        this.fab = document.getElementById('fab');
        this.widgetModal = document.getElementById('widget-modal');
        this.widgetSettingsModal = document.getElementById('widget-settings-modal');
        this.navTabs = document.querySelectorAll('.nav-tab');
        this.panelBackdrop = document.querySelector('.panel-backdrop');
        this.widgetSelectorButtons = Array.from(document.querySelectorAll('.widget-selector-btn'));
        this.importDialog = document.getElementById('import-dialog');
        this.importJsonInput = document.getElementById('import-json-input');
        this.importSummary = document.getElementById('import-summary');
        this.confirmImportButton = document.getElementById('confirm-import');
        this.nameEntryDialog = document.getElementById('name-entry-dialog');
        this.presetClassInput = document.getElementById('preset-class-name');
        this.presetPeriodInput = document.getElementById('preset-period');
        this.presetClassFilterInput = document.getElementById('preset-class-filter');
        this.presetPeriodFilterSelect = document.getElementById('preset-period-filter');
        this.layoutPresetSelect = document.getElementById('layout-preset');
        this.applyLayoutPresetButton = document.getElementById('apply-layout-preset');
        this.reduceMotionToggle = document.getElementById('reduce-motion-toggle');

        // App State
        this.widgets = [];
        this.isTeacherPanelOpen = false;
        this.presetsKey = 'classroomLayoutPresets';
        this.presets = [];
        this.hasSavedState = !!localStorage.getItem('classroomScreenState');
        this.lessonPlanEditor = null;
        this.appVersion = '2.3.0'; // Version for state management
        this.schemaVersion = 1; // Numeric schema version for data migrations

        this.projectorChannel = new BroadcastChannel('teacher-screen-sync');

        // Managers
        this.saveState = debounce(this.saveState.bind(this), 300);

        this.layoutManager = new LayoutManager(this.widgetsContainer);
        this.layoutManager.onLayoutChange = () => this.saveState();
        this.backgroundManager = new BackgroundManager(this.studentView);

        this.widgetCategories = [
            { name: 'Time Management', icon: 'timer.svg', widgets: [{ type: 'timer', label: 'Timer' }] },
            { name: 'Engagement', icon: 'engagement.svg', widgets: [{ type: 'noise-meter', label: 'Noise Meter' }, { type: 'name-picker', label: 'Name Picker' }] },
            { name: 'Tools', icon: 'tools.svg', widgets: [{ type: 'qr-code', label: 'QR Code' }, { type: 'drawing-tool', label: 'Drawing Tool' }, { type: 'document-viewer', label: 'Document Viewer' }, { type: 'mask', label: 'Mask' }, { type: 'notes', label: 'Notes' }] }
        ];

        this.themes = [
            { name: 'Memory Cue', id: 'memory-cue-theme', swatch: '#8e82ff' },
            { name: 'Light', id: 'light-theme', swatch: '#3498db' },
            { name: 'Dark', id: 'dark-theme', swatch: '#4dabf7' },
            { name: 'Ocean', id: 'ocean-theme', swatch: '#0077b6' },
            { name: 'Forest', id: 'forest-theme', swatch: '#2d6a4f' },
            { name: 'Sunset', id: 'sunset-theme', swatch: '#d62828' },
            { name: 'Royal', id: 'royal-theme', swatch: '#6a4c93' },
            { name: 'Monochrome', id: 'monochrome-theme', swatch: '#495057' },
            { name: 'High Contrast', id: 'high-contrast-theme', swatch: '#000000' },
            { name: 'Calm Classroom', id: 'calm-theme', swatch: '#4f8fbf' }
        ];

        this.defaultPresets = [
            {
                name: 'Default',
                className: '',
                period: '',
                theme: 'memory-cue-theme',
                background: {
                    type: 'gradient',
                    value: 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)'
                },
                layout: { widgets: [] },
                lessonPlan: null
            },
            {
                name: 'Focus Mode',
                className: 'All Classes',
                period: 'Afternoon',
                theme: 'dark-theme',
                background: {
                    type: 'solid',
                    value: '#1a1a1a'
                },
                layout: { widgets: [{ type: 'TimerWidget', id: 'widget-1', position: { x: 10, y: 10 }, size: { width: 300, height: 200 } }] },
                lessonPlan: null
            }
        ];
    }

    init() {
        this.setupEventListeners();
        this.initLessonPlanner();
        this.loadSavedState();
        this.backgroundManager.init();
        this.layoutManager.init();
        this.setupPresetControls();
        this.renderBackgroundSelector();

        const savedTheme = localStorage.getItem('selectedTheme');
        if (savedTheme) {
            document.body.className = savedTheme;
        }

        this.renderThemeSelector();
        this.renderWidgetModal();

        if (this.widgets.length === 0) {
            this.addWidget('timer');
        }

        this.showWelcomeTourIfNeeded();

        const savedRM = localStorage.getItem('reduceMotion');
        if (savedRM === '1') {
            document.documentElement.style.setProperty('--reduce-motion', 1);
            if (this.reduceMotionToggle) this.reduceMotionToggle.checked = true;
        }
    }

    setupEventListeners() {
        if (this.reduceMotionToggle) {
            this.reduceMotionToggle.addEventListener('change', () => {
                const value = this.reduceMotionToggle.checked ? 1 : 0;
                document.documentElement.style.setProperty('--reduce-motion', value);
                localStorage.setItem('reduceMotion', value);
            });
        }

        // Navigation and Panel
        this.navTabs.forEach(tab => tab.addEventListener('click', () => this.handleNavClick(tab.dataset.tab)));
        this.closeTeacherPanelBtn.addEventListener('click', () => this.toggleTeacherPanel(false));
        this.panelBackdrop.addEventListener('click', () => this.toggleTeacherPanel(false));

        // FAB and Modals
        this.fab.addEventListener('click', () => this.openDialog(this.widgetModal));
        this.widgetModal.querySelector('.modal-close').addEventListener('click', () => this.closeDialog(this.widgetModal));
        this.setupDialogControls();

        this.initializeWidgetSelector();

        // Accordion Cards
        const detailsElements = document.querySelectorAll('.control-card details');
        detailsElements.forEach(details => {
            details.addEventListener('toggle', () => {
                if (details.open) {
                    detailsElements.forEach(otherDetails => {
                        if (otherDetails !== details) {
                            otherDetails.open = false;
                        }
                    });
                }
            });
        });

        // Other controls...
        document.getElementById('start-timer').addEventListener('click', () => this.startTimerFromControls());
        document.getElementById('stop-timer').addEventListener('click', () => this.stopTimerFromControls());

        // Widget Settings Modal Logic
        document.addEventListener('openWidgetSettings', (e) => this.openWidgetSettings(e.detail.widget));

        const settingsModalCloseBtn = this.widgetSettingsModal.querySelector('.modal-close-btn');
        if (settingsModalCloseBtn) {
            settingsModalCloseBtn.addEventListener('click', () => this.closeWidgetSettings());
        }

        this.widgetSettingsModal.addEventListener('click', (e) => {
            if (e.target === this.widgetSettingsModal) {
                this.closeWidgetSettings();
            }
        });

        // New Timer Presets (5, 10, 15 min)
        const preset5 = document.getElementById('timer-preset-5');
        if (preset5) {
            preset5.addEventListener('click', () => {
                document.getElementById('timer-hours').value = 0;
                document.getElementById('timer-minutes').value = 5;
                document.getElementById('timer-seconds').value = 0;
                this.startTimerFromControls();
            });
        }

        const preset10 = document.getElementById('timer-preset-10');
        if (preset10) {
            preset10.addEventListener('click', () => {
                document.getElementById('timer-hours').value = 0;
                document.getElementById('timer-minutes').value = 10;
                document.getElementById('timer-seconds').value = 0;
                this.startTimerFromControls();
            });
        }

        const preset15 = document.getElementById('timer-preset-15');
        if (preset15) {
            preset15.addEventListener('click', () => {
                document.getElementById('timer-hours').value = 0;
                document.getElementById('timer-minutes').value = 15;
                document.getElementById('timer-seconds').value = 0;
                this.startTimerFromControls();
            });
        }

        document.getElementById('reset-layout').addEventListener('click', () => this.resetLayout());
        document.getElementById('save-preset').addEventListener('click', () => this.savePreset());
        document.addEventListener('widgetRemoved', (event) => this.handleWidgetRemoved(event.detail.widget));

        // Export/Import
        document.getElementById('export-layout').addEventListener('click', () => this.handleExportLayout());
        document.getElementById('import-layout').addEventListener('click', () => this.openDialog(this.importDialog));
        this.confirmImportButton.addEventListener('click', () => this.handleConfirmImport());

        // Preset Filters
        this.presetClassFilterInput.addEventListener('input', () => this.renderPresetList());
        this.presetPeriodFilterSelect.addEventListener('change', () => this.renderPresetList());

        if (this.applyLayoutPresetButton) {
            this.applyLayoutPresetButton.addEventListener('click', () => this.applyLayoutPreset());
        }

        // Projector View Button
        const openProjectorBtn = document.getElementById('open-projector-view');
        if (openProjectorBtn) {
            openProjectorBtn.addEventListener('click', () => window.open('projector.html', '_blank'));
        }
    }

    handleNavClick(tab) {
        // Update tab states
        this.navTabs.forEach(t => {
            const isSelected = t.dataset.tab === tab;
            t.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            if (isSelected) t.classList.add('active');
            else t.classList.remove('active');
        });

        // Show corresponding panel, hide others
        // We use the ID convention: {tab}-view
        const viewId = `${tab}-view`;
        document.querySelectorAll('.view').forEach(view => {
            if (view.id === viewId) {
                view.hidden = false;
            } else {
                view.hidden = true;
            }
        });

        // Teacher Panel Logic
        if (tab === 'classroom') {
            // Ensure student view is ready
            this.toggleTeacherPanel(true);
        } else {
            // For other views, close the teacher panel or keep it?
            // Usually dashboard etc might not need the floating teacher panel.
            // But let's close it to focus on the content, unless designed otherwise.
            this.toggleTeacherPanel(false);

            // If it's a placeholder view, we might still show the notification
            // but now we have actual DOM elements showing "Coming soon".
            // So the notification is optional or redundant.
            // I'll keep the notification for feedback if it's empty.
            if (tab !== 'classroom') {
                 // this.showNotification(`${tab.charAt(0).toUpperCase() + tab.slice(1)} view active`);
            }
        }
    }

    toggleTeacherPanel(forceState = null) {
        this.isTeacherPanelOpen = forceState !== null ? forceState : !this.isTeacherPanelOpen;
        this.teacherPanel.classList.toggle('open', this.isTeacherPanelOpen);
        this.panelBackdrop.classList.toggle('visible', this.isTeacherPanelOpen);
        this.studentView.classList.toggle('panel-open', this.isTeacherPanelOpen);
    }

    initializeWidgetSelector() {
        if (!this.widgetSelectorButtons || !this.widgetSelectorButtons.length) return;

        this.widgetSelectorButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const widgetType = button.dataset.widget;
                if (!widgetType) return;
                this.setActiveWidgetButton(widgetType);
                this.addWidget(widgetType);
            });
        });
    }

    setActiveWidgetButton(type) {
        if (!this.widgetSelectorButtons || !this.widgetSelectorButtons.length) return;
        const targetButton = this.widgetSelectorButtons.find((btn) => btn.dataset.widget === type);
        this.widgetSelectorButtons.forEach((btn) => {
            btn.classList.toggle('active', btn === targetButton);
        });
    }

    addWidget(type) {
        let widget;
        try {
            switch (type) {
                case 'timer': widget = new TimerWidget(); break;
                case 'noise-meter': widget = new NoiseMeterWidget(); break;
                case 'name-picker': widget = new NamePickerWidget(); break;
                case 'qr-code': widget = new QRCodeWidget(); break;
                case 'drawing-tool': widget = new DrawingToolWidget(); break;
                case 'document-viewer': widget = new DocumentViewerWidget(); break;
                case 'mask': widget = new MaskWidget(); break;
                case 'notes': widget = new NotesWidget(); break;
                default: throw new Error(`Unknown widget type: ${type}`);
            }

            const widgetElement = this.layoutManager.addWidget(widget);
            this.widgets.push(widget);
            this.setActiveWidgetButton(type);
            
            const placeholder = this.widgetsContainer.querySelector('.widget-placeholder');
            if (placeholder) placeholder.remove();
            
            this.saveState();
            this.showNotification(`${this.getFriendlyWidgetName(type)} Added!`);
            this.closeDialog(this.widgetModal);
        } catch (error) {
            console.error('Failed to add widget:', error);
            this.showNotification('Failed to add widget.', 'error');
        }
    }

    getFriendlyWidgetName(type) {
        const names = {
            'timer': 'Timer',
            'noise-meter': 'Noise Meter',
            'name-picker': 'Name Picker',
            'qr-code': 'QR Code',
            'drawing-tool': 'Drawing Tool',
            'document-viewer': 'Document Viewer',
            'mask': 'Mask',
            'notes': 'Notes'
        };
        return names[type] || 'Widget';
    }

    renderWidgetModal() {
        const container = this.widgetModal.querySelector('.widget-categories');
        container.innerHTML = '';
        this.widgetCategories.forEach(category => {
            category.widgets.forEach(widget => {
                const button = document.createElement('button');
                button.className = 'widget-category-btn';
                button.innerHTML = `
                    <img src="assets/icons/${widget.type}.svg" alt="" class="category-icon">
                    <span>${widget.label}</span>
                `;
                button.addEventListener('click', () => this.addWidget(widget.type));
                container.appendChild(button);
            });
        });
    }

    renderThemeSelector() {
        this.themeSelector.innerHTML = '';
        this.themes.forEach(theme => {
            const label = document.createElement('label');
            label.className = 'theme-option';
            label.innerHTML = `
                <input type="radio" name="theme" value="${theme.id}">
                <span class="theme-swatch" style="background-color: ${theme.swatch};"></span>
                <span>${theme.name}</span>
            `;
            const input = label.querySelector('input');
            input.checked = (document.body.className === theme.id);
            input.addEventListener('change', () => {
                this.switchTheme(theme.id);
                this.saveState();
            });
            this.themeSelector.appendChild(label);
        });
    }

    switchTheme(themeName) {
        document.body.className = themeName;
        localStorage.setItem('selectedTheme', themeName);
    }

    saveState() {
        const state = {
            version: this.appVersion,
            schemaVersion: this.schemaVersion,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
        const stateJSON = JSON.stringify(state);
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

        this.projectorChannel.postMessage({
            type: 'layout-update',
            state: state
        });
    }

    setupPresetControls() {
        const storedPresets = localStorage.getItem(this.presetsKey);
        try {
            this.presets = storedPresets ? JSON.parse(storedPresets) : [];
        } catch (e) {
            console.error('Failed to parse presets:', e);
            this.presets = [];
        }

        if (!Array.isArray(this.presets) || this.presets.length === 0) {
            this.presets = [...this.defaultPresets];
        }

        // Ensure old presets have new fields
        this.presets.forEach(p => {
            p.className = p.className || '';
            p.period = p.period || '';
        });

        this.savePresets();
        this.renderPresetList();
    }

    savePresets() {
        localStorage.setItem(this.presetsKey, JSON.stringify(this.presets));
    }

    applyLayoutPreset() {
        const preset = this.layoutPresetSelect ? this.layoutPresetSelect.value : '';
        if (!preset) return;
        if (!this.layoutManager || !Array.isArray(this.layoutManager.widgets)) return;

        switch (preset) {
            case '2x2':
                this.apply2x2Preset();
                break;
            case 'full-timer':
                this.applyFullTimerPreset();
                break;
        }

        this.layoutManager.saveLayout();
        this.saveState();
        this.showNotification('Layout preset applied.');
    }

    apply2x2Preset() {
        const cols = this.layoutManager.gridColumns; // 12
        const rows = this.layoutManager.gridRows;    // 8
        const slots = [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 0, y: 4 },
            { x: 6, y: 4 }
        ];
        const width = 6;
        const height = 4;
        this.layoutManager.widgets.forEach((info, index) => {
            const slot = slots[index % slots.length];
            info.x = slot.x;
            info.y = slot.y;
            info.width = width;
            info.height = height;
            info.element.style.gridColumn = `${slot.x + 1} / span ${width}`;
            info.element.style.gridRow = `${slot.y + 1} / span ${height}`;
        });
    }

    applyFullTimerPreset() {
        if (!this.layoutManager.widgets.length) return;
        const timerInfo = this.layoutManager.widgets.find(info => info.widget instanceof TimerWidget) || this.layoutManager.widgets[0];
        const cols = this.layoutManager.gridColumns; // 12
        timerInfo.x = 0;
        timerInfo.y = 0;
        timerInfo.width = cols;
        timerInfo.height = 2;
        timerInfo.element.style.gridColumn = `1 / span ${cols}`;
        timerInfo.element.style.gridRow = `1 / span 2`;
    }

    savePreset() {
        const presetName = this.presetNameInput ? this.presetNameInput.value.trim() : '';
        if (!presetName) {
            this.showNotification('Please enter a preset name.', 'warning');
            return;
        }

        const className = this.presetClassInput ? this.presetClassInput.value.trim() : '';
        const period = this.presetPeriodInput ? this.presetPeriodInput.value.trim() : '';

        const newPreset = {
            name: presetName,
            className,
            period,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };

        const existingIndex = this.presets.findIndex(preset => preset.name.toLowerCase() === presetName.toLowerCase());
        if (existingIndex !== -1) {
            if (!confirm(`Preset "${presetName}" exists. Overwrite it?`)) {
                return;
            }
            this.presets[existingIndex] = newPreset;
            this.showNotification(`Preset "${presetName}" updated.`);
        } else {
            this.presets.push(newPreset);
            this.showNotification(`Preset "${presetName}" saved.`);
        }

        this.savePresets();
        this.renderPresetList();
    }

    loadPreset(name) {
        const preset = this.presets.find(item => item.name === name);
        if (!preset) {
            this.showNotification('Preset not found.', 'error');
            return;
        }

        if (this.presetNameInput) this.presetNameInput.value = preset.name;
        if (this.presetClassInput) this.presetClassInput.value = preset.className || '';
        if (this.presetPeriodInput) this.presetPeriodInput.value = preset.period || '';

        if (preset.theme) this.switchTheme(preset.theme);
        if (preset.background) this.backgroundManager.deserialize(preset.background);
        if (preset.lessonPlan && this.lessonPlanEditor) this.lessonPlanEditor.setContents(preset.lessonPlan);

        this.widgets = [];
        this.layoutManager.deserialize(preset.layout, (widgetData) => {
            let widget;
            switch (widgetData.type) {
                case 'TimerWidget': widget = new TimerWidget(); break;
                case 'NoiseMeterWidget': widget = new NoiseMeterWidget(); break;
                case 'NamePickerWidget': widget = new NamePickerWidget(); break;
                case 'QRCodeWidget': widget = new QRCodeWidget(); break;
                case 'DrawingToolWidget': widget = new DrawingToolWidget(); break;
                case 'DocumentViewerWidget': widget = new DocumentViewerWidget(); break;
                case 'MaskWidget': widget = new MaskWidget(); break;
                case 'NotesWidget': widget = new NotesWidget(); break;
            }
            if (widget) {
                this.widgets.push(widget);
            }
            return widget;
        });

        this.saveState();
        this.showNotification(`Preset "${preset.name}" loaded.`);
    }

    overwritePreset(name) {
        if (this.presetNameInput) this.presetNameInput.value = name;

        const className = this.presetClassInput ? this.presetClassInput.value.trim() : '';
        const period = this.presetPeriodInput ? this.presetPeriodInput.value.trim() : '';

        const presetIndex = this.presets.findIndex(preset => preset.name === name);
        if (presetIndex === -1) {
            this.showNotification('Preset not found.', 'error');
            return;
        }
        this.presets[presetIndex] = {
            name,
            className,
            period,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Preset "${name}" overwritten.`);
    }

    deletePreset(name) {
        const presetIndex = this.presets.findIndex(preset => preset.name === name);
        if (presetIndex === -1) {
            this.showNotification('Preset not found.', 'error');
            return;
        }
        if (!confirm(`Delete preset "${name}"?`)) {
            return;
        }
        this.presets.splice(presetIndex, 1);
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Preset "${name}" deleted.`);
    }

    getSerializableState() {
        return {
            version: this.appVersion,
            schemaVersion: this.schemaVersion,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
    }

    handleExportLayout() {
        const exportPayload = {
            schemaVersion: this.schemaVersion,
            appVersion: this.appVersion,
            state: this.getSerializableState(),
            presets: this.presets || []
        };

        const jsonString = JSON.stringify(exportPayload, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'classroom-layout-presets.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('Layout and presets exported.');
    }

    handleConfirmImport() {
        const jsonString = this.importJsonInput.value;
        if (!jsonString) {
            this.importSummary.textContent = 'Error: Input is empty.';
            this.importSummary.style.color = 'red';
            return;
        }

        try {
            const parsed = JSON.parse(jsonString);

            if (typeof parsed.schemaVersion !== 'number' || !parsed.state || !Array.isArray(parsed.presets)) {
                throw new Error('Invalid JSON structure.');
            }

            let state = this.runMigrations(parsed.state);

            const summary = `
                Ready to import:
                - ${parsed.presets.length} presets
                - ${state.layout?.widgets?.length || 0} widgets
                - Theme: ${state.theme || 'default'}
            `;
            this.importSummary.textContent = summary;
            this.importSummary.style.color = 'green';

            // Normalize imported presets
            parsed.presets.forEach(p => {
                p.className = p.className || '';
                p.period = p.period || '';
            });

            this.presets = parsed.presets;
            this.savePresets();
            this.renderPresetList();

            if (state.theme) this.switchTheme(state.theme);
            if (state.background) this.backgroundManager.deserialize(state.background);
            if (state.lessonPlan && this.lessonPlanEditor) this.lessonPlanEditor.setContents(state.lessonPlan);

            this.widgets = [];
            this.layoutManager.deserialize(state.layout, (widgetData) => {
                let widget;
                switch (widgetData.type) {
                    case 'TimerWidget': widget = new TimerWidget(); break;
                    case 'NoiseMeterWidget': widget = new NoiseMeterWidget(); break;
                    case 'NamePickerWidget': widget = new NamePickerWidget(); break;
                    case 'QRCodeWidget': widget = new QRCodeWidget(); break;
                    case 'DrawingToolWidget': widget = new DrawingToolWidget(); break;
                    case 'DocumentViewerWidget': widget = new DocumentViewerWidget(); break;
                    case 'MaskWidget': widget = new MaskWidget(); break;
                    case 'NotesWidget': widget = new NotesWidget(); break;
                }
                if (widget) {
                    this.widgets.push(widget);
                }
                return widget;
            });

            this.saveState();
            this.closeDialog(this.importDialog);
            this.showNotification('Layout and presets imported successfully.');

        } catch (error) {
            this.importSummary.textContent = `Error: ${error.message}`;
            this.importSummary.style.color = 'red';
            console.error('Import failed:', error);
        }
    }

    renderPresetList() {
        if (!this.presetListElement) return;

        const classFilter = this.presetClassFilterInput.value.toLowerCase();
        const periodFilter = this.presetPeriodFilterSelect.value.toLowerCase();

        const filteredPresets = this.presets.filter(preset => {
            const classNameMatch = !classFilter || (preset.className && preset.className.toLowerCase().includes(classFilter));
            const periodMatch = !periodFilter || (preset.period && preset.period.toLowerCase() === periodFilter);
            return classNameMatch && periodMatch;
        });

        this.presetListElement.innerHTML = '';
        if (filteredPresets.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.textContent = 'No presets match your filters.';
            this.presetListElement.appendChild(emptyState);
            return;
        }

        filteredPresets.forEach(preset => {
            const item = document.createElement('div');
            item.className = 'preset-item';

            const name = document.createElement('span');
            name.className = 'preset-name';
            name.textContent = preset.name;

            const subtext = document.createElement('span');
            subtext.className = 'preset-subtext';
            const classInfo = preset.className || 'No Class';
            const periodInfo = preset.period || 'Any Period';
            subtext.textContent = `${classInfo} — ${periodInfo}`;

            const mainInfo = document.createElement('div');
            mainInfo.className = 'preset-main-info';
            mainInfo.appendChild(name);
            mainInfo.appendChild(subtext);

            const actions = document.createElement('div');
            actions.className = 'preset-actions';

            const loadButton = document.createElement('button');
            loadButton.type = 'button';
            loadButton.className = 'control-button';
            loadButton.textContent = 'Load';
            loadButton.dataset.action = 'load';
            loadButton.dataset.name = preset.name;

            const overwriteButton = document.createElement('button');
            overwriteButton.type = 'button';
            overwriteButton.className = 'control-button';
            overwriteButton.textContent = 'Overwrite';
            overwriteButton.dataset.action = 'overwrite';
            overwriteButton.dataset.name = preset.name;

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'control-button';
            deleteButton.textContent = 'Delete';
            deleteButton.dataset.action = 'delete';
            deleteButton.dataset.name = preset.name;

            // Event delegation for preset actions
            item.addEventListener('click', (e) => {
                const button = e.target.closest('button');
                if (!button) return;

                const action = button.dataset.action;
                const presetName = button.dataset.name;

                if (action === 'load') this.loadPreset(presetName);
                if (action === 'overwrite') this.overwritePreset(presetName);
                if (action === 'delete') this.deletePreset(presetName);
            });

            actions.appendChild(loadButton);
            actions.appendChild(overwriteButton);
            actions.appendChild(deleteButton);

            item.appendChild(mainInfo);
            item.appendChild(actions);

            this.presetListElement.appendChild(item);
        });
    }

    loadSavedState() {
        const attemptLoad = (key) => {
            const savedString = localStorage.getItem(key);
            if (!savedString) return null;
            try {
                const parsed = JSON.parse(savedString);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (e) {
                console.warn(`Failed to parse state from ${key}`, e);
            }
            return null;
        };

        // Try loading primary state
        let state = attemptLoad('classroomScreenState');
        if (state) {
            this.applyState(state);
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
                this.applyState(state);
                this.showNotification('Your layout was restored from a backup.');
                return;
            }
        }

        // If all fail, ensure corrupt state is cleared so defaults can load
        if (localStorage.getItem('classroomScreenState')) {
            console.warn('Corrupt state detected and no backups available; clearing.');
            localStorage.removeItem('classroomScreenState');
        }
    }

    applyState(state) {
        try {
            // Run migration pipeline
            state = this.runMigrations(state);

            // Restore theme
            if (state.theme) {
                this.switchTheme(state.theme);
            }

            // Restore background
            if (state.background) {
                this.backgroundManager.deserialize(state.background);
            }

            // Restore layout and widgets
            if (state.layout && state.layout.widgets) {
                this.layoutManager.deserialize(state.layout, (widgetData) => {
                    // This factory function recreates widgets from saved data
                    let widget;
                    switch (widgetData.type) {
                        case 'TimerWidget': widget = new TimerWidget(); break;
                        case 'NoiseMeterWidget': widget = new NoiseMeterWidget(); break;
                        case 'NamePickerWidget': widget = new NamePickerWidget(); break;
                        case 'QRCodeWidget': widget = new QRCodeWidget(); break;
                        case 'DrawingToolWidget': widget = new DrawingToolWidget(); break;
                        case 'DocumentViewerWidget': widget = new DocumentViewerWidget(); break;
                        case 'MaskWidget': widget = new MaskWidget(); break;
                    case 'NotesWidget': widget = new NotesWidget(); break;
                    }
                    if (widget) {
                        this.widgets.push(widget);
                    }
                    return widget;
                });
            }

            // Restore lesson plan
            if (state.lessonPlan && this.lessonPlanEditor) {
                this.lessonPlanEditor.setContents(state.lessonPlan);
            }
        } catch (err) {
            console.error('State load failed; resetting.', err);
            localStorage.removeItem('classroomScreenState');
            this.showNotification("Your previous layout was corrupted; reset to defaults.", "warning");
        }
    }

    runMigrations(state) {
        // Default to schema 0 if it's a legacy state object.
        state.schemaVersion = state.schemaVersion || 0;

        while (state.schemaVersion < this.schemaVersion) {
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

    resetLayout() {
        if (confirm('Are you sure you want to reset the layout? This will remove all widgets.')) {
            this.widgets = [];
            this.widgetsContainer.innerHTML = '<div class="widget-placeholder"><p>Add your first widget from the Teacher Controls!</p></div>';
            if (this.layoutManager) {
                this.layoutManager.widgets = [];
            }
            this.backgroundManager.reset();
            if (this.lessonPlanEditor) {
                this.lessonPlanEditor.setContents([]);
            }
            this.saveState();
            this.showNotification('Layout has been reset.');
        }
    }

    handleWidgetRemoved(widget) {
        this.widgets = this.widgets.filter(existing => existing !== widget);
        if (this.layoutManager && Array.isArray(this.layoutManager.widgets)) {
            this.layoutManager.widgets = this.layoutManager.widgets.filter(info => info.widget !== widget);
        }
        if (this.widgets.length === 0 && !this.widgetsContainer.querySelector('.widget-placeholder')) {
            this.widgetsContainer.innerHTML = '<div class="widget-placeholder"><p>Add your first widget from the Teacher Controls!</p></div>';
        }
        this.saveState();
    }

    startTimerFromControls() {
        const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (timerWidget) {
            const hours = parseInt(document.getElementById('timer-hours').value, 10) || 0;
            const minutes = parseInt(document.getElementById('timer-minutes').value, 10) || 0;
            const seconds = parseInt(document.getElementById('timer-seconds').value, 10) || 0;
            // The existing TimerWidget.start() takes minutes, or we need to update it to take arbitrary time?
            // The existing startTimerFromControls uses timerWidget.set(totalSeconds) which doesn't seem to exist in the TimerWidget code I read.
            // Let's re-read TimerWidget carefully. It has start(minutes). It has this.time = chosenMinutes * 60.
            // It does NOT have a set(seconds) method. The current implementation in main.js seems to be broken or relying on a different version?
            // "timerWidget.set(totalSeconds)" -> checking TimerWidget source again.
            // TimerWidget has start(minutes), tick(), stop(), notifyComplete(), etc. No set().
            // So I should fix this method as well while I am here, or at least implement the new one correctly.

            // Wait, looking at TimerWidget.start(minutes):
            // const customMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
            // ... this.time = chosenMinutes * 60;

            // The user input in teacher panel has HH:MM:SS.
            // If I want to support seconds, I might need to update TimerWidget to support starting with seconds or modify how I call it.
            // But my task is "Timer quick-preset buttons".

            // Let's implement startTimerPresetFromControls first.

            const totalMinutes = (hours * 60) + minutes + (seconds / 60);
            if (totalMinutes > 0) {
                timerWidget.start(totalMinutes);
                this.showNotification('Timer started!');
            } else {
                this.showNotification('Please set a timer duration.', 'warning');
            }
        } else {
            this.showNotification('No timer widget found. Add one first!', 'error');
        }
    }

    startTimerPresetFromControls(minutes) {
        let timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (!timerWidget) {
            // "Finds first TimerWidget and calls widget.start(minutes)"
            // If none exists, maybe I should create one? The instructions say "Finds first TimerWidget".
            // I'll stick to finding. If not found, I'll notify.
            this.showNotification('No timer widget found. Add one first!', 'error');
            return;
        }

        timerWidget.start(minutes);
        this.showNotification(`Timer started for ${minutes} minutes.`);
    }

    stopTimerFromControls() {
        const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (timerWidget) {
            timerWidget.stop();
            this.showNotification('Timer stopped.');
        } else {
            this.showNotification('No timer widget found.', 'error');
        }
    }

    renderBackgroundSelector() {
        if (!this.backgroundSelector) return;
        this.backgroundSelector.innerHTML = '';
        const backgrounds = this.backgroundManager.getAvailableBackgrounds();

        for (const type in backgrounds) {
            backgrounds[type].forEach((value, index) => {
                const swatch = document.createElement('div');
                swatch.className = 'background-swatch';
                swatch.tabIndex = 0;
                swatch.setAttribute('role', 'button');
                swatch.setAttribute(
                    'aria-label',
                    type === 'solid'
                        ? `Solid background ${value}`
                        : type === 'gradient'
                            ? `Gradient background ${index + 1}`
                            : `Image background ${index + 1}`
                );

                if (type === 'solid') {
                    swatch.style.backgroundColor = value;
                } else if (type === 'gradient') {
                    swatch.style.backgroundImage = value;
                } else if (type === 'image') {
                    swatch.style.backgroundImage = `url(${value})`;
                    swatch.style.backgroundSize = 'cover';
                    swatch.style.backgroundPosition = 'center';
                }

                const applyBackground = () => {
                    this.backgroundManager.setBackground(type, value);
                    this.saveState();
                };

                swatch.addEventListener('click', applyBackground);
                swatch.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        applyBackground();
                    }
                });

                this.backgroundSelector.appendChild(swatch);
            });
        }
    }

    showNotification(message, type = 'success') {
        const existingNotification = document.querySelector('.notification-toast');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification-toast ${type}`;
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        notification.textContent = message;
        this.appContainer.appendChild(notification);

        // Announce to screen reader via live region
        const liveRegion = document.getElementById('live-region');
        if (liveRegion) {
            liveRegion.textContent = '';
            window.requestAnimationFrame(() => {
                liveRegion.textContent = message;
            });
        }

        void notification.offsetWidth;

        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    setupDialogControls() {
        const dialogs = [
            this.helpDialog,
            this.tourDialog,
            this.widgetModal,
            this.importDialog,
            this.nameEntryDialog
        ].filter(Boolean);
        dialogs.forEach((dialog) => {
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) {
                    this.closeDialog(dialog);
                }
            });

            dialog.querySelectorAll('[data-close], .modal-close').forEach((btn) => {
                btn.addEventListener('click', () => this.closeDialog(dialog));
            });
        });
    }

    openDialog(dialog) {
        if (!dialog) return;
        if (!dialog.open) {
            dialog.showModal();
        }
    }

    closeDialog(dialog) {
        if (dialog && dialog.open) {
            dialog.close();
        }
    }

    closeAllDialogs() {
        [this.helpDialog, this.tourDialog, this.widgetModal].forEach((dialog) => {
            if (dialog && dialog.open) {
                dialog.close();
            }
        });
    }

    showWelcomeTourIfNeeded() {
        const tourSeen = localStorage.getItem('welcomeTourSeen');
        if (this.hasSavedState || tourSeen) {
            return;
        }
        this.openDialog(this.tourDialog);
        localStorage.setItem('welcomeTourSeen', 'true');
    }

    initLessonPlanner() {
        if (document.getElementById('lesson-plan-editor')) {
            this.lessonPlanEditor = new Quill('#lesson-plan-editor', {
                theme: 'snow',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['link', 'image']
                    ]
                }
            });

            this.lessonPlanEditor.on('text-change', () => {
                this.saveState();
            });
        }
    }

    openWidgetSettings(widget) {
        if (!this.widgetSettingsModal) return;

        const modalBody = this.widgetSettingsModal.querySelector('.modal-body');
        const modalTitle = this.widgetSettingsModal.querySelector('.modal-title');

        if (!modalBody || !modalTitle) return;

        // Clear previous content
        modalBody.innerHTML = '';

        // Set Title
        modalTitle.textContent = `${widget.constructor.name.replace('Widget', '')} Settings`;

        // Get controls from the widget
        // We assume widgets have a 'controlsOverlay' property or a 'getControls' method
        // Based on TimerWidget analysis, it has 'controlsOverlay'.

        let controlsNode = null;
        if (typeof widget.getControls === 'function') {
            controlsNode = widget.getControls();
        } else if (widget.controlsOverlay) {
            controlsNode = widget.controlsOverlay;
        } else {
            // Fallback for widgets that haven't been refactored yet
            const p = document.createElement('p');
            p.textContent = 'Settings not available for this widget yet.';
            controlsNode = p;
        }

        // If controls are detached from widget, append them.
        // NOTE: Appending moves the node from its current location (if any) to the modal.
        // This is exactly what we want if it was hidden in the widget.
        if (controlsNode) {
            modalBody.appendChild(controlsNode);
            // Ensure it's visible (TimerWidget hides it by default?)
            // TimerWidget controlsOverlay has .widget-content-controls class.
            // We removed opacity: 0 from css, so it should be visible.
            // However, TimerWidget might have internal logic relying on display: none?
            // Checked TimerWidget code: it doesn't seem to toggle display of controlsOverlay, just appends it.
            // But let's make sure.
        }

        this.activeSettingsWidget = widget;
        this.widgetSettingsModal.classList.add('visible');
    }

    closeWidgetSettings() {
        if (!this.widgetSettingsModal) return;
        this.widgetSettingsModal.classList.remove('visible');

        // Optional: Move controls back to the widget?
        // Or just leave them detached until next open?
        // If we leave them detached, the widget instance still holds the reference 'controlsOverlay',
        // so it's fine. It just won't be in the DOM.

        // If the widget has a specific method to handle closing settings (e.g., to pause previews), call it.
        if (this.activeSettingsWidget && typeof this.activeSettingsWidget.onSettingsClose === 'function') {
            this.activeSettingsWidget.onSettingsClose();
        }

        this.saveState();
        this.activeSettingsWidget = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new ClassroomScreenApp();
    app.init();

    const toolbarToggleBtn = document.getElementById('toolbar-toggle-btn');
    const toolbarWrapper = document.getElementById('widget-toolbar-wrapper');

    if (toolbarToggleBtn && toolbarWrapper) {
        toolbarToggleBtn.addEventListener('click', () => {
            toolbarWrapper.classList.toggle('toolbar-open');
        });
    }
});
