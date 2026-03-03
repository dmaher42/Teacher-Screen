const revealWidgetAppBus = window.TeacherScreenAppBus ? window.TeacherScreenAppBus.appBus : null;
const revealWidgetIsTeacherMode = window.TeacherScreenAppMode ? window.TeacherScreenAppMode.isTeacherMode : () => true;
const revealWidgetIsProjectorMode = window.TeacherScreenAppMode ? window.TeacherScreenAppMode.isProjectorMode : () => false;

/**
 * RevealManagerWidget
 * Manages Reveal deck sources from URL or raw HTML and renders them in a persistent iframe.
 */
class RevealManagerWidget {
    static activeInstance = null;
    static keyboardHandlerInitialized = false;

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

        this.element = document.createElement('div');
        this.element.className = 'reveal-manager-widget-content reveal-manager--compact';
        this.element.tabIndex = 0;

        const modeGroupName = `reveal-input-mode-${Date.now()}`;

        // DOM structure: flex column manager with compact topbar, collapsible advanced panel, and stage overlay nav.
        // toggleCompact(false) shows the full controls panel while preserving deck storage keys.
        this.element.innerHTML = `
            <div class="reveal-manager">
                <div class="reveal-manager__topbar">
                    <button type="button" class="control-button reveal-btn reveal-btn-primary reveal-launch-btn" title="Launch current deck">Open</button>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-presentation-toggle-btn" title="Toggle presentation mode">Enter Presentation Mode</button>
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
                    <div class="reveal-overlay-nav" aria-label="Deck navigation overlay">
                        <button type="button" class="control-button reveal-nav-btn" data-nav="prev">‹</button>
                        <button type="button" class="control-button reveal-nav-btn" data-nav="next">›</button>
                    </div>
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
        this.toggleControlsButton = this.element.querySelector('.reveal-toggle-controls-btn');
        this.panelContainer = this.element.querySelector('.reveal-manager__panel');
        this.topbar = this.element.querySelector('.reveal-manager__topbar');
        this.revealContainer = this.element.querySelector('.reveal-container');
        this.frameWrap = this.element.querySelector('.reveal-manager-frame-wrap');
        this.navButtons = Array.from(this.element.querySelectorAll('.reveal-nav-btn'));
        this.presenterStatus = this.element.querySelector('.reveal-presenter-status');

        // Keep a stable iframe reference for toolbar navigation, similar to React's useRef.
        this.iframeRef = { current: null };

        this.iframe = document.createElement('iframe');
        this.iframe.className = 'reveal-frame';
        this.iframe.title = 'Reveal deck frame';
        this.iframe.setAttribute('referrerpolicy', 'no-referrer');
        this.frameWrap.appendChild(this.iframe);
        this.iframeRef.current = this.iframe;

        this.handleModeChange = this.handleModeChange.bind(this);
        this.handleSaveDeck = this.handleSaveDeck.bind(this);
        this.handleLaunchFromInputs = this.handleLaunchFromInputs.bind(this);
        this.handleLaunchSaved = this.handleLaunchSaved.bind(this);
        this.handleRenameDeck = this.handleRenameDeck.bind(this);
        this.handleDeleteDeck = this.handleDeleteDeck.bind(this);
        this.handlePresentationToggle = this.handlePresentationToggle.bind(this);
        this.handleToggleControls = this.handleToggleControls.bind(this);
        this.handleRootInteraction = this.handleRootInteraction.bind(this);
        this.handleOverlayNavPointerDown = this.handleOverlayNavPointerDown.bind(this);
        this.handleWindowMessage = this.handleWindowMessage.bind(this);
        this.handleIframeLoad = this.handleIframeLoad.bind(this);

        this.modeRadios.forEach((radio) => radio.addEventListener('change', this.handleModeChange));
        this.saveButton.addEventListener('click', this.handleSaveDeck);
        this.launchButton.addEventListener('click', this.handleLaunchFromInputs);
        this.launchSavedButton.addEventListener('click', this.handleLaunchSaved);
        this.renameButton.addEventListener('click', this.handleRenameDeck);
        this.deleteButton.addEventListener('click', this.handleDeleteDeck);
        this.presentationToggleButton.addEventListener('click', this.handlePresentationToggle);
        this.toggleControlsButton.addEventListener('click', this.handleToggleControls);
        this.element.addEventListener('click', this.handleRootInteraction);
        this.element.addEventListener('focusin', this.handleRootInteraction);
        window.addEventListener('message', this.handleWindowMessage);
        this.iframe.addEventListener('load', this.handleIframeLoad);
        this.navButtons.forEach((button) => {
            button.addEventListener('click', (event) => this.handleNavButtonClick(event));
            button.addEventListener('mousedown', this.handleOverlayNavPointerDown);
            const direction = button.dataset.nav || button.dataset.direction;
            button.title = `Navigate ${direction}`;
            button.setAttribute('aria-label', `Navigate ${direction}`);
        });

        RevealManagerWidget.initKeyboardHandler();

        this.renderSavedDeckOptions();
        this.updateModeUI();
        this.toggleCompact(true);
        this.updatePresentationUI();

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
    }

    handleOverlayNavPointerDown(event) {
        event.stopPropagation();
    }

    setupRevealSync() {
        if (!revealWidgetAppBus || !revealWidgetIsProjectorMode()) return;

        revealWidgetAppBus.on('reveal-slide-change', (payload) => {
            if (!payload) return;
            this.applySlideState(payload);
        });

        revealWidgetAppBus.on('reveal-fragment-change', (state) => {
            if (!state) return;
            this.applyFragmentState(state);
        });
    }

    handleIframeLoad() {
        this.slideChangeHandlerAttached = false;
        this.bindSlideChangeListener();
    }

    bindSlideChangeListener() {
        if (this.isProjectorView || !revealWidgetAppBus || !revealWidgetIsTeacherMode() || this.slideChangeHandlerAttached) return;

        const frameWindow = this.iframeRef.current?.contentWindow;
        const reveal = frameWindow && frameWindow.Reveal;
        if (!reveal || typeof reveal.on !== 'function') return;

        reveal.on('slidechanged', (event) => {
            revealWidgetAppBus.emit('reveal-slide-change', {
                indexh: event.indexh,
                indexv: event.indexv,
                indexf: event.indexf || 0
            });
        });

        reveal.on('fragmentshown', () => {
            if (typeof reveal.getState !== 'function') return;
            revealWidgetAppBus.emit('reveal-fragment-change', reveal.getState());
        });

        reveal.on('fragmenthidden', () => {
            if (typeof reveal.getState !== 'function') return;
            revealWidgetAppBus.emit('reveal-fragment-change', reveal.getState());
        });

        this.slideChangeHandlerAttached = true;
    }

    applySlideState(state) {
        if (!state) return;

        const frameWindow = this.iframeRef.current?.contentWindow;
        const reveal = frameWindow && frameWindow.Reveal;

        if (reveal && typeof reveal.slide === 'function') {
            reveal.slide(state.indexh || 0, state.indexv || 0, state.indexf || 0);
            return;
        }

        if (frameWindow) {
            frameWindow.postMessage({ type: 'reveal-slide-state', state }, '*');
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

    buildDeckFromInputs() {
        const type = this.getCurrentMode();
        const content = type === 'url' ? this.urlInput.value.trim() : this.htmlInput.value;

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

    launchDeck(deck) {
        if (!deck) return;

        this.activeDeck = {
            id: deck.id,
            name: deck.name,
            type: deck.type,
            content: deck.content
        };

        if (deck.type === 'url') {
            this.iframe.srcdoc = '';
            this.iframe.src = deck.content;
        } else {
            this.iframe.removeAttribute('src');
            this.iframe.srcdoc = deck.content;
        }

        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
        this.launchButton.textContent = 'Stop';
        this.sendDeckToPresenter();
        this.bindSlideChangeListener();
    }

    stopDeck() {
        this.activeDeck = null;
        this.savedSelect.value = '';
        this.iframe.removeAttribute('src');
        this.iframe.srcdoc = '';
        this.launchButton.textContent = 'Open';
        this.setPresenterStatus(this.presenterWindow ? 'Presenter connected' : '');
    }

    applyFragmentState(state) {
        if (!state) return;

        const frameWindow = this.iframeRef.current?.contentWindow;
        const reveal = frameWindow && frameWindow.Reveal;

        if (reveal && typeof reveal.setState === 'function') {
            reveal.setState(state);
            return;
        }

        if (frameWindow) {
            frameWindow.postMessage({ type: 'reveal-fragment-state', state }, '*');
        }
    }

    sendKeyToIframe(direction) {
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
        this.sendNavToPresenter(direction);

        if (!this.isProjectorView && revealWidgetIsTeacherMode()) {
            this.broadcastCurrentSlideState();
        }
    }

    broadcastCurrentSlideState() {
        if (!revealWidgetAppBus || this.isProjectorView || !revealWidgetIsTeacherMode()) return;

        const frameWindow = this.iframeRef.current?.contentWindow;
        const reveal = frameWindow && frameWindow.Reveal;
        if (!reveal || typeof reveal.getIndices !== 'function') return;

        const indices = reveal.getIndices();
        revealWidgetAppBus.emit('reveal-slide-change', {
            indexh: indices.h || 0,
            indexv: indices.v || 0,
            indexf: indices.f || 0
        });
    }

    sendNavToPresenter(direction) {
        if (!this.presenterWindow) return;

        if (this.presenterWindow.closed) {
            this.markPresenterClosed();
            return;
        }

        this.presenterWindow.postMessage({ type: 'reveal-nav', direction }, window.location.origin);
    }

    sendDeckToPresenter() {
        if (!this.presenterWindow || !this.activeDeck) return;

        if (this.presenterWindow.closed) {
            this.markPresenterClosed();
            return;
        }

        this.presenterWindow.postMessage(
            {
                type: 'reveal-presenter-load',
                deck: this.activeDeck
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

    handleNavButtonClick(event) {
        event.stopPropagation();
        const direction = event.currentTarget.dataset.nav || event.currentTarget.dataset.direction;
        if (!direction) return;
        this.sendKeyToIframe(direction);
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
            this.htmlInput.value = deck.content || '';
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
        this.toggleControlsButton.removeEventListener('click', this.handleToggleControls);
        this.element.removeEventListener('click', this.handleRootInteraction);
        this.element.removeEventListener('focusin', this.handleRootInteraction);
        window.removeEventListener('message', this.handleWindowMessage);
        this.iframe.removeEventListener('load', this.handleIframeLoad);
        this.navButtons.forEach((button) => button.removeEventListener('mousedown', this.handleOverlayNavPointerDown));

        if (this.presenterWindowMonitor) {
            clearInterval(this.presenterWindowMonitor);
            this.presenterWindowMonitor = null;
        }


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
