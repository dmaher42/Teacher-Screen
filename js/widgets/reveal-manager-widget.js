const eventBus = window.TeacherScreenEventBus ? window.TeacherScreenEventBus.eventBus : null;

/**
 * RevealManagerWidget
 * Manages Reveal deck sources from URL or raw HTML and renders them in a persistent iframe.
 */
class RevealManagerWidget {
    static activeInstance = null;
    static keyboardHandlerInitialized = false;
    static projectorSyncForwarderInitialized = false;

    constructor() {
        this.layoutType = 'grid';
        this.storageKey = 'revealDecks';
        this.activeDeck = null;
        this.presentationMode = false;
        this.isCompact = true;
        this.presenterWindow = null;
        this.presenterWindowMonitor = null;
        const appModeUtils = window.TeacherScreenAppMode || {};
        this.appMode = appModeUtils.APP_MODE || 'teacher';
        this.isTeacherMode = appModeUtils.isTeacherMode || (() => this.appMode === 'teacher');
        this.isProjectorMode = appModeUtils.isProjectorMode || (() => this.appMode === 'projector');
        this.isProjectorView = this.isProjectorMode();
        this.slideChangeHandlerAttached = false;
        this.revealDeck = null;
        this.projectorWindow = null;
        this.globalSlideSyncAttached = false;

        this.element = document.createElement('div');
        this.element.className = 'reveal-manager-widget-content reveal-manager--compact';
        this.element.tabIndex = 0;

        const modeGroupName = `reveal-input-mode-${Date.now()}`;

        // DOM structure: flex column manager with compact topbar and collapsible advanced panel.
        // toggleCompact(false) shows the full controls panel while preserving deck storage keys.
        this.element.innerHTML = `
            <div class="reveal-manager">
                <div class="reveal-manager__topbar">
                    <button type="button" class="control-button reveal-btn reveal-btn-primary reveal-launch-btn" title="Launch current deck">Open</button>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-projector-btn" title="Open projector window">Start Projector</button>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-presentation-toggle-btn" title="Toggle presentation mode">Enter Presentation Mode</button>
                    <button type="button" id="presentation-prev" class="control-button reveal-btn reveal-btn-secondary" title="Previous slide">Prev</button>
                    <button type="button" id="presentation-next" class="control-button reveal-btn reveal-btn-secondary" title="Next slide">Next</button>
                    <span class="reveal-presenter-status" role="status" aria-live="polite" hidden></span>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-toggle-controls-btn" aria-label="Toggle full controls" title="Show full controls">⋯</button>
                </div>

            <div class="reveal-manager__panel advanced-controls" hidden>
                <details class="reveal-manager__section" open>
                    <summary>Source</summary>
                    <div class="reveal-manager-row">
                    <label>
                        <input type="radio" name="${modeGroupName}" value="url" checked>
                        URL
                    </label>
                    <label>
                        <input type="radio" name="${modeGroupName}" value="html">
                        HTML
                    </label>
                </div>
                <div class="reveal-manager-row">
                    <input type="text" class="reveal-deck-name" placeholder="Deck name">
                </div>
                <div class="reveal-manager-row reveal-url-row">
                    <input type="text" class="reveal-content-input" placeholder="https://your-reveal-deck-url">
                </div>
                <div class="reveal-manager-row reveal-html-row" style="display:none;">
                    <textarea class="reveal-content-textarea" placeholder="Paste full Reveal HTML here"></textarea>
                    </div>
                    <div class="reveal-manager-row reveal-manager-actions">
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-save-btn">Save Deck</button>
                    </div>
                </details>

                <details class="reveal-manager__section" open>
                    <summary>Library</summary>
                    <div class="reveal-manager-row">
                        <select class="reveal-saved-select">
                            <option value="">Select saved deck</option>
                        </select>
                        <button type="button" class="control-button reveal-btn reveal-btn-primary reveal-launch-saved-btn">Launch Saved</button>
                    </div>
                    <div class="reveal-manager-row reveal-manager-actions">
                        <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-rename-btn">Rename</button>
                        <button type="button" class="control-button reveal-btn reveal-btn-danger reveal-delete-btn">Delete</button>
                    </div>
                </details>

            </div>

                <div class="reveal-manager__stage">
                    <div class="reveal-container">
                    <div class="reveal-manager-frame-wrap"></div>
                    </div>
                </div>
            </div>
        `;

        this.modeRadios = Array.from(this.element.querySelectorAll('input[type="radio"]'));
        this.deckNameInput = this.element.querySelector('.reveal-deck-name');
        this.urlRow = this.element.querySelector('.reveal-url-row');
        this.htmlRow = this.element.querySelector('.reveal-html-row');
        this.urlInput = this.element.querySelector('.reveal-content-input');
        this.htmlInput = this.element.querySelector('.reveal-content-textarea');
        this.saveButton = this.element.querySelector('.reveal-save-btn');
        this.launchButton = this.element.querySelector('.reveal-launch-btn');
        this.savedSelect = this.element.querySelector('.reveal-saved-select');
        this.launchSavedButton = this.element.querySelector('.reveal-launch-saved-btn');
        this.renameButton = this.element.querySelector('.reveal-rename-btn');
        this.deleteButton = this.element.querySelector('.reveal-delete-btn');
        this.presentationToggleButton = this.element.querySelector('.reveal-presentation-toggle-btn');
        this.projectorButton = this.element.querySelector('.reveal-projector-btn');
        this.prevButton = this.element.querySelector('#presentation-prev');
        this.nextButton = this.element.querySelector('#presentation-next');
        this.toggleControlsButton = this.element.querySelector('.reveal-toggle-controls-btn');
        this.panelContainer = this.element.querySelector('.reveal-manager__panel');
        this.topbar = this.element.querySelector('.reveal-manager__topbar');
        this.revealContainer = this.element.querySelector('.reveal-container');
        this.frameWrap = this.element.querySelector('.reveal-manager-frame-wrap');
        this.presenterStatus = this.element.querySelector('.reveal-presenter-status');

        // Keep a stable iframe reference for toolbar navigation, similar to React's useRef.
        this.iframeRef = { current: null };

        this.iframe = document.createElement('iframe');
        this.iframe.className = 'reveal-frame';
        this.iframe.title = 'Reveal deck frame';
        this.iframe.setAttribute('referrerpolicy', 'no-referrer');
        this.frameWrap.appendChild(this.iframe);
        this.iframeRef.current = this.iframe;

        this.inlineDeckContainer = document.createElement('div');
        this.inlineDeckContainer.className = 'reveal-inline-deck';
        this.inlineDeckContainer.style.display = 'none';
        this.inlineDeckContainer.style.width = '100%';
        this.inlineDeckContainer.style.height = '100%';
        this.frameWrap.appendChild(this.inlineDeckContainer);

        this.resizeObserver = null;
        this.revealResizeObserver = null;
        this.positionObserver = null;
        this.layoutObserverInterval = null;
        this.layoutTimeout = null;

        this.handleModeChange = this.handleModeChange.bind(this);
        this.handleSaveDeck = this.handleSaveDeck.bind(this);
        this.handleLaunchFromInputs = this.handleLaunchFromInputs.bind(this);
        this.handleLaunchSaved = this.handleLaunchSaved.bind(this);
        this.handleRenameDeck = this.handleRenameDeck.bind(this);
        this.handleDeleteDeck = this.handleDeleteDeck.bind(this);
        this.handlePresentationToggle = this.handlePresentationToggle.bind(this);
        this.handleToggleControls = this.handleToggleControls.bind(this);
        this.handleRootInteraction = this.handleRootInteraction.bind(this);
        this.handleWindowMessage = this.handleWindowMessage.bind(this);
        this.handleIframeLoad = this.handleIframeLoad.bind(this);
        this.handlePrevClick = this.handlePrevClick.bind(this);
        this.handleNextClick = this.handleNextClick.bind(this);
        this.openProjector = this.openProjector.bind(this);

        this.modeRadios.forEach((radio) => radio.addEventListener('change', this.handleModeChange));
        this.saveButton.addEventListener('click', this.handleSaveDeck);
        this.launchButton.addEventListener('click', this.handleLaunchFromInputs);
        this.launchSavedButton.addEventListener('click', this.handleLaunchSaved);
        this.renameButton.addEventListener('click', this.handleRenameDeck);
        this.deleteButton.addEventListener('click', this.handleDeleteDeck);
        this.presentationToggleButton.addEventListener('click', this.handlePresentationToggle);
        this.projectorButton.addEventListener('click', this.openProjector);
        this.prevButton.addEventListener('click', this.handlePrevClick);
        this.nextButton.addEventListener('click', this.handleNextClick);
        this.toggleControlsButton.addEventListener('click', this.handleToggleControls);
        this.element.addEventListener('click', this.handleRootInteraction);
        this.element.addEventListener('focusin', this.handleRootInteraction);
        window.addEventListener('message', this.handleWindowMessage);
        this.iframe.addEventListener('load', this.handleIframeLoad);


        RevealManagerWidget.initKeyboardHandler();

        this.renderSavedDeckOptions();
        this.updateModeUI();
        this.toggleCompact(true);
        this.updatePresentationUI();
        this.initLayoutObservers();

        this.setupRevealSync();

        if (this.isProjectorMode()) {
            this.layoutType = 'grid';
            this.setProjectorControlsHidden(true);
        } else {
            this.layoutType = 'grid';
        }
    }

    setProjectorControlsHidden(hidden) {
        if (!this.topbar || !this.panelContainer) return;

        this.topbar.style.display = hidden ? 'none' : '';
        this.panelContainer.style.display = hidden ? 'none' : '';
    }

    static initKeyboardHandler() {
        if (RevealManagerWidget.keyboardHandlerInitialized) return;

        document.addEventListener('keydown', (event) => {
            const active = RevealManagerWidget.activeInstance;
            if (!active) return;

            const directionMap = {
                ArrowLeft: 'prev',
                ArrowRight: 'next',
                ArrowUp: 'up',
                ArrowDown: 'down'
            };
            const direction = directionMap[event.key];
            if (!direction) return;

            event.preventDefault();
            active.sendKeyToIframe(direction);
        });

        RevealManagerWidget.keyboardHandlerInitialized = true;
    }

    handleRootInteraction() {
        RevealManagerWidget.activeInstance = this;

        if (this.activeDeck && this.activeDeck.type === 'html') {
            import('../utils/reveal-manager.js').then(({ activateReveal }) => {
                activateReveal(this.inlineDeckContainer);
            });
        }
    }

    setupRevealSync() {
        if (RevealManagerWidget.projectorSyncForwarderInitialized || !this.isTeacherMode()) return;

        import('../utils/presentation-controller.js')
            .then(({ registerPresentationAppBusHandlers }) => {
                registerPresentationAppBusHandlers();
            })
            .catch((error) => {
                console.warn('[RevealSync] unable to register AppBus handlers', error);
            });

        RevealManagerWidget.projectorSyncForwarderInitialized = true;
    }

    handleIframeLoad() {
        this.slideChangeHandlerAttached = false;
        this.revealDeck = null;
        this.bindSlideChangeListener();
    }

    bindSlideChangeListener() {
        const deck = this.getActiveRevealApi();
        if (!deck || typeof deck.on !== 'function' || this.slideChangeHandlerAttached) return;

        deck.on('ready', (event) => {
            const payload = this.broadcastSlideSync(event);
            if (!payload) return;
            console.log('[RevealSync] teacher initial broadcast', payload.h, payload.v);
        });

        if (window.Reveal && typeof Reveal.on === 'function' && !this.globalSlideSyncAttached) {
            Reveal.on('slidechanged', (event) => {
                const payload = this.broadcastSlideSync(event);
                if (!payload) return;
                console.log('[RevealSync] teacher broadcast', payload.h, payload.v);
            });
            this.globalSlideSyncAttached = true;
        }
        this.slideChangeHandlerAttached = true;
    }

    broadcastSlideSync(event = null) {
        if (!this.isTeacherMode()) return null;

        const deck = this.getActiveRevealApi();
        const indices = !event && deck && typeof deck.getIndices === 'function'
            ? deck.getIndices()
            : null;

        const payload = {
            type: 'slideSync',
            h: event && typeof event.indexh === 'number' ? event.indexh : (indices?.h || 0),
            v: event && typeof event.indexv === 'number' ? event.indexv : (indices?.v || 0)
        };

        if (this.activeDeck && this.activeDeck.type === 'url') {
            payload.url = this.activeDeck.content;
        }

        if (this.activeDeck && this.activeDeck.type === 'html') {
            payload.html = this.activeDeck.content;
        }

        if (this.projectorWindow && !this.projectorWindow.closed) {
            this.projectorWindow.postMessage(payload, '*');
        }

        window.postMessage(payload, '*');
        return payload;
    }

    openProjector() {
        const projectorUrl = new URL('projector.html', window.location.href);
        this.projectorWindow = window.open(
            projectorUrl.toString(),
            'projector',
            'fullscreen=yes'
        );

        if (this.projectorWindow) {
            window.setTimeout(() => this.broadcastSlideSync(), 500);
            window.setTimeout(() => this.broadcastSlideSync(), 1500);
        }
    }

    toggleCompact(compact) {
        this.isCompact = compact;
        this.element.classList.toggle('reveal-manager--compact', compact);
        this.panelContainer.hidden = compact;
        this.toggleControlsButton.textContent = compact ? '⋯' : 'Close';
        this.toggleControlsButton.title = compact ? 'Show full controls' : 'Hide full controls';
    }

    handleToggleControls(event) {
        event.stopPropagation();
        this.toggleCompact(!this.isCompact);
        this.requestRevealLayout();
    }

    getCurrentMode() {
        const selected = this.modeRadios.find((radio) => radio.checked);
        return selected ? selected.value : 'url';
    }

    setMode(mode) {
        this.modeRadios.forEach((radio) => {
            radio.checked = radio.value === mode;
        });
        this.updateModeUI();
    }

    updateModeUI() {
        const mode = this.getCurrentMode();
        this.urlRow.style.display = mode === 'url' ? '' : 'none';
        this.htmlRow.style.display = mode === 'html' ? '' : 'none';
    }

    handleModeChange() {
        this.updateModeUI();
    }

    getSavedDecks() {
        try {
            const parsed = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Unable to parse saved reveal decks:', error);
            return [];
        }
    }

    saveDecks(decks) {
        localStorage.setItem(this.storageKey, JSON.stringify(decks));
    }

    renderSavedDeckOptions() {
        const decks = this.getSavedDecks();
        const previousValue = this.savedSelect.value;

        this.savedSelect.innerHTML = '<option value="">Select saved deck</option>';

        decks.forEach((deck) => {
            const option = document.createElement('option');
            option.value = String(deck.id);
            const isActive = this.activeDeck && this.activeDeck.id === deck.id;
            option.textContent = `${isActive ? '● ' : ''}${deck.name} (${deck.type.toUpperCase()})`;
            this.savedSelect.appendChild(option);
        });

        if (previousValue) {
            this.savedSelect.value = previousValue;
        }
    }

    initLayoutObservers() {
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => {
                this.requestRevealLayout();
            });
            this.resizeObserver.observe(this.element);
        }

        const attachPositionObserver = () => {
            const widgetShell = this.element.parentElement;
            if (!widgetShell) return false;

            this.positionObserver = new MutationObserver(() => {
                this.requestRevealLayout();
            });
            this.positionObserver.observe(widgetShell, { attributes: true, attributeFilter: ['style'] });
            return true;
        };

        if (!attachPositionObserver()) {
            this.layoutObserverInterval = window.setInterval(() => {
                if (attachPositionObserver()) {
                    clearInterval(this.layoutObserverInterval);
                    this.layoutObserverInterval = null;
                }
            }, 300);
        }
    }

    requestRevealLayout() {
        if (!this.activeDeck) return;

        if (this.activeDeck.type === 'html') {
            clearTimeout(this.layoutTimeout);

            this.layoutTimeout = setTimeout(async () => {
                try {
                    const module = await import('../utils/reveal-manager.js');

                    if (typeof module.layoutReveal === 'function') {
                        module.layoutReveal(this.inlineDeckContainer);
                    } else {
                        console.warn('[Reveal] layoutReveal not available');
                    }
                } catch (error) {
                    console.warn('[Reveal] unable to layout presentation', error);
                }
            }, 120);
            return;
        }

        const frameWindow = this.iframeRef.current?.contentWindow;
        const reveal = frameWindow && frameWindow.Reveal;
        if (reveal && typeof reveal.layout === 'function') {
            reveal.layout();
        }
    }

    getActiveRevealApi() {
        if (this.activeDeck && this.activeDeck.type === 'html') {
            return this.revealDeck || this.inlineDeckContainer.__teacherScreenRevealDeck || null;
        }

        const frameWindow = this.iframeRef.current?.contentWindow;
        if (!frameWindow) return null;

        return frameWindow.Reveal && typeof frameWindow.Reveal.on === 'function'
            ? frameWindow.Reveal
            : null;
    }

    loadPresentation(container, html) {
        import('../utils/reveal-manager.js')
            .then(({ destroyReveal, initializeReveal, mountPresentationMarkup }) => {
                destroyReveal(container);
                this.revealDeck = null;
                this.slideChangeHandlerAttached = false;
                mountPresentationMarkup(container, html);
                return initializeReveal(container);
            })
            .then((deck) => {
                if (!deck) return;

                this.revealDeck = deck;
                container.__teacherScreenRevealDeck = deck;

                if (this.revealResizeObserver) {
                    this.revealResizeObserver.disconnect();
                }
                if (typeof ResizeObserver === 'function') {
                    this.revealResizeObserver = new ResizeObserver(() => {
                        this.requestRevealLayout();
                    });
                    this.revealResizeObserver.observe(this.inlineDeckContainer);
                }

                this.revealDeckContainer = container;
                this.bindSlideChangeListener();
                this.requestRevealLayout();
            })
            .catch((error) => {
                console.warn('[Reveal] unable to initialize presentation', error);
            });
    }

    resetInlineRevealState() {
        this.revealDeck = null;
        this.revealDeckContainer = null;
        this.slideChangeHandlerAttached = false;
        if (this.inlineDeckContainer) {
            this.inlineDeckContainer.__teacherScreenRevealDeck = null;
        }

        import('../utils/reveal-manager.js')
            .then(({ destroyReveal }) => {
                destroyReveal(this.inlineDeckContainer);
            })
            .catch((error) => {
                console.warn('[Reveal] unable to reset presentation', error);
            });
    }

    persistActiveDeckState() {
        if (!eventBus || typeof eventBus.emit !== 'function') {
            return;
        }

        eventBus.emit('layout:updated', {
            source: this.isProjectorMode() ? 'projector' : 'teacher',
            payload: { type: 'widget-config', widget: 'reveal-manager' }
        });
    }

    buildDeckFromInputs() {
        const type = this.getCurrentMode();
        const rawContent = type === 'url' ? this.urlInput.value.trim() : this.htmlInput.value;
        const content = type === 'html' ? this.normalizeHtmlDeckContent(rawContent) : rawContent;

        if (!content.trim()) {
            return null;
        }

        return {
            id: Date.now(),
            name: (this.deckNameInput.value || 'Untitled Deck').trim(),
            type,
            content
        };
    }

    normalizeHtmlDeckContent(content) {
        if (typeof content !== 'string' || !content) {
            return '';
        }

        let normalized = content.trim();

        if (normalized.startsWith('"') && normalized.endsWith('"')) {
            try {
                const parsed = JSON.parse(normalized);
                if (typeof parsed === 'string') {
                    normalized = parsed;
                }
            } catch (error) {
                // Fall back to manual unescaping below.
            }
        }

        return normalized
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, '\'')
            .replace(/\\\//g, '/');
    }

    ensureRevealInitScript(html) {
        if (!html || typeof html !== 'string') return html;
        if (html.includes('teacher-screen-reveal-init')) return html;

        const revealBootstrapScript = `
<script id="teacher-screen-reveal-init">
(function () {
    function initReveal() {
        const revealEl = document.querySelector('.reveal');
        if (!revealEl) {
            console.warn('[Reveal] container not found');
            return false;
        }

        if (!window.Reveal || typeof window.Reveal.initialize !== 'function') {
            console.warn('[Reveal] library not loaded');
            return false;
        }

        if (window.__teacherScreenRevealInitialized) {
            console.warn('[Reveal] already initialized — skipping');
            return true;
        }

        if (typeof window.Reveal.isReady === 'function' && !window.Reveal.isReady()) {
            window.__teacherScreenRevealInitialized = true;
            window.Reveal.initialize({
                embedded: true,
                keyboard: false,
                hash: false,
                slideNumber: false,
                controls: false,
                progress: true
            });
            console.log('[Reveal] deck initialized');
            return true;
        }

        if (typeof window.Reveal.sync === 'function') {
            window.Reveal.sync();
        }
        window.__teacherScreenRevealInitialized = true;
        console.log('[Reveal] deck initialized');
        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initReveal);
    } else {
        initReveal();
    }

    window.addEventListener('resize', function () {
        if (window.Reveal && typeof window.Reveal.layout === 'function') {
            window.Reveal.layout();
        }
    });
})();
</script>`;

        const revealAssets = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js/dist/theme/black.css">
<script src="https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.js"></script>`;

        let nextHtml = html;

        if (nextHtml.includes('</head>')) {
            nextHtml = nextHtml.replace('</head>', `${revealAssets}
</head>`);
        } else {
            nextHtml = `${revealAssets}
${nextHtml}`;
        }

        if (nextHtml.includes('</body>')) {
            return nextHtml.replace('</body>', `${revealBootstrapScript}
</body>`);
        }

        return `${nextHtml}
${revealBootstrapScript}`;
    }

    launchDeck(deck) {
        if (!deck) return;

        const content = deck.type === 'html'
            ? this.normalizeHtmlDeckContent(deck.content)
            : deck.content;

        this.activeDeck = {
            id: deck.id,
            name: deck.name,
            type: deck.type,
            content
        };

        if (deck.type === 'url') {
            this.inlineDeckContainer.innerHTML = '';
            this.inlineDeckContainer.style.display = 'none';
            this.iframe.style.display = '';
            this.iframe.removeAttribute('srcdoc');
            this.iframe.src = content;
        } else {
            this.iframe.removeAttribute('src');
            this.iframe.srcdoc = '';
            this.iframe.style.display = 'none';
            this.inlineDeckContainer.style.display = '';

            const hasRevealStructure = /class=["']reveal["']/.test(content) && /class=["']slides["']/.test(content);
            const revealHtml = hasRevealStructure
                ? content
                : `<div class="reveal"><div class="slides"><section>${content}</section></div></div>`;
            this.loadPresentation(this.inlineDeckContainer, revealHtml);
        }

        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
        this.launchButton.textContent = 'Stop';
        this.sendDeckToPresenter();
        this.bindSlideChangeListener();
        this.persistActiveDeckState();
    }

    stopDeck() {
        this.activeDeck = null;
        this.resetInlineRevealState();
        this.savedSelect.value = '';
        this.iframe.removeAttribute('src');
        this.iframe.srcdoc = '';
        this.iframe.style.display = '';
        this.inlineDeckContainer.innerHTML = '';
        this.inlineDeckContainer.style.display = 'none';
        this.launchButton.textContent = 'Open';
        this.setPresenterStatus(this.presenterWindow ? 'Presenter connected' : '');
        this.emitPresentationNavigation('presentation:stop');
        this.persistActiveDeckState();
    }

    sendKeyToIframe(direction) {
        const reveal = this.getActiveRevealApi();

        if (this.activeDeck && this.activeDeck.type === 'html' && reveal) {
            const actionMap = {
                next: 'next',
                prev: 'prev',
                up: 'up',
                down: 'down'
            };
            const action = actionMap[direction];
            if (action && typeof reveal[action] === 'function') {
                reveal[action]();
            }
        } else {
            const frame = this.iframeRef.current;
            if (!frame || !frame.contentWindow) return;

            // Reveal deck pages loaded in the iframe must listen for this event:
            // window.addEventListener("message", function(event) {
            //   if (event.data.type === "reveal-nav") {
            //     if (event.data.direction === "next") Reveal.next();
            //     if (event.data.direction === "prev") Reveal.prev();
            //     if (event.data.direction === "up") Reveal.up();
            //     if (event.data.direction === "down") Reveal.down();
            //   }
            // });
            frame.contentWindow.postMessage({ type: 'reveal-nav', direction }, '*');
        }

        this.sendNavToPresenter(direction);

    }


    emitPresentationNavigation(eventName) {
        const appBus = window.TeacherScreenAppBus ? window.TeacherScreenAppBus.appBus : null;
        if (!appBus || typeof appBus.emit !== 'function') return;
        appBus.emit(eventName);
    }

    handlePrevClick(event) {
        event.stopPropagation();
        console.log('[RevealSync] teacher prev slide');
        if (this.activeDeck && this.activeDeck.type === 'html') {
            this.emitPresentationNavigation('presentation:prev');
            import('../utils/reveal-manager.js').then(({ activateReveal, getRevealDeck }) => {
                activateReveal(this.inlineDeckContainer);
                const deck = getRevealDeck(this.inlineDeckContainer) || this.revealDeck;
                if (deck && typeof deck.prev === 'function') {
                    deck.prev();
                }
            });
        } else {
            this.emitPresentationNavigation('presentation:prev');
            this.sendKeyToIframe('prev');
        }
    }

    handleNextClick(event) {
        event.stopPropagation();
        console.log('[RevealSync] teacher next slide');
        if (this.activeDeck && this.activeDeck.type === 'html') {
            this.emitPresentationNavigation('presentation:next');
            import('../utils/reveal-manager.js').then(({ activateReveal, getRevealDeck }) => {
                activateReveal(this.inlineDeckContainer);
                const deck = getRevealDeck(this.inlineDeckContainer) || this.revealDeck;
                if (deck && typeof deck.next === 'function') {
                    deck.next();
                }
            });
        } else {
            this.emitPresentationNavigation('presentation:next');
            this.sendKeyToIframe('next');
        }
    }

    sendNavToPresenter(direction) {
        if (!this.presenterWindow) return;

        if (this.presenterWindow.closed) {
            this.markPresenterClosed();
            return;
        }

        this.presenterWindow.postMessage({ type: 'reveal-nav', direction }, window.location.origin);
    }

    handleInternalRevealNavigate(payload = {}) {
        if (!payload || !payload.direction || this.isProjectorView) return;
        this.navigate(payload.direction);
    }

    sendDeckToPresenter() {
        if (!this.presenterWindow || !this.activeDeck) return;

        if (this.presenterWindow.closed) {
            this.markPresenterClosed();
            return;
        }

        const presenterDeck = this.activeDeck.type === 'html'
            ? { ...this.activeDeck, content: this.ensureRevealInitScript(this.activeDeck.content) }
            : this.activeDeck;

        this.presenterWindow.postMessage(
            {
                type: 'reveal-presenter-load',
                deck: presenterDeck
            },
            window.location.origin
        );
    }

    setPresenterStatus(text) {
        if (!this.presenterStatus) return;
        this.presenterStatus.textContent = text || '';
        this.presenterStatus.hidden = !text;
    }

    markPresenterClosed() {
        this.presenterWindow = null;
        if (this.presenterWindowMonitor) {
            clearInterval(this.presenterWindowMonitor);
            this.presenterWindowMonitor = null;
        }

        this.setPresenterStatus('Presenter closed');
    }

    handleLaunchFromInputs() {
        if (this.activeDeck) {
            this.stopDeck();
            return;
        }

        const deck = this.buildDeckFromInputs();
        if (!deck) return;
        this.launchDeck(deck);
    }

    handleSaveDeck() {
        const deck = this.buildDeckFromInputs();
        if (!deck) return;

        const decks = this.getSavedDecks();
        decks.push(deck);
        this.saveDecks(decks);
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
    }

    handleLaunchSaved() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) return;

        const deck = this.getSavedDecks().find((item) => item.id === selectedId);
        if (!deck) return;

        this.setMode(deck.type);
        this.deckNameInput.value = deck.name;
        if (deck.type === 'url') {
            this.urlInput.value = deck.content;
        } else {
            this.htmlInput.value = deck.content;
        }

        this.launchDeck(deck);
    }

    handleRenameDeck() {
        const selectedId = Number(this.savedSelect.value);
        const nextName = this.deckNameInput.value.trim();
        if (!selectedId || !nextName) return;

        const decks = this.getSavedDecks();
        const deckToRename = decks.find((item) => item.id === selectedId);
        if (!deckToRename) return;

        deckToRename.name = nextName;
        this.saveDecks(decks);

        if (this.activeDeck && this.activeDeck.id === selectedId) {
            this.activeDeck.name = nextName;
        }

        this.renderSavedDeckOptions();
        this.savedSelect.value = String(selectedId);
    }

    handleDeleteDeck() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) return;

        const decks = this.getSavedDecks();
        const nextDecks = decks.filter((item) => item.id !== selectedId);
        this.saveDecks(nextDecks);

        if (this.activeDeck && this.activeDeck.id === selectedId) {
            this.stopDeck();
        }

        this.renderSavedDeckOptions();
        this.savedSelect.value = '';
    }

    handlePresentationToggle() {
        if (!this.activeDeck) {
            this.setPresenterStatus('Open a deck first');
            return;
        }

        const presenterUrl = new URL('reveal-presenter.html', window.location.href);
        this.presenterWindow = window.open(presenterUrl.toString(), 'reveal-presenter-window');

        if (!this.presenterWindow) {
            this.setPresenterStatus('Unable to open presenter');
            return;
        }

        this.setPresenterStatus('Presenter opening...');
        this.emitPresentationNavigation('presentation:start');
        if (this.presenterWindowMonitor) {
            clearInterval(this.presenterWindowMonitor);
        }
        this.presenterWindowMonitor = window.setInterval(() => {
            if (this.presenterWindow && this.presenterWindow.closed) {
                this.markPresenterClosed();
            }
        }, 1000);

        this.sendDeckToPresenter();
        this.bindSlideChangeListener();
    }

    updatePresentationUI() {
        this.element.classList.toggle('presentation-mode', this.presentationMode);
        this.revealContainer.classList.toggle('presentation', this.presentationMode);

        if (this.presentationMode) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }

        this.presentationToggleButton.textContent = 'Enter Presentation Mode';
    }

    handleWindowMessage(event) {
        if (event.origin !== window.location.origin || !event.data) return;

        if (event.data.type === 'reveal-presenter-ready') {
            this.setPresenterStatus('Presenter connected');
            this.sendDeckToPresenter();
            this.bindSlideChangeListener();
        }

        if (event.data.type === 'reveal-presenter-closed') {
            this.markPresenterClosed();
        }
    }

    serialize() {
        return {
            type: 'RevealManagerWidget',
            activeDeck: this.activeDeck
        };
    }

    deserialize(data) {
        if (!data || !data.activeDeck) return;

        const deck = data.activeDeck;
        this.setMode(deck.type || 'url');
        this.deckNameInput.value = deck.name || '';

        if (deck.type === 'html') {
            this.htmlInput.value = this.normalizeHtmlDeckContent(deck.content || '');
        } else {
            this.urlInput.value = deck.content || '';
        }

        this.launchDeck(deck);
    }

    toggleHelp() {
        // No help text defined for this widget yet.
    }

    setEditable() {}

    remove() {
        document.body.style.overflow = 'auto';

        this.modeRadios.forEach((radio) => radio.removeEventListener('change', this.handleModeChange));
        this.saveButton.removeEventListener('click', this.handleSaveDeck);
        this.launchButton.removeEventListener('click', this.handleLaunchFromInputs);
        this.launchSavedButton.removeEventListener('click', this.handleLaunchSaved);
        this.renameButton.removeEventListener('click', this.handleRenameDeck);
        this.deleteButton.removeEventListener('click', this.handleDeleteDeck);
        this.presentationToggleButton.removeEventListener('click', this.handlePresentationToggle);
        this.projectorButton.removeEventListener('click', this.openProjector);
        this.prevButton.removeEventListener('click', this.handlePrevClick);
        this.nextButton.removeEventListener('click', this.handleNextClick);
        this.toggleControlsButton.removeEventListener('click', this.handleToggleControls);
        this.element.removeEventListener('click', this.handleRootInteraction);
        this.element.removeEventListener('focusin', this.handleRootInteraction);
        window.removeEventListener('message', this.handleWindowMessage);
        this.iframe.removeEventListener('load', this.handleIframeLoad);

        if (this.layoutObserverInterval) {
            clearInterval(this.layoutObserverInterval);
            this.layoutObserverInterval = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.revealResizeObserver) {
            this.revealResizeObserver.disconnect();
            this.revealResizeObserver = null;
        }
        if (this.positionObserver) {
            this.positionObserver.disconnect();
            this.positionObserver = null;
        }
        if (this.layoutTimeout) {
            clearTimeout(this.layoutTimeout);
            this.layoutTimeout = null;
        }

        if (this.presenterWindowMonitor) {
            clearInterval(this.presenterWindowMonitor);
            this.presenterWindowMonitor = null;
        }

        if (this.revealDeck && typeof this.revealDeck.destroy === 'function') {
            try {
                this.revealDeck.destroy();
            } catch (err) {
                console.warn('Reveal destroy failed', err);
            }
        }

        eventBus.emit('widget:removed', {
            id: this.id,
            type: 'reveal'
        });

        if (RevealManagerWidget.activeInstance === this) {
            RevealManagerWidget.activeInstance = null;
        }
        this.element.remove();

        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }
}

if (typeof window !== 'undefined') {
    window.RevealManagerWidget = RevealManagerWidget;
}
