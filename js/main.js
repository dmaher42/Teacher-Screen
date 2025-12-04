document.addEventListener('DOMContentLoaded', function() {
    // Initialize the application
    const app = new ClassroomScreenApp();
    app.init();
});

class ClassroomScreenApp {
    constructor() {
        this.widgetsContainer = document.getElementById('widgets-container');
        this.teacherView = document.getElementById('teacher-view');
        this.studentView = document.getElementById('student-view');
        this.toggleViewBtn = document.getElementById('toggle-view');
        
        this.widgets = [];
        this.layoutManager = new LayoutManager(this.widgetsContainer);
        this.backgroundManager = new BackgroundManager(document.body);
        
        this.setupEventListeners();
    }
    
    init() {
        // Set up the initial view
        this.loadSavedState();
        
        // Initialize background manager
        this.backgroundManager.init();
        
        // Set up the layout manager
        this.layoutManager.init();
        
        // Add any default widgets
        this.addDefaultWidgets();
    }
    
    setupEventListeners() {
        // Toggle teacher view
        this.toggleViewBtn.addEventListener('click', () => {
            this.teacherView.classList.toggle('hidden');
        });
        
        // Widget controls
        document.getElementById('add-timer-widget').addEventListener('click', () => {
            this.addWidget('timer');
        });
        
        document.getElementById('add-noise-meter').addEventListener('click', () => {
            this.addWidget('noise-meter');
        });
        
        document.getElementById('add-name-picker').addEventListener('click', () => {
            this.addWidget('name-picker');
        });
        
        document.getElementById('add-qr-code').addEventListener('click', () => {
            this.addWidget('qr-code');
        });
        
        document.getElementById('add-drawing-tool').addEventListener('click', () => {
            this.addWidget('drawing-tool');
        });
        
        // Background controls
        document.getElementById('background-type').addEventListener('change', (e) => {
            this.updateBackgroundOptions(e.target.value);
        });
        
        // Timer controls
        document.getElementById('start-timer').addEventListener('click', () => {
            const minutes = parseInt(document.getElementById('timer-minutes').value);
            if (minutes > 0) {
                this.startTimer(minutes);
            }
        });
        
        document.getElementById('stop-timer').addEventListener('click', () => {
            this.stopTimer();
        });
    }
    
    addWidget(type) {
        let widget;
        
        switch(type) {
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
                console.error(`Unknown widget type: ${type}`);
                return;
        }
        
        // Add the widget to the layout
        this.layoutManager.addWidget(widget, 0, 0, 3, 2);
        this.widgets.push(widget);
        
        // Save the state
        this.saveState();
    }
    
    addDefaultWidgets() {
        // Add a timer widget by default
        this.addWidget('timer');
    }
    
    updateBackgroundOptions(type) {
        const optionsContainer = document.getElementById('background-options');
        optionsContainer.innerHTML = '';
        
        switch(type) {
            case 'solid':
                const colors = ['#ffffff', '#f0f0f0', '#e6f3f7', '#ffeedd', '#e8f5e9'];
                colors.forEach(color => {
                    const colorOption = document.createElement('button');
                    colorOption.style.backgroundColor = color;
                    colorOption.style.width = '30px';
                    colorOption.style.height = '30px';
                    colorOption.style.margin = '5px';
                    colorOption.style.border = '1px solid #ccc';
                    colorOption.addEventListener('click', () => {
                        this.backgroundManager.setBackground('solid', color);
                    });
                    optionsContainer.appendChild(colorOption);
                });
                break;
                
            case 'gradient':
                const gradients = [
                    'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
                    'linear-gradient(to top, #a8edea 0%, #fed6e3 100%)',
                    'linear-gradient(to right, #fc5c7d, #6a82fb)'
                ];
                gradients.forEach((gradient, index) => {
                    const gradientOption = document.createElement('button');
                    gradientOption.style.background = gradient;
                    gradientOption.style.width = '100%';
                    gradientOption.style.height = '30px';
                    gradientOption.style.margin = '5px 0';
                    gradientOption.style.border = '1px solid #ccc';
                    gradientOption.addEventListener('click', () => {
                        this.backgroundManager.setBackground('gradient', gradient);
                    });
                    optionsContainer.appendChild(gradientOption);
                });
                break;
                
            case 'image':
                const images = [
                    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600',
                    'https://images.unsplash.com/photo-1493514789931-586cb221d7a7?w=1600',
                    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1600'
                ];
                images.forEach(imageUrl => {
                    const imageOption = document.createElement('img');
                    imageOption.src = imageUrl;
                    imageOption.style.width = '100%';
                    imageOption.style.height = '60px';
                    imageOption.style.objectFit = 'cover';
                    imageOption.style.margin = '5px 0';
                    imageOption.style.border = '1px solid #ccc';
                    imageOption.style.cursor = 'pointer';
                    imageOption.addEventListener('click', () => {
                        this.backgroundManager.setBackground('image', imageUrl);
                    });
                    optionsContainer.appendChild(imageOption);
                });
                break;
        }
    }
    
    startTimer(minutes) {
        // Find the first timer widget and start it
        const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (timerWidget) {
            timerWidget.start(minutes);
        }
    }
    
    stopTimer() {
        // Find the first timer widget and stop it
        const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (timerWidget) {
            timerWidget.stop();
        }
    }
    
    saveState() {
        // Save the current state to localStorage
        const state = {
            widgets: this.widgets.map(widget => widget.serialize()),
            background: this.backgroundManager.serialize()
        };
        localStorage.setItem('classroomScreenState', JSON.stringify(state));
    }
    
    loadSavedState() {
        // Load the saved state from localStorage
        const savedState = localStorage.getItem('classroomScreenState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                // Restore widgets
                // Restore background
                this.backgroundManager.deserialize(state.background);
            } catch (e) {
                console.error('Failed to load saved state:', e);
            }
        }
    }
}
