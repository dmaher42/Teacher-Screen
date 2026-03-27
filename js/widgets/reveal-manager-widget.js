const eventBus = window.TeacherScreenEventBus ? window.TeacherScreenEventBus.eventBus : null;

class RevealManagerWidget {
    static activeInstance = null;
    static keyboardHandlerInitialized = false;

    constructor() {
        this.layoutType = 'grid';
        this.storageKey = 'revealDecks';
        this.activeDeck = null;
        this.revealDeck = null;
        this.currentIndices = { h: 0, v: 0 };
        this.isCompact = true;
        this.projectorWindow = null;
        this.projectorChannel = typeof BroadcastChannel === 'function'
            ? new BroadcastChannel('teacher-screen-sync')
            : null;
        this.sceneChangeUnsubscribe = null;
        this.resizeObserver = null;
        this.reactivateTimeout = null;
        this.deckReadyHandler = null;
        this.deckSlideChangedHandler = null;
        this.renderVersion = 0;
        this.renderPromise = null;

        const appModeUtils = window.TeacherScreenAppMode || {};
        this.appMode = appModeUtils.APP_MODE || 'teacher';
        this.isTeacherMode = appModeUtils.isTeacherMode || (() => this.appMode === 'teacher');

        this.element = document.createElement('div');
        this.element.className = 'reveal-manager-widget-content reveal-manager--compact';
        this.element.tabIndex = 0;
        this.element.innerHTML = `
            <div class="reveal-manager">
                <div class="reveal-manager__topbar">
                    <button type="button" class="control-button reveal-btn reveal-btn-primary reveal-launch-btn" title="Load or stop the current deck">Open</button>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-prev-btn" title="Previous slide">Prev</button>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-next-btn" title="Next slide">Next</button>
                    <span class="reveal-deck-indicator" role="status" aria-live="polite" hidden></span>
                    <span class="reveal-presenter-status" role="status" aria-live="polite" hidden></span>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-projector-btn" title="Open the projector window">Projector</button>
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-toggle-controls-btn" aria-label="Toggle deck controls" title="Show deck controls">Details</button>
                </div>

                <div class="reveal-manager__panel advanced-controls" hidden>
                    <details class="reveal-manager__section" open>
                        <summary>Deck Source</summary>
                        <div class="reveal-manager-row">
                            <input type="text" class="reveal-deck-name" placeholder="Deck name">
                        </div>
                        <div class="reveal-manager-row">
                            <textarea class="reveal-content-textarea" placeholder="Paste full Reveal HTML here"></textarea>
                        </div>
                        <div class="reveal-manager-row reveal-manager-actions">
                            <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-save-btn">Save Deck</button>
                        </div>
                    </details>

                    <details class="reveal-manager__section" open>
                        <summary>Saved Decks</summary>
                        <div class="reveal-manager-row">
                            <select class="reveal-saved-select" aria-label="Select saved deck">
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
                        <div class="reveal-manager-frame-wrap">
                            <div class="reveal-inline-deck"></div>
                            <div class="reveal-manager-empty">
                                Paste Reveal HTML, then press Open.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.launchButton = this.element.querySelector('.reveal-launch-btn');
        this.prevButton = this.element.querySelector('.reveal-prev-btn');
        this.nextButton = this.element.querySelector('.reveal-next-btn');
        this.deckIndicator = this.element.querySelector('.reveal-deck-indicator');
        this.statusLabel = this.element.querySelector('.reveal-presenter-status');
        this.projectorButton = this.element.querySelector('.reveal-projector-btn');
        this.toggleControlsButton = this.element.querySelector('.reveal-toggle-controls-btn');
        this.panelContainer = this.element.querySelector('.reveal-manager__panel');
        this.deckNameInput = this.element.querySelector('.reveal-deck-name');
        this.htmlInput = this.element.querySelector('.reveal-content-textarea');
        this.saveButton = this.element.querySelector('.reveal-save-btn');
        this.savedSelect = this.element.querySelector('.reveal-saved-select');
        this.launchSavedButton = this.element.querySelector('.reveal-launch-saved-btn');
        this.renameButton = this.element.querySelector('.reveal-rename-btn');
        this.deleteButton = this.element.querySelector('.reveal-delete-btn');
        this.inlineDeckContainer = this.element.querySelector('.reveal-inline-deck');
        this.emptyState = this.element.querySelector('.reveal-manager-empty');

        this.handleLaunchFromInputs = this.handleLaunchFromInputs.bind(this);
        this.handlePrevClick = this.handlePrevClick.bind(this);
        this.handleNextClick = this.handleNextClick.bind(this);
        this.handleSaveDeck = this.handleSaveDeck.bind(this);
        this.handleLaunchSaved = this.handleLaunchSaved.bind(this);
        this.handleRenameDeck = this.handleRenameDeck.bind(this);
        this.handleDeleteDeck = this.handleDeleteDeck.bind(this);
        this.handleToggleControls = this.handleToggleControls.bind(this);
        this.handleRootInteraction = this.handleRootInteraction.bind(this);
        this.handleDocumentVisibilityChange = this.handleDocumentVisibilityChange.bind(this);
        this.handleSceneChanged = this.handleSceneChanged.bind(this);
        this.openProjector = this.openProjector.bind(this);

        this.launchButton.addEventListener('click', this.handleLaunchFromInputs);
        this.prevButton.addEventListener('click', this.handlePrevClick);
        this.nextButton.addEventListener('click', this.handleNextClick);
        this.saveButton.addEventListener('click', this.handleSaveDeck);
        this.launchSavedButton.addEventListener('click', this.handleLaunchSaved);
        this.renameButton.addEventListener('click', this.handleRenameDeck);
        this.deleteButton.addEventListener('click', this.handleDeleteDeck);
        this.projectorButton.addEventListener('click', this.openProjector);
        this.toggleControlsButton.addEventListener('click', this.handleToggleControls);
        this.element.addEventListener('click', this.handleRootInteraction);
        this.element.addEventListener('focusin', this.handleRootInteraction);
        document.addEventListener('visibilitychange', this.handleDocumentVisibilityChange);

        if (eventBus && typeof eventBus.on === 'function') {
            this.sceneChangeUnsubscribe = eventBus.on('scene:changed', this.handleSceneChanged);
        }

        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => {
                this.ensureDeckVisible();
            });
            this.resizeObserver.observe(this.element);
        }

        RevealManagerWidget.initKeyboardHandler();
        this.renderSavedDeckOptions();
        this.toggleCompact(true);
        this.updateDeckIndicator();
        this.updateControls();
    }

    static initKeyboardHandler() {
        if (RevealManagerWidget.keyboardHandlerInitialized) return;

        document.addEventListener('keydown', (event) => {
            const active = RevealManagerWidget.activeInstance;
            if (!active || !active.activeDeck) return;

            const directionMap = {
                ArrowLeft: 'prev',
                ArrowRight: 'next',
                ArrowUp: 'up',
                ArrowDown: 'down'
            };
            const direction = directionMap[event.key];
            if (!direction) return;

            event.preventDefault();
            active.navigate(direction);
        });

        RevealManagerWidget.keyboardHandlerInitialized = true;
    }

    setStatus(message) {
        if (!this.statusLabel) return;
        this.statusLabel.textContent = message || '';
        this.statusLabel.hidden = !message;
    }

    updateDeckIndicator() {
        if (!this.deckIndicator) return;

        if (!this.activeDeck) {
            this.deckIndicator.textContent = '';
            this.deckIndicator.hidden = true;
            return;
        }

        const deckName = (this.activeDeck.name || 'Untitled Deck').trim();
        this.deckIndicator.textContent = `${deckName} - HTML`;
        this.deckIndicator.hidden = false;
    }

    updateControls() {
        const hasDeck = !!this.activeDeck;
        this.launchButton.textContent = hasDeck ? 'Stop' : 'Open';
        this.prevButton.disabled = !hasDeck;
        this.nextButton.disabled = !hasDeck;
        this.emptyState.hidden = hasDeck;
    }

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls reveal-manager-settings-controls';

        const helpText = document.createElement('div');
        helpText.className = 'widget-help-text';
        helpText.textContent = 'Paste Reveal HTML, save decks for reuse, and control the live presentation from one place.';
        controls.appendChild(helpText);

        const sourceSection = document.createElement('div');
        sourceSection.className = 'widget-settings-section';
        const sourceHeading = document.createElement('h3');
        sourceHeading.textContent = 'Source';
        sourceSection.appendChild(sourceHeading);

        const deckNameLabel = document.createElement('label');
        deckNameLabel.textContent = 'Deck name';
        const settingsDeckNameInput = document.createElement('input');
        settingsDeckNameInput.type = 'text';
        deckNameLabel.appendChild(settingsDeckNameInput);
        sourceSection.appendChild(deckNameLabel);

        const htmlLabel = document.createElement('label');
        htmlLabel.textContent = 'Reveal HTML';
        const settingsHtmlInput = document.createElement('textarea');
        settingsHtmlInput.placeholder = 'Paste full Reveal HTML here';
        htmlLabel.appendChild(settingsHtmlInput);
        sourceSection.appendChild(htmlLabel);

        const sourceActions = document.createElement('div');
        sourceActions.className = 'widget-settings-actions';
        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'control-button';
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'control-button';
        saveButton.textContent = 'Save Deck';
        sourceActions.append(openButton, saveButton);
        sourceSection.appendChild(sourceActions);
        controls.appendChild(sourceSection);

        const savedSection = document.createElement('div');
        savedSection.className = 'widget-settings-section';
        const savedHeading = document.createElement('h3');
        savedHeading.textContent = 'Saved Decks';
        savedSection.appendChild(savedHeading);

        const savedLabel = document.createElement('label');
        savedLabel.textContent = 'Saved deck';
        const settingsSavedSelect = document.createElement('select');
        savedLabel.appendChild(settingsSavedSelect);
        savedSection.appendChild(savedLabel);

        const savedActions = document.createElement('div');
        savedActions.className = 'widget-settings-actions';
        const launchSavedButton = document.createElement('button');
        launchSavedButton.type = 'button';
        launchSavedButton.className = 'control-button';
        launchSavedButton.textContent = 'Load Saved Deck';
        const renameButton = document.createElement('button');
        renameButton.type = 'button';
        renameButton.className = 'control-button';
        renameButton.textContent = 'Rename Deck';
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'control-button modal-danger-btn';
        deleteButton.textContent = 'Delete Deck';
        savedActions.append(launchSavedButton, renameButton, deleteButton);
        savedSection.appendChild(savedActions);
        controls.appendChild(savedSection);

        const liveSection = document.createElement('div');
        liveSection.className = 'widget-settings-section';
        const liveHeading = document.createElement('h3');
        liveHeading.textContent = 'Actions';
        liveSection.appendChild(liveHeading);

        const liveActions = document.createElement('div');
        liveActions.className = 'widget-settings-actions';
        const prevButton = document.createElement('button');
        prevButton.type = 'button';
        prevButton.className = 'control-button';
        prevButton.textContent = 'Previous Slide';
        const nextButton = document.createElement('button');
        nextButton.type = 'button';
        nextButton.className = 'control-button';
        nextButton.textContent = 'Next Slide';
        const projectorButton = document.createElement('button');
        projectorButton.type = 'button';
        projectorButton.className = 'control-button';
        projectorButton.textContent = 'Open Projector';
        liveActions.append(prevButton, nextButton, projectorButton);
        liveSection.appendChild(liveActions);
        controls.appendChild(liveSection);

        const statusCard = document.createElement('div');
        statusCard.className = 'widget-settings-meta';
        const statusLabel = document.createElement('strong');
        statusLabel.textContent = 'Status';
        const statusText = document.createElement('span');
        statusCard.append(statusLabel, statusText);
        controls.appendChild(statusCard);

        const syncSavedOptions = () => {
            const selectedValue = this.savedSelect.value;
            settingsSavedSelect.innerHTML = '';
            Array.from(this.savedSelect.options).forEach((option) => {
                settingsSavedSelect.appendChild(option.cloneNode(true));
            });
            settingsSavedSelect.value = selectedValue;
        };

        const syncFromWidget = () => {
            this.updateCurrentIndices();
            settingsDeckNameInput.value = this.deckNameInput.value;
            settingsHtmlInput.value = this.htmlInput.value;
            openButton.textContent = this.activeDeck ? 'Stop Deck' : 'Load Deck';
            prevButton.disabled = !this.activeDeck;
            nextButton.disabled = !this.activeDeck;
            projectorButton.disabled = !this.activeDeck;
            syncSavedOptions();

            if (this.activeDeck) {
                const deckName = (this.activeDeck.name || 'Untitled Deck').trim();
                statusText.textContent = `${deckName} live at slide ${this.currentIndices.h + 1}.${this.currentIndices.v + 1}.`;
            } else {
                statusText.textContent = 'No deck currently open.';
            }
        };

        const syncInputsToWidget = () => {
            this.deckNameInput.value = settingsDeckNameInput.value;
            this.htmlInput.value = settingsHtmlInput.value;
            this.savedSelect.value = settingsSavedSelect.value;
        };

        openButton.addEventListener('click', () => {
            syncInputsToWidget();
            this.handleLaunchFromInputs();
            window.setTimeout(syncFromWidget, 0);
        });

        saveButton.addEventListener('click', () => {
            syncInputsToWidget();
            this.handleSaveDeck();
            window.setTimeout(syncFromWidget, 0);
        });

        launchSavedButton.addEventListener('click', () => {
            syncInputsToWidget();
            this.handleLaunchSaved();
            window.setTimeout(syncFromWidget, 0);
        });

        renameButton.addEventListener('click', () => {
            syncInputsToWidget();
            this.handleRenameDeck();
            window.setTimeout(syncFromWidget, 0);
        });

        deleteButton.addEventListener('click', () => {
            syncInputsToWidget();
            this.handleDeleteDeck();
            window.setTimeout(syncFromWidget, 0);
        });

        prevButton.addEventListener('click', () => {
            this.navigate('prev');
            window.setTimeout(syncFromWidget, 0);
        });

        nextButton.addEventListener('click', () => {
            this.navigate('next');
            window.setTimeout(syncFromWidget, 0);
        });

        projectorButton.addEventListener('click', () => {
            this.openProjector();
            syncFromWidget();
        });

        settingsSavedSelect.addEventListener('change', () => {
            this.savedSelect.value = settingsSavedSelect.value;
        });

        syncFromWidget();
        return controls;
    }

    toggleCompact(compact) {
        this.isCompact = compact;
        this.element.classList.toggle('reveal-manager--compact', compact);
        this.panelContainer.hidden = compact;
        this.toggleControlsButton.textContent = compact ? 'Details' : 'Close';
        this.toggleControlsButton.title = compact ? 'Show deck controls' : 'Hide deck controls';
    }

    handleToggleControls(event) {
        event.stopPropagation();
        this.toggleCompact(!this.isCompact);
        this.ensureDeckVisible();
    }

    handleRootInteraction() {
        RevealManagerWidget.activeInstance = this;
        this.activateDeck();
    }

    handleDocumentVisibilityChange() {
        if (document.visibilityState !== 'visible') return;
        this.ensureDeckVisible();
    }

    handleSceneChanged(payload = {}) {
        if (payload.tab !== 'classroom') return;
        this.ensureDeckVisible();
    }

    persistActiveDeckState() {
        if (!eventBus || typeof eventBus.emit !== 'function') return;

        eventBus.emit('layout:updated', {
            source: this.isTeacherMode() ? 'teacher' : 'projector',
            payload: { type: 'widget-config', widget: 'reveal-manager' }
        });
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

    normalizeStoredDeck(deck) {
        if (!deck || typeof deck.content !== 'string') {
            return null;
        }

        const normalizedContent = this.normalizeHtmlDeckContent(deck.content);
        if ((deck.type === 'html' || this.looksLikeHtmlDeck(normalizedContent))
            && this.hasRenderableSlideMarkup(normalizedContent)) {
            return {
                id: deck.id || Date.now(),
                name: (deck.name || 'Untitled Deck').trim(),
                type: 'html',
                content: normalizedContent
            };
        }

        return null;
    }

    renderSavedDeckOptions() {
        const decks = this.getSavedDecks();
        const selectedValue = this.savedSelect.value;

        this.savedSelect.innerHTML = '<option value="">Select saved deck</option>';

        decks.forEach((deck) => {
            const normalized = this.normalizeStoredDeck(deck);
            const option = document.createElement('option');
            option.value = String(deck.id);
            option.textContent = normalized
                ? normalized.name
                : `${deck.name || 'Untitled Deck'} (unsupported)`;
            this.savedSelect.appendChild(option);
        });

        if (selectedValue) {
            this.savedSelect.value = selectedValue;
        }
    }

    looksLikeHtmlDeck(content) {
        if (typeof content !== 'string') {
            return false;
        }

        const trimmed = content.trim();
        return /<\s*(?:!doctype\s+html|html|head|body|div|section|script|style|meta|title)\b/i.test(trimmed);
    }

    hasRenderableSlideMarkup(content) {
        if (typeof content !== 'string') {
            return false;
        }

        const normalized = content.trim();
        const hasRevealStructure = /class=["'][^"']*\breveal\b[^"']*["']/i.test(normalized)
            && /class=["'][^"']*\bslides\b[^"']*["']/i.test(normalized);

        return hasRevealStructure || /<\s*section\b/i.test(normalized);
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
                // Keep the original string and continue unescaping below.
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

    buildDeckFromInputs() {
        const content = this.normalizeHtmlDeckContent(this.htmlInput.value);
        if (!content.trim()) {
            this.setStatus('Paste Reveal HTML first.');
            return null;
        }

        if (!this.looksLikeHtmlDeck(content)) {
            this.setStatus('This widget now expects full Reveal HTML.');
            return null;
        }

        if (!this.hasRenderableSlideMarkup(content)) {
            this.setStatus('Add at least one slide section before opening.');
            return null;
        }

        return {
            id: Date.now(),
            name: (this.deckNameInput.value || 'Untitled Deck').trim(),
            type: 'html',
            content
        };
    }

    wrapDeckMarkup(content) {
        const normalized = this.normalizeHtmlDeckContent(content);
        const hasRevealStructure = /class=["'][^"']*\breveal\b[^"']*["']/i.test(normalized)
            && /class=["'][^"']*\bslides\b[^"']*["']/i.test(normalized);

        if (hasRevealStructure) {
            return normalized;
        }

        if (!this.hasRenderableSlideMarkup(normalized)) {
            return '<div class="reveal"><div class="slides"><section><h2>Invalid Reveal deck</h2><p>Add at least one slide section to this deck.</p></section></div></div>';
        }

        const innerContent = /<\s*section\b/i.test(normalized)
            ? normalized
            : `<section>${normalized}</section>`;

        return `<div class="reveal"><div class="slides">${innerContent}</div></div>`;
    }

    updateCurrentIndices(event = null) {
        if (event && typeof event.indexh === 'number') {
            this.currentIndices = {
                h: event.indexh,
                v: typeof event.indexv === 'number' ? event.indexv : 0
            };
            return;
        }

        if (!this.revealDeck || typeof this.revealDeck.getIndices !== 'function') {
            return;
        }

        const indices = this.revealDeck.getIndices();
        this.currentIndices = {
            h: indices && typeof indices.h === 'number' ? indices.h : 0,
            v: indices && typeof indices.v === 'number' ? indices.v : 0
        };
    }

    detachDeckListeners() {
        if (!this.revealDeck || typeof this.revealDeck.off !== 'function') {
            this.deckReadyHandler = null;
            this.deckSlideChangedHandler = null;
            return;
        }

        if (this.deckReadyHandler) {
            this.revealDeck.off('ready', this.deckReadyHandler);
        }
        if (this.deckSlideChangedHandler) {
            this.revealDeck.off('slidechanged', this.deckSlideChangedHandler);
        }

        this.deckReadyHandler = null;
        this.deckSlideChangedHandler = null;
    }

    attachDeckListeners(deck) {
        this.detachDeckListeners();
        this.revealDeck = deck;

        if (!deck || typeof deck.on !== 'function') {
            return;
        }

        this.deckReadyHandler = (event) => {
            this.updateCurrentIndices(event);
            this.setStatus('');
            this.broadcastSlideSync(event);
        };

        this.deckSlideChangedHandler = (event) => {
            this.updateCurrentIndices(event);
            this.broadcastSlideSync(event);
        };

        deck.on('ready', this.deckReadyHandler);
        deck.on('slidechanged', this.deckSlideChangedHandler);
    }

    async moveDeckToStoredSlide(deck) {
        if (!deck || typeof deck.slide !== 'function') {
            return;
        }

        const slideToSavedIndex = () => {
            deck.slide(this.currentIndices.h || 0, this.currentIndices.v || 0);
        };

        if (typeof deck.isReady === 'function' && deck.isReady()) {
            slideToSavedIndex();
            return;
        }

        if (typeof deck.on !== 'function') {
            slideToSavedIndex();
            return;
        }

        await new Promise((resolve) => {
            const onReady = () => {
                if (typeof deck.off === 'function') {
                    deck.off('ready', onReady);
                }
                slideToSavedIndex();
                resolve();
            };

            deck.on('ready', onReady);
            window.setTimeout(resolve, 300);
        });
    }

    async activateDeck() {
        if (!this.activeDeck) return;

        try {
            const { activateReveal } = await import('../utils/reveal-manager.js');
            activateReveal(this.inlineDeckContainer);
        } catch (error) {
            console.warn('[Reveal] unable to activate deck', error);
        }
    }

    async requestRevealLayout() {
        if (!this.activeDeck) return;

        try {
            const { activateReveal, layoutReveal } = await import('../utils/reveal-manager.js');
            activateReveal(this.inlineDeckContainer);
            layoutReveal(this.inlineDeckContainer);
        } catch (error) {
            console.warn('[Reveal] unable to layout deck', error);
        }
    }

    ensureDeckVisible() {
        if (!this.activeDeck) return;

        if (this.renderPromise) {
            return;
        }

        if (this.reactivateTimeout) {
            clearTimeout(this.reactivateTimeout);
            this.reactivateTimeout = null;
        }

        this.reactivateTimeout = window.setTimeout(async () => {
            try {
                const { activateReveal, getRevealDeck, hasMountedReveal, layoutReveal } = await import('../utils/reveal-manager.js');

                const deck = getRevealDeck(this.inlineDeckContainer) || this.revealDeck;
                const mounted = hasMountedReveal(this.inlineDeckContainer);

                if (!mounted || !deck) {
                    await this.renderActiveDeck({ preserveIndices: true });
                    this.reactivateTimeout = null;
                    return;
                }

                activateReveal(this.inlineDeckContainer);
                layoutReveal(this.inlineDeckContainer);
                window.requestAnimationFrame(() => layoutReveal(this.inlineDeckContainer));
            } catch (error) {
                console.warn('[Reveal] unable to restore deck visibility', error);
            } finally {
                this.reactivateTimeout = null;
            }
        }, 120);
    }

    async renderActiveDeck({ preserveIndices = true } = {}) {
        if (!this.activeDeck) return null;
        if (this.renderPromise) {
            return this.renderPromise;
        }

        this.renderPromise = (async () => {
            try {
                const renderVersion = ++this.renderVersion;
                const {
                    activateReveal,
                    destroyReveal,
                    initializeReveal,
                    layoutReveal,
                    mountPresentationMarkup
                } = await import('../utils/reveal-manager.js');

                const targetIndices = preserveIndices
                    ? { ...this.currentIndices }
                    : { h: 0, v: 0 };

                destroyReveal(this.inlineDeckContainer);
                this.inlineDeckContainer.innerHTML = '';

                mountPresentationMarkup(this.inlineDeckContainer, this.wrapDeckMarkup(this.activeDeck.content));

                const deck = await initializeReveal(this.inlineDeckContainer);
                if (renderVersion !== this.renderVersion || !this.activeDeck) {
                    if (deck && typeof deck.destroy === 'function') {
                        deck.destroy();
                    }
                    return null;
                }

                if (!deck) {
                    this.setStatus('Unable to load Reveal deck.');
                    return null;
                }

                this.revealDeck = deck;
                this.inlineDeckContainer.__teacherScreenRevealDeck = deck;
                this.attachDeckListeners(deck);
                activateReveal(this.inlineDeckContainer);
                this.currentIndices = targetIndices;
                await this.moveDeckToStoredSlide(deck);
                layoutReveal(this.inlineDeckContainer);
                window.requestAnimationFrame(() => layoutReveal(this.inlineDeckContainer));
                this.setStatus('');
                return deck;
            } catch (error) {
                console.warn('[Reveal] unable to initialize presentation', error);
                this.setStatus('Unable to load Reveal deck.');
                return null;
            } finally {
                this.renderPromise = null;
            }
        })();

        return this.renderPromise;
    }

    async launchDeck(deck, { preserveIndices = false } = {}) {
        this.activeDeck = {
            id: deck.id,
            name: deck.name,
            type: 'html',
            content: this.normalizeHtmlDeckContent(deck.content)
        };

        if (!preserveIndices) {
            this.currentIndices = { h: 0, v: 0 };
        }

        this.updateDeckIndicator();
        this.updateControls();
        this.savedSelect.value = String(deck.id || '');
        this.toggleCompact(true);
        this.setStatus('Loading deck...');

        const loadedDeck = await this.renderActiveDeck({ preserveIndices });
        if (!loadedDeck) {
            return;
        }

        this.persistActiveDeckState();
    }

    async stopDeck() {
        this.renderVersion += 1;
        this.renderPromise = null;
        this.detachDeckListeners();

        try {
            const { destroyReveal } = await import('../utils/reveal-manager.js');
            destroyReveal(this.inlineDeckContainer);
        } catch (error) {
            console.warn('[Reveal] unable to stop deck', error);
        }

        this.inlineDeckContainer.innerHTML = '';
        this.inlineDeckContainer.__teacherScreenRevealDeck = null;
        this.revealDeck = null;
        this.activeDeck = null;
        this.currentIndices = { h: 0, v: 0 };
        this.savedSelect.value = '';
        this.setStatus('');
        this.updateDeckIndicator();
        this.updateControls();
        this.persistActiveDeckState();
    }

    broadcastSlideSync(event = null) {
        if (!this.activeDeck || !this.isTeacherMode()) {
            return null;
        }

        this.updateCurrentIndices(event);

        const payload = {
            type: 'slideSync',
            h: this.currentIndices.h || 0,
            v: this.currentIndices.v || 0,
            html: this.activeDeck.content
        };

        if (this.projectorWindow && !this.projectorWindow.closed) {
            this.projectorWindow.postMessage(payload, '*');
        }

        if (this.projectorChannel) {
            let syncToken = null;
            try {
                syncToken = sessionStorage.getItem('teacher-screen-projector-sync-token')
                    || window.__TeacherProjectorSyncToken
                    || null;
            } catch (error) {
                console.warn('[RevealSync] unable to read projector sync token', error);
            }

            this.projectorChannel.postMessage({
                ...payload,
                syncToken
            });
        }

        window.postMessage(payload, '*');
        return payload;
    }

    navigate(direction) {
        if (!this.activeDeck || !this.revealDeck) return;

        this.activateDeck();

        const actionMap = {
            prev: 'prev',
            next: 'next',
            up: 'up',
            down: 'down'
        };
        const action = actionMap[direction];
        if (!action || typeof this.revealDeck[action] !== 'function') return;

        this.revealDeck[action]();
        window.setTimeout(() => this.broadcastSlideSync(), 0);
    }

    handlePrevClick(event) {
        event.stopPropagation();
        this.navigate('prev');
    }

    handleNextClick(event) {
        event.stopPropagation();
        this.navigate('next');
    }

    handleLaunchFromInputs() {
        if (this.activeDeck) {
            this.stopDeck();
            return;
        }

        const deck = this.buildDeckFromInputs();
        if (!deck) return;

        this.launchDeck(deck, { preserveIndices: false });
    }

    handleSaveDeck() {
        const deck = this.buildDeckFromInputs();
        if (!deck) return;

        const decks = this.getSavedDecks();
        decks.push(deck);
        this.saveDecks(decks);
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
        this.setStatus('Deck saved.');
    }

    handleLaunchSaved() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) {
            this.setStatus('Choose a saved deck first.');
            return;
        }

        const deck = this.getSavedDecks().find((item) => item.id === selectedId);
        const normalized = this.normalizeStoredDeck(deck);

        if (!normalized) {
            this.setStatus('That saved deck is not supported in the rebuilt widget.');
            return;
        }

        this.deckNameInput.value = normalized.name;
        this.htmlInput.value = normalized.content;
        this.launchDeck(normalized, { preserveIndices: false });
    }

    handleRenameDeck() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) return;

        const decks = this.getSavedDecks();
        const index = decks.findIndex((item) => item.id === selectedId);
        if (index < 0) return;

        const nextName = window.prompt('Rename deck', decks[index].name || 'Untitled Deck');
        if (typeof nextName !== 'string') return;

        decks[index] = {
            ...decks[index],
            name: nextName.trim() || 'Untitled Deck'
        };

        this.saveDecks(decks);
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(selectedId);
        this.setStatus('Deck renamed.');
    }

    handleDeleteDeck() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) return;

        const decks = this.getSavedDecks().filter((item) => item.id !== selectedId);
        this.saveDecks(decks);
        this.renderSavedDeckOptions();
        this.savedSelect.value = '';
        this.setStatus('Deck deleted.');
    }

    openProjector() {
        if (!this.activeDeck) {
            this.setStatus('Load a deck before opening the projector.');
            return;
        }

        const projectorUrl = new URL('projector.html', window.location.href);
        try {
            const syncToken = sessionStorage.getItem('teacher-screen-projector-sync-token')
                || window.__TeacherProjectorSyncToken
                || null;
            if (syncToken) {
                projectorUrl.searchParams.set('syncToken', syncToken);
            }
        } catch (error) {
            console.warn('[RevealSync] unable to attach projector sync token', error);
        }

        this.projectorWindow = window.open(
            projectorUrl.toString(),
            'projector',
            'fullscreen=yes'
        );

        if (!this.projectorWindow) {
            this.setStatus('Projector popup blocked.');
            return;
        }

        this.setStatus('Projector opening...');
        window.setTimeout(() => this.broadcastSlideSync(), 500);
        window.setTimeout(() => this.broadcastSlideSync(), 1500);
    }

    serialize() {
        return {
            type: 'RevealManagerWidget',
            activeDeck: this.activeDeck,
            currentIndices: this.currentIndices
        };
    }

    deserialize(data = {}) {
        const deck = this.normalizeStoredDeck(data.activeDeck);
        if (!deck) return;

        this.currentIndices = data.currentIndices && typeof data.currentIndices === 'object'
            ? {
                h: Number.isFinite(data.currentIndices.h) ? data.currentIndices.h : 0,
                v: Number.isFinite(data.currentIndices.v) ? data.currentIndices.v : 0
            }
            : { h: 0, v: 0 };

        this.deckNameInput.value = deck.name;
        this.htmlInput.value = deck.content;
        this.launchDeck(deck, { preserveIndices: true });
    }

    setEditable() {}

    remove() {
        this.launchButton.removeEventListener('click', this.handleLaunchFromInputs);
        this.prevButton.removeEventListener('click', this.handlePrevClick);
        this.nextButton.removeEventListener('click', this.handleNextClick);
        this.saveButton.removeEventListener('click', this.handleSaveDeck);
        this.launchSavedButton.removeEventListener('click', this.handleLaunchSaved);
        this.renameButton.removeEventListener('click', this.handleRenameDeck);
        this.deleteButton.removeEventListener('click', this.handleDeleteDeck);
        this.projectorButton.removeEventListener('click', this.openProjector);
        this.toggleControlsButton.removeEventListener('click', this.handleToggleControls);
        this.element.removeEventListener('click', this.handleRootInteraction);
        this.element.removeEventListener('focusin', this.handleRootInteraction);
        document.removeEventListener('visibilitychange', this.handleDocumentVisibilityChange);

        if (this.sceneChangeUnsubscribe) {
            this.sceneChangeUnsubscribe();
            this.sceneChangeUnsubscribe = null;
        }

        if (this.projectorChannel) {
            this.projectorChannel.close();
            this.projectorChannel = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.reactivateTimeout) {
            clearTimeout(this.reactivateTimeout);
            this.reactivateTimeout = null;
        }

        this.detachDeckListeners();
        this.stopDeck();

        if (eventBus && typeof eventBus.emit === 'function') {
            eventBus.emit('widget:removed', {
                id: this.id,
                type: 'reveal'
            });
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
