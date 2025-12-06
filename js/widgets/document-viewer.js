class DocumentViewerWidget {
    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'widget';
        this.element.innerHTML = `
            <div class="widget-header">
                <span class="widget-title">Document Viewer</span>
                <div class="widget-controls">
                    <button class="widget-close">&times;</button>
                </div>
            </div>
            <div class="widget-content">
                <div class="document-viewer-controls">
                    <input type="file" class="document-viewer-file-input" style="display: none;">
                    <button class="control-button upload-button">Upload File</button>
                    <input type="text" class="document-viewer-url-input" placeholder="Enter URL to embed">
                    <button class="control-button embed-button">Embed</button>
                </div>
                <div class="document-viewer-content"></div>
            </div>
        `;

        this.contentArea = this.element.querySelector('.document-viewer-content');
        this.fileInput = this.element.querySelector('.document-viewer-file-input');

        this.element.querySelector('.upload-button').addEventListener('click', () => {
            this.fileInput.click();
        });

        this.fileInput.addEventListener('change', (event) => {
            this.handleFileUpload(event);
        });

        this.element.querySelector('.embed-button').addEventListener('click', () => {
            const url = this.element.querySelector('.document-viewer-url-input').value;
            this.embedUrl(url);
        });
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file) {
            if (file.type === 'application/pdf') {
                this.renderPdf(file);
            } else {
                this.contentArea.innerHTML = `<p>File type not supported. Please upload a PDF file.</p>`;
            }
        }
    }

    renderPdf(file) {
        const fileReader = new FileReader();
        fileReader.onload = () => {
            const typedarray = new Uint8Array(fileReader.result);
            pdfjsLib.getDocument(typedarray).promise.then(pdf => {
                this.contentArea.innerHTML = '';
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    pdf.getPage(pageNum).then(page => {
                        const canvas = document.createElement('canvas');
                        this.contentArea.appendChild(canvas);
                        const context = canvas.getContext('2d');
                        const viewport = page.getViewport({ scale: 1.5 });
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        page.render({ canvasContext: context, viewport: viewport });
                    });
                }
            });
        };
        fileReader.readAsArrayBuffer(file);
    }

    embedUrl(url) {
        if (url) {
            this.contentArea.innerHTML = `<iframe src="${url}" style="width: 100%; height: 100%; border: none;"></iframe>`;
        }
    }

    serialize() {
        const iframe = this.contentArea.querySelector('iframe');
        return {
            type: 'DocumentViewerWidget',
            url: iframe ? iframe.src : null,
        };
    }
}
