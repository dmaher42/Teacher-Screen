import { startPresentationDiagnostics } from './utils/presentation-debug.js';
import { destroyReveal, getRevealDeck, getRevealState, initializeReveal, layoutReveal, mountPresentationMarkup } from './utils/reveal-manager.js';
import { createWidgetByType } from './widgets/widget-registry.js';

window.APP_MODE = 'projector';
const PROJECTOR_APP_MODE = 'projector';

console.log('Projector Mode:', PROJECTOR_APP_MODE);

window.__ProjectorConnection = {
    window: window,
    connected: true
};

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

async function loadPresentation(url) {
    const res = await fetch(url);
    const html = await res.text();

    const root = document.getElementById('presentation-root');
    if (!root) {
        console.warn('Presentation root not found');
        return;
    }

    destroyReveal(root);
    mountPresentationMarkup(root, html);
    const deck = await initializeReveal(root);
    if (deck && typeof layoutReveal === 'function') {
        layoutReveal(root);
    }
}

async function loadPresentationHtml(html) {
    const root = document.getElementById('presentation-root');
    if (!root) {
        console.warn('Presentation root not found');
        return;
    }

    destroyReveal(root);
    mountPresentationMarkup(root, html);
    const deck = await initializeReveal(root);
    if (deck && typeof layoutReveal === 'function') {
        layoutReveal(root);
    }
}

const slideRevealWhenReady = async (h = 0, v = 0) => {
    const root = document.getElementById('presentation-root');
    const revealState = getRevealState(root);
    const deck = getRevealDeck(root);
    if (!deck || typeof deck.slide !== 'function') {
        return;
    }

    if (revealState.ready || (typeof deck.isReady === 'function' && deck.isReady())) {
        deck.slide(h, v);
        return;
    }

    await new Promise((resolve) => {
        const onReady = () => {
            if (typeof deck.off === 'function') {
                deck.off('ready', onReady);
            }
            resolve();
        };

        if (typeof deck.on === 'function') {
            deck.on('ready', onReady);
            return;
        }

        resolve();
    });

    if (typeof deck.slide === 'function') {
        deck.slide(h, v);
    }
};

const initializeRevealSyncListener = () => {
    // Teacher -> Projector synchronization
    // Uses postMessage slideSync events.
    window.addEventListener('message', (event) => {
        const data = event.data;

        if (!data || data.type !== 'slideSync') return;

        console.log('Projector received slide:', data.h, data.v);

        if (data.url) {
            loadPresentation(data.url)
                .then(() => slideRevealWhenReady(data.h, data.v))
                .catch((error) => {
                    console.warn('Unable to load presentation URL', error);
                });
            return;
        }

        if (data.html) {
            loadPresentationHtml(data.html)
                .then(() => slideRevealWhenReady(data.h, data.v))
                .catch((error) => {
                    console.warn('Unable to load presentation HTML', error);
                });
            return;
        }

        slideRevealWhenReady(data.h, data.v);
    });
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
        });

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

        this.layoutManager.deserialize(resetSnapshot, (widgetData) => {
            if (widgetData.visibleOnProjector === false) {
                return null;
            }
            return createWidgetByType(widgetData.type);
        });

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
                    // Filter out widgets not meant for the projector
                    if (widgetData.visibleOnProjector === false) {
                        return null;
                    }

                    const widget = createWidgetByType(widgetData.type);
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

    destroy() {}

}

document.addEventListener('DOMContentLoaded', async () => {
    await bootstrapProjectorDependencies();
    initializeRevealSyncListener();
    const app = new ProjectorApp();
    app.init();
    startPresentationDiagnostics();
});
