const DOCUMENT_VIEWER_DB_NAME = 'teacher-screen-documents';
const DOCUMENT_VIEWER_DB_VERSION = 1;
const DOCUMENT_VIEWER_STORE_NAME = 'pdfs';
const DOCUMENT_VIEWER_MAX_PDF_BYTES = 50 * 1024 * 1024;
let documentViewerDatabasePromise = null;

function openDocumentViewerDatabase() {
    if (documentViewerDatabasePromise) {
        return documentViewerDatabasePromise;
    }

    documentViewerDatabasePromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('Browser document storage is unavailable.'));
            return;
        }

        const request = indexedDB.open(DOCUMENT_VIEWER_DB_NAME, DOCUMENT_VIEWER_DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(DOCUMENT_VIEWER_STORE_NAME)) {
                database.createObjectStore(DOCUMENT_VIEWER_STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onerror = () => reject(request.error || new Error('Unable to open document storage.'));
        request.onblocked = () => reject(new Error('Document storage is blocked by another open Teacher Screen tab.'));
        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => {
                database.close();
                documentViewerDatabasePromise = null;
            };
            resolve(database);
        };
    }).catch((error) => {
        documentViewerDatabasePromise = null;
        throw error;
    });

    return documentViewerDatabasePromise;
}

async function saveDocumentViewerPdf(record) {
    const database = await openDocumentViewerDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(DOCUMENT_VIEWER_STORE_NAME, 'readwrite');
        transaction.oncomplete = () => resolve(record.id);
        transaction.onerror = () => reject(transaction.error || new Error('Unable to save the PDF.'));
        transaction.onabort = () => reject(transaction.error || new Error('Saving the PDF was cancelled.'));
        transaction.objectStore(DOCUMENT_VIEWER_STORE_NAME).put(record);
    });
}

async function loadDocumentViewerPdf(id) {
    const database = await openDocumentViewerDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(DOCUMENT_VIEWER_STORE_NAME, 'readonly');
        const request = transaction.objectStore(DOCUMENT_VIEWER_STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Unable to restore the PDF.'));
    });
}

class DocumentViewerWidget {
    static presentingInstance = null;
    static activeInstance = null;

    constructor() {
        this.layoutType = 'stage';
        this.pdfDoc = null;
        this.totalPages = 0;
        this.currentPage = 1;
        this.isRenderingPage = false;
        this.sourceMode = 'none';
        this.localPdfName = '';
        this.localPdfSize = 0;
        this.storedPdfId = '';
        this.pdfRequiresReupload = false;
        this.pendingRestoreNotice = '';
        this.persistenceNotice = '';
        this.loadGeneration = 0;

        this.element = document.createElement('div');
        this.element.className = 'document-viewer document-viewer-widget-content';

        this.element.innerHTML = `
            <div class="document-viewer-controls">
                <input type="file" class="document-viewer-file-input" accept=".pdf,application/pdf" style="display: none;">
                <input type="text" class="document-viewer-url-input" placeholder="Enter URL to embed" aria-label="Document URL">
                <button class="control-button upload-button" type="button">Upload PDF</button>
                <button class="control-button embed-button" type="button">Embed</button>

                <div class="document-viewer-pdf-controls">
                    <button class="control-button nav-button prev-button" type="button" disabled>Previous</button>
                    <span class="document-viewer-page-counter">Page 0 of 0</span>
                    <button class="control-button nav-button next-button" type="button" disabled>Next</button>
                    <button class="control-button present-button" type="button" disabled>Present</button>
                    <button class="control-button exit-present-button" type="button" style="display:none;">Exit Presentation</button>
                </div>
            </div>
            <div class="document-viewer-content">
                <!-- PDF canvas or iframe goes here -->
            </div>
        `;

        this.contentArea = this.element.querySelector('.document-viewer-content');
        this.fileInput = this.element.querySelector('.document-viewer-file-input');
        this.urlInput = this.element.querySelector('.document-viewer-url-input');

        // PDF navigation controls
        this.prevBtn = this.element.querySelector('.prev-button');
        this.nextBtn = this.element.querySelector('.next-button');
        this.pageCounterEl = this.element.querySelector('.document-viewer-page-counter');
        this.presentBtn = this.element.querySelector('.present-button');
        this.exitPresentBtn = this.element.querySelector('.exit-present-button');
        this.pdfControls = this.element.querySelector('.document-viewer-pdf-controls');

        // Build unified control bar
        const controlBar = document.createElement('div');
        controlBar.className = 'widget-control-bar';

        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions';
        primaryActions.append(
            this.element.querySelector('.upload-button'),
            this.element.querySelector('.embed-button'),
            this.pdfControls
        );

        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';
        this.presentBtn.title = 'Start presentation mode';
        this.exitPresentBtn.title = 'Exit presentation mode';
        secondaryActions.append(this.presentBtn, this.exitPresentBtn);

        controlBar.append(primaryActions, secondaryActions);
        this.element.appendChild(controlBar);
        this.controlBar = controlBar;
        this.controlsRow = this.element.querySelector('.document-viewer-controls');

        // Canvas (created lazily)
        this.canvas = null;
        this.ctx = null;
        this.canvasContainer = null;

        // Bind event handlers to this instance
        this.handleUploadClick = this.handleUploadClick.bind(this);
        this.handleFileChange = this.handleFileChange.bind(this);
        this.handleEmbedClick = this.handleEmbedClick.bind(this);
        this.handleUrlKeydown = this.handleUrlKeydown.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
        this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.handlePrevClick = this.handlePrevClick.bind(this);
        this.handleNextClick = this.handleNextClick.bind(this);
        this.handlePresentClick = this.handlePresentClick.bind(this);
        this.handleExitPresentClick = this.handleExitPresentClick.bind(this);
        this.handleRootClick = this.handleRootClick.bind(this);

        // Wire up UI events
        this.element.querySelector('.upload-button').addEventListener('click', this.handleUploadClick);
        this.fileInput.addEventListener('change', this.handleFileChange);
        this.element.querySelector('.embed-button').addEventListener('click', this.handleEmbedClick);
        this.urlInput.addEventListener('keydown', this.handleUrlKeydown);
        this.prevBtn.addEventListener('click', this.handlePrevClick);
        this.nextBtn.addEventListener('click', this.handleNextClick);
        this.presentBtn.addEventListener('click', this.handlePresentClick);
        this.exitPresentBtn.addEventListener('click', this.handleExitPresentClick);
        document.addEventListener('keydown', this.handleDocumentKeydown);
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);

        // When the widget is interacted with, mark it as active for keyboard control
        this.element.addEventListener('pointerdown', this.handleRootClick, true);
        this.element.addEventListener('click', this.handleRootClick);
        this.element.addEventListener('focusin', this.handleRootClick);

        this.element.tabIndex = 0;
        this.element.setAttribute('aria-label', 'Document viewer');
        this.showContentMessage('Upload a PDF or paste a document URL to begin.');
    }

    handleRootClick(event) {
        DocumentViewerWidget.activeInstance = this;
        if (!event?.target?.closest('button, input, textarea, select, a, iframe, [contenteditable="true"], [role="textbox"]')) {
            this.element.focus({ preventScroll: true });
        }
    }

    handleDocumentPointerDown(event) {
        if (DocumentViewerWidget.activeInstance === this && !this.element.contains(event.target)) {
            DocumentViewerWidget.activeInstance = null;
        }
    }

    handleDocumentKeydown(event) {
        if (DocumentViewerWidget.activeInstance !== this && DocumentViewerWidget.presentingInstance !== this) {
            return;
        }
        this.handleKeydown(event);
    }

    handleUrlKeydown(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.handleEmbedClick();
    }

    handleKeydown(event) {
        if (event.key === 'Escape' && this.element.classList.contains('presentation-mode')) {
            event.preventDefault();
            this.exitPresentationMode({ restoreFocus: true });
            return;
        }

        if (!this.pdfDoc || event.target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) {
            return;
        }

        const pageTargets = {
            ArrowLeft: this.currentPage - 1,
            ArrowRight: this.currentPage + 1,
            Home: 1,
            End: this.totalPages
        };
        if (!Object.prototype.hasOwnProperty.call(pageTargets, event.key)) {
            return;
        }

        event.preventDefault();
        this.goToPage(pageTargets[event.key]);
    }

    notifyChanged(action = 'document-state-changed') {
        document.dispatchEvent(new CustomEvent('widgetChanged', {
            detail: { widget: this, action }
        }));
    }

    handleUploadClick() {
        this.fileInput.click();
    }

    handleFileChange(event) {
        const file = event.target.files[0];
        if (file) {
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
            if (!isPdf) {
                this.loadGeneration += 1;
                this.resetPdfState();
                this.showContentMessage('File type not supported. Please upload a PDF file.');
                this.notifyChanged('document-cleared');
            } else if (file.size > DOCUMENT_VIEWER_MAX_PDF_BYTES) {
                this.loadGeneration += 1;
                this.resetPdfState();
                this.showContentMessage('This PDF is larger than 50 MB. Choose a smaller file.');
                this.notifyChanged('document-cleared');
            } else {
                void this.renderPdf(file);
            }
        }
        event.target.value = '';
    }

    handleEmbedClick() {
        const url = this.urlInput.value.trim();
        this.embedUrl(url);
    }

    handlePrevClick() {
        this.goToPage(this.currentPage - 1);
    }

    handleNextClick() {
        this.goToPage(this.currentPage + 1);
    }

    handlePresentClick() {
        this.enterPresentationMode();
    }

    handleExitPresentClick() {
        this.exitPresentationMode();
    }

    toggleHelp() {
        // No help text defined for this widget yet.
    }

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls document-viewer-settings-controls';

        const sourceSection = document.createElement('div');
        sourceSection.className = 'widget-settings-section';

        const sourceHeading = document.createElement('h3');
        sourceHeading.textContent = 'Source';
        sourceSection.appendChild(sourceHeading);

        const sourceLabel = document.createElement('label');
        sourceLabel.textContent = 'Embed URL';
        const sourceInput = document.createElement('input');
        sourceInput.type = 'text';
        sourceInput.value = this.urlInput.value || '';
        sourceInput.placeholder = 'https://example.com/document';
        sourceLabel.appendChild(sourceInput);
        sourceSection.appendChild(sourceLabel);

        const sourceActions = document.createElement('div');
        sourceActions.className = 'widget-settings-actions';

        const uploadButton = document.createElement('button');
        uploadButton.type = 'button';
        uploadButton.className = 'control-button';
        uploadButton.textContent = 'Upload PDF';

        const embedButton = document.createElement('button');
        embedButton.type = 'button';
        embedButton.className = 'control-button';
        embedButton.textContent = 'Load URL';

        sourceActions.append(uploadButton, embedButton);
        sourceSection.appendChild(sourceActions);
        controls.appendChild(sourceSection);

        const navigationSection = document.createElement('div');
        navigationSection.className = 'widget-settings-section';

        const navigationHeading = document.createElement('h3');
        navigationHeading.textContent = 'Actions';
        navigationSection.appendChild(navigationHeading);

        const navActions = document.createElement('div');
        navActions.className = 'widget-settings-actions';

        const prevButton = document.createElement('button');
        prevButton.type = 'button';
        prevButton.className = 'control-button';
        prevButton.textContent = 'Previous Page';

        const nextButton = document.createElement('button');
        nextButton.type = 'button';
        nextButton.className = 'control-button';
        nextButton.textContent = 'Next Page';

        const presentButton = document.createElement('button');
        presentButton.type = 'button';
        presentButton.className = 'control-button';

        navActions.append(prevButton, nextButton, presentButton);
        navigationSection.appendChild(navActions);
        controls.appendChild(navigationSection);

        const statusCard = document.createElement('div');
        statusCard.className = 'widget-settings-meta';
        const statusLabel = document.createElement('strong');
        statusLabel.textContent = 'Status';
        const statusText = document.createElement('span');
        statusCard.append(statusLabel, statusText);
        controls.appendChild(statusCard);

        const syncStatus = () => {
            const iframe = this.contentArea.querySelector('iframe');
            const embeddedUrl = iframe ? iframe.src : '';
            const hasPdf = !!this.pdfDoc;

            sourceInput.value = this.urlInput.value || embeddedUrl || '';
            prevButton.disabled = !hasPdf || this.currentPage <= 1;
            nextButton.disabled = !hasPdf || this.currentPage >= this.totalPages;
            presentButton.disabled = !hasPdf && !embeddedUrl;
            presentButton.textContent = this.element.classList.contains('presentation-mode')
                ? 'Exit Presentation Mode'
                : 'Enter Presentation Mode';

            if (hasPdf) {
                statusText.textContent = `PDF loaded. Page ${this.currentPage} of ${this.totalPages}.${this.persistenceNotice ? ` ${this.persistenceNotice}` : ''}`;
            } else if (this.pendingRestoreNotice) {
                statusText.textContent = this.pendingRestoreNotice;
            } else if (embeddedUrl) {
                statusText.textContent = embeddedUrl;
            } else {
                statusText.textContent = 'No document loaded yet.';
            }
        };

        uploadButton.addEventListener('click', () => {
            this.handleUploadClick();
            window.setTimeout(syncStatus, 250);
        });

        embedButton.addEventListener('click', () => {
            this.urlInput.value = sourceInput.value.trim();
            this.handleEmbedClick();
            syncStatus();
        });

        prevButton.addEventListener('click', () => {
            this.handlePrevClick();
            window.setTimeout(syncStatus, 0);
        });

        nextButton.addEventListener('click', () => {
            this.handleNextClick();
            window.setTimeout(syncStatus, 0);
        });

        presentButton.addEventListener('click', () => {
            if (this.element.classList.contains('presentation-mode')) {
                this.exitPresentationMode();
            } else {
                this.enterPresentationMode();
            }
            syncStatus();
        });

        sourceInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            embedButton.click();
        });

        syncStatus();
        return controls;
    }

    resetPdfState({ clearSource = true } = {}) {
        if (this.pdfDoc && typeof this.pdfDoc.destroy === 'function') {
            Promise.resolve(this.pdfDoc.destroy()).catch(() => {});
        }
        this.pdfDoc = null;
        this.totalPages = 0;
        this.currentPage = 1;
        this.isRenderingPage = false;
        this.pendingPage = null;
        this.activeRenderPromise = null;
        if (clearSource) {
            this.sourceMode = 'none';
            this.localPdfName = '';
            this.localPdfSize = 0;
            this.storedPdfId = '';
            this.pdfRequiresReupload = false;
            this.pendingRestoreNotice = '';
            this.persistenceNotice = '';
        }
        this.element.classList.remove('is-loading');
        this.updateNavControls();
    }

    showContentMessage(message) {
        const text = document.createElement('p');
        text.className = 'document-viewer-message';
        text.textContent = message;
        this.contentArea.replaceChildren(text);
        this.updateNavControls();
    }

    showLocalPdfRestoreNotice(fileName = '') {
        this.resetPdfState();
        const label = fileName ? `"${fileName}"` : 'This PDF';
        this.pendingRestoreNotice = `${label} needs to be uploaded again on this device.`;
        this.sourceMode = 'pdf-upload-missing';
        this.localPdfName = fileName || '';
        this.pdfRequiresReupload = true;
        this.showContentMessage(this.pendingRestoreNotice);
    }

    getPdfLibrary() {
        return window.pdfjsLib && typeof window.pdfjsLib.getDocument === 'function'
            ? window.pdfjsLib
            : null;
    }

    createStoredPdfId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return `pdf-${window.crypto.randomUUID()}`;
        }
        return `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    ensureCanvas() {
        if (!this.canvasContainer) {
            this.canvasContainer = document.createElement('div');
            this.canvasContainer.className = 'document-viewer-canvas-container';
        }
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.setAttribute('aria-label', 'PDF page');
            this.canvasContainer.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
        }
        this.contentArea.replaceChildren(this.canvasContainer);
    }

    async loadPdfBytes(arrayBuffer, generation) {
        const pdfLibrary = this.getPdfLibrary();
        if (!pdfLibrary) {
            const error = new Error('PDF support is unavailable.');
            error.code = 'PDF_ENGINE_UNAVAILABLE';
            throw error;
        }

        const typedArray = new Uint8Array(arrayBuffer.slice(0));
        const pdf = await pdfLibrary.getDocument({ data: typedArray, isEvalSupported: false }).promise;
        if (generation !== this.loadGeneration) {
            if (typeof pdf.destroy === 'function') {
                await Promise.resolve(pdf.destroy()).catch(() => {});
            }
            return false;
        }

        this.pdfDoc = pdf;
        this.totalPages = pdf.numPages;
        this.currentPage = 1;
        this.ensureCanvas();
        this.element.classList.remove('is-loading');
        this.updateNavControls();
        await this.goToPage(1);
        return true;
    }

    async renderPdf(file) {
        const generation = ++this.loadGeneration;
        this.exitPresentationMode();
        this.resetPdfState();
        this.sourceMode = 'pdf-upload';
        this.localPdfName = file?.name || 'document.pdf';
        this.localPdfSize = Number(file?.size) || 0;
        this.pdfRequiresReupload = true;
        this.element.classList.add('is-loading');
        this.showContentMessage('Loading PDF…');
        this.element.classList.add('is-loading');

        try {
            if (!this.getPdfLibrary()) {
                const error = new Error('PDF support is unavailable.');
                error.code = 'PDF_ENGINE_UNAVAILABLE';
                throw error;
            }

            const arrayBuffer = await file.arrayBuffer();
            if (generation !== this.loadGeneration) return;
            const loaded = await this.loadPdfBytes(arrayBuffer, generation);
            if (!loaded || generation !== this.loadGeneration) return;

            try {
                const storedPdfId = this.createStoredPdfId();
                await saveDocumentViewerPdf({
                    id: storedPdfId,
                    name: this.localPdfName,
                    size: this.localPdfSize,
                    type: 'application/pdf',
                    blob: file.slice(0, file.size, 'application/pdf'),
                    updatedAt: Date.now()
                });
                if (generation !== this.loadGeneration) return;
                this.storedPdfId = storedPdfId;
                this.pdfRequiresReupload = false;
                this.sourceMode = 'pdf-storage';
                this.persistenceNotice = 'Saved on this device for reload and projector use.';
            } catch (storageError) {
                console.warn('PDF storage unavailable:', storageError);
                this.persistenceNotice = 'This PDF is available for this session only.';
            }

            this.updateNavControls();
            this.notifyChanged('pdf-loaded');
        } catch (error) {
            if (generation !== this.loadGeneration) return;
            const isMissingEngine = error?.code === 'PDF_ENGINE_UNAVAILABLE';
            if (!isMissingEngine) {
                console.error('PDF load error:', error);
            }
            this.resetPdfState();
            this.showContentMessage(isMissingEngine
                ? 'PDF support could not load. Check your connection and try again.'
                : 'Unable to load this PDF. Try a different file.');
            this.notifyChanged('document-cleared');
        }
    }

    async restoreStoredPdf(localPdf = {}) {
        const generation = ++this.loadGeneration;
        this.exitPresentationMode();
        this.resetPdfState();
        this.sourceMode = 'pdf-storage-loading';
        this.localPdfName = localPdf.name || 'document.pdf';
        this.localPdfSize = Number(localPdf.size) || 0;
        this.storedPdfId = localPdf.id || '';
        this.pdfRequiresReupload = false;
        this.element.classList.add('is-loading');
        this.showContentMessage(`Restoring "${this.localPdfName}"…`);
        this.element.classList.add('is-loading');

        try {
            if (!this.getPdfLibrary()) {
                const error = new Error('PDF support is unavailable.');
                error.code = 'PDF_ENGINE_UNAVAILABLE';
                throw error;
            }
            const storedPdf = await loadDocumentViewerPdf(this.storedPdfId);
            if (generation !== this.loadGeneration) return;
            if (!storedPdf?.blob || typeof storedPdf.blob.arrayBuffer !== 'function') {
                this.showLocalPdfRestoreNotice(this.localPdfName);
                return;
            }

            this.localPdfName = storedPdf.name || this.localPdfName;
            this.localPdfSize = Number(storedPdf.size) || this.localPdfSize;
            const arrayBuffer = await storedPdf.blob.arrayBuffer();
            if (generation !== this.loadGeneration) return;
            const loaded = await this.loadPdfBytes(arrayBuffer, generation);
            if (!loaded || generation !== this.loadGeneration) return;
            this.sourceMode = 'pdf-storage';
            this.persistenceNotice = 'Saved on this device for reload and projector use.';
            this.updateNavControls();
        } catch (error) {
            if (generation !== this.loadGeneration) return;
            this.element.classList.remove('is-loading');
            if (error?.code === 'PDF_ENGINE_UNAVAILABLE') {
                this.sourceMode = 'pdf-storage-unavailable';
                this.showContentMessage('This PDF is saved, but PDF support could not load. Check your connection and reload.');
                return;
            }
            console.warn('PDF restore unavailable:', error);
            this.showLocalPdfRestoreNotice(this.localPdfName);
        }
    }

    goToPage(pageNum) {
        if (!this.pdfDoc) return Promise.resolve(false);

        const targetPage = Math.max(1, Math.min(pageNum, this.totalPages));
        if (this.isRenderingPage) {
            this.pendingPage = targetPage;
            return this.activeRenderPromise || Promise.resolve(false);
        }

        const generation = this.loadGeneration;
        const pdf = this.pdfDoc;
        this.isRenderingPage = true;
        this.currentPage = targetPage;
        this.updateNavControls();
        this.element.classList.add('is-loading');

        this.activeRenderPromise = pdf.getPage(targetPage).then((page) => {
            if (!this.canvas || !this.ctx || generation !== this.loadGeneration) {
                return false;
            }

            const containerWidth = this.contentArea.clientWidth || this.element.clientWidth || 800;
            const viewport = page.getViewport({ scale: 1 });
            const scale = containerWidth / viewport.width;
            const scaledViewport = page.getViewport({ scale });
            this.canvas.width = scaledViewport.width;
            this.canvas.height = scaledViewport.height;
            const renderTask = page.render({ canvasContext: this.ctx, viewport: scaledViewport });
            return renderTask.promise.then(() => true);
        }).catch((error) => {
            if (error?.name !== 'RenderingCancelledException' && generation === this.loadGeneration) {
                console.error('PDF render error:', error);
            }
            return false;
        }).finally(() => {
            if (generation !== this.loadGeneration) return;
            this.isRenderingPage = false;
            this.element.classList.remove('is-loading');
            const pendingPage = this.pendingPage;
            this.pendingPage = null;
            this.activeRenderPromise = null;
            if (pendingPage !== null && pendingPage !== this.currentPage) {
                this.goToPage(pendingPage);
            }
        });

        return this.activeRenderPromise;
    }

    updateNavControls() {
        const hasPdf = !!this.pdfDoc;
        const hasDocument = hasPdf || !!this.contentArea?.querySelector('iframe');

        this.prevBtn.disabled = !hasPdf || this.currentPage <= 1;
        this.nextBtn.disabled = !hasPdf || this.currentPage >= this.totalPages;
        this.presentBtn.disabled = !hasDocument;
        const navVisibility = hasPdf ? 'visible' : 'hidden';
        this.prevBtn.style.visibility = navVisibility;
        this.nextBtn.style.visibility = navVisibility;
        this.pageCounterEl.style.visibility = navVisibility;
        this.pageCounterEl.textContent = hasPdf
            ? `Page ${this.currentPage} of ${this.totalPages}`
            : 'Page 0 of 0';
    }

    enterPresentationMode() {
        if (this.presentBtn.disabled) return;
        if (DocumentViewerWidget.presentingInstance && DocumentViewerWidget.presentingInstance !== this) {
            DocumentViewerWidget.presentingInstance.exitPresentationMode();
        }

        DocumentViewerWidget.presentingInstance = this;
        this.element.classList.add('presentation-mode');
        this.element.setAttribute('role', 'dialog');
        this.element.setAttribute('aria-modal', 'true');
        this.element.closest('.widget')?.classList.add('document-viewer-widget--presenting');
        document.body.classList.add('document-viewer-presenting');
        this.presentBtn.style.display = 'none';
        this.exitPresentBtn.style.display = 'inline-block';
        this.element.focus({ preventScroll: true });

        window.requestAnimationFrame(() => this.onWidgetLayout());
    }

    exitPresentationMode({ restoreFocus = false } = {}) {
        const wasPresenting = this.element.classList.contains('presentation-mode');
        this.element.classList.remove('presentation-mode');
        this.element.removeAttribute('role');
        this.element.removeAttribute('aria-modal');
        this.element.closest('.widget')?.classList.remove('document-viewer-widget--presenting');
        if (DocumentViewerWidget.presentingInstance === this) {
            DocumentViewerWidget.presentingInstance = null;
            document.body.classList.remove('document-viewer-presenting');
        }
        this.presentBtn.style.display = 'inline-block';
        this.exitPresentBtn.style.display = 'none';

        if (wasPresenting) {
            window.requestAnimationFrame(() => this.onWidgetLayout());
            if (restoreFocus) {
                this.presentBtn.focus({ preventScroll: true });
            }
        }
    }

    embedUrl(url, { notifyChange = true } = {}) {
        this.loadGeneration += 1;
        this.exitPresentationMode();
        this.resetPdfState();

        if (url) {
            const hasProtocol = /^https?:\/\//i.test(url);
            const safeUrl = hasProtocol ? url : `https://${url}`;
            const iframe = document.createElement('iframe');
            iframe.className = 'document-viewer-iframe';
            iframe.src = safeUrl;
            iframe.title = 'Embedded document';
            iframe.loading = 'lazy';
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'fullscreen');
            this.sourceMode = 'embed-url';
            this.urlInput.value = safeUrl;
            this.contentArea.replaceChildren(iframe);
            this.updateNavControls();
        } else {
            this.showContentMessage('Please enter a URL to embed.');
        }

        if (notifyChange) {
            this.notifyChanged(url ? 'document-url-loaded' : 'document-cleared');
        }
    }

    serialize() {
        const iframe = this.contentArea.querySelector('iframe');
        const hasPdfSource = this.sourceMode.startsWith('pdf-') && !!this.localPdfName;
        return {
            type: 'DocumentViewerWidget',
            url: iframe ? iframe.src : null,
            localPdf: hasPdfSource
                ? {
                    id: this.storedPdfId || null,
                    name: this.localPdfName || '',
                    size: this.localPdfSize || 0,
                    requiresReupload: this.pdfRequiresReupload || !this.storedPdfId
                }
                : null
        };
    }

    deserialize(data = {}) {
        if (data.url) {
            this.urlInput.value = data.url;
            this.embedUrl(data.url, { notifyChange: false });
            return;
        }

        if (data.localPdf?.id && data.localPdf.requiresReupload !== true) {
            void this.restoreStoredPdf(data.localPdf);
            return;
        }

        if (data.localPdf?.requiresReupload) {
            this.showLocalPdfRestoreNotice(data.localPdf.name || '');
        }
    }

    onWidgetLayout() {
        if (!this.pdfDoc || this.isRenderingPage) {
            return;
        }

        window.requestAnimationFrame(() => {
            if (this.pdfDoc && !this.isRenderingPage) {
                this.goToPage(this.currentPage);
            }
        });
    }

    setEditable() {}

    // Optional: Call this if your larger system supports destroying widgets
    destroy() {
        this.loadGeneration += 1;
        this.exitPresentationMode();
        if (DocumentViewerWidget.activeInstance === this) {
            DocumentViewerWidget.activeInstance = null;
        }
        this.element.removeEventListener('pointerdown', this.handleRootClick, true);
        this.element.removeEventListener('click', this.handleRootClick);
        this.element.removeEventListener('focusin', this.handleRootClick);
        document.removeEventListener('keydown', this.handleDocumentKeydown);
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);

        this.element.querySelector('.upload-button')?.removeEventListener('click', this.handleUploadClick);
        this.fileInput?.removeEventListener('change', this.handleFileChange);
        this.element.querySelector('.embed-button')?.removeEventListener('click', this.handleEmbedClick);
        this.urlInput?.removeEventListener('keydown', this.handleUrlKeydown);
        this.prevBtn?.removeEventListener('click', this.handlePrevClick);
        this.nextBtn?.removeEventListener('click', this.handleNextClick);
        this.presentBtn?.removeEventListener('click', this.handlePresentClick);
        this.exitPresentBtn?.removeEventListener('click', this.handleExitPresentClick);
        if (this.pdfDoc && typeof this.pdfDoc.destroy === 'function') {
            Promise.resolve(this.pdfDoc.destroy()).catch(() => {});
        }
        this.pdfDoc = null;
    }
}
