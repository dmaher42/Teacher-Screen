class DocumentViewerWidget {
    // Track which instance is "active" for keyboard shortcuts
    static activeInstance = null;
    static keyboardHandlerInitialized = false;

    constructor() {
        this.pdfDoc = null;
        this.totalPages = 0;
        this.currentPage = 1;
        this.isRenderingPage = false;

        this.element = document.createElement('div');
        this.element.className = 'document-viewer-widget-content';

        this.element.innerHTML = `
            <div class="document-viewer-controls">
                <input type="file" class="document-viewer-file-input" style="display: none;">
                <button class="control-button upload-button" type="button">Upload File</button>
                <input type="text" class="document-viewer-url-input" placeholder="Enter URL to embed">
                <button class="control-button embed-button" type="button">Embed</button>

                <div class="document-viewer-pdf-controls">
                    <button class="control-button nav-button prev-button" type="button" disabled>Previous</button>
                    <span class="document-viewer-page-counter">Page 0 of 0</span>
                    <button class="control-button nav-button next-button" type="button" disabled>Next</button>
                    <button class="control-button present-button" type="button">Present</button>
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

        // Canvas (created lazily)
        this.canvas = null;
        this.ctx = null;

        // Bind event handlers to this instance
        this.handleUploadClick = this.handleUploadClick.bind(this);
        this.handleFileChange = this.handleFileChange.bind(this);
        this.handleEmbedClick = this.handleEmbedClick.bind(this);
        this.handlePrevClick = this.handlePrevClick.bind(this);
        this.handleNextClick = this.handleNextClick.bind(this);
        this.handlePresentClick = this.handlePresentClick.bind(this);
        this.handleExitPresentClick = this.handleExitPresentClick.bind(this);
        this.handleRootClick = this.handleRootClick.bind(this);

        // Wire up UI events
        this.element.querySelector('.upload-button').addEventListener('click', this.handleUploadClick);
        this.fileInput.addEventListener('change', this.handleFileChange);
        this.element.querySelector('.embed-button').addEventListener('click', this.handleEmbedClick);
        this.prevBtn.addEventListener('click', this.handlePrevClick);
        this.nextBtn.addEventListener('click', this.handleNextClick);
        this.presentBtn.addEventListener('click', this.handlePresentClick);
        this.exitPresentBtn.addEventListener('click', this.handleExitPresentClick);

        // When the widget is interacted with, mark it as active for keyboard control
        this.element.addEventListener('click', this.handleRootClick);
        this.element.addEventListener('focusin', this.handleRootClick);

        // Ensure global keyboard handler is set up once
        DocumentViewerWidget.initKeyboardHandler();
    }

    // Global keydown handler shared by all instances
    static initKeyboardHandler() {
        if (DocumentViewerWidget.keyboardHandlerInitialized) return;

        document.addEventListener('keydown', (event) => {
            const active = DocumentViewerWidget.activeInstance;
            if (!active || !active.pdfDoc) return;

            // Only respond to arrow keys when a PDF is loaded
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                active.goToPage(active.currentPage - 1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                active.goToPage(active.currentPage + 1);
            }
        });

        DocumentViewerWidget.keyboardHandlerInitialized = true;
    }

    handleRootClick() {
        DocumentViewerWidget.activeInstance = this;
    }

    handleUploadClick() {
        this.fileInput.click();
    }

    handleFileChange(event) {
        const file = event.target.files[0];
        if (file) {
            if (file.type === 'application/pdf') {
                this.renderPdf(file);
            } else {
                this.resetPdfState();
                this.contentArea.innerHTML = `<p>File type not supported. Please upload a PDF file.</p>`;
            }
        }
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

    resetPdfState() {
        this.pdfDoc = null;
        this.totalPages = 0;
        this.currentPage = 1;
        this.isRenderingPage = false;
        this.updateNavControls();
    }

    renderPdf(file) {
        this.resetPdfState();
        this.contentArea.innerHTML = `<p>Loading PDF…</p>`;

        const fileReader = new FileReader();
        fileReader.onload = () => {
            const typedarray = new Uint8Array(fileReader.result);

            // pdfjsLib should be available globally
            pdfjsLib.getDocument(typedarray).promise
                .then((pdf) => {
                    this.pdfDoc = pdf;
                    this.totalPages = pdf.numPages;

                    // Prepare canvas
                    this.contentArea.innerHTML = '';
                    if (!this.canvas) {
                        const container = document.createElement('div');
                        container.className = 'document-viewer-canvas-container';
                        this.canvas = document.createElement('canvas');
                        container.appendChild(this.canvas);
                        this.contentArea.appendChild(container);
                        this.ctx = this.canvas.getContext('2d');
                    } else {
                        // Ensure canvas is attached
                        this.contentArea.appendChild(this.canvas.parentElement || this.canvas);
                    }

                    this.updateNavControls();
                    this.goToPage(1);
                })
                .catch((error) => {
                    console.error('PDF load error:', error);
                    this.resetPdfState();
                    this.contentArea.innerHTML = `<p>Unable to load document.</p>`;
                });
        };

        fileReader.readAsArrayBuffer(file);
    }

    goToPage(pageNum) {
        if (!this.pdfDoc) return;
        if (this.isRenderingPage) return;

        // Clamp the page number
        pageNum = Math.max(1, Math.min(pageNum, this.totalPages));
        if (pageNum === this.currentPage && this.canvas) {
            // Already on this page
            return;
        }

        this.isRenderingPage = true;
        this.currentPage = pageNum;
        this.updateNavControls();

        this.pdfDoc.getPage(this.currentPage).then((page) => {
            const containerWidth = this.contentArea.clientWidth || 800;
            const viewport = page.getViewport({ scale: 1 }); // initial scale
            const scale = containerWidth / viewport.width;
            const scaledViewport = page.getViewport({ scale });

            this.canvas.width = scaledViewport.width;
            this.canvas.height = scaledViewport.height;

            const renderContext = {
                canvasContext: this.ctx,
                viewport: scaledViewport,
            };

            const renderTask = page.render(renderContext);
            return renderTask.promise;
        }).then(() => {
            this.isRenderingPage = false;
        }).catch((error) => {
            console.error('PDF render error:', error);
            this.isRenderingPage = false;
        });
    }

    updateNavControls() {
        const hasPdf = !!this.pdfDoc;

        this.prevBtn.disabled = !hasPdf || this.currentPage <= 1;
        this.nextBtn.disabled = !hasPdf || this.currentPage >= this.totalPages;

        if (hasPdf) {
            this.pageCounterEl.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
        } else {
            this.pageCounterEl.textContent = `Page 0 of 0`;
        }
    }

    enterPresentationMode() {
        this.element.classList.add('presentation-mode');
        this.presentBtn.style.display = 'none';
        this.exitPresentBtn.style.display = 'inline-block';

        // Ensure this widget is the active one for keyboard nav
        DocumentViewerWidget.activeInstance = this;

        // Re-render current page into the new size if a PDF is loaded
        if (this.pdfDoc) {
            this.goToPage(this.currentPage);
        }
    }

    exitPresentationMode() {
        this.element.classList.remove('presentation-mode');
        this.presentBtn.style.display = 'inline-block';
        this.exitPresentBtn.style.display = 'none';

        // Re-render at normal size if a PDF is loaded
        if (this.pdfDoc) {
            this.goToPage(this.currentPage);
        }
    }

    embedUrl(url) {
        this.resetPdfState();

        if (url) {
            // Simple URL validation: add protocol if missing
            const hasProtocol = /^https?:\/\//i.test(url);
            const safeUrl = hasProtocol ? url : `https://${url}`;

            this.contentArea.innerHTML = `
                <iframe src="${safeUrl}" 
                        class="document-viewer-iframe"
                        style="width: 100%; height: 100%; border: none;"></iframe>`;
        } else {
            this.contentArea.innerHTML = `<p>Please enter a URL to embed.</p>`;
        }
    }

    serialize() {
        const iframe = this.contentArea.querySelector('iframe');
        return {
            type: 'DocumentViewerWidget',
            url: iframe ? iframe.src : null,
            // Note: PDF files uploaded via <input type="file"> cannot be
            // reliably reloaded without additional file-handling logic.
        };
    }

    // Optional: Call this if your larger system supports destroying widgets
    destroy() {
        this.element.removeEventListener('click', this.handleRootClick);
        this.element.removeEventListener('focusin', this.handleRootClick);

        this.element.querySelector('.upload-button')?.removeEventListener('click', this.handleUploadClick);
        this.fileInput?.removeEventListener('change', this.handleFileChange);
        this.element.querySelector('.embed-button')?.removeEventListener('click', this.handleEmbedClick);
        this.prevBtn?.removeEventListener('click', this.handlePrevClick);
        this.nextBtn?.removeEventListener('click', this.handleNextClick);
        this.presentBtn?.removeEventListener('click', this.handlePresentClick);
        this.exitPresentBtn?.removeEventListener('click', this.handleExitPresentClick);

        if (DocumentViewerWidget.activeInstance === this) {
            DocumentViewerWidget.activeInstance = null;
        }
    }
}

