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
        
        // App State
        this.widgets = [];
        this.isTeacherViewOpen = false;

        // Managers
        this.layoutManager = new LayoutManager(this.widgetsContainer);
        this.layoutManager.onLayoutChange = () => this.saveState();
        this.backgroundManager = new BackgroundManager(this.studentView);
    }

    /**
     * Initialize the application.
     */
    init() {
        this.setupEventListeners();
        this.loadSavedState();
        this.backgroundManager.init();
        this.layoutManager.init();
        this.updateBackgroundOptions(this.backgroundTypeSelect.value);
        
        // If no widgets are loaded, add a default one
        if (this.widgets.length === 0) {
            this.addWidget('timer');
        }
    }

    /**
     * Set up all event listeners for the application.
     */
    setupEventListeners() {
        // View toggle
        this.toggleViewBtn.addEventListener('click', () => this.toggleTeacherView());
        this.closeTeacherViewBtn.addEventListener('click', () => this.toggleTeacherView(false));

        // Widget controls
        document.getElementById('add-timer-widget').addEventListener('click', () => this.addWidget('timer'));
        document.getElementById('add-noise-meter').addEventListener('click', () => this.addWidget('noise-meter'));
        document.getElementById('add-name-picker').addEventListener('click', () => this.addWidget('name-picker'));
        document.getElementById('add-qr-code').addEventListener('click', () => this.addWidget('qr-code'));
        document.getElementById('add-drawing-tool').addEventListener('click', () => this.addWidget('drawing-tool'));

        // Timer controls
        document.getElementById('start-timer').addEventListener('click', () => this.startTimerFromControls());
        document.getElementById('stop-timer').addEventListener('click', () => this.stopTimerFromControls());

        // Theme controls
        this.themeSelector.addEventListener('click', (e) => {
            if (e.target.classList.contains('theme-option')) {
                this.switchTheme(e.target.dataset.theme);
            }
        });

        // Background controls
        this.backgroundTypeSelect.addEventListener('change', (e) => {
            this.updateBackgroundOptions(e.target.value);
        });

        // Layout controls
        document.getElementById('save-layout').addEventListener('click', () => this.saveState());
        document.getElementById('reset-layout').addEventListener('click', () => this.resetLayout());
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
        this.toggleViewBtn.classList.toggle('active', this.isTeacherViewOpen);
        this.toggleViewBtn.setAttribute('aria-expanded', this.isTeacherViewOpen);
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
                default:
                    throw new Error(`Unknown widget type: ${type}`);
            }
            
            // Add the widget to the layout manager
            this.layoutManager.addWidget(widget);
            this.widgets.push(widget);
            
            // Remove placeholder if it exists
            const placeholder = this.widgetsContainer.querySelector('.widget-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
            
            this.saveState();
            this.showNotification(`${type.replace('-', ' ')} widget added!`);
        } catch (error) {
            console.error('Failed to add widget:', error);
            this.showNotification('Failed to add widget.', 'error');
        }
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
            layout: this.layoutManager.serialize()
        };
        localStorage.setItem('classroomScreenState', JSON.stringify(state));
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
                        }
                        if (widget) {
                            this.widgets.push(widget);
                        }
                        return widget;
                    });
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
            this.backgroundManager.reset();
            this.saveState();
            this.showNotification('Layout has been reset.');
        }
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
}

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new ClassroomScreenApp();
    app.init();
});
