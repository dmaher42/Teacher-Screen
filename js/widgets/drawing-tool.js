/**
 * Drawing Tool Widget Class
 * Creates a simple drawing canvas with color and line width controls.
 */
class DrawingToolWidget {
    /**
     * Constructor for DrawingToolWidget.
     */
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'drawing-tool-widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Pick a color and line width, draw on the canvas, and use Clear to reset. Right-click or use browser tools to save your drawing.';

        // Create the canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'drawing-tool-canvas';
        this.ctx = this.canvas.getContext('2d');

        // Create the controls
        this.controls = document.createElement('div');
        this.controls.className = 'drawing-tool-controls';

        // Color picker
        this.colorPicker = document.createElement('input');
        this.colorPicker.type = 'color';
        this.colorPicker.className = 'color-picker';
        this.colorPicker.value = '#000000';
        this.colorPicker.addEventListener('change', (e) => this.setColor(e.target.value));

        // Line width selector
        this.lineWidthSelector = document.createElement('input');
        this.lineWidthSelector.type = 'range';
        this.lineWidthSelector.min = '1';
        this.lineWidthSelector.max = '20';
        this.lineWidthSelector.value = '2';
        this.lineWidthSelector.addEventListener('input', (e) => this.setLineWidth(e.target.value));

        // Clear button
        this.clearButton = document.createElement('button');
        this.clearButton.textContent = 'Clear';
        this.clearButton.addEventListener('click', () => this.clear());

        // Assemble the controls
        this.controls.appendChild(this.colorPicker);
        this.controls.appendChild(this.lineWidthSelector);
        this.controls.appendChild(this.clearButton);

        // Assemble the widget
        this.element.appendChild(this.helpText);
        this.element.appendChild(this.canvas);
        this.element.appendChild(this.controls);

        // Drawing state
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.currentLineWidth = 2;

        // Set up event listeners after the element is in the DOM
        setTimeout(() => this.setupCanvas(), 0);
    }

    /**
     * Set up the canvas dimensions and drawing event listeners.
     * This is called after the widget is added to the DOM.
     */
    setupCanvas() {
        // Set canvas size based on its container's dimensions
        const rect = this.content.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height - this.controls.offsetHeight; // Adjust for controls

        // Set initial drawing styles
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.setupEventListeners();
    }

    /**
     * Set up mouse/touch event listeners for drawing.
     */
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseleave', () => this.stopDrawing());

        // Add touch support for tablets
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            this.canvas.dispatchEvent(mouseEvent);
        });
    }

    /**
     * Handle the start of a drawing action.
     */
    startDrawing(e) {
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        this.ctx.beginPath();
        this.ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    }

    /**
     * Handle the drawing motion.
     */
    draw(e) {
        if (!this.isDrawing) return;
        const rect = this.canvas.getBoundingClientRect();
        this.ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.currentLineWidth;
        this.ctx.stroke();
    }

    /**
     * Handle the end of a drawing action.
     */
    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.ctx.beginPath(); // Reset the path
        }
    }

    /**
     * Set the drawing color.
     * @param {string} color - The new color.
     */
    setColor(color) {
        this.currentColor = color;
    }

    /**
     * Set the line width.
     * @param {number} width - The new line width.
     */
    setLineWidth(width) {
        this.currentLineWidth = width;
    }

    /**
     * Clear the entire canvas.
     */
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Remove the widget from the DOM.
     */
    remove() {
        this.element.remove();
        // Notify the app to update its widget list
        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    toggleHelp() {
        const isVisible = this.helpText.style.display === 'block';
        this.helpText.style.display = isVisible ? 'none' : 'block';
    }

    /**
     * Serialize the widget's state for saving to localStorage.
     * @returns {object} The serialized state.
     */
    serialize() {
        // Save the canvas as a data URL
        const imageData = this.canvas.toDataURL();
        return {
            type: 'DrawingToolWidget',
            imageData: imageData
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        if (data.imageData) {
            const img = new Image();
            img.onload = () => {
                // Redraw the saved image onto the canvas
                this.ctx.drawImage(img, 0, 0);
            };
            img.src = data.imageData;
        }
    }
}
