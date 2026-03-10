import { appBus } from './utils/app-bus.js';
import { APP_MODE } from './utils/app-mode.js';

console.log('Projector Mode:', APP_MODE);

appBus.init();
console.log('AppBus initialised');

const loadClassicScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
});

const bootstrapProjectorDependencies = async () => {
    await loadClassicScript('https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js');
    await loadClassicScript('https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js');
    await loadClassicScript('https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.js');
    await loadClassicScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js');
    await loadClassicScript('js/utils/layout-manager.js');
    await loadClassicScript('js/utils/background-manager.js');
    await loadClassicScript('js/utils/reveal-sync.js');
    await loadClassicScript('assets/sounds/sound-data.js');
    await loadClassicScript('js/widgets/timer.js');
    await loadClassicScript('js/widgets/noise-meter.js');
    await loadClassicScript('js/widgets/noise-meter-widget.js');
    await loadClassicScript('js/widgets/name-picker.js');
    await loadClassicScript('js/widgets/qr-code-widget.js');
    await loadClassicScript('js/widgets/drawing-tool.js');
    await loadClassicScript('js/widgets/document-viewer.js');
    await loadClassicScript('js/widgets/url-viewer.js');
    await loadClassicScript('js/widgets/reveal-manager-widget.js');
    await loadClassicScript('js/widgets/presentation-widget.js');
    await loadClassicScript('js/widgets/notes-widget.js');
    await loadClassicScript('js/widgets/wellbeing-widget.js');
    await loadClassicScript('js/widgets/rich-text-widget.js');
    await loadClassicScript('js/widgets/mask-widget.js');
};

/**
 * Projector View Application Script
 * Loads and displays the classroom screen state in a read-only mode.
 */

const THEMES = ['theme-ocean', 'theme-professional', 'theme-light'];

function applyTheme(themeName) {
    const nextTheme = THEMES.includes(themeName) ? themeName : 'theme-professional';
    THEMES.forEach(theme => document.body.classList.remove(theme));
    document.body.classList.add(nextTheme);
}

class ProjectorApp {
    constructor() {
        this.appContainer = document.getElementById('app-container');
        this.studentView = document.getElementById('student-view');
        this.widgetsContainer = document.getElementById('widgets-container');
        this.widgets = [];
        this.isEditMode = false;
        this.lastTeacherLayoutSnapshot = null;
        this.preEditLayoutSnapshot = null;

        this.editControls = document.getElementById('projector-edit-controls');
        this.editStatus = document.getElementById('projector-edit-status');
        this.doneEditButton = document.getElementById('projector-edit-done');
        this.resetLastChangeButton = document.getElementById('projector-reset-last-change');

        // Managers
        this.layoutManager = new LayoutManager(this.widgetsContainer);
        this.layoutManager.setEditable(false);
        // Disable editing in LayoutManager if possible, but we already hid controls with CSS.
        // We can also override methods if needed.

        this.backgroundManager = new BackgroundManager(this.studentView);

        this.projectorChannel = new BroadcastChannel('teacher-screen-sync');
        this.revealSync = typeof window !== 'undefined' && window.RevealSync ? new window.RevealSync() : null;
    }

    init() {
        this.backgroundManager.init();
        this.layoutManager.init();
        this.setupEditModeControls();

        // Ask the teacher window for the latest state as soon as the projector starts.
        this.projectorChannel.postMessage({ type: 'request-sync' });

        // Listen for storage events to update in real-time
        window.addEventListener('storage', (event) => {
            if (event.key === 'classroomScreenState') {
                this.loadSavedState();
            }
            if (event.key === 'selectedTheme') {
                this.loadTheme();
            }
            if (event.key === 'teacher-slide' && event.newValue) {
                try {
                    const data = JSON.parse(event.newValue);
                    console.log('[sync] projector received slide update');
                    console.log('[sync] teacher slide update', data);

                    if (window.Reveal && typeof window.Reveal.slide === 'function') {
                        window.Reveal.slide(data.indexh, data.indexv);
                    }
                } catch (error) {
                    console.warn('[sync] invalid teacher slide payload', error);
                }
            }
        });

        if (this.revealSync) {
            this.revealSync.onSlideState((state) => {
                if (window.Reveal && typeof window.Reveal.slide === 'function') {
                    window.Reveal.slide(state.indexh, state.indexv, state.indexf);
                }
            });
        }

        this.projectorChannel.onmessage = (event) => {
            const message = event.data || {};

            if (message.type === 'layout-update') {
                if (message.source === 'projector') {
                    return;
                }

                if (message.state && message.state.layout) {
                    this.lastTeacherLayoutSnapshot = JSON.parse(JSON.stringify(message.state.layout));
                }

                this.rebuildLayout(message.state);
                return;
            }

            if (message.type === 'layout-delta' && message.delta) {
                if (message.source === 'projector') {
                    return;
                }
                this.layoutManager.applyLayoutDelta(message.delta);
            }
        };

        this.loadTheme();
        this.loadSavedState();
    }

    loadTheme() {
        const theme = localStorage.getItem('selectedTheme') || 'theme-professional';
        applyTheme(theme);
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
            if (state.layout) {
                this.lastTeacherLayoutSnapshot = JSON.parse(JSON.stringify(state.layout));
            }
            this.rebuildLayout(state);
        }
    }


    setupEditModeControls() {
        const params = new URLSearchParams(window.location.search);
        const startsInEditMode = params.get('edit') === '1';

        if (this.doneEditButton) {
            this.doneEditButton.addEventListener('click', () => this.setEditMode(false));
        }

        if (this.resetLastChangeButton) {
            this.resetLastChangeButton.addEventListener('click', () => this.resetLastChange());
        }

        document.addEventListener('keydown', (event) => {
            const isModifierPressed = event.ctrlKey || event.metaKey;
            if (!isModifierPressed || event.key.toLowerCase() !== 'e') {
                return;
            }

            event.preventDefault();
            this.toggleEditMode();
        });

        this.layoutManager.onLayoutChange = (payload) => {
            if (!this.isEditMode) {
                return;
            }

            if (!payload || payload.type !== 'widget-update') {
                return;
            }

            this.projectorChannel.postMessage({
                type: 'layout-delta-from-projector',
                source: 'projector',
                delta: payload
            });
        };

        this.setEditMode(startsInEditMode);
    }

    toggleEditMode() {
        this.setEditMode(!this.isEditMode);
    }

    setEditMode(enabled) {
        this.isEditMode = !!enabled;
        if (this.isEditMode && !this.preEditLayoutSnapshot) {
            this.preEditLayoutSnapshot = this.layoutManager.serialize();
        }

        if (!this.isEditMode) {
            this.preEditLayoutSnapshot = null;
        }

        this.layoutManager.setEditable(this.isEditMode);
        document.body.classList.toggle('edit-mode', this.isEditMode);

        if (this.editControls) {
            this.editControls.hidden = !this.isEditMode;
        }

        if (this.editStatus) {
            this.editStatus.textContent = this.isEditMode ? 'Edit: ON' : 'Edit: OFF';
        }
    }

    resetLastChange() {
        const resetSnapshot = this.preEditLayoutSnapshot || this.lastTeacherLayoutSnapshot;
        if (!resetSnapshot) {
            return;
        }

        this.layoutManager.deserialize(resetSnapshot, (widgetData) => this.createProjectorWidget(widgetData));

        if (this.isEditMode) {
            this.projectorChannel.postMessage({
                type: 'layout-update-from-projector',
                source: 'projector',
                layout: this.layoutManager.serialize()
            });
        }
    }

    rebuildLayout(state) {
        try {
            // Restore theme (if stored in state, though main.js seems to store it in body class and state)
            if (state.theme) {
                applyTheme(state.theme);
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
                    const widget = this.createProjectorWidget(widgetData);
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

    createProjectorWidget(widgetData) {
        if (widgetData.visibleOnProjector === false) {
            return null;
        }

        return this.layoutManager.createWidgetFromType(widgetData.type);
    }

    destroy() {
        if (this.revealSync && this.revealSync.channel && typeof this.revealSync.channel.close === 'function') {
            this.revealSync.channel.close();
        }
    }

}

document.addEventListener('DOMContentLoaded', async () => {
    await bootstrapProjectorDependencies();
    const app = new ProjectorApp();
    app.init();
});
