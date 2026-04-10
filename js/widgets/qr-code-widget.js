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
        this.element.appendChild(this.canvas);

        const controlBar = document.createElement('div');
        controlBar.className = 'widget-control-bar';

        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions';
        primaryActions.appendChild(this.generateButton);

        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';

        controlBar.append(primaryActions, secondaryActions);
        this.element.appendChild(controlBar);

        // Initialize with a default QR code
        this.input.value = 'https://example.com';
        this.generate();
    }

    /**
     * Generate a QR code based on the current input value.
     */
    generate() {
        const text = this.input.value.trim() || ' ';
        const size = this.getCanvasSize();
        if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(this.canvas, text, { width: size, margin: 1 }).catch((error) => {
                console.error('QR generation failed:', error);
            });
        } else {
            console.error('QRCode library is not loaded.');
        }
    }

    getCanvasSize() {
        const bounds = this.element.getBoundingClientRect();
        const usableWidth = Math.max(120, Math.floor(bounds.width - 32));
        const usableHeight = Math.max(120, Math.floor(bounds.height - 132));
        return Math.max(120, Math.min(280, usableWidth, usableHeight));
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

    onWidgetLayout() {
        this.generate();
    }

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls qr-code-settings-controls';

        const helpText = document.createElement('div');
        helpText.className = 'widget-help-text';
        helpText.textContent = 'Enter any text, link, or code and regenerate the QR image instantly.';
        controls.appendChild(helpText);

        const sourceSection = document.createElement('div');
        sourceSection.className = 'widget-settings-section';

        const sourceHeading = document.createElement('h3');
        sourceHeading.textContent = 'Source';
        sourceSection.appendChild(sourceHeading);

        const contentLabel = document.createElement('label');
        contentLabel.textContent = 'Text or URL';
        const contentInput = document.createElement('input');
        contentInput.type = 'text';
        contentInput.value = this.input.value;
        contentInput.placeholder = 'Enter text or URL';
        contentLabel.appendChild(contentInput);
        sourceSection.appendChild(contentLabel);

        const actions = document.createElement('div');
        actions.className = 'widget-settings-actions';
        const generateButton = document.createElement('button');
        generateButton.type = 'button';
        generateButton.className = 'control-button';
        generateButton.textContent = 'Generate QR Code';
        actions.appendChild(generateButton);
        sourceSection.appendChild(actions);
        controls.appendChild(sourceSection);

        const statusCard = document.createElement('div');
        statusCard.className = 'widget-settings-meta';
        const statusLabel = document.createElement('strong');
        statusLabel.textContent = 'Status';
        const statusText = document.createElement('span');
        statusCard.append(statusLabel, statusText);
        controls.appendChild(statusCard);

        const syncStatus = () => {
            statusText.textContent = this.input.value.trim() || 'Blank QR placeholder';
        };

        const applyGenerate = () => {
            this.input.value = contentInput.value;
            this.generate();
            syncStatus();
        };

        generateButton.addEventListener('click', applyGenerate);
        contentInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            applyGenerate();
        });

        syncStatus();
        return controls;
    }

    toggleHelp() {
        const isVisible = this.helpText.style.display === 'block';
        this.helpText.style.display = isVisible ? 'none' : 'block';
    }
}
