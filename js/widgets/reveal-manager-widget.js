const eventBus = window.TeacherScreenEventBus ? window.TeacherScreenEventBus.eventBus : null;
const SLIDE_IMPORT_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const SLIDE_IMPORT_MAX_STORED_BYTES = 150 * 1024 * 1024;
const SLIDE_ASSET_ID_ATTRIBUTE = 'data-slide-asset-id';

class RevealManagerWidget {
    static activeInstance = null;
    static keyboardHandlerInitialized = false;

    constructor() {
        this.layoutType = 'grid';
        this.storageKey = 'revealDecks';
        this.lastDeckStorageKey = 'revealLastDeck';
        this.activeDeck = null;
        this.revealDeck = null;
        this.sourceTypes = [
            { value: 'html', label: 'Reveal HTML' },
            { value: 'google-slides', label: 'Google Slides' },
            { value: 'powerpoint', label: 'PowerPoint' }
        ];
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
        this.runtimeObjectUrls = new Set();

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
                    <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-toggle-controls-btn" aria-label="Open deck setup" title="Open deck setup">Deck Setup</button>
                </div>

                <div class="reveal-manager__panel advanced-controls" hidden>
                    <details class="reveal-manager__section" open>
                        <summary>Import</summary>
                        <div class="reveal-manager-row">
                            <select class="reveal-source-type" aria-label="Select presentation source type">
                                <option value="html">Reveal HTML</option>
                                <option value="google-slides">Google Slides</option>
                                <option value="powerpoint">PowerPoint</option>
                            </select>
                        </div>
                        <div class="reveal-manager-row">
                            <input type="text" class="reveal-deck-name" placeholder="Deck name">
                        </div>
                        <div class="reveal-manager-row reveal-external-row" hidden>
                            <input type="text" class="reveal-external-url" placeholder="Paste the share or present URL">
                        </div>
                        <p class="reveal-external-validation" hidden></p>
                        <div class="reveal-manager-row reveal-html-row">
                            <textarea class="reveal-content-textarea" placeholder="Paste full Reveal HTML here"></textarea>
                        </div>
                        <div class="reveal-manager-row reveal-manager-actions">
                            <button type="button" class="control-button reveal-btn reveal-btn-secondary reveal-save-btn">Save</button>
                            <button type="button" class="control-button reveal-btn reveal-btn-primary reveal-convert-btn">Import Slides</button>
                        </div>
                        <input type="file" class="reveal-deck-file-input" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden>
                    </details>

                    <details class="reveal-manager__section" open>
                        <summary>Saved</summary>
                        <div class="reveal-manager-row">
                            <select class="reveal-saved-select" aria-label="Select saved deck">
                                <option value="">Select saved deck</option>
                            </select>
                            <button type="button" class="control-button reveal-btn reveal-btn-primary reveal-launch-saved-btn">Open</button>
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
                            <div class="reveal-manager-empty" aria-hidden="true"></div>
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
        this.toggleControlsButton = this.element.querySelector('.reveal-toggle-controls-btn');
        this.panelContainer = this.element.querySelector('.reveal-manager__panel');
        this.sourceTypeSelect = this.element.querySelector('.reveal-source-type');
        this.deckNameInput = this.element.querySelector('.reveal-deck-name');
        this.externalUrlInput = this.element.querySelector('.reveal-external-url');
        this.externalValidation = this.element.querySelector('.reveal-external-validation');
        this.htmlRow = this.element.querySelector('.reveal-html-row');
        this.externalRow = this.element.querySelector('.reveal-external-row');
        this.htmlInput = this.element.querySelector('.reveal-content-textarea');
        this.saveButton = this.element.querySelector('.reveal-save-btn');
        this.convertButton = this.element.querySelector('.reveal-convert-btn');
        this.deckFileInput = this.element.querySelector('.reveal-deck-file-input');
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
        this.handleConvertButtonClick = this.handleConvertButtonClick.bind(this);
        this.handleDeckFileSelection = this.handleDeckFileSelection.bind(this);
        this.handleConvertToRevealDeck = this.handleConvertToRevealDeck.bind(this);
        this.handleLaunchSaved = this.handleLaunchSaved.bind(this);
        this.handleRenameDeck = this.handleRenameDeck.bind(this);
        this.handleDeleteDeck = this.handleDeleteDeck.bind(this);
        this.handleToggleControls = this.handleToggleControls.bind(this);
        this.handleRootInteraction = this.handleRootInteraction.bind(this);
        this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.handleDocumentVisibilityChange = this.handleDocumentVisibilityChange.bind(this);
        this.handleSceneChanged = this.handleSceneChanged.bind(this);
        this.handleSourceTypeChange = this.handleSourceTypeChange.bind(this);
        this.openProjector = this.openProjector.bind(this);

        this.launchButton.addEventListener('click', this.handleLaunchFromInputs);
        this.prevButton.addEventListener('click', this.handlePrevClick);
        this.nextButton.addEventListener('click', this.handleNextClick);
        this.saveButton.addEventListener('click', this.handleSaveDeck);
        this.convertButton.addEventListener('click', this.handleConvertButtonClick);
        this.deckFileInput.addEventListener('change', this.handleDeckFileSelection);
        this.launchSavedButton.addEventListener('click', this.handleLaunchSaved);
        this.renameButton.addEventListener('click', this.handleRenameDeck);
        this.deleteButton.addEventListener('click', this.handleDeleteDeck);
        this.toggleControlsButton.addEventListener('click', this.handleToggleControls);
        this.sourceTypeSelect.addEventListener('change', this.handleSourceTypeChange);
        this.externalUrlInput.addEventListener('input', () => this.updateSourceFields());
        this.externalUrlInput.addEventListener('blur', () => this.updateSourceFields());
        this.element.addEventListener('click', this.handleRootInteraction);
        this.element.addEventListener('focusin', this.handleRootInteraction);
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
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
        this.updateSourceFields();
        this.updateDeckIndicator();
        this.updateControls();
        this.emitPresentationState();
    }

    static initKeyboardHandler() {
        if (RevealManagerWidget.keyboardHandlerInitialized) return;

        document.addEventListener('keydown', (event) => {
            const active = RevealManagerWidget.activeInstance;
            if (!active || !active.activeDeck) return;

            const target = event.target instanceof Element ? event.target : null;
            if (event.defaultPrevented
                || event.altKey
                || event.ctrlKey
                || event.metaKey
                || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) {
                return;
            }

            if (!active.element?.isConnected) {
                RevealManagerWidget.activeInstance = null;
                return;
            }

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
        this.emitPresentationState();
    }

    escapeHtml(value = '') {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    getPresentationStateSnapshot() {
        const activeDeck = this.activeDeck
            ? {
                name: this.activeDeck.name || '',
                type: this.activeDeck.type || 'html',
                sourceUrl: this.activeDeck.sourceUrl || ''
            }
            : null;

        return {
            widgetId: this.widgetId || null,
            hasDeck: !!activeDeck,
            activeDeck,
            sourceType: activeDeck?.type || null,
            sourceLabel: activeDeck ? this.getSourceTypeLabel(activeDeck.type) : '',
            canNavigate: !!(activeDeck && activeDeck.type === 'html'),
            currentIndices: {
                h: Number.isFinite(this.currentIndices?.h) ? this.currentIndices.h : 0,
                v: Number.isFinite(this.currentIndices?.v) ? this.currentIndices.v : 0
            },
            statusMessage: this.statusLabel?.textContent || ''
        };
    }

    emitPresentationState() {
        if (!eventBus || typeof eventBus.emit !== 'function') {
            return;
        }

        eventBus.emit('presentation:state-changed', this.getPresentationStateSnapshot());
    }

    emitSavedDecksChanged() {
        if (!eventBus || typeof eventBus.emit !== 'function') {
            return;
        }

        eventBus.emit('presentation:saved-decks-changed', {
            decks: this.getSavedDecks()
        });
    }

    getSourceTypeLabel(type = 'html') {
        return this.sourceTypes.find((item) => item.value === type)?.label || 'Reveal HTML';
    }

    isExternalSourceType(type = 'html') {
        return type === 'google-slides' || type === 'powerpoint';
    }

    normalizeExternalUrl(url = '') {
        const raw = String(url || '').trim();
        if (!raw) {
            return '';
        }

        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }

        return `https://${raw}`;
    }

    detectExternalSourceTypeFromUrl(url = '') {
        const raw = String(url || '').trim();
        if (!raw) {
            return null;
        }

        const normalizedUrl = this.normalizeExternalUrl(raw);
        try {
            const parsed = new URL(normalizedUrl);
            const hostname = parsed.hostname.toLowerCase();
            const pathname = parsed.pathname.toLowerCase();

            if (hostname.includes('docs.google.com') && pathname.includes('/presentation')) {
                return 'google-slides';
            }

            if (hostname.includes('slides.google.com')) {
                return 'google-slides';
            }

            if (hostname.includes('powerpoint.live.com')
                || hostname.includes('office.com')
                || hostname.includes('officeapps.live.com')
                || hostname.includes('onedrive.live.com')
                || hostname.includes('1drv.ms')
                || hostname.includes('sharepoint.com')
                || pathname.includes('.ppt')
                || pathname.includes('.pptx')) {
                return 'powerpoint';
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    getExternalPresentationRuntime(deck = {}) {
        const requestedType = this.isExternalSourceType(deck?.type) ? deck.type : 'google-slides';
        const validation = this.validateExternalSourceUrl({
            type: requestedType,
            sourceUrl: deck?.sourceUrl || deck?.url || ''
        });
        const sourceType = validation.detectedSourceType || requestedType;
        const sourceLabel = this.getSourceTypeLabel(sourceType);

        const runtime = {
            sourceType,
            sourceLabel,
            validation,
            normalizedUrl: validation.normalizedUrl || '',
            launchUrl: validation.normalizedUrl || '',
            embedUrl: '',
            canMirrorInApp: false
        };

        if (!validation.canProceed || !validation.normalizedUrl) {
            return runtime;
        }

        try {
            const parsed = new URL(validation.normalizedUrl);
            const hostname = parsed.hostname.toLowerCase();
            const pathname = parsed.pathname.toLowerCase();
            const queryText = `${parsed.search}${parsed.hash}`.toLowerCase();

            if (sourceType === 'google-slides') {
                const slideIdMatch = parsed.pathname.match(/\/presentation\/d\/([^/]+)/i);
                if (slideIdMatch && slideIdMatch[1]) {
                    const params = new URLSearchParams({
                        start: 'false',
                        loop: 'false',
                        delayms: '3000',
                        rm: 'minimal'
                    });
                    runtime.embedUrl = `https://docs.google.com/presentation/d/${slideIdMatch[1]}/embed?${params.toString()}`;
                    runtime.canMirrorInApp = true;
                }
            } else if (sourceType === 'powerpoint') {
                const isExplicitEmbedLink = hostname.includes('view.officeapps.live.com')
                    || hostname.includes('officeapps.live.com')
                    || (hostname.includes('powerpoint.live.com') && (pathname.includes('/embed') || queryText.includes('embed')))
                    || queryText.includes('action=embedview')
                    || queryText.includes('embed=true');

                if (isExplicitEmbedLink) {
                    runtime.embedUrl = validation.normalizedUrl;
                    runtime.canMirrorInApp = true;
                }
            }
        } catch (error) {
            return runtime;
        }

        return runtime;
    }

    validateExternalSourceUrl({ type = 'google-slides', sourceUrl = '' } = {}) {
        const sourceType = this.isExternalSourceType(type) ? type : 'google-slides';
        const raw = String(sourceUrl || '').trim();

        if (!raw) {
            return {
                sourceType,
                detectedSourceType: null,
                normalizedUrl: '',
                state: 'empty',
                message: '',
                canProceed: false
            };
        }

        const normalizedUrl = this.normalizeExternalUrl(raw);
        let parsed;
        try {
            parsed = new URL(normalizedUrl);
        } catch (error) {
            return {
                sourceType,
                detectedSourceType: null,
                normalizedUrl,
                state: 'error',
                message: 'Enter a full Google Slides or PowerPoint web link.',
                canProceed: false
            };
        }

        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.toLowerCase();
        const queryText = `${parsed.search}${parsed.hash}`.toLowerCase();
        const detectedSourceType = this.detectExternalSourceTypeFromUrl(normalizedUrl);

        if (!detectedSourceType) {
            return {
                sourceType,
                detectedSourceType: null,
                normalizedUrl,
                state: 'error',
                message: 'This link is not recognised as a Google Slides or PowerPoint presentation.',
                canProceed: false
            };
        }

        if (detectedSourceType === 'google-slides') {
            if (!(hostname.includes('docs.google.com') || hostname.includes('slides.google.com'))) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'error',
                    message: 'Use a Google Slides web link from docs.google.com or slides.google.com.',
                    canProceed: false
                };
            }

            if (hostname.includes('docs.google.com') && !pathname.includes('/presentation')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'error',
                    message: 'This Google link is not pointing to a Slides presentation.',
                    canProceed: false
                };
            }

            if (pathname.includes('/edit') || queryText.includes('action=edit') || queryText.includes('mode=edit')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This looks like an edit link. It may open the editor instead of a clean presentation view.',
                    canProceed: true
                };
            }

            if (pathname.includes('/copy')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This looks like a copy link. A Present, Preview, or Publish link is safer for class display.',
                    canProceed: true
                };
            }

            if (pathname.includes('/presentation/d/')
                && !pathname.includes('/present')
                && !pathname.includes('/preview')
                && !pathname.includes('/pub')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This share link should work, but a Present or Publish link is more reliable on the projector.',
                    canProceed: true
                };
            }
        }

        if (detectedSourceType === 'powerpoint') {
            const isMicrosoftHost = hostname.includes('powerpoint.live.com')
                || hostname.includes('office.com')
                || hostname.includes('officeapps.live.com')
                || hostname.includes('onedrive.live.com')
                || hostname.includes('1drv.ms')
                || hostname.includes('sharepoint.com');

            if (!isMicrosoftHost && !pathname.includes('.ppt') && !pathname.includes('.pptx')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'error',
                    message: 'Use a Microsoft 365, OneDrive, SharePoint, or direct PowerPoint web link.',
                    canProceed: false
                };
            }

            if (pathname.includes('/edit')
                || pathname.includes('edit.aspx')
                || queryText.includes('action=edit')
                || queryText.includes('mode=edit')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This looks like an edit link. It may open the Office editor instead of the live presentation view.',
                    canProceed: true
                };
            }

            if (pathname.includes('.ppt') || pathname.includes('.pptx')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This file link is accepted, but a browser presentation link is safer for live projection.',
                    canProceed: true
                };
            }

            if ((hostname.includes('onedrive.live.com') || hostname.includes('1drv.ms') || hostname.includes('sharepoint.com'))
                && !hostname.includes('powerpoint.live.com')
                && !pathname.includes('powerpoint')) {
                return {
                    sourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This share link may open a file page first. A dedicated PowerPoint presentation link is more reliable.',
                    canProceed: true
                };
            }
        }

        return {
            sourceType,
            detectedSourceType,
            normalizedUrl,
            state: 'ok',
            message: '',
            canProceed: true
        };
    }

    renderExternalValidationState(validation = null, target = this.externalValidation) {
        if (!target) {
            return validation;
        }

        if (!validation || !validation.message || validation.state === 'ok' || validation.state === 'empty') {
            target.hidden = true;
            target.textContent = '';
            delete target.dataset.state;
            return validation;
        }

        target.hidden = false;
        target.textContent = validation.message;
        target.dataset.state = validation.state;
        return validation;
    }

    updateSourceFields() {
        const sourceType = this.sourceTypeSelect?.value || 'html';
        const isExternal = this.isExternalSourceType(sourceType);
        const isStoredImport = !isExternal && this.isStoredImportDeck(this.activeDeck);

        if (this.htmlRow) {
            this.htmlRow.hidden = isExternal;
        }

        if (this.externalRow) {
            this.externalRow.hidden = !isExternal;
        }

        if (this.externalUrlInput) {
            this.externalUrlInput.placeholder = sourceType === 'google-slides'
                ? 'Paste the Google Slides share or present URL'
                : sourceType === 'powerpoint'
                    ? 'Paste the PowerPoint web presentation URL'
                    : 'Paste the share or present URL';
        }

        if (this.htmlInput) {
            this.htmlInput.disabled = isStoredImport;
            this.htmlInput.placeholder = isStoredImport
                ? `Imported ${String(this.activeDeck.sourceFormat || 'slide').toUpperCase()} deck stored on this device. Re-import the file to replace it.`
                : 'Paste full Reveal HTML here';
        }

        if (this.emptyState && !this.activeDeck) {
            this.emptyState.textContent = '';
        }

        this.renderExternalValidationState(
            isExternal
                ? this.validateExternalSourceUrl({
                    type: sourceType,
                    sourceUrl: this.externalUrlInput?.value || ''
                })
                : null
        );
    }

    handleSourceTypeChange() {
        this.updateSourceFields();
    }

    updateDeckIndicator() {
        if (!this.deckIndicator) return;

        if (!this.activeDeck) {
            this.deckIndicator.textContent = '';
            this.deckIndicator.hidden = true;
            return;
        }

        const deckName = (this.activeDeck.name || 'Untitled Deck').trim();
        this.deckIndicator.textContent = `${deckName} - ${this.getSourceTypeLabel(this.activeDeck.type)}`;
        this.deckIndicator.hidden = false;
    }

    updateControls() {
        const hasDeck = !!this.activeDeck;
        const isLiveRevealDeck = hasDeck && this.activeDeck.type === 'html';
        this.launchButton.textContent = hasDeck ? 'Stop' : 'Open';
        this.prevButton.disabled = !isLiveRevealDeck;
        this.nextButton.disabled = !isLiveRevealDeck;
        this.emptyState.hidden = true;
    }

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls reveal-manager-settings-controls';

        const sourceSection = document.createElement('div');
        sourceSection.className = 'widget-settings-section';
        const sourceHeading = document.createElement('h3');
        sourceHeading.textContent = 'Source';
        sourceSection.appendChild(sourceHeading);

        const sourceTypeLabel = document.createElement('label');
        sourceTypeLabel.textContent = 'Source type';
        const settingsSourceTypeSelect = document.createElement('select');
        this.sourceTypes.forEach((sourceType) => {
            const option = document.createElement('option');
            option.value = sourceType.value;
            option.textContent = sourceType.label;
            settingsSourceTypeSelect.appendChild(option);
        });
        sourceTypeLabel.appendChild(settingsSourceTypeSelect);
        sourceSection.appendChild(sourceTypeLabel);

        const deckNameLabel = document.createElement('label');
        deckNameLabel.textContent = 'Deck name';
        const settingsDeckNameInput = document.createElement('input');
        settingsDeckNameInput.type = 'text';
        deckNameLabel.appendChild(settingsDeckNameInput);
        sourceSection.appendChild(deckNameLabel);

        const externalUrlLabel = document.createElement('label');
        externalUrlLabel.textContent = 'External slide URL';
        const settingsExternalUrlInput = document.createElement('input');
        settingsExternalUrlInput.type = 'text';
        settingsExternalUrlInput.placeholder = 'https://...';
        externalUrlLabel.appendChild(settingsExternalUrlInput);
        sourceSection.appendChild(externalUrlLabel);

        const externalValidation = document.createElement('div');
        externalValidation.className = 'widget-help-text presentation-validation';
        externalValidation.hidden = true;
        sourceSection.appendChild(externalValidation);

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
        saveButton.textContent = 'Save';
        const convertButton = document.createElement('button');
        convertButton.type = 'button';
        convertButton.className = 'control-button control-button--primary';
        convertButton.textContent = 'Import Slides';
        sourceActions.append(openButton, saveButton, convertButton);
        sourceSection.appendChild(sourceActions);
        controls.appendChild(sourceSection);

        const savedSection = document.createElement('div');
        savedSection.className = 'widget-settings-section';
        const savedHeading = document.createElement('h3');
        savedHeading.textContent = 'Saved';
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
        launchSavedButton.textContent = 'Open';
        const renameButton = document.createElement('button');
        renameButton.type = 'button';
        renameButton.className = 'control-button';
        renameButton.textContent = 'Rename';
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'control-button modal-danger-btn';
        deleteButton.textContent = 'Delete';
        savedActions.append(launchSavedButton, renameButton, deleteButton);
        savedSection.appendChild(savedActions);
        controls.appendChild(savedSection);

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
            settingsSourceTypeSelect.value = this.sourceTypeSelect.value;
            settingsDeckNameInput.value = this.deckNameInput.value;
            settingsExternalUrlInput.value = this.externalUrlInput.value;
            settingsHtmlInput.value = this.htmlInput.value;
            openButton.textContent = this.activeDeck ? 'Stop' : 'Load';
            syncSavedOptions();
            this.updateExternalSourceSettingsUI(
                settingsSourceTypeSelect,
                externalUrlLabel,
                htmlLabel,
                externalValidation,
                settingsExternalUrlInput
            );

            if (this.activeDeck) {
                const deckName = (this.activeDeck.name || 'Untitled Deck').trim();
                statusText.textContent = this.activeDeck.type === 'html'
                    ? `${deckName} live at slide ${this.currentIndices.h + 1}.${this.currentIndices.v + 1}.`
                    : `${deckName} ready as a ${this.getSourceTypeLabel(this.activeDeck.type)} source. Use Projector to open the live deck.`;
            } else {
                statusText.textContent = 'No deck currently open.';
            }
        };

        const syncInputsToWidget = () => {
            this.sourceTypeSelect.value = settingsSourceTypeSelect.value;
            this.deckNameInput.value = settingsDeckNameInput.value;
            this.externalUrlInput.value = settingsExternalUrlInput.value;
            this.htmlInput.value = settingsHtmlInput.value;
            this.savedSelect.value = settingsSavedSelect.value;
            this.updateSourceFields();
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

        convertButton.addEventListener('click', () => {
            syncInputsToWidget();
            this.handleConvertToRevealDeck();
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

        settingsSavedSelect.addEventListener('change', () => {
            this.savedSelect.value = settingsSavedSelect.value;
        });

        settingsSourceTypeSelect.addEventListener('change', () => {
            this.sourceTypeSelect.value = settingsSourceTypeSelect.value;
            this.updateSourceFields();
            this.updateExternalSourceSettingsUI(
                settingsSourceTypeSelect,
                externalUrlLabel,
                htmlLabel,
                externalValidation,
                settingsExternalUrlInput
            );
        });

        settingsExternalUrlInput.addEventListener('input', () => {
            this.renderExternalValidationState(
                this.validateExternalSourceUrl({
                    type: settingsSourceTypeSelect.value,
                    sourceUrl: settingsExternalUrlInput.value
                }),
                externalValidation
            );
        });

        settingsExternalUrlInput.addEventListener('blur', () => {
            this.renderExternalValidationState(
                this.validateExternalSourceUrl({
                    type: settingsSourceTypeSelect.value,
                    sourceUrl: settingsExternalUrlInput.value
                }),
                externalValidation
            );
        });

        syncFromWidget();
        return controls;
    }

    toggleCompact(compact) {
        this.isCompact = compact;
        this.element.classList.toggle('reveal-manager--compact', compact);
        this.panelContainer.hidden = compact;
        this.toggleControlsButton.textContent = compact ? 'Deck Setup' : 'Hide Setup';
        this.toggleControlsButton.title = compact ? 'Open deck setup' : 'Hide deck setup';
        this.toggleControlsButton.setAttribute('aria-label', compact ? 'Open deck setup' : 'Hide deck setup');
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

    handleDocumentPointerDown(event) {
        if (RevealManagerWidget.activeInstance === this && !this.element.contains(event.target)) {
            RevealManagerWidget.activeInstance = null;
        }
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
        this.emitPresentationState();
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
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(decks));
            this.emitSavedDecksChanged();
            return true;
        } catch (error) {
            console.warn('Unable to save reveal decks:', error);
            const quotaExceeded = error?.name === 'QuotaExceededError'
                || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
                || error?.code === 22
                || error?.code === 1014;
            this.setStatus(quotaExceeded
                ? 'This deck is too large for Slides storage. Use Document Viewer for a PDF, or link Google Slides or PowerPoint.'
                : 'This deck could not be saved in this browser.');
            return false;
        }
    }

    saveLastDeck(deck) {
        const normalizedDeck = this.getPersistentDeckReference(deck);
        if (!normalizedDeck) {
            return false;
        }

        try {
            localStorage.setItem(this.lastDeckStorageKey, JSON.stringify(normalizedDeck));
            return true;
        } catch (error) {
            console.warn('Unable to save the last reveal deck:', error);
            this.setStatus('Deck opened, but it is too large to restore automatically after closing.');
            return false;
        }
    }

    getLastDeck() {
        try {
            const parsed = JSON.parse(localStorage.getItem(this.lastDeckStorageKey) || 'null');
            return this.normalizeStoredDeck(parsed);
        } catch (error) {
            return null;
        }
    }

    normalizeStoredDeck(deck) {
        if (!deck || typeof deck !== 'object') {
            return null;
        }

        const sourceType = deck.type || 'html';
        if (this.isExternalSourceType(sourceType)) {
            const validation = this.validateExternalSourceUrl({
                type: sourceType,
                sourceUrl: deck.sourceUrl || deck.url || ''
            });
            if (!validation.canProceed) {
                return null;
            }

            return {
                id: deck.id || Date.now(),
                name: (deck.name || 'Untitled Deck').trim(),
                type: validation.detectedSourceType || sourceType,
                sourceUrl: validation.normalizedUrl,
                content: ''
            };
        }

        const storageId = typeof deck.storageId === 'string' ? deck.storageId.trim() : '';
        if (storageId) {
            return {
                id: deck.id || Date.now(),
                name: (deck.name || 'Untitled Deck').trim(),
                type: 'html',
                content: typeof deck.content === 'string' ? deck.content : '',
                storageId,
                storageKind: 'indexeddb',
                sourceFormat: deck.sourceFormat === 'pptx' ? 'pptx' : 'pdf',
                sourceName: String(deck.sourceName || '').trim(),
                sourceSize: Math.max(0, Number(deck.sourceSize) || 0),
                slideCount: Math.max(0, Number(deck.slideCount) || 0)
            };
        }

        if (typeof deck.content !== 'string') {
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

    isStoredImportDeck(deck = null) {
        return !!(deck && typeof deck.storageId === 'string' && deck.storageId.trim());
    }

    getPersistentDeckReference(deck = null) {
        const normalized = this.normalizeStoredDeck(deck);
        if (!normalized) {
            return null;
        }

        if (!this.isStoredImportDeck(normalized)) {
            return normalized;
        }

        return {
            id: normalized.id,
            name: normalized.name,
            type: 'html',
            content: '',
            storageId: normalized.storageId,
            storageKind: 'indexeddb',
            sourceFormat: normalized.sourceFormat,
            sourceName: normalized.sourceName,
            sourceSize: normalized.sourceSize,
            slideCount: normalized.slideCount
        };
    }

    getDocumentStore() {
        const store = window.TeacherScreenDocumentStore;
        if (!store || typeof store.saveSlideDeck !== 'function' || typeof store.loadSlideDeck !== 'function') {
            throw new Error('Browser document storage is unavailable.');
        }
        return store;
    }

    createImportedDeckStorageId(deckId = Date.now()) {
        const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `slides-${deckId}-${randomPart}`;
    }

    clearRuntimeObjectUrls() {
        this.runtimeObjectUrls.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch (error) {
                // The browser may already have released the object URL.
            }
        });
        this.runtimeObjectUrls.clear();
    }

    async hydrateStoredDeck(deck) {
        if (!this.isStoredImportDeck(deck)) {
            return deck;
        }

        const store = this.getDocumentStore();
        const [storedDeck, assets] = await Promise.all([
            store.loadSlideDeck(deck.storageId),
            store.loadSlideAssets(deck.storageId)
        ]);
        if (!storedDeck || typeof storedDeck.content !== 'string' || !storedDeck.content.trim()) {
            const error = new Error('The imported slide deck is no longer stored on this device.');
            error.code = 'SLIDE_DECK_MISSING';
            throw error;
        }

        const assetsById = new Map((Array.isArray(assets) ? assets : []).map((asset) => [String(asset.id), asset]));
        const parsed = new DOMParser().parseFromString(storedDeck.content, 'text/html');
        const assetElements = Array.from(parsed.body.querySelectorAll(`[${SLIDE_ASSET_ID_ATTRIBUTE}]`));
        const nextObjectUrls = new Set();

        try {
            assetElements.forEach((element) => {
                const assetId = String(element.getAttribute(SLIDE_ASSET_ID_ATTRIBUTE) || '');
                const asset = assetsById.get(assetId);
                if (!asset || !(asset.blob instanceof Blob)) {
                    const error = new Error('One or more imported slide images are missing.');
                    error.code = 'SLIDE_ASSET_MISSING';
                    throw error;
                }

                const objectUrl = URL.createObjectURL(asset.blob);
                nextObjectUrls.add(objectUrl);
                element.setAttribute('src', objectUrl);
                element.removeAttribute(SLIDE_ASSET_ID_ATTRIBUTE);
            });
        } catch (error) {
            nextObjectUrls.forEach((url) => URL.revokeObjectURL(url));
            throw error;
        }

        this.clearRuntimeObjectUrls();
        this.runtimeObjectUrls = nextObjectUrls;
        return {
            ...deck,
            name: deck.name || storedDeck.name || 'Imported Deck',
            content: parsed.body.innerHTML,
            sourceFormat: deck.sourceFormat || storedDeck.sourceFormat || 'pdf',
            sourceName: deck.sourceName || storedDeck.sourceName || '',
            sourceSize: Number(deck.sourceSize) || Number(storedDeck.sourceSize) || 0,
            slideCount: Number(deck.slideCount) || Number(storedDeck.slideCount) || 0
        };
    }

    async persistImportedDeck(deck, assets = []) {
        const normalized = this.normalizeStoredDeck(deck);
        if (!normalized || !this.isStoredImportDeck(normalized) || !normalized.content.trim()) {
            throw new Error('The imported slide deck could not be prepared for storage.');
        }

        const store = this.getDocumentStore();
        await store.saveSlideDeck({
            deck: {
                id: normalized.storageId,
                deckId: normalized.id,
                name: normalized.name,
                sourceFormat: normalized.sourceFormat,
                sourceName: normalized.sourceName,
                sourceSize: normalized.sourceSize,
                slideCount: normalized.slideCount,
                content: normalized.content,
                updatedAt: Date.now()
            },
            assets
        });
        return this.getPersistentDeckReference(normalized);
    }

    async updateStoredDeckName(deck) {
        if (!this.isStoredImportDeck(deck)) return false;
        try {
            return await this.getDocumentStore().updateSlideDeck(deck.storageId, { name: deck.name });
        } catch (error) {
            console.warn('Unable to update the stored slide deck name:', error);
            return false;
        }
    }

    async deleteStoredDeckData(deck) {
        if (!this.isStoredImportDeck(deck)) return false;
        try {
            return await this.getDocumentStore().deleteSlideDeck(deck.storageId);
        } catch (error) {
            console.warn('Unable to delete stored slide deck data:', error);
            this.setStatus('The deck was removed from the list, but its local slide files could not be cleaned up.');
            return false;
        }
    }

    clearLastDeckReference(deck) {
        if (!deck) return;
        const lastDeck = this.getLastDeck();
        if (!lastDeck) return;
        const sameDeck = Number(lastDeck.id) === Number(deck.id)
            || (this.isStoredImportDeck(lastDeck)
                && this.isStoredImportDeck(deck)
                && lastDeck.storageId === deck.storageId);
        if (sameDeck) {
            localStorage.removeItem(this.lastDeckStorageKey);
        }
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

    getSavedDeckById(deckId) {
        const normalizedId = Number(deckId);
        if (!normalizedId) {
            return null;
        }

        return this.getSavedDecks().find((item) => Number(item?.id) === normalizedId) || null;
    }

    updateExternalSourceSettingsUI(sourceTypeSelect, externalUrlLabel, htmlLabel, externalValidation = null, externalUrlInput = null) {
        if (!sourceTypeSelect || !externalUrlLabel || !htmlLabel) {
            return;
        }

        const sourceType = sourceTypeSelect.value || 'html';
        const isExternal = this.isExternalSourceType(sourceType);

        externalUrlLabel.hidden = !isExternal;
        htmlLabel.hidden = isExternal;

        this.renderExternalValidationState(
            isExternal
                ? this.validateExternalSourceUrl({
                    type: sourceType,
                    sourceUrl: externalUrlInput?.value || this.externalUrlInput?.value || ''
                })
                : null,
            externalValidation
        );
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
        const sourceType = this.sourceTypeSelect?.value || 'html';
        if (this.isExternalSourceType(sourceType)) {
            const validation = this.validateExternalSourceUrl({
                type: sourceType,
                sourceUrl: this.externalUrlInput?.value || ''
            });
            this.renderExternalValidationState(validation);
            if (!validation.canProceed) {
                this.setStatus(validation.message || `Add a ${this.getSourceTypeLabel(sourceType)} URL first.`);
                return null;
            }

            const effectiveSourceType = validation.detectedSourceType || sourceType;
            if (effectiveSourceType !== sourceType) {
                this.sourceTypeSelect.value = effectiveSourceType;
                this.updateSourceFields();
            }

            return {
                id: Date.now(),
                name: (this.deckNameInput.value || this.getSourceTypeLabel(effectiveSourceType)).trim(),
                type: effectiveSourceType,
                sourceUrl: validation.normalizedUrl,
                content: ''
            };
        }

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

    promptForExternalSourceConversion() {
        const currentUrl = (this.externalUrlInput?.value || this.activeDeck?.sourceUrl || '').trim();
        const promptMessage = 'Paste the slide deck URL';
        const response = window.prompt(promptMessage, currentUrl);
        if (response === null) {
            return null;
        }

        const sourceUrl = String(response || '').trim();
        if (!sourceUrl) {
            this.setStatus('Paste a slide deck URL first.');
            return null;
        }

        const detectedSourceType = this.detectExternalSourceTypeFromUrl(sourceUrl) || 'google-slides';
        return {
            type: detectedSourceType,
            sourceUrl
        };
    }

    buildRevealDeckFromExternalSource({ type = 'google-slides', sourceUrl = '', name = '' } = {}) {
        const sourceType = this.isExternalSourceType(type) ? type : this.detectExternalSourceTypeFromUrl(sourceUrl) || 'google-slides';
        const validation = this.validateExternalSourceUrl({
            type: sourceType,
            sourceUrl
        });
        this.renderExternalValidationState(validation);
        if (!validation.canProceed) {
            this.setStatus(validation.message || `Add a ${this.getSourceTypeLabel(sourceType)} URL first.`);
            return null;
        }

        const deckName = (name || this.deckNameInput.value || `${this.getSourceTypeLabel(sourceType)} Reveal`).trim();
        const sourceLabel = this.getSourceTypeLabel(sourceType);
        const escapedSourceUrl = this.escapeHtml(validation.normalizedUrl);
        const deckTitle = this.escapeHtml(deckName);
        const deck = {
            id: Date.now(),
            name: deckName,
            type: 'html',
            content: `
                <div class="reveal">
                    <div class="slides">
                        <section>
                            <h2>${deckTitle}</h2>
                            <p><a href="${escapedSourceUrl}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(sourceLabel)} source</a></p>
                        </section>
                        <section>
                            <h2>Reveal Deck</h2>
                            <p>Build the synced lesson slides here.</p>
                        </section>
                    </div>
                </div>
            `.trim()
        };

        return deck;
    }

    buildRevealDeckFromImportedSlides({
        id = Date.now(),
        name = 'Imported Deck',
        slides = [],
        storageId = '',
        sourceFormat = 'pdf',
        sourceName = '',
        sourceSize = 0
    } = {}) {
        const deckName = String(name || 'Imported Deck').trim() || 'Imported Deck';
        const normalizedSlides = Array.isArray(slides) ? slides.filter(Boolean) : [];
        const slideMarkup = normalizedSlides.length > 0
            ? normalizedSlides.join('\n')
            : '<section><h2>Imported Deck</h2><p>No slides were found in the selected file.</p></section>';

        return {
            id,
            name: deckName,
            type: 'html',
            storageId,
            storageKind: storageId ? 'indexeddb' : '',
            sourceFormat: sourceFormat === 'pptx' ? 'pptx' : 'pdf',
            sourceName: String(sourceName || '').trim(),
            sourceSize: Math.max(0, Number(sourceSize) || 0),
            slideCount: normalizedSlides.length,
            content: `
                <div class="reveal">
                    <div class="slides">
                        ${slideMarkup}
                    </div>
                </div>
            `.trim()
        };
    }

    getImportedDeckBaseName(fileName = '') {
        const raw = String(fileName || '').trim();
        if (!raw) {
            return 'Imported Deck';
        }

        return raw
            .replace(/\.(pdf|pptx)$/i, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Imported Deck';
    }

    normalizeZipPath(value = '') {
        return String(value || '')
            .replace(/^\/+/, '')
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/');
    }

    async getZipEntryText(zip, entryPath = '') {
        if (!zip || !entryPath) {
            return null;
        }

        const normalizedTarget = this.normalizeZipPath(entryPath);
        const candidates = [
            entryPath,
            normalizedTarget,
            normalizedTarget.replace(/\//g, '\\')
        ];

        for (const candidate of candidates) {
            const entry = zip.file(candidate);
            if (entry) {
                return entry.async('text');
            }
        }

        const matchName = Object.keys(zip.files || {}).find((name) => this.normalizeZipPath(name) === normalizedTarget);
        if (!matchName) {
            return null;
        }

        const entry = zip.file(matchName);
        return entry ? entry.async('text') : null;
    }

    async handleConvertButtonClick() {
        if (!this.deckFileInput) {
            return;
        }

        this.deckFileInput.value = '';
        this.deckFileInput.click();
    }

    async handleDeckFileSelection(event) {
        const file = event?.target?.files?.[0];
        if (!file) {
            return;
        }

        await this.importDeckFile(file);
        this.deckFileInput.value = '';
    }

    async importDeckFile(file) {
        if (!file) {
            return null;
        }

        if (Number(file.size) > SLIDE_IMPORT_MAX_SOURCE_BYTES) {
            this.setStatus('This file is larger than 50 MB. Choose a smaller PDF or PowerPoint file.');
            return null;
        }

        const fileName = file.name || 'Imported Deck';
        const baseName = this.getImportedDeckBaseName(fileName);
        const lowerName = fileName.toLowerCase();
        const importedDeckName = `${baseName} Reveal`;
        const deckId = Date.now();
        const storageId = this.createImportedDeckStorageId(deckId);

        let imported = null;
        try {
            this.setStatus(`Preparing ${fileName} for local slide storage...`);
            if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
                imported = await this.importPdfDeck(file, importedDeckName, { deckId, storageId });
            } else if (lowerName.endsWith('.pptx') || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
                imported = await this.importPptxDeck(file, importedDeckName, { deckId, storageId });
            } else {
                this.setStatus('Choose a PDF or PPTX file.');
                return null;
            }
        } catch (error) {
            console.warn('Unable to import slide deck:', error);
            const quotaExceeded = error?.name === 'QuotaExceededError';
            this.setStatus(quotaExceeded
                ? 'There is not enough browser storage for this slide deck. Remove an older local deck or choose a smaller file.'
                : 'That slide deck could not be imported. The original file was not changed.');
            return null;
        }

        if (!imported?.deck) {
            return null;
        }

        let deck = null;
        try {
            deck = await this.persistImportedDeck(imported.deck, imported.assets);
        } catch (error) {
            console.warn('Unable to store imported slide deck:', error);
            const quotaExceeded = error?.name === 'QuotaExceededError';
            this.setStatus(quotaExceeded
                ? 'There is not enough browser storage for this slide deck. Remove an older local deck or choose a smaller file.'
                : 'This deck could not be saved on this device. Close other Teacher Screen tabs and try again.');
            return null;
        }

        const decks = this.getSavedDecks();
        decks.push(deck);
        if (!this.saveDecks(decks)) {
            await this.deleteStoredDeckData(deck);
            return null;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
        this.sourceTypeSelect.value = 'html';
        this.deckNameInput.value = deck.name;
        this.externalUrlInput.value = '';
        this.htmlInput.value = '';
        this.updateSourceFields();
        await this.launchDeck(deck, { preserveIndices: false });
        if (this.revealDeck) {
            this.setStatus(`Imported ${fileName}. Saved on this device for reload and projector use.`);
        }
        return deck;
    }

    async importPdfDeck(file, deckName, { deckId = Date.now(), storageId = '' } = {}) {
        if (typeof pdfjsLib === 'undefined' || !pdfjsLib?.getDocument) {
            this.setStatus('PDF support is not available right now.');
            return null;
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
        const slides = [];
        const assets = [];
        let storedBytes = 0;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));

            await page.render({
                canvasContext: context,
                viewport
            }).promise;

            const imageBlob = await this.canvasToSlideBlob(canvas);
            const assetId = `${storageId}-pdf-page-${pageNumber}`;
            storedBytes += imageBlob.size;
            if (storedBytes > SLIDE_IMPORT_MAX_STORED_BYTES) {
                const error = new Error('The rendered slide deck is too large to store safely.');
                error.name = 'QuotaExceededError';
                throw error;
            }
            assets.push({
                id: assetId,
                blob: imageBlob,
                mimeType: imageBlob.type || 'image/webp',
                alt: `Imported PDF page ${pageNumber}`
            });
            slides.push(`
                <section>
                    <img ${SLIDE_ASSET_ID_ATTRIBUTE}="${assetId}" alt="Imported PDF page ${pageNumber}" style="width:100%;height:100%;object-fit:contain;">
                </section>
            `.trim());
            canvas.width = 1;
            canvas.height = 1;
            if (typeof page.cleanup === 'function') page.cleanup();
        }

        if (typeof pdf.destroy === 'function') await pdf.destroy();
        return {
            deck: this.buildRevealDeckFromImportedSlides({
                id: deckId,
                name: deckName,
                slides,
                storageId,
                sourceFormat: 'pdf',
                sourceName: file.name || '',
                sourceSize: file.size || 0
            }),
            assets
        };
    }

    canvasToSlideBlob(canvas) {
        if (!canvas || typeof canvas.toBlob !== 'function') {
            return Promise.reject(new Error('This browser cannot prepare PDF pages for slide storage.'));
        }

        return new Promise((resolve, reject) => {
            canvas.toBlob((webpBlob) => {
                if (webpBlob) {
                    resolve(webpBlob);
                    return;
                }

                canvas.toBlob((pngBlob) => {
                    if (pngBlob) {
                        resolve(pngBlob);
                        return;
                    }
                    reject(new Error('A PDF page could not be converted into a stored slide image.'));
                }, 'image/png');
            }, 'image/webp', 0.9);
        });
    }

    async importPptxDeck(file, deckName, { deckId = Date.now(), storageId = '' } = {}) {
        if (typeof JSZip === 'undefined') {
            this.setStatus('PPTX support is not available right now.');
            return null;
        }

        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const presentationXml = await this.getZipEntryText(zip, 'ppt/presentation.xml');
        const relsXml = await this.getZipEntryText(zip, 'ppt/_rels/presentation.xml.rels');

        if (!presentationXml || !relsXml) {
            this.setStatus('That PPTX file could not be read.');
            return null;
        }

        const relMap = new Map();
        const relPattern = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/gi;
        let relMatch;
        while ((relMatch = relPattern.exec(relsXml)) !== null) {
            relMap.set(relMatch[1], relMatch[2]);
        }

        const slideIds = [];
        const slidePattern = /<p:sldId\b[^>]*r:id="([^"]+)"/gi;
        let slideMatch;
        while ((slideMatch = slidePattern.exec(presentationXml)) !== null) {
            slideIds.push(slideMatch[1]);
        }

        const slides = [];
        const assets = [];
        let storedBytes = 0;
        for (let index = 0; index < slideIds.length; index += 1) {
            const relId = slideIds[index];
            const target = relMap.get(relId);
            if (!target) {
                continue;
            }

            const slidePath = `ppt/${target.replace(/^\/+/, '')}`;
            const slideXml = await this.getZipEntryText(zip, slidePath);
            if (!slideXml) {
                continue;
            }

            const slideContent = await this.extractPptxSlideContent(zip, slidePath, slideXml, index + 1, storageId);
            slideContent.images.forEach((image) => {
                if (!(image.blob instanceof Blob)) return;
                storedBytes += image.blob.size;
                assets.push({
                    id: image.assetId,
                    blob: image.blob,
                    mimeType: image.mimeType,
                    alt: image.alt
                });
            });
            if (storedBytes > SLIDE_IMPORT_MAX_STORED_BYTES) {
                const error = new Error('The extracted slide deck is too large to store safely.');
                error.name = 'QuotaExceededError';
                throw error;
            }
            slides.push(this.buildRevealPptxSlide(slideContent, index + 1));
        }

        return {
            deck: this.buildRevealDeckFromImportedSlides({
                id: deckId,
                name: deckName,
                slides,
                storageId,
                sourceFormat: 'pptx',
                sourceName: file.name || '',
                sourceSize: file.size || 0
            }),
            assets
        };
    }

    async extractPptxSlideContent(zip, slidePath = '', slideXml = '', slideNumber = 1, storageId = '') {
        const doc = slideXml ? new DOMParser().parseFromString(slideXml, 'application/xml') : null;
        const textBlocks = this.extractPptxSlideTextBlocks(doc, slideNumber);
        const backgroundColor = this.extractPptxSlideBackgroundColor(doc);
        const images = zip ? await this.extractPptxSlideImages(zip, slidePath, doc, storageId, slideNumber) : [];

        return {
            slideNumber,
            backgroundColor,
            textBlocks,
            images
        };
    }

    extractPptxSlideBackgroundColor(doc = null) {
        if (!doc) {
            return '';
        }

        const bgNode = doc.getElementsByTagNameNS('*', 'bg')[0];
        const bgColor = this.extractPptxColorFromNode(bgNode);
        return bgColor || '';
    }

    extractPptxSlideTextBlocks(doc = null, slideNumber = 1) {
        if (!doc) {
            return [];
        }

        const paragraphs = Array.from(doc.getElementsByTagNameNS('*', 'p'));
        const blocks = [];

        paragraphs.forEach((paragraph, index) => {
            if (!paragraph || !paragraph.children) {
                return;
            }

            const runs = Array.from(paragraph.children).filter((child) => child && child.localName === 'r');
            if (!runs.length) {
                return;
            }

            const runHtml = runs
                .map((run) => this.extractPptxRunHtml(run))
                .filter(Boolean)
                .join('');

            if (!runHtml) {
                return;
            }

            blocks.push(index === 0
                ? `<h2>${runHtml}</h2>`
                : `<p>${runHtml}</p>`);
        });

        if (!blocks.length) {
            blocks.push(`<h2>Slide ${slideNumber}</h2>`);
        }

        return blocks;
    }

    extractPptxRunHtml(run = null) {
        if (!run) {
            return '';
        }

        const textParts = Array.from(run.getElementsByTagNameNS('*', 't'))
            .map((node) => String(node.textContent || '').trim())
            .filter(Boolean);

        if (!textParts.length) {
            return '';
        }

        const text = this.escapeHtml(textParts.join(' '));
        const rPr = Array.from(run.children || []).find((child) => child && child.localName === 'rPr') || null;
        const styles = [];

        const color = this.extractPptxColorFromNode(rPr);
        if (color) {
            styles.push(`color:${color}`);
        }

        if (rPr?.getAttribute('b') === '1' || rPr?.getAttribute('b') === 'true') {
            styles.push('font-weight:700');
        }

        if (rPr?.getAttribute('i') === '1' || rPr?.getAttribute('i') === 'true') {
            styles.push('font-style:italic');
        }

        if (rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none') {
            styles.push('text-decoration:underline');
        }

        return styles.length
            ? `<span style="${styles.join(';')}">${text}</span>`
            : text;
    }

    extractPptxColorFromNode(node = null) {
        if (!node) {
            return '';
        }

        const solidFill = Array.from(node.children || []).find((child) => child && child.localName === 'solidFill')
            || node.getElementsByTagNameNS('*', 'solidFill')[0]
            || null;
        if (!solidFill) {
            return '';
        }

        const srgbClr = solidFill.getElementsByTagNameNS('*', 'srgbClr')[0];
        if (srgbClr) {
            const value = String(srgbClr.getAttribute('val') || '').trim();
            if (value) {
                const alpha = solidFill.getElementsByTagNameNS('*', 'alpha')[0]?.getAttribute('val');
                return alpha && Number(alpha) < 100000
                    ? `color-mix(in srgb, #${value} ${Math.max(0, Math.min(100, Math.round((Number(alpha) / 100000) * 100)))}%, transparent)`
                    : `#${value}`;
            }
        }

        const schemeClr = solidFill.getElementsByTagNameNS('*', 'schemeClr')[0];
        if (schemeClr) {
            const scheme = String(schemeClr.getAttribute('val') || '').trim().toLowerCase();
            const schemeMap = {
                dk1: '#111827',
                lt1: '#ffffff',
                dk2: '#1f2937',
                lt2: '#f8fafc',
                accent1: '#3b82f6',
                accent2: '#10b981',
                accent3: '#f59e0b',
                accent4: '#8b5cf6',
                accent5: '#ef4444',
                accent6: '#06b6d4',
                hlink: '#2563eb',
                folhlink: '#7c3aed'
            };
            return schemeMap[scheme] || '';
        }

        return '';
    }

    async extractPptxSlideImages(zip, slidePath = '', doc = null, storageId = '', slideNumber = 1) {
        if (!zip || !slidePath || !doc) {
            return [];
        }

        const slideRelsPath = slidePath
            .replace(/ppt\/slides\/([^/]+)$/i, 'ppt/slides/_rels/$1.rels')
            .replace(/\/+/g, '/');
        const relsXml = await this.getZipEntryText(zip, slideRelsPath);
        if (!relsXml) {
            return [];
        }

        const relMap = new Map();
        const relPattern = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/gi;
        let relMatch;
        while ((relMatch = relPattern.exec(relsXml)) !== null) {
            relMap.set(relMatch[1], relMatch[2]);
        }

        const blips = Array.from(doc.getElementsByTagNameNS('*', 'blip'));
        const embedIds = [...new Set(blips
            .map((node) => node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
                || node.getAttribute('r:embed')
                || node.getAttribute('embed'))
            .filter(Boolean))];

        const images = [];
        for (let imageIndex = 0; imageIndex < embedIds.length; imageIndex += 1) {
            const embedId = embedIds[imageIndex];
            const target = relMap.get(embedId);
            if (!target) {
                continue;
            }

            const imagePath = this.resolvePptxRelativePath(slidePath, target);
            const mimeType = this.getMimeTypeForPath(imagePath);
            const blob = await this.getZipEntryBlob(zip, imagePath, mimeType);
            if (blob) {
                images.push({
                    assetId: `${storageId}-pptx-${slideNumber}-${imageIndex + 1}`,
                    blob,
                    mimeType,
                    alt: String(imagePath || 'image').split('/').pop() || 'image'
                });
            }
        }

        return images;
    }

    resolvePptxRelativePath(basePath = '', targetPath = '') {
        const normalizedTarget = this.normalizeZipPath(targetPath);
        if (!normalizedTarget) {
            return '';
        }

        if (/^[a-z]+:/i.test(normalizedTarget)) {
            return normalizedTarget;
        }

        const baseDir = this.normalizeZipPath(basePath).replace(/[^/]+$/, '');
        const stack = baseDir.split('/').filter(Boolean);

        normalizedTarget.split('/').forEach((part) => {
            if (!part || part === '.') {
                return;
            }
            if (part === '..') {
                stack.pop();
                return;
            }
            stack.push(part);
        });

        return stack.join('/');
    }

    getMimeTypeForPath(filePath = '') {
        const extension = String(filePath || '').split('.').pop().toLowerCase();
        const mimeMap = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            bmp: 'image/bmp',
            svg: 'image/svg+xml'
        };

        return mimeMap[extension] || 'application/octet-stream';
    }

    async getZipEntryBlob(zip, entryPath = '', mimeType = 'application/octet-stream') {
        if (!zip || !entryPath) {
            return null;
        }

        const normalizedTarget = this.normalizeZipPath(entryPath);
        const candidates = [
            entryPath,
            normalizedTarget,
            normalizedTarget.replace(/\//g, '\\')
        ];

        for (const candidate of candidates) {
            const entry = zip.file(candidate);
            if (entry) {
                const blob = await entry.async('blob');
                return blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType);
            }
        }

        const matchName = Object.keys(zip.files || {}).find((name) => this.normalizeZipPath(name) === normalizedTarget);
        if (!matchName) {
            return null;
        }

        const entry = zip.file(matchName);
        if (!entry) {
            return null;
        }

        const blob = await entry.async('blob');
        return blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType);
    }

    buildRevealPptxSlide({ slideNumber = 1, backgroundColor = '', textBlocks = [], images = [] } = {}) {
        const slideBackground = backgroundColor ? `background:${backgroundColor};` : '';
        const bodyBlocks = Array.isArray(textBlocks) && textBlocks.length > 0
            ? textBlocks.join('')
            : `<h2>Slide ${slideNumber}</h2>`;
        const imageMarkup = Array.isArray(images) && images.length > 0
            ? `
                <div style="display:grid; gap:0.6rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items:start;">
                    ${images.map((image) => `
                        <figure style="margin:0; padding:0.5rem; border:1px solid rgba(148,163,184,0.25); border-radius:12px; background:rgba(255,255,255,0.65);">
                            <img ${SLIDE_ASSET_ID_ATTRIBUTE}="${this.escapeHtml(image.assetId || '')}" alt="${this.escapeHtml(image.alt || `Slide ${slideNumber} image`)}" style="display:block; width:100%; height:auto; object-fit:contain;">
                        </figure>
                    `).join('')}
                </div>
            `
            : '';

        return `
            <section style="${slideBackground} padding: 1rem;">
                <div style="display:grid; gap:1rem; align-content:start; text-align:left; max-width: 100%; height: 100%;">
                    <div style="display:grid; gap:0.6rem;">
                        ${bodyBlocks}
                    </div>
                    ${imageMarkup}
                </div>
            </section>
        `.trim();
    }

    async loadExternalSource({ type = 'google-slides', sourceUrl = '', name = '' } = {}) {
        const validation = this.validateExternalSourceUrl({ type, sourceUrl });
        const sourceType = validation.detectedSourceType || (this.isExternalSourceType(type) ? type : 'google-slides');
        if (!validation.canProceed) {
            this.renderExternalValidationState(validation);
            this.setStatus(validation.message || `Add a ${this.getSourceTypeLabel(sourceType)} URL first.`);
            return false;
        }

        const deckName = (name || this.getSourceTypeLabel(sourceType)).trim();
        this.sourceTypeSelect.value = sourceType;
        this.deckNameInput.value = deckName;
        this.externalUrlInput.value = validation.normalizedUrl;
        this.htmlInput.value = '';
        this.updateSourceFields();

        await this.launchDeck({
            id: Date.now(),
            name: deckName,
            type: sourceType,
            sourceUrl: validation.normalizedUrl,
            content: ''
        }, { preserveIndices: false });

        return !!this.activeDeck;
    }

    saveExternalSource({ type = 'google-slides', sourceUrl = '', name = '' } = {}) {
        const validation = this.validateExternalSourceUrl({ type, sourceUrl });
        const sourceType = validation.detectedSourceType || (this.isExternalSourceType(type) ? type : 'google-slides');
        if (!validation.canProceed) {
            this.renderExternalValidationState(validation);
            this.setStatus(validation.message || `Add a ${this.getSourceTypeLabel(sourceType)} URL first.`);
            return null;
        }

        const deckName = (name || this.getSourceTypeLabel(sourceType)).trim();
        const decks = this.getSavedDecks();
        const existingIndex = decks.findIndex((deck) => {
            const normalizedDeck = this.normalizeStoredDeck(deck);
            return normalizedDeck
                && normalizedDeck.type === sourceType
                && normalizedDeck.sourceUrl === validation.normalizedUrl;
        });

        const nextDeck = {
            id: existingIndex >= 0 ? Number(decks[existingIndex].id) || Date.now() : Date.now(),
            name: deckName,
            type: sourceType,
            sourceUrl: validation.normalizedUrl,
            content: ''
        };

        if (existingIndex >= 0) {
            decks[existingIndex] = nextDeck;
        } else {
            decks.push(nextDeck);
        }

        this.sourceTypeSelect.value = sourceType;
        this.deckNameInput.value = deckName;
        this.externalUrlInput.value = validation.normalizedUrl;
        this.htmlInput.value = '';
        this.updateSourceFields();
        if (!this.saveDecks(decks)) {
            return null;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(nextDeck.id);
        this.setStatus(existingIndex >= 0 ? 'Saved link updated.' : 'Saved link added.');
        return nextDeck;
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

        if (this.activeDeck.type !== 'html') {
            this.inlineDeckContainer.innerHTML = '';
            this.inlineDeckContainer.__teacherScreenRevealDeck = null;
            this.revealDeck = null;
            const externalRuntime = this.renderExternalDeckScaffold(this.activeDeck);
            this.setStatus(externalRuntime?.canMirrorInApp
                ? `${externalRuntime.sourceLabel} ready. Projector opens the live deck in a separate window.`
                : `${this.getSourceTypeLabel(this.activeDeck.type)} link ready. Use an embeddable link to mirror it inside Teacher Screen and the projector.`);
            return null;
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

    renderExternalDeckScaffold(deck) {
        if (!this.inlineDeckContainer || !deck) {
            return null;
        }

        const runtime = this.getExternalPresentationRuntime(deck);
        const sourceLabel = runtime.sourceLabel;
        const sourceUrl = runtime.normalizedUrl || deck.sourceUrl || '';
        this.inlineDeckContainer.innerHTML = '';

        if (runtime.canMirrorInApp && runtime.embedUrl) {
            const shell = document.createElement('div');
            shell.className = 'reveal-external-embed-shell';

            const iframe = document.createElement('iframe');
            iframe.className = 'reveal-external-embed-frame';
            iframe.src = runtime.embedUrl;
            iframe.title = `${deck.name || sourceLabel} presentation`;
            iframe.loading = 'lazy';
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'fullscreen');

            shell.appendChild(iframe);
            this.inlineDeckContainer.appendChild(shell);
            return runtime;
        }

        const card = document.createElement('div');
        card.className = 'reveal-external-source-card';

        const eyebrow = document.createElement('span');
        eyebrow.className = 'reveal-external-source-card__eyebrow';
        eyebrow.textContent = sourceLabel;
        card.appendChild(eyebrow);

        const heading = document.createElement('h3');
        heading.textContent = deck.name || sourceLabel;
        card.appendChild(heading);

        const message = document.createElement('p');
        message.textContent = `${sourceLabel} can preview here in an embeddable view, but Projector opens the live source window because external decks do not slide-sync through Teacher Screen. Reveal Prev / Next controls still stay reserved for HTML decks.`;
        card.appendChild(message);

        const link = document.createElement('a');
        link.className = 'reveal-external-source-card__link';
        link.href = sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = sourceUrl;
        card.appendChild(link);

        this.inlineDeckContainer.appendChild(card);
        return runtime;
    }

    async launchDeck(deck, { preserveIndices = false } = {}) {
        const normalizedDeck = this.normalizeStoredDeck(deck);
        if (!normalizedDeck) {
            this.setStatus('That deck could not be loaded.');
            return false;
        }

        if (this.reactivateTimeout) {
            clearTimeout(this.reactivateTimeout);
            this.reactivateTimeout = null;
        }
        const pendingRender = this.renderPromise;
        if (pendingRender) {
            this.renderVersion += 1;
            try {
                await pendingRender;
            } catch (error) {
                console.warn('[Reveal] previous deck render did not finish cleanly', error);
            }
            this.renderPromise = null;
        }
        this.detachDeckListeners();

        this.setStatus('Loading deck...');
        const previousDeck = this.activeDeck;
        this.activeDeck = normalizedDeck;
        let runtimeDeck = normalizedDeck;
        try {
            if (this.isStoredImportDeck(normalizedDeck)) {
                runtimeDeck = await this.hydrateStoredDeck(normalizedDeck);
            } else {
                this.clearRuntimeObjectUrls();
            }
        } catch (error) {
            this.activeDeck = previousDeck;
            console.warn('Unable to restore imported slide deck:', error);
            this.setStatus(error?.code === 'SLIDE_DECK_MISSING' || error?.code === 'SLIDE_ASSET_MISSING'
                ? 'This imported deck is no longer stored on this device. Re-import the original file.'
                : 'This imported deck could not be restored from browser storage.');
            return false;
        }

        this.activeDeck = runtimeDeck;

        if (!preserveIndices) {
            this.currentIndices = { h: 0, v: 0 };
        }

        this.updateDeckIndicator();
        this.updateControls();
        this.savedSelect.value = String(runtimeDeck.id || '');
        this.toggleCompact(true);
        this.updateSourceFields();

        const loadedDeck = await this.renderActiveDeck({ preserveIndices });
        if (this.activeDeck.type === 'html' && !loadedDeck) {
            this.saveLastDeck(this.activeDeck);
            this.persistActiveDeckState();
            return false;
        }

        this.saveLastDeck(this.activeDeck);
        this.persistActiveDeckState();
        return true;
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
        this.clearRuntimeObjectUrls();
        this.revealDeck = null;
        this.activeDeck = null;
        this.currentIndices = { h: 0, v: 0 };
        this.savedSelect.value = '';
        this.setStatus('');
        this.updateSourceFields();
        this.updateDeckIndicator();
        this.updateControls();
        this.persistActiveDeckState();
    }

    broadcastSlideSync(event = null) {
        if (!this.activeDeck || this.activeDeck.type !== 'html' || !this.isTeacherMode()) {
            return null;
        }

        this.updateCurrentIndices(event);
        this.emitPresentationState();

        const payload = {
            type: 'slideSync',
            h: this.currentIndices.h || 0,
            v: this.currentIndices.v || 0,
            deck: this.getPersistentDeckReference(this.activeDeck),
            html: this.isStoredImportDeck(this.activeDeck) ? '' : this.activeDeck.content
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
        if (!this.activeDeck || this.activeDeck.type !== 'html' || !this.revealDeck) return;

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
        if (!this.saveDecks(decks)) {
            return;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
        this.setStatus('Deck saved.');
    }

    handleConvertToRevealDeck() {
        const promptSource = this.promptForExternalSourceConversion();
        if (!promptSource) return;

        const deckName = (this.deckNameInput?.value || '').trim();
        const deck = this.buildRevealDeckFromExternalSource({
            type: promptSource.type,
            sourceUrl: promptSource.sourceUrl,
            name: deckName
        });
        if (!deck) return;

        const decks = this.getSavedDecks();
        decks.push(deck);
        if (!this.saveDecks(decks)) {
            return;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
        this.sourceTypeSelect.value = 'html';
        this.deckNameInput.value = deck.name;
        this.externalUrlInput.value = promptSource.sourceUrl;
        this.htmlInput.value = deck.content;
        this.updateSourceFields();
        this.launchDeck(deck, { preserveIndices: false });
        this.setStatus('Converted to Reveal.');
    }

    async handleLaunchSaved() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) {
            this.setStatus('Choose a saved deck first.');
            return;
        }

        const deck = this.getSavedDeckById(selectedId);
        const normalized = this.normalizeStoredDeck(deck);

        if (!normalized) {
            this.setStatus('That saved deck is not supported in the rebuilt widget.');
            return;
        }

        this.deckNameInput.value = normalized.name;
        this.sourceTypeSelect.value = normalized.type || 'html';
        this.externalUrlInput.value = normalized.sourceUrl || '';
        this.htmlInput.value = this.isStoredImportDeck(normalized) ? '' : (normalized.content || '');
        this.updateSourceFields();
        await this.launchDeck(normalized, { preserveIndices: false });
    }

    async loadSavedDeckById(deckId) {
        const deck = this.getSavedDeckById(deckId);
        const normalized = this.normalizeStoredDeck(deck);

        if (!normalized) {
            this.setStatus('That saved deck is not supported in the rebuilt widget.');
            return false;
        }

        this.deckNameInput.value = normalized.name;
        this.sourceTypeSelect.value = normalized.type || 'html';
        this.externalUrlInput.value = normalized.sourceUrl || '';
        this.htmlInput.value = this.isStoredImportDeck(normalized) ? '' : (normalized.content || '');
        this.updateSourceFields();
        await this.launchDeck(normalized, { preserveIndices: false });
        return !!this.activeDeck;
    }

    async loadLastDeck() {
        const deck = this.getLastDeck();
        if (!deck) {
            this.setStatus('No last deck is available yet.');
            return false;
        }

        this.deckNameInput.value = deck.name;
        this.sourceTypeSelect.value = deck.type || 'html';
        this.externalUrlInput.value = deck.sourceUrl || '';
        this.htmlInput.value = this.isStoredImportDeck(deck) ? '' : (deck.content || '');
        this.updateSourceFields();
        await this.launchDeck(deck, { preserveIndices: false });
        return !!this.activeDeck;
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

        if (!this.saveDecks(decks)) {
            return;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(selectedId);
        void this.updateStoredDeckName(decks[index]);
        this.setStatus('Deck renamed.');
    }

    renameSavedDeckById(deckId, nextName) {
        const selectedId = Number(deckId);
        const trimmedName = typeof nextName === 'string' ? nextName.trim() : '';
        if (!selectedId || !trimmedName) {
            return false;
        }

        const decks = this.getSavedDecks();
        const index = decks.findIndex((item) => Number(item?.id) === selectedId);
        if (index < 0) {
            return false;
        }

        decks[index] = {
            ...decks[index],
            name: trimmedName
        };

        if (!this.saveDecks(decks)) {
            return false;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(selectedId);
        void this.updateStoredDeckName(decks[index]);

        if (this.activeDeck && Number(this.activeDeck.id) === selectedId) {
            this.activeDeck = {
                ...this.activeDeck,
                name: trimmedName
            };
            this.saveLastDeck(this.activeDeck);
            this.updateDeckIndicator();
            this.emitPresentationState();
            this.persistActiveDeckState();
        }

        this.setStatus('Deck renamed.');
        return true;
    }

    async handleDeleteDeck() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) return;

        const savedDecks = this.getSavedDecks();
        const deletedDeck = savedDecks.find((item) => Number(item?.id) === selectedId) || null;
        const decks = savedDecks.filter((item) => Number(item?.id) !== selectedId);
        if (!deletedDeck || !this.saveDecks(decks)) {
            return;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = '';
        this.clearLastDeckReference(deletedDeck);
        const storedDataDeleted = !this.isStoredImportDeck(deletedDeck) || await this.deleteStoredDeckData(deletedDeck);
        if (this.activeDeck && Number(this.activeDeck.id) === selectedId) {
            await this.stopDeck();
        }
        if (storedDataDeleted) this.setStatus('Deck deleted.');
    }

    async deleteSavedDeckById(deckId) {
        const selectedId = Number(deckId);
        if (!selectedId) {
            return false;
        }

        const savedDecks = this.getSavedDecks();
        const deletedDeck = savedDecks.find((item) => Number(item?.id) === selectedId) || null;
        const nextDecks = savedDecks.filter((item) => Number(item?.id) !== selectedId);
        if (!deletedDeck || nextDecks.length === savedDecks.length) {
            return false;
        }

        if (!this.saveDecks(nextDecks)) {
            return false;
        }
        this.renderSavedDeckOptions();
        this.savedSelect.value = '';
        this.clearLastDeckReference(deletedDeck);
        const storedDataDeleted = !this.isStoredImportDeck(deletedDeck) || await this.deleteStoredDeckData(deletedDeck);

        if (this.activeDeck && Number(this.activeDeck.id) === selectedId) {
            await this.stopDeck();
        } else if (storedDataDeleted) {
            this.setStatus('Deck deleted.');
        }

        return true;
    }

    openProjector() {
        if (!this.activeDeck) {
            this.setStatus('Load a deck before opening the projector.');
            return false;
        }

        if (this.activeDeck.type !== 'html') {
            return this.openExternalSourceWindow(this.activeDeck);
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
            return false;
        }

        this.setStatus(this.activeDeck.type === 'html'
            ? 'Projector opening...'
            : `${this.getSourceTypeLabel(this.activeDeck.type)} projector opening...`);

        if (this.activeDeck.type === 'html') {
            window.setTimeout(() => this.broadcastSlideSync(), 500);
            window.setTimeout(() => this.broadcastSlideSync(), 1500);
        } else {
            window.setTimeout(() => this.persistActiveDeckState(), 300);
        }
        return true;
    }

    openExternalSourceWindow(deck) {
        const validation = this.validateExternalSourceUrl({
            type: deck?.type || 'google-slides',
            sourceUrl: deck?.sourceUrl || ''
        });
        if (!validation.canProceed) {
            this.renderExternalValidationState(validation);
            this.setStatus(validation.message || 'This external source does not have a usable URL yet.');
            return false;
        }

        const externalWindow = window.open(validation.normalizedUrl, 'projector', 'fullscreen=yes');
        if (!externalWindow) {
            this.setStatus('Projector popup blocked.');
            return false;
        }

        this.projectorWindow = externalWindow;
        this.setStatus(`${this.getSourceTypeLabel(deck.type)} opening in a live projector window...`);
        return true;
    }

    serialize() {
        return {
            type: 'RevealManagerWidget',
            activeDeck: this.getPersistentDeckReference(this.activeDeck),
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
        this.sourceTypeSelect.value = deck.type || 'html';
        this.externalUrlInput.value = deck.sourceUrl || '';
        this.htmlInput.value = this.isStoredImportDeck(deck) ? '' : (deck.content || '');
        this.updateSourceFields();
        void this.launchDeck(deck, { preserveIndices: true });
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
        this.toggleControlsButton.removeEventListener('click', this.handleToggleControls);
        this.sourceTypeSelect.removeEventListener('change', this.handleSourceTypeChange);
        this.deckFileInput.removeEventListener('change', this.handleDeckFileSelection);
        this.element.removeEventListener('click', this.handleRootInteraction);
        this.element.removeEventListener('focusin', this.handleRootInteraction);
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
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
