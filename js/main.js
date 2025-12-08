/**
 * Main application class for the Custom Classroom Screen.
 * This class initializes the app, manages widgets, and handles user interactions.
 */

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
        this.studentView = document.getElementById('student-view');
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
        this.navTabs = document.querySelectorAll('.nav-tab');
        this.panelBackdrop = document.querySelector('.panel-backdrop');
        this.importDialog = document.getElementById('import-dialog');
        this.importJsonInput = document.getElementById('import-json-input');
        this.importSummary = document.getElementById('import-summary');
        this.confirmImportButton = document.getElementById('confirm-import');
        this.presetClassInput = document.getElementById('preset-class-name');
        this.presetPeriodInput = document.getElementById('preset-period');
        this.presetClassFilterInput = document.getElementById('preset-class-filter');
        this.presetPeriodFilterSelect = document.getElementById('preset-period-filter');

        // App State
        this.widgets = [];
        this.isTeacherPanelOpen = false;
        this.presetsKey = 'classroomLayoutPresets';
        this.presets = [];
        this.hasSavedState = !!localStorage.getItem('classroomScreenState');
        this.lessonPlanEditor = null;
        this.appVersion = '2.3.0'; // Version for state management
        this.schemaVersion = 1; // Numeric schema version for data migrations

        // Managers
        this.layoutManager = new LayoutManager(this.widgetsContainer);
        this.layoutManager.onLayoutChange = () => this.saveState();
        this.backgroundManager = new BackgroundManager(this.studentView);

        this.widgetCategories = [
            { name: 'Time Management', icon: 'timer.svg', widgets: [{ type: 'timer', label: 'Timer' }] },
            { name: 'Engagement', icon: 'engagement.svg', widgets: [{ type: 'noise-meter', label: 'Noise Meter' }, { type: 'name-picker', label: 'Name Picker' }] },
            { name: 'Tools', icon: 'tools.svg', widgets: [{ type: 'qr-code', label: 'QR Code' }, { type: 'drawing-tool', label: 'Drawing Tool' }, { type: 'document-viewer', label: 'Document Viewer' }, { type: 'mask', label: 'Mask' }] }
        ];

        this.themes = [
            { name: 'Memory Cue', id: 'memory-cue-theme' },
            { name: 'Light', id: 'light-theme' },
            { name: 'Dark', id: 'dark-theme' },
            { name: 'Ocean', id: 'ocean-theme' },
            { name: 'Forest', id: 'forest-theme' },
        ];

        this.defaultPresets = [
            { name: 'Default', className: '', period: '', theme: 'memory-cue-theme', background: { type: 'gradient', settings: { start: '#a1c4fd', end: '#c2e9fb' } }, layout: { widgets: [] }, lessonPlan: null },
            { name: 'Focus Mode', className: 'All Classes', period: 'Afternoon', theme: 'dark-theme', background: { type: 'solid', settings: { color: '#1a1a1a' } }, layout: { widgets: [{ type: 'TimerWidget', id: 'widget-1', position: { x: 10, y: 10 }, size: { width: 300, height: 200 } }] }, lessonPlan: null }
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
        this.renderThemeSelector();
        this.renderWidgetModal();

        if (this.widgets.length === 0) {
            this.addWidget('timer');
        }

        this.showWelcomeTourIfNeeded();
    }

    setupEventListeners() {
        // Navigation and Panel
        this.navTabs.forEach(tab => tab.addEventListener('click', () => this.handleNavClick(tab.dataset.tab)));
        this.closeTeacherPanelBtn.addEventListener('click', () => this.toggleTeacherPanel(false));
        this.panelBackdrop.addEventListener('click', () => this.toggleTeacherPanel(false));

        // FAB and Modals
        this.fab.addEventListener('click', () => this.openDialog(this.widgetModal));
        this.widgetModal.querySelector('.modal-close').addEventListener('click', () => this.closeDialog(this.widgetModal));
        this.setupDialogControls();

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

        document.querySelectorAll('.timer-quick-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const minutes = parseInt(btn.dataset.minutes, 10);
                this.startTimerPresetFromControls(minutes);
            });
        });

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

        // Projector View Button
        const openProjectorBtn = document.getElementById('open-projector-view');
        if (openProjectorBtn) {
            openProjectorBtn.addEventListener('click', () => window.open('projector.html', '_blank'));
        }
    }

    handleNavClick(tab) {
        if (tab === 'classroom') {
            this.toggleTeacherPanel(true);
        } else {
            this.showNotification(`${tab.charAt(0).toUpperCase() + tab.slice(1)} is coming soon!`);
        }
    }

    toggleTeacherPanel(forceState = null) {
        this.isTeacherPanelOpen = forceState !== null ? forceState : !this.isTeacherPanelOpen;
        this.teacherPanel.classList.toggle('open', this.isTeacherPanelOpen);
        this.panelBackdrop.classList.toggle('visible', this.isTeacherPanelOpen);
        this.studentView.classList.toggle('panel-open', this.isTeacherPanelOpen);
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
                default: throw new Error(`Unknown widget type: ${type}`);
            }

            const widgetElement = this.layoutManager.addWidget(widget);
            this.widgets.push(widget);
            
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
            'mask': 'Mask'
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
                <span class="theme-swatch" style="background-color: var(--primary-color)"></span>
                <span>${theme.name}</span>
            `;
            const input = label.querySelector('input');
            input.addEventListener('change', () => this.switchTheme(theme.id));
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
        localStorage.setItem('classroomScreenState', JSON.stringify(state));
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
        const savedState = localStorage.getItem('classroomScreenState');
        if (savedState) {
            try {
                let state = JSON.parse(savedState);

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
            } catch (e) {
                console.error('Failed to load saved state:', e);
                // If parsing fails, it's likely corrupt. Clear it.
                localStorage.removeItem('classroomScreenState');
            }
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
            backgrounds[type].forEach(value => {
                const swatch = document.createElement('div');
                swatch.className = 'background-swatch';
                if (type === 'solid') {
                    swatch.style.backgroundColor = value;
                } else {
                    swatch.style.backgroundImage = value;
                }

                swatch.addEventListener('click', () => {
                    this.backgroundManager.setBackground(type, value);
                    this.saveState();
                });
                this.backgroundSelector.appendChild(swatch);
            });
        }
    }

    showNotification(message, type = 'success') {
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        this.appContainer.appendChild(notification);

        void notification.offsetWidth;

        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    setupDialogControls() {
        const dialogs = [this.helpDialog, this.tourDialog, this.widgetModal, this.importDialog].filter(Boolean);
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
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new ClassroomScreenApp();
    app.init();
});
