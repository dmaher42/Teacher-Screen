import './utils/app-mode.js';
import { startPresentationDiagnostics } from './utils/presentation-debug.js';
import { destroyReveal, getRevealDeck, getRevealState, initializeReveal, layoutReveal, mountPresentationMarkup } from './utils/reveal-manager.js';
import { createWidgetByType } from './widgets/widget-registry.js';
import './utils/widget-change-notifier.js';

window.APP_MODE = 'projector';
const PROJECTOR_APP_MODE = 'projector';
const PROJECTOR_SYNC_TOKEN_KEY = 'teacher-screen-projector-sync-token';
const EXTERNAL_OPTIONAL_DEPENDENCY_TIMEOUT_MS = 2500;
const LOCAL_DEPENDENCY_TIMEOUT_MS = 10000;
const PROJECTOR_SYNC_RETRY_DELAYS_MS = [250, 1000, 2500, 5000];
const PROJECTOR_LOCAL_ASSET_VERSION = '40';

window.__ProjectorConnection = {
    window: window,
    connected: true
};

let activePresentationSourceKey = null;
let activePresentationLoadPromise = null;
let activePresentationObjectUrls = new Set();

function isDedicatedRevealProjectorWidget(widgetData = {}) {
    const type = widgetData.type;
    return type === 'RevealManagerWidget' || type === 'reveal-manager';
}

function getProjectorSyncToken() {
    try {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('syncToken');
        if (token) {
            sessionStorage.setItem(PROJECTOR_SYNC_TOKEN_KEY, token);
            return token;
        }

        return sessionStorage.getItem(PROJECTOR_SYNC_TOKEN_KEY) || null;
    } catch (error) {
        console.warn('Unable to read projector sync token', error);
        return null;
    }
}

const isExternalDependency = (src) => /^https?:\/\//i.test(src);

const getDependencyTimeoutMs = (dependency) => {
    if (Number.isFinite(dependency.timeoutMs)) {
        return dependency.timeoutMs;
    }

    return !dependency.required && isExternalDependency(dependency.src)
        ? EXTERNAL_OPTIONAL_DEPENDENCY_TIMEOUT_MS
        : LOCAL_DEPENDENCY_TIMEOUT_MS;
};

const loadClassicScript = (src, timeoutMs = LOCAL_DEPENDENCY_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;

    const settle = (callback) => {
        if (settled) {
            return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        callback();
    };

    const timeoutId = window.setTimeout(() => {
        settle(() => {
            script.remove();
            reject(new Error(`Timed out loading script: ${src}`));
        });
    }, timeoutMs);

    const isLocalAsset = !/^https?:\/\//i.test(src);
    script.src = isLocalAsset
        ? `${src}${src.includes('?') ? '&' : '?'}v=${PROJECTOR_LOCAL_ASSET_VERSION}`
        : src;
    script.defer = true;
    script.onload = () => settle(resolve);
    script.onerror = () => settle(() => reject(new Error(`Failed to load script: ${src}`)));
    document.head.appendChild(script);
});

const PROJECTOR_DEPENDENCIES = [
    { src: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.js', required: false },
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js', required: false },
    { src: 'js/utils/local-document-store.js', required: true },
    { src: 'js/utils/layout-manager.js', required: true },
    { src: 'js/utils/background-manager.js', required: true },
    { src: 'js/widgets/noise-meter.js', required: false },
    { src: 'js/widgets/noise-meter-widget.js', required: false },
    { src: 'js/widgets/behaviour-tracker-widget.js', required: true },
    { src: 'js/widgets/name-picker.js', required: false },
    { src: 'js/widgets/qr-code-widget.js', required: false },
    { src: 'js/widgets/drawing-tool.js', required: false },
    { src: 'js/widgets/document-viewer.js', required: false },
    { src: 'js/widgets/url-viewer.js', required: false },
    { src: 'js/widgets/reveal-manager-widget.js', required: false },
    { src: 'js/widgets/quiz-game-widget.js', required: false },
    { src: 'js/widgets/notes-widget.js', required: false },
    { src: 'js/widgets/wellbeing-widget.js', required: false },
    { src: 'js/widgets/rich-text-widget.js', required: false },
    { src: 'js/widgets/mask-widget.js', required: false }
];

const loadProjectorDependency = async (dependency) => {
    try {
        await loadClassicScript(dependency.src, getDependencyTimeoutMs(dependency));
        return null;
    } catch (error) {
        const failure = {
            src: dependency.src,
            required: dependency.required,
            error: error.message
        };

        const logMethod = dependency.required ? 'error' : 'warn';
        console[logMethod](`[projector] dependency load failed: ${dependency.src}`, error);

        if (dependency.required) {
            throw Object.assign(new Error(`Critical projector dependency failed: ${dependency.src}`), {
                cause: error,
                failures: [failure]
            });
        }

        return failure;
    }
};

const bootstrapProjectorDependencies = async () => {
    const richTextDependency = PROJECTOR_DEPENDENCIES.find((dependency) => dependency.src.endsWith('/rich-text-widget.js'));
    const quillDependency = PROJECTOR_DEPENDENCIES.find((dependency) => dependency.src.includes('/quill@'));
    const parallelDependencies = PROJECTOR_DEPENDENCIES.filter((dependency) => dependency !== richTextDependency);
    const dependencyPromises = new Map(
        parallelDependencies.map((dependency) => [dependency, loadProjectorDependency(dependency)])
    );
    const richTextPromise = richTextDependency
        ? Promise.resolve(quillDependency ? dependencyPromises.get(quillDependency) : null)
            .then(() => loadProjectorDependency(richTextDependency))
        : null;
    const failures = (await Promise.all([
        ...dependencyPromises.values(),
        ...(richTextPromise ? [richTextPromise] : [])
    ])).filter(Boolean);

    window.__ProjectorDependencyFailures = failures;
    return failures;
};

const projectorDependencyResultPromise = bootstrapProjectorDependencies()
    .then((failures) => ({ failures, error: null }))
    .catch((error) => ({ failures: [], error }));

function showProjectorStartupMessage(message) {
    const root = document.getElementById('presentation-root');
    if (!root) {
        return;
    }

    root.innerHTML = `<div style="padding:16px;color:#fff;background:#7f1d1d;font:600 16px/1.4 Poppins,sans-serif;">${message}</div>`;
}

function prepareProjectorPresentationRoot(root) {
    if (!root) {
        return;
    }

    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.width = '100vw';
    root.style.height = '100vh';
    root.style.zIndex = '10';
    root.style.pointerEvents = 'none';
}

function clearProjectorPresentationRoot() {
    const root = document.getElementById('presentation-root');
    if (!root) {
        return;
    }

    destroyReveal(root);
    root.innerHTML = '';
    activePresentationObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    activePresentationObjectUrls.clear();
    activePresentationSourceKey = null;
    activePresentationLoadPromise = null;
}

async function hydrateStoredPresentationDeck(deck = null) {
    const storageId = typeof deck?.storageId === 'string' ? deck.storageId.trim() : '';
    const store = window.TeacherScreenDocumentStore;
    if (!storageId || !store || typeof store.loadSlideDeck !== 'function') {
        return '';
    }

    const [storedDeck, assets] = await Promise.all([
        store.loadSlideDeck(storageId),
        store.loadSlideAssets(storageId)
    ]);
    if (!storedDeck || typeof storedDeck.content !== 'string') {
        throw new Error('The imported projector deck is no longer stored on this device.');
    }

    const parsed = new DOMParser().parseFromString(storedDeck.content, 'text/html');
    const assetsById = new Map((Array.isArray(assets) ? assets : []).map((asset) => [String(asset.id), asset]));
    const nextObjectUrls = new Set();
    try {
        Array.from(parsed.body.querySelectorAll('[data-slide-asset-id]')).forEach((element) => {
            const asset = assetsById.get(String(element.getAttribute('data-slide-asset-id') || ''));
            if (!asset || !(asset.blob instanceof Blob)) {
                throw new Error('An imported projector slide image is missing.');
            }
            const objectUrl = URL.createObjectURL(asset.blob);
            nextObjectUrls.add(objectUrl);
            element.setAttribute('src', objectUrl);
            element.removeAttribute('data-slide-asset-id');
        });
    } catch (error) {
        nextObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        throw error;
    }

    activePresentationObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    activePresentationObjectUrls = nextObjectUrls;
    return parsed.body.innerHTML;
}

function getDedicatedRevealDeckState(layout = null) {
    if (!layout || !Array.isArray(layout.widgets)) {
        return null;
    }

    return layout.widgets.find((widgetData) => {
        const revealData = widgetData && typeof widgetData.data === 'object' ? widgetData.data : null;
        return (
        isDedicatedRevealProjectorWidget(widgetData)
        && widgetData.visibleOnProjector !== false
        && revealData
        && revealData.activeDeck
        && ((typeof revealData.activeDeck.content === 'string' && revealData.activeDeck.content.trim())
            || (typeof revealData.activeDeck.storageId === 'string' && revealData.activeDeck.storageId.trim()))
        );
    }) || null;
}

function syncRevealDeckFromLayout(layout = null) {
    const revealWidget = getDedicatedRevealDeckState(layout);
    if (!revealWidget) {
        clearProjectorPresentationRoot();
        return;
    }

    const revealData = revealWidget && typeof revealWidget.data === 'object' ? revealWidget.data : {};
    const indices = revealData.currentIndices && typeof revealData.currentIndices === 'object'
        ? revealData.currentIndices
        : { h: 0, v: 0 };

    const contentPromise = revealData.activeDeck.storageId
        ? hydrateStoredPresentationDeck(revealData.activeDeck)
        : Promise.resolve(revealData.activeDeck.content);
    contentPromise
        .then((content) => loadPresentationHtml(content))
        .then(() => slideRevealWhenReady(indices.h || 0, indices.v || 0))
        .catch((error) => {
            console.warn('Unable to restore Reveal deck from saved layout', error);
        });
}

function getProjectorRevealWidgets() {
    const app = window.__TeacherScreenProjectorApp;
    if (!app || typeof app.getRevealWidgets !== 'function') {
        return [];
    }

    return app.getRevealWidgets();
}

async function syncRevealWidgetsOnProjector(data = {}) {
    const widgets = getProjectorRevealWidgets();
    if (!widgets.length) {
        return false;
    }

    const nextIndices = {
        h: Number.isFinite(data.h) ? data.h : 0,
        v: Number.isFinite(data.v) ? data.v : 0
    };

    await Promise.all(widgets.map(async (widget) => {
        if (!widget) {
            return;
        }

        widget.currentIndices = nextIndices;

        const deckReference = data.deck && typeof data.deck === 'object' ? data.deck : null;
        if (deckReference && typeof widget.launchDeck === 'function') {
            const activeStorageId = String(widget.activeDeck?.storageId || '');
            const nextStorageId = String(deckReference.storageId || '');
            const needsReload = !widget.activeDeck
                || (nextStorageId && activeStorageId !== nextStorageId)
                || (!nextStorageId && Number(widget.activeDeck.id) !== Number(deckReference.id));
            if (needsReload) {
                await widget.launchDeck(deckReference, { preserveIndices: true });
                return;
            }
        } else if (data.html && typeof widget.launchDeck === 'function') {
            const nextContent = String(data.html || '');
            const needsReload = !widget.activeDeck || widget.activeDeck.content !== nextContent;

            if (needsReload) {
                await widget.launchDeck({
                    id: widget.activeDeck && widget.activeDeck.id ? widget.activeDeck.id : Date.now(),
                    name: widget.activeDeck && widget.activeDeck.name ? widget.activeDeck.name : 'Projector Deck',
                    type: 'html',
                    content: nextContent
                }, { preserveIndices: true });
                return;
            }
        }

        if (widget.restorePromise && typeof widget.restorePromise.then === 'function') {
            await widget.restorePromise;
        }

        if (typeof widget.moveDeckToStoredSlide === 'function') {
            await widget.moveDeckToStoredSlide(widget.revealDeck);
        }

        if (typeof widget.requestRevealLayout === 'function') {
            await widget.requestRevealLayout();
        }
    }));

    clearProjectorPresentationRoot();
    return true;
}

function wrapRevealPresentationHtml(html = '') {
    const normalized = String(html || '').trim();
    if (!normalized) {
        return '';
    }

    const hasRevealStructure = /class=["'][^"']*\breveal\b[^"']*["']/i.test(normalized)
        && /class=["'][^"']*\bslides\b[^"']*["']/i.test(normalized);

    if (hasRevealStructure) {
        return normalized;
    }

    const innerContent = /<\s*section\b/i.test(normalized)
        ? normalized
        : `<section>${normalized}</section>`;

    return `<div class="reveal"><div class="slides">${innerContent}</div></div>`;
}

async function loadPresentationHtml(html) {
    const wrappedHtml = wrapRevealPresentationHtml(html);
    const sourceKey = `html:${wrappedHtml}`;
    const root = document.getElementById('presentation-root');
    if (!root) {
        console.warn('Presentation root not found');
        return;
    }

    if (activePresentationLoadPromise && activePresentationSourceKey === sourceKey) {
        return activePresentationLoadPromise;
    }

    if (activePresentationSourceKey === sourceKey && getRevealDeck(root)) {
        return getRevealDeck(root);
    }

    activePresentationSourceKey = sourceKey;
    activePresentationLoadPromise = (async () => {
        destroyReveal(root);
        root.innerHTML = '';
        mountPresentationMarkup(root, wrappedHtml);
        const deck = await initializeReveal(root);
        prepareProjectorPresentationRoot(root);
        if (deck && typeof layoutReveal === 'function') {
            layoutReveal(root);
        }

        return deck;
    })();

    try {
        return await activePresentationLoadPromise;
    } finally {
        activePresentationLoadPromise = null;
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

const handleSlideSyncPayload = async (data = {}) => {
    if (!data || data.type !== 'slideSync') {
        return;
    }

    const syncedRevealWidgets = await syncRevealWidgetsOnProjector(data);
    if (syncedRevealWidgets) {
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

    if (data.deck?.storageId) {
        hydrateStoredPresentationDeck(data.deck)
            .then((content) => loadPresentationHtml(content))
            .then(() => slideRevealWhenReady(data.h, data.v))
            .catch((error) => {
                console.warn('Unable to load stored presentation deck', error);
            });
        return;
    }

    slideRevealWhenReady(data.h, data.v);
};

const initializeRevealSyncListener = () => {
    // Teacher -> Projector synchronization
    // Uses postMessage slideSync events.
    window.addEventListener('message', (event) => {
        const data = event.data;

        if (!data || data.type !== 'slideSync') return;
        if (event.origin !== window.location.origin) return;
        handleSlideSyncPayload(data);
    });
};

/**
 * Projector View Application Script
 * Loads and displays the classroom screen state in a read-only mode.
 */

const THEMES = ['theme-ocean', 'theme-professional', 'theme-light'];
const THEME_META_COLORS = {
    'theme-light': '#ffffff',
    'theme-ocean': '#0f172a',
    'theme-professional': '#111827'
};

function applyTheme(themeName) {
    const nextTheme = THEMES.includes(themeName) ? themeName : 'theme-professional';
    THEMES.forEach(theme => document.body.classList.remove(theme));
    document.body.classList.add(nextTheme);
    document.documentElement.style.colorScheme = nextTheme === 'theme-light' ? 'light' : 'dark';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', THEME_META_COLORS[nextTheme] || THEME_META_COLORS['theme-professional']);
    }
}

class ProjectorApp {
    constructor() {
        this.appContainer = document.getElementById('app-container');
        this.studentView = document.getElementById('student-view');
        this.widgetsContainer = document.getElementById('widgets-container');
        this.classroomReminderDock = document.getElementById('classroom-reminder-dock');
        this.classroomReminderList = document.getElementById('classroom-reminder-list');
        this.classroomReminderTitle = document.getElementById('classroom-reminder-title');
        this.widgets = [];
        this.isEditMode = false;
        this.lastTeacherLayoutSnapshot = null;
        this.preEditLayoutSnapshot = null;

        // Managers
        this.layoutManager = new LayoutManager(this.widgetsContainer);
        this.layoutManager.setEditable(false);

        this.backgroundManager = new BackgroundManager(this.studentView);

        this.projectorChannel = new BroadcastChannel('teacher-screen-sync');
        this.projectorSyncToken = getProjectorSyncToken();
        this.hasTeacherSync = false;
        this.widgetStateRevisions = new Map();
        this.projectorSyncRetryTimers = [];
        this.requestTeacherSync = this.requestTeacherSync.bind(this);
        this.handleVisibilitySync = this.handleVisibilitySync.bind(this);
        window.__TeacherScreenProjectorApp = this;
    }

    init() {
        this.backgroundManager.init();
        this.layoutManager.init();
        this.setupEditModeControls();

        // Listen for storage events to update in real-time
        window.addEventListener('storage', (event) => {
            if (event.key === 'selectedTheme') {
                this.loadTheme();
            }
        });

        this.projectorChannel.onmessage = (event) => {
            const message = event.data || {};
            if (!this.projectorSyncToken || message.syncToken !== this.projectorSyncToken) {
                return;
            }

            if (message.type === 'layout-update' && message.state && message.state.layout) {
                if (message.source === 'projector') {
                    return;
                }

                this.hasTeacherSync = true;
                this.clearTeacherSyncRetries();
                this.renderClassroomReminders(message.state.classReminders);
                if (this.shouldApplyTeacherLayoutUpdate(message.state.layout)) {
                    this.rebuildLayout(message.state);
                } else {
                    this.applyTeacherLayoutGeometry(message.state.layout);
                }
                this.lastTeacherLayoutSnapshot = JSON.parse(JSON.stringify(message.state.layout));
                return;
            }

            if (message.type === 'layout-delta' && message.source === 'teacher' && message.delta) {
                this.layoutManager.applyLayoutDelta(message.delta);
                return;
            }

            if (message.type === 'widget-state-update' && message.source === 'teacher') {
                this.applyWidgetStateUpdate(message);
                return;
            }

            if (message.type === 'class-reminders-sync' && message.source !== 'projector') {
                this.renderClassroomReminders(message.reminders);
                return;
            }

            if (message.type === 'timer-sync' && message.timerState) {
                if (message.source === 'projector') {
                    return;
                }
                this.applyTimerState(message.timerState);
                return;
            }

            if (message.type === 'noise-meter-sync' && message.source === 'teacher' && message.widgetId) {
                const widgetInfo = this.layoutManager.widgets.find((widget) => widget.id === message.widgetId);
                widgetInfo?.widget?.applySyncedLevel?.(message.level);
                return;
            }

            if (message.type === 'slideSync') {
                handleSlideSyncPayload(message);
            }
        };

        this.loadTheme();
        this.loadSavedState();

        document.addEventListener('visibilitychange', this.handleVisibilitySync);
        window.addEventListener('focus', this.requestTeacherSync);
        window.addEventListener('pageshow', this.requestTeacherSync);

        // Register the receiver first, then request the latest state. Retry briefly
        // in case either window is still starting up and misses the first request.
        this.requestTeacherSync();
        this.scheduleTeacherSyncRetries();
    }

    requestTeacherSync() {
        if (!this.projectorChannel || !this.projectorSyncToken) {
            return false;
        }

        this.projectorChannel.postMessage({
            type: 'request-sync',
            syncToken: this.projectorSyncToken
        });
        return true;
    }

    clearTeacherSyncRetries() {
        this.projectorSyncRetryTimers.forEach((timerId) => window.clearTimeout(timerId));
        this.projectorSyncRetryTimers = [];
    }

    scheduleTeacherSyncRetries() {
        this.clearTeacherSyncRetries();
        PROJECTOR_SYNC_RETRY_DELAYS_MS.forEach((delayMs) => {
            const timerId = window.setTimeout(() => {
                if (!this.hasTeacherSync) {
                    this.requestTeacherSync();
                }
            }, delayMs);
            this.projectorSyncRetryTimers.push(timerId);
        });
    }

    handleVisibilitySync() {
        if (!document.hidden) {
            this.requestTeacherSync();
        }
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

    formatReminderDueDate(value) {
        if (!value) return '';
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? new Date(`${value}T12:00:00`)
            : new Date(value);
        if (!Number.isFinite(date.getTime())) return '';
        return `Due ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
    }

    renderClassroomReminders(snapshot) {
        if (!this.classroomReminderDock || !this.classroomReminderList) return;
        const reminders = Array.isArray(snapshot?.reminders)
            ? snapshot.reminders
                .filter((reminder) => reminder && typeof reminder.text === 'string' && reminder.text.trim())
                .slice(0, 100)
                .sort((left, right) => {
                    if (left.completed !== right.completed) return left.completed ? 1 : -1;
                    const leftOrder = Number.isFinite(left.orderIndex) ? left.orderIndex : 0;
                    const rightOrder = Number.isFinite(right.orderIndex) ? right.orderIndex : 0;
                    return leftOrder - rightOrder;
                })
            : [];

        this.classroomReminderList.replaceChildren();
        if (reminders.length === 0) {
            this.classroomReminderDock.hidden = true;
            return;
        }

        const className = typeof snapshot?.context?.className === 'string'
            ? snapshot.context.className.trim().slice(0, 240)
            : '';
        if (this.classroomReminderTitle) {
            this.classroomReminderTitle.textContent = className ? `${className} reminders` : 'Class reminders';
        }

        reminders.forEach((reminder) => {
            const row = document.createElement('div');
            row.className = `class-reminder-row class-reminder-row--projector${reminder.completed ? ' is-complete' : ''}`;
            row.dataset.reminderId = String(reminder.id || '');

            const status = document.createElement('span');
            status.className = 'class-reminder-row__projector-status';
            status.setAttribute('aria-hidden', 'true');
            status.innerHTML = reminder.completed
                ? '<i class="fa-solid fa-circle-check"></i>'
                : '<i class="fa-regular fa-circle"></i>';

            const content = document.createElement('div');
            content.className = 'class-reminder-row__content';
            const text = document.createElement('span');
            text.className = 'class-reminder-row__text';
            text.textContent = reminder.text.trim().slice(0, 2000);
            content.appendChild(text);
            const due = this.formatReminderDueDate(reminder.dueDate);
            if (due) {
                const meta = document.createElement('span');
                meta.className = 'class-reminder-row__meta';
                meta.textContent = due;
                content.appendChild(meta);
            }
            row.append(status, content);
            this.classroomReminderList.appendChild(row);
        });
        this.classroomReminderDock.hidden = false;
    }

    shouldApplyTeacherLayoutUpdate(nextLayout) {
        if (!nextLayout || !Array.isArray(nextLayout.widgets)) {
            return false;
        }

        const currentWidgets = Array.isArray(this.layoutManager.widgets)
            ? this.layoutManager.widgets.map((info) => ({
                id: info.id,
                type: info.widget?.constructor?.name || null,
                x: info.x,
                y: info.y,
                width: info.width,
                height: info.height,
                visibleOnProjector: info.visibleOnProjector !== false,
                data: info.widget && typeof info.widget.serialize === 'function' ? info.widget.serialize() : null
            }))
            : [];

        const nextWidgets = nextLayout.widgets.map((widget) => ({
            id: widget.id || null,
            type: widget.type || null,
            x: widget.x,
            y: widget.y,
            width: widget.width,
            height: widget.height,
            visibleOnProjector: widget.visibleOnProjector !== false,
            data: widget.data ?? null
        }));

        if (currentWidgets.length !== nextWidgets.length) {
            return true;
        }

        const currentById = new Map(currentWidgets.map((widget) => [widget.id, widget]));

        for (const nextWidget of nextWidgets) {
            const currentWidget = currentById.get(nextWidget.id);
            if (!currentWidget) {
                return true;
            }

            if (currentWidget.type !== nextWidget.type) {
                return true;
            }

            if (currentWidget.visibleOnProjector !== nextWidget.visibleOnProjector) {
                return true;
            }

            const nextData = JSON.stringify(nextWidget.data ?? null);
            const currentData = JSON.stringify(currentWidget.data ?? null);
            if (nextData !== currentData) {
                return true;
            }
        }

        return false;
    }

    applyTeacherLayoutGeometry(nextLayout) {
        if (!nextLayout || !Array.isArray(nextLayout.widgets)) {
            return false;
        }

        nextLayout.widgets.forEach((widget) => {
            this.layoutManager.applyLayoutDelta({
                type: 'widget-update',
                id: widget.id,
                x: widget.x,
                y: widget.y,
                w: widget.width,
                h: widget.height
            });
        });
        this.layoutManager.applyWidgetStackOrder(nextLayout.widgets.map((widget) => widget.id));
        return true;
    }

    applyWidgetStateUpdate(message = {}) {
        const revision = Number(message.revision) || 0;
        const previousRevision = this.widgetStateRevisions.get(message.id) || 0;
        if (!message.id || revision <= previousRevision) {
            return false;
        }

        const widgetInfo = this.layoutManager.widgets.find((candidate) => candidate.id === message.id);
        if (!widgetInfo
            || widgetInfo.widget?.constructor?.name !== message.widgetType
            || typeof widgetInfo.widget?.deserialize !== 'function') {
            this.requestTeacherSync();
            return false;
        }

        try {
            widgetInfo.widget.deserialize(message.data || {});
        } catch (error) {
            console.warn('[Projector] Live widget update failed; requesting a full refresh.', error);
            this.requestTeacherSync();
            return false;
        }
        this.widgetStateRevisions.set(message.id, revision);
        this.layoutManager.scheduleWidgetLayoutHook(widgetInfo);
        return true;
    }


    setupEditModeControls() {
        this.setEditMode(false);
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
                layout: this.layoutManager.serialize(),
                syncToken: this.projectorSyncToken
            });
        }
    }

    rebuildLayout(state) {
        try {
            this.renderClassroomReminders(state.classReminders);
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
                clearProjectorPresentationRoot();

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
            } else {
                clearProjectorPresentationRoot();
            }

            this.applyTimerStates(state.timerStates);
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
        this.clearTeacherSyncRetries();
        document.removeEventListener('visibilitychange', this.handleVisibilitySync);
        window.removeEventListener('focus', this.requestTeacherSync);
        window.removeEventListener('pageshow', this.requestTeacherSync);
        if (this.projectorChannel && typeof this.projectorChannel.close === 'function') {
            this.projectorChannel.close();
        }
        if (this.revealSync && this.revealSync.channel && typeof this.revealSync.channel.close === 'function') {
            this.revealSync.channel.close();
        }
    }

    applyTimerStates(timerStates = []) {
        if (!Array.isArray(timerStates) || !timerStates.length) {
            return;
        }

        timerStates.forEach((timerState) => this.applyTimerState(timerState));
    }

    applyTimerState(timerState = {}) {
        if (!timerState || typeof timerState !== 'object') {
            return;
        }

        const targetWidget = this.widgets.find((widget) => {
            if (!widget || typeof widget.applySyncedState !== 'function') {
                return false;
            }

            if (timerState.widgetId && widget.widgetId) {
                return widget.widgetId === timerState.widgetId;
            }

            return true;
        });

        if (!targetWidget || typeof targetWidget.applySyncedState !== 'function') {
            return;
        }

        targetWidget.applySyncedState(timerState);
    }

    getRevealWidgets() {
        return this.widgets.filter((widget) => widget && widget.constructor && widget.constructor.name === 'RevealManagerWidget');
    }

}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { failures, error: dependencyError } = await projectorDependencyResultPromise;
        if (dependencyError) {
            throw dependencyError;
        }

        if (failures.length > 0) {
            console.warn('[projector] continuing with optional dependency failures', failures);
        }

        initializeRevealSyncListener();

        if (typeof LayoutManager !== 'function' || typeof BackgroundManager !== 'function') {
            showProjectorStartupMessage('Projector failed to start because core layout files did not load.');
            return;
        }

        const app = new ProjectorApp();
        app.init();
        startPresentationDiagnostics();
    } catch (error) {
        console.error('[projector] startup failed', error);
        showProjectorStartupMessage('Projector startup failed. Check the browser console for dependency errors.');
    }
});
