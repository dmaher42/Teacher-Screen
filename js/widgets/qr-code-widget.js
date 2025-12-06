/**
 * QR Code Widget Class
 * Generates a QR code from user-provided text using the QRCode library.
 */
class QRCodeWidget {
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'qr-code-widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Edit the text or URL, then click Generate to refresh the QR code. Share or download the code using your browser tools.';

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
        this.element.appendChild(this.helpText);
        this.element.appendChild(this.input);
        this.element.appendChild(this.generateButton);
        this.element.appendChild(this.canvas);

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

    toggleHelp() {
        const isVisible = this.helpText.style.display === 'block';
        this.helpText.style.display = isVisible ? 'none' : 'block';
    }
}
