/**
 * QR Code Widget Class
 * Generates a QR code from user-provided text using the QRCode library.
 */
class QRCodeWidget {
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'widget';
        this.element.dataset.widgetType = 'qr-code';

        // Create the widget header
        this.header = document.createElement('div');
        this.header.className = 'widget-header';

        this.title = document.createElement('div');
        this.title.className = 'widget-title';
        this.title.textContent = 'QR Code';

        this.helpButton = document.createElement('button');
        this.helpButton.className = 'widget-help';
        this.helpButton.textContent = '?';

        this.closeButton = document.createElement('button');
        this.closeButton.className = 'widget-close';
        this.closeButton.innerHTML = '&times;';
        this.closeButton.addEventListener('click', () => this.remove());

        this.controls = document.createElement('div');
        this.controls.className = 'widget-controls';
        this.controls.appendChild(this.helpButton);
        this.controls.appendChild(this.closeButton);

        this.header.appendChild(this.title);
        this.header.appendChild(this.controls);

        // Create the widget content area
        this.content = document.createElement('div');
        this.content.className = 'widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.textContent = 'Edit the text or URL, then click Generate to refresh the QR code. Share or download the code using your browser tools.';
        this.helpButton.addEventListener('click', () => {
            const isVisible = this.helpText.style.display === 'block';
            this.helpText.style.display = isVisible ? 'none' : 'block';
        });

        // Input for QR content
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.placeholder = 'Enter text or URL';
        this.input.className = 'qr-input';

        // Button to generate QR code
        this.generateButton = document.createElement('button');
        this.generateButton.textContent = 'Generate';
        this.generateButton.addEventListener('click', () => this.generate());

        // Canvas to render the QR code
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'qr-code-canvas';

        // Assemble widget
        this.content.appendChild(this.helpText);
        this.content.appendChild(this.input);
        this.content.appendChild(this.generateButton);
        this.content.appendChild(this.canvas);
        this.element.appendChild(this.header);
        this.element.appendChild(this.content);

        // Initialize with a default QR code
        this.input.value = 'https://example.com';
        this.generate();
    }

    /**
     * Generate a QR code based on the current input value.
     */
    generate() {
        const text = this.input.value.trim() || ' ';
        if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(this.canvas, text, { width: 200 }).catch((error) => {
                console.error('QR generation failed:', error);
            });
        } else {
            console.error('QRCode library is not loaded.');
        }
    }

    /**
     * Remove the widget from the DOM and notify listeners.
     */
    remove() {
        this.element.remove();
        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    /**
     * Serialize the widget state.
     * @returns {object}
     */
    serialize() {
        return {
            type: 'QRCodeWidget',
            text: this.input.value
        };
    }

    /**
     * Deserialize the widget state.
     * @param {object} data
     */
    deserialize(data) {
        this.input.value = data.text || '';
        this.generate();
    }
}
