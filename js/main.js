/**
 * Main application class for the Custom Classroom Screen.
 * This class initializes the app, manages widgets, and handles user interactions.
 */
class ClassroomScreenApp {
    constructor() {
        // DOM Elements
        this.appContainer = document.getElementById('app-container');
        this.studentView = document.getElementById('student-view');
        this.teacherView = document.getElementById('teacher-view');
        this.widgetsContainer = document.getElementById('widgets-container');
        this.toggleViewBtn = document.getElementById('toggle-view');
        this.closeTeacherViewBtn = document.getElementById('close-teacher-view');
        this.themeSelector = document.getElementById('theme-selector');
        this.backgroundTypeSelect = document.getElementById('background-type');
        this.backgroundOptionsContainer = document.getElementById('background-options');
        this.widgetAccordion = document.getElementById('widget-accordion');
        this.widgetSearchInput = document.getElementById('widget-search');
        this.presetNameInput = document.getElementById('preset-name');
        this.presetListElement = document.getElementById('preset-list');
        this.teacherHelpButton = document.getElementById('teacher-help');
        this.helpDialog = document.getElementById('help-dialog');
        this.tourDialog = document.getElementById('tour-dialog');

        // App State
        this.widgets = [];
        this.isTeacherViewOpen = false;
        this.presetsKey = 'classroomLayoutPresets';
        this.presets = [];
        this.hasSavedState = !!localStorage.getItem('classroomScreenState');
        this.lessonPlanEditor = null;

        // Managers
        this.layoutManager = new LayoutManager(this.widgetsContainer);
        this.layoutManager.onLayoutChange = () => this.saveState();
        this.backgroundManager = new BackgroundManager(this.studentView);

        this.widgetSearchKey = 'widgetSearchQuery';
        this.widgetCategories = [
            {
                name: 'Time Management',
                widgets: [
                    { type: 'timer', label: 'Add Timer' }
                ]
            },
            {
                name: 'Engagement',
                widgets: [
                    { type: 'noise-meter', label: 'Add Noise Meter' },
                    { type: 'name-picker', label: 'Add Name Picker' }
                ]
            },
            {
                name: 'Tools',
                widgets: [
                    { type: 'qr-code', label: 'Add QR Code' },
                    { type: 'drawing-tool', label: 'Add Drawing Tool' },
                    { type: 'document-viewer', label: 'Add Document Viewer' },
                    { type: 'mask', label: 'Add Mask' }
                ]
            }
        ];

        // Default presets
        this.defaultPresets = [
            {
                name: 'Simple Timer',
                theme: 'light-theme',
                background: { type: 'solid', value: '#f0f0f0' },
                layout: {
                    widgets: [
                        { type: 'TimerWidget', gridColumn: '1 / span 4', gridRow: '1 / span 2', data: { time: 300, running: false } }
                    ]
                }
            },
            {
                name: 'Full Dashboard',
                theme: 'light-theme',
                background: { type: 'gradient', value: 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)' },
                layout: {
                    widgets: [
                        { type: 'TimerWidget', gridColumn: '1 / span 4', gridRow: '1 / span 2', data: { time: 0, running: false } },
                        { type: 'NoiseMeterWidget', gridColumn: '5 / span 4', gridRow: '1 / span 2', data: {} },
                        { type: 'NamePickerWidget', gridColumn: '1 / span 6', gridRow: '3 / span 3', data: { originalNames: ['Alice', 'Bob', 'Charlie'], names: ['Alice', 'Bob', 'Charlie'] } },
                        { type: 'QRCodeWidget', gridColumn: '7 / span 4', gridRow: '3 / span 3', data: { text: 'https://school.example.com' } }
                    ]
                }
            },
            {
                name: 'Quiz Mode',
                theme: 'light-theme',
                background: { type: 'solid', value: '#e6f3f7' },
                layout: {
                    widgets: [
                        { type: 'TimerWidget', gridColumn: '1 / span 4', gridRow: '1 / span 2', data: { time: 600, running: false } },
                        { type: 'QRCodeWidget', gridColumn: '5 / span 4', gridRow: '1 / span 3', data: { text: 'Submit answers here' } },
                        { type: 'NamePickerWidget', gridColumn: '9 / span 4', gridRow: '1 / span 3', data: { originalNames: ['Alice', 'Bob', 'Charlie'], names: ['Alice', 'Bob', 'Charlie'] } }
                    ]
                }
            }
        ];
    }

    /**
     * Initialize the application.
     */
    init() {
        this.setupEventListeners();
        this.renderWidgetAccordion();
        this.initLessonPlanner();
        this.loadSavedState();
        this.backgroundManager.init();
        this.layoutManager.init();
        this.setupPresetControls();
        this.updateBackgroundOptions(this.backgroundTypeSelect.value);

        const savedSearch = localStorage.getItem(this.widgetSearchKey) || '';
        if (this.widgetSearchInput) {
            this.widgetSearchInput.value = savedSearch;
        }
        this.filterWidgetList(savedSearch);

        // If no widgets are loaded, add a default one
        if (this.widgets.length === 0) {
            this.addWidget('timer');
        }

        this.showWelcomeTourIfNeeded();
    }

    /**
     * Set up all event listeners for the application.
     */
    setupEventListeners() {
        if (!this.toggleViewBtn) {
            console.warn('Toggle view button not found. Event listeners not initialized.');
            return;
        }

        // View toggle
        this.toggleViewBtn.addEventListener('click', () => this.toggleTeacherView());
        if (this.closeTeacherViewBtn) {
            this.closeTeacherViewBtn.addEventListener('click', () => this.toggleTeacherView(false));
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const dialogOpen = (this.helpDialog && this.helpDialog.open) || (this.tourDialog && this.tourDialog.open);
                if (dialogOpen) {
                    this.closeAllDialogs();
                } else if (this.isTeacherViewOpen) {
                    this.toggleTeacherView(false);
                }
            }

            if ((event.key === 'Enter' || event.key === ' ') && document.activeElement === this.toggleViewBtn) {
                event.preventDefault();
                this.toggleViewBtn.click();
            }
        });

        if (this.widgetAccordion) {
            this.widgetAccordion.addEventListener('click', (e) => {
                const button = e.target.closest('.widget-add-btn');
                if (button && button.dataset.widget) {
                    this.addWidget(button.dataset.widget);
                }
            });
        }

        if (this.widgetSearchInput) {
            this.widgetSearchInput.addEventListener('input', (e) => this.filterWidgetList(e.target.value));
        }

        // Timer controls
        const startTimerButton = document.getElementById('start-timer');
        if (startTimerButton) {
            startTimerButton.addEventListener('click', () => this.startTimerFromControls());
        }

        const stopTimerButton = document.getElementById('stop-timer');
        if (stopTimerButton) {
            stopTimerButton.addEventListener('click', () => this.stopTimerFromControls());
        }

        // Theme controls
        if (this.themeSelector) {
            this.themeSelector.addEventListener('click', (e) => {
                if (e.target.classList.contains('theme-option')) {
                    this.switchTheme(e.target.dataset.theme);
                }
            });
        }

        // Background controls
        if (this.backgroundTypeSelect) {
            this.backgroundTypeSelect.addEventListener('change', (e) => {
                this.updateBackgroundOptions(e.target.value);
            });
        }

        // Layout controls
        const resetLayoutButton = document.getElementById('reset-layout');
        if (resetLayoutButton) {
            resetLayoutButton.addEventListener('click', () => this.resetLayout());
        }

        const savePresetButton = document.getElementById('save-preset');
        if (savePresetButton) {
            savePresetButton.addEventListener('click', () => this.savePreset());
        }

        if (this.presetListElement) {
            this.presetListElement.addEventListener('click', (e) => {
                const actionButton = e.target.closest('button[data-action]');
                if (!actionButton) return;

                const presetName = actionButton.dataset.name;
                switch (actionButton.dataset.action) {
                    case 'load':
                        this.loadPreset(presetName);
                        break;
                    case 'delete':
                        this.deletePreset(presetName);
                        break;
                    case 'overwrite':
                        this.overwritePreset(presetName);
                        break;
                }
            });
        }

        document.addEventListener('widgetRemoved', (event) => {
            if (event.detail && event.detail.widget) {
                this.handleWidgetRemoved(event.detail.widget);
            }
        });

        if (this.teacherHelpButton) {
            this.teacherHelpButton.addEventListener('click', () => this.openDialog(this.helpDialog));
        }

        this.setupDialogControls();

        // Tab controls
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                tabContents.forEach(content => {
                    if (content.id === button.dataset.tab) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });
            });
        });
    }

    /**
     * Toggle the teacher control panel.
     * @param {boolean} [forceState] - Optional boolean to force open (true) or closed (false).
     */
    toggleTeacherView(forceState = null) {
        if (forceState !== null) {
            this.isTeacherViewOpen = forceState;
        } else {
            this.isTeacherViewOpen = !this.isTeacherViewOpen;
        }

        this.teacherView.classList.toggle('hidden', !this.isTeacherViewOpen);
        this.teacherView.classList.toggle('open', this.isTeacherViewOpen);
        this.toggleViewBtn.classList.toggle('active', this.isTeacherViewOpen);
        this.toggleViewBtn.setAttribute('aria-expanded', this.isTeacherViewOpen);

        if (this.isTeacherViewOpen) {
            this.teacherView.focus();
        }
    }

    /**
     * Add a new widget to the screen.
     * @param {string} type - The type of widget to add ('timer', 'noise-meter', etc.).
     */
    addWidget(type) {
        let widget;
        try {
            switch (type) {
                case 'timer':
                    widget = new TimerWidget();
                    break;
                case 'noise-meter':
                    widget = new NoiseMeterWidget();
                    break;
                case 'name-picker':
                    widget = new NamePickerWidget();
                    break;
                case 'qr-code':
                    widget = new QRCodeWidget();
                    break;
                case 'drawing-tool':
                    widget = new DrawingToolWidget();
                    break;
                case 'document-viewer':
                    widget = new DocumentViewerWidget();
                    break;
                case 'mask':
                    widget = new MaskWidget();
                    break;
                default:
                    throw new Error(`Unknown widget type: ${type}`);
            }

            // Add the widget to the layout manager
            const widgetElement = this.layoutManager.addWidget(widget);
            this.widgets.push(widget);
            
            // Remove placeholder if it exists
            const placeholder = this.widgetsContainer.querySelector('.widget-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
            
            this.saveState();
            if (widgetElement) {
                widgetElement.classList.add('action-flash');
                setTimeout(() => widgetElement.classList.remove('action-flash'), 1200);
            }

            this.showNotification(`${this.getFriendlyWidgetName(type)} Added!`);
        } catch (error) {
            console.error('Failed to add widget:', error);
            this.showNotification('Failed to add widget.', 'error');
        }
    }

    /**
     * Provide a human-friendly widget label.
     * @param {string} type
     * @returns {string}
     */
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

    /**
     * Render the widget accordion based on configured categories.
     */
    renderWidgetAccordion() {
        if (!this.widgetAccordion) return;

        this.widgetAccordion.innerHTML = '';

        this.widgetCategories.forEach((category) => {
            const details = document.createElement('details');
            details.className = 'widget-category';
            details.open = true;
            details.dataset.categoryName = category.name.toLowerCase();

            const summary = document.createElement('summary');
            summary.textContent = category.name;
            details.appendChild(summary);

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'widget-buttons';

            category.widgets.forEach((widgetConfig) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'control-button widget-add-btn';
                button.dataset.widget = widgetConfig.type;
                const friendlyName = this.getFriendlyWidgetName(widgetConfig.type);
                button.textContent = widgetConfig.label || `Add ${friendlyName}`;
                button.setAttribute('aria-label', `Add ${friendlyName} widget`);
                buttonContainer.appendChild(button);
            });

            details.appendChild(buttonContainer);
            this.widgetAccordion.appendChild(details);
        });
    }

    /**
     * Filter the widget list based on a search query.
     * @param {string} query - Search text provided by the user.
     */
    filterWidgetList(query = '') {
        if (!this.widgetAccordion) return;

        const searchTerm = query.toLowerCase().trim();
        localStorage.setItem(this.widgetSearchKey, query);

        const categories = this.widgetAccordion.querySelectorAll('.widget-category');

        categories.forEach(category => {
            let visibleCount = 0;
            const buttons = category.querySelectorAll('.widget-add-btn');
            const categoryLabel = (category.dataset.categoryName || category.querySelector('summary')?.textContent || '').toLowerCase();

            buttons.forEach(button => {
                const label = button.textContent.toLowerCase();
                const type = button.dataset.widget.toLowerCase();
                const isVisible = !searchTerm || label.includes(searchTerm) || type.includes(searchTerm) || categoryLabel.includes(searchTerm);
                button.classList.toggle('hidden', !isVisible);
                if (isVisible) {
                    visibleCount++;
                }
            });
            category.classList.toggle('hidden', visibleCount === 0);
        });
    }

    /**
     * Switch the application theme.
     * @param {string} themeName - The name of the theme to switch to.
     */
    switchTheme(themeName) {
        // Remove all theme classes
        document.body.classList.remove('light-theme', 'dark-theme', 'ocean-theme', 'forest-theme', 'sunset-theme', 'royal-theme', 'monochrome-theme', 'high-contrast-theme');
        
        // Add the selected theme class
        document.body.classList.add(themeName);
        
        // Update the selected state in the theme selector
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.theme === themeName);
        });
        
        // Save the theme preference
        localStorage.setItem('selectedTheme', themeName);
    }

    /**
     * Update the background options based on the selected type.
     * @param {string} type - The type of background ('solid', 'gradient', 'image').
     */
    updateBackgroundOptions(type) {
        this.backgroundOptionsContainer.innerHTML = '';
        
        switch (type) {
            case 'solid':
                const colors = ['#ffffff', '#f0f0f0', '#e6f3f7', '#ffeedd', '#e8f5e9', '#f3e5f5'];
                colors.forEach(color => {
                    const button = this.createColorOption(color);
                    this.backgroundOptionsContainer.appendChild(button);
                });
                break;
                
            case 'gradient':
                const gradients = [
                    'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
                    'linear-gradient(to top, #a8edea 0%, #fed6e3 100%)',
                    'linear-gradient(to right, #fc5c7d, #6a82fb)'
                ];
                gradients.forEach(gradient => {
                    const button = this.createGradientOption(gradient);
                    this.backgroundOptionsContainer.appendChild(button);
                });
                break;
                
            case 'image':
                const images = [
                    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600',
                    'https://images.unsplash.com/photo-1493514789931-586cb221d7a7?w=1600',
                    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1600'
                ];
                images.forEach(imageUrl => {
                    const button = this.createImageOption(imageUrl);
                    this.backgroundOptionsContainer.appendChild(button);
                });
                break;
        }
    }

    /**
     * Create a button for a solid color background option.
     * @param {string} color - The color value.
     * @returns {HTMLButtonElement} The created button.
     */
    createColorOption(color) {
        const button = document.createElement('button');
        button.className = 'color-option';
        button.style.backgroundColor = color;
        button.setAttribute('aria-label', `Set background to ${color}`);
        button.addEventListener('click', () => {
            this.backgroundManager.setBackground('solid', color);
            this.saveState();
        });
        return button;
    }

    /**
     * Create a button for a gradient background option.
     * @param {string} gradient - The gradient CSS value.
     * @returns {HTMLButtonElement} The created button.
     */
    createGradientOption(gradient) {
        const button = document.createElement('button');
        button.className = 'gradient-option';
        button.style.background = gradient;
        button.setAttribute('aria-label', 'Set background to gradient');
        button.addEventListener('click', () => {
            this.backgroundManager.setBackground('gradient', gradient);
            this.saveState();
        });
        return button;
    }

    /**
     * Create an image element for an image background option.
     * @param {string} imageUrl - The URL of the image.
     * @returns {HTMLImageElement} The created image element.
     */
    createImageOption(imageUrl) {
        const image = document.createElement('img');
        image.className = 'image-option';
        image.src = imageUrl;
        image.alt = 'Background option';
        image.addEventListener('click', () => {
            this.backgroundManager.setBackground('image', imageUrl);
            this.saveState();
        });
        return image;
    }

    /**
     * Start the timer widget from the teacher controls.
     */
    startTimerFromControls() {
        const minutes = parseInt(document.getElementById('timer-minutes').value);
        if (minutes > 0) {
            // Find the first timer widget and start it
            const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
            if (timerWidget) {
                timerWidget.start(minutes);
            } else {
                this.showNotification('Please add a Timer widget first.', 'warning');
            }
        }
    }

    /**
     * Stop the timer widget from the teacher controls.
     */
    stopTimerFromControls() {
        const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (timerWidget) {
            timerWidget.stop();
        }
    }

    /**
     * Save the current application state to localStorage.
     */
    saveState() {
        const state = {
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
        localStorage.setItem('classroomScreenState', JSON.stringify(state));
    }

    /**
     * Load presets from localStorage and merge defaults.
     */
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

        this.savePresets();
        this.renderPresetList();
    }

    /**
     * Save presets to localStorage.
     */
    savePresets() {
        localStorage.setItem(this.presetsKey, JSON.stringify(this.presets));
    }

    /**
     * Save or overwrite a preset using the current layout.
     */
    savePreset() {
        const presetName = this.presetNameInput ? this.presetNameInput.value.trim() : '';
        if (!presetName) {
            this.showNotification('Please enter a preset name.', 'warning');
            return;
        }

        const newPreset = {
            name: presetName,
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

    /**
     * Load a preset by name.
     * @param {string} name - Preset identifier.
     */
    loadPreset(name) {
        const preset = this.presets.find(item => item.name === name);
        if (!preset) {
            this.showNotification('Preset not found.', 'error');
            return;
        }

        if (this.presetNameInput) {
            this.presetNameInput.value = preset.name;
        }

        if (preset.theme) {
            this.switchTheme(preset.theme);
        }
        if (preset.background) {
            this.backgroundManager.deserialize(preset.background);
        }

        if (preset.lessonPlan && this.lessonPlanEditor) {
            this.lessonPlanEditor.setContents(preset.lessonPlan);
        }

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

    /**
     * Overwrite an existing preset with the current layout.
     * @param {string} name - Preset identifier.
     */
    overwritePreset(name) {
        if (this.presetNameInput) {
            this.presetNameInput.value = name;
        }
        const presetIndex = this.presets.findIndex(preset => preset.name === name);
        if (presetIndex === -1) {
            this.showNotification('Preset not found.', 'error');
            return;
        }
        this.presets[presetIndex] = {
            name,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Preset "${name}" overwritten.`);
    }

    /**
     * Delete a preset.
     * @param {string} name - Preset identifier.
     */
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

    /**
     * Render the preset list UI.
     */
    renderPresetList() {
        if (!this.presetListElement) return;

        this.presetListElement.innerHTML = '';
        if (this.presets.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.textContent = 'No presets saved yet.';
            this.presetListElement.appendChild(emptyState);
            return;
        }

        this.presets.forEach(preset => {
            const item = document.createElement('div');
            item.className = 'preset-item';

            const name = document.createElement('span');
            name.textContent = preset.name;

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

            actions.appendChild(loadButton);
            actions.appendChild(overwriteButton);
            actions.appendChild(deleteButton);

            item.appendChild(name);
            item.appendChild(actions);

            this.presetListElement.appendChild(item);
        });
    }

    /**
     * Load the saved application state from localStorage.
     */
    loadSavedState() {
        const savedState = localStorage.getItem('classroomScreenState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                
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
            }
        }
    }

    /**
     * Reset the application layout to its default state.
     */
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

    /**
     * Remove references to widgets when they are deleted from the DOM.
     * @param {object} widget - Widget instance that was removed.
     */
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

    /**
     * Show a notification message to the user.
     * @param {string} message - The message to display.
     * @param {string} [type='success'] - The type of notification ('success', 'error', 'warning').
     */
    showNotification(message, type = 'success') {
        // Remove any existing notifications
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        this.appContainer.appendChild(notification);

        // Trigger a reflow to enable the transition
        void notification.offsetWidth;

        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * Wire dialog open/close buttons for help and tour.
     */
    setupDialogControls() {
        const dialogs = [this.helpDialog, this.tourDialog].filter(Boolean);
        dialogs.forEach((dialog) => {
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) {
                    this.closeAllDialogs();
                }
            });

            dialog.querySelectorAll('[data-close], .modal-close').forEach((btn) => {
                btn.addEventListener('click', () => this.closeAllDialogs());
            });
        });
    }

    /**
     * Open a dialog with modal behavior.
     * @param {HTMLDialogElement} dialog
     */
    openDialog(dialog) {
        if (!dialog) return;
        if (!dialog.open) {
            dialog.showModal();
        }
    }

    /**
     * Close all open dialogs.
     */
    closeAllDialogs() {
        [this.helpDialog, this.tourDialog].forEach((dialog) => {
            if (dialog && dialog.open) {
                dialog.close();
            }
        });
    }

    /**
     * Display the welcome tour on first load without saved state.
     */
    showWelcomeTourIfNeeded() {
        const tourSeen = localStorage.getItem('welcomeTourSeen');
        if (this.hasSavedState || tourSeen) {
            return;
        }
        this.openDialog(this.tourDialog);
        localStorage.setItem('welcomeTourSeen', 'true');
    }

    /**
     * Initialize the Quill rich text editor for the lesson plan.
     */
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
