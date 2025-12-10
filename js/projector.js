/**
 * Projector View Application Script
 * Loads and displays the classroom screen state in a read-only mode.
 */

class ProjectorApp {
    constructor() {
        this.appContainer = document.getElementById('app-container');
        this.studentView = document.getElementById('student-view');
        this.widgetsContainer = document.getElementById('widgets-container');
        this.widgets = [];

        // Managers
        this.layoutManager = new LayoutManager(this.widgetsContainer);
        // Disable editing in LayoutManager if possible, but we already hid controls with CSS.
        // We can also override methods if needed.

        this.backgroundManager = new BackgroundManager(this.studentView);

        this.projectorChannel = new BroadcastChannel('teacher-screen-sync');
    }

    init() {
        this.backgroundManager.init();
        this.layoutManager.init();

        // Listen for storage events to update in real-time
        window.addEventListener('storage', (event) => {
            if (event.key === 'classroomScreenState') {
                this.loadSavedState();
            }
            if (event.key === 'selectedTheme') {
                this.loadTheme();
            }
        });

        this.projectorChannel.onmessage = (event) => {
            if (event.data.type === 'layout-update') {
                this.rebuildLayout(event.data.state);
            }
        };

        this.loadTheme();
        this.loadSavedState();
    }

    loadTheme() {
        const theme = localStorage.getItem('selectedTheme');
        if (theme) {
            document.body.className = `projector-view ${theme}`;
        }
    }

    loadSavedState() {
        const savedString = localStorage.getItem('classroomScreenState');
        if (!savedString) return;

        let state = null;
        try {
            state = JSON.parse(savedString);
        } catch (e) {
            console.warn('Corrupt state detected in Projector; ignoring.', e);
            return;
        }

        if (state && typeof state === 'object') {
            this.rebuildLayout(state);
        }
    }

    rebuildLayout(state) {
        try {
            // Restore theme (if stored in state, though main.js seems to store it in body class and state)
            if (state.theme) {
                document.body.className = `projector-view ${state.theme}`;
            }

            // Restore background
            if (state.background) {
                this.backgroundManager.deserialize(state.background);
            }

            // Restore layout and widgets
            if (state.layout && state.layout.widgets) {
                // Clear existing widgets before reloading to avoid duplicates/stale state
                this.widgets = [];
                // We need to clear the container or let LayoutManager handle it.
                // LayoutManager.deserialize clears the container.

                this.layoutManager.deserialize(state.layout, (widgetData) => {
                    // Filter out widgets not meant for the projector
                    if (widgetData.visibleOnProjector === false) {
                        return null;
                    }

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
        } catch (err) {
            console.error('Projector layout rebuild failed:', err);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new ProjectorApp();
    app.init();
});
