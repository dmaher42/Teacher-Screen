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
        this.helpText.className = 'widget-help-text secondary-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Pick a color and line width, draw on the canvas, and use Clear to reset. Right-click or use browser tools to save your drawing.';

        // Create the canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'drawing-tool-canvas';
        this.ctx = this.canvas.getContext('2d');
        this.surface = document.createElement('div');
        this.surface.className = 'drawing-tool-surface';
        this.surfaceHint = document.createElement('div');
        this.surfaceHint.className = 'drawing-tool-surface__hint';
        this.surface.appendChild(this.canvas);
        this.surface.appendChild(this.surfaceHint);

        // Create the controls bar
        this.controls = document.createElement('div');
        this.controls.className = 'widget-control-bar drawing-tool-controls';

        this.toolButtons = new Map();

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
        this.clearButton.title = 'Clear drawing';
        this.clearButton.addEventListener('click', () => this.clear());

        // Assemble the controls
        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions';
        this.toolsGroup = document.createElement('div');
        this.toolsGroup.className = 'drawing-tool-tools';
        [
            ['freehand', 'Free'],
            ['line', 'Line'],
            ['rectangle', 'Box'],
            ['ellipse', 'Oval']
        ].forEach(([tool, label]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'drawing-tool-tool';
            button.textContent = label;
            button.title = label;
            button.dataset.tool = tool;
            button.addEventListener('click', () => this.setTool(tool));
            this.toolButtons.set(tool, button);
            this.toolsGroup.appendChild(button);
        });
        primaryActions.appendChild(this.toolsGroup);
        primaryActions.appendChild(this.colorPicker);
        primaryActions.appendChild(this.lineWidthSelector);

        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';
        this.statusBadge = document.createElement('span');
        this.statusBadge.className = 'drawing-tool-status';
        secondaryActions.appendChild(this.statusBadge);
        secondaryActions.appendChild(this.clearButton);

        this.controls.appendChild(primaryActions);
        this.controls.appendChild(secondaryActions);

        // Assemble the widget
        this.element.appendChild(this.helpText);
        this.element.appendChild(this.surface);
        this.element.appendChild(this.controls);

        // Drawing state
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.currentLineWidth = 2;
        this.currentTool = 'freehand';
        this.canvasListenersBound = false;
        this.pendingImageData = null;
        this.startPoint = null;
        this.lastPointer = null;
        this.previewSnapshot = null;
        this.hasContent = false;
        this.updateDrawingUI();

        // Set up event listeners after the element is in the DOM
        setTimeout(() => this.setupCanvas(), 0);
    }

    /**
     * Set up the canvas dimensions and drawing event listeners.
     * This is called after the widget is added to the DOM.
     */
    setupCanvas() {
        const nextWidth = Math.max(1, Math.floor(this.surface?.clientWidth || this.canvas.clientWidth || this.element.clientWidth || this.element.getBoundingClientRect().width));
        const nextHeight = Math.max(1, Math.floor(this.surface?.clientHeight || this.canvas.clientHeight || (this.element.clientHeight - this.controls.offsetHeight)));
        if (!nextWidth || !nextHeight) {
            return;
        }

        let previousSnapshot = null;
        if (this.canvas.width > 0 && this.canvas.height > 0) {
            previousSnapshot = document.createElement('canvas');
            previousSnapshot.width = this.canvas.width;
            previousSnapshot.height = this.canvas.height;
            previousSnapshot.getContext('2d').drawImage(this.canvas, 0, 0);
        }

        this.canvas.width = nextWidth;
        this.canvas.height = nextHeight;

        // Set initial drawing styles
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.setupEventListeners();

        if (previousSnapshot) {
            this.ctx.drawImage(previousSnapshot, 0, 0, nextWidth, nextHeight);
        } else {
            this.restorePendingImage();
        }
    }

    /**
     * Set up mouse/touch event listeners for drawing.
     */
    setupEventListeners() {
        if (this.canvasListenersBound) {
            return;
        }

        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', (e) => this.stopDrawing(e));
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

        this.canvasListenersBound = true;
    }

    /**
     * Handle the start of a drawing action.
     */
    startDrawing(e) {
        const point = this.getPointerPosition(e);
        this.isDrawing = true;
        this.startPoint = point;
        this.lastPointer = point;
        this.element.classList.add('is-drawing');

        if (this.currentTool === 'freehand') {
            this.ctx.beginPath();
            this.ctx.moveTo(point.x, point.y);
            return;
        }

        this.previewSnapshot = this.snapshotCanvas();
    }

    /**
     * Handle the drawing motion.
     */
    draw(e) {
        if (!this.isDrawing) return;
        const point = this.getPointerPosition(e);
        this.lastPointer = point;

        if (this.currentTool === 'freehand') {
            this.ctx.lineTo(point.x, point.y);
            this.ctx.strokeStyle = this.currentColor;
            this.ctx.lineWidth = this.currentLineWidth;
            this.ctx.stroke();
            this.hasContent = true;
            this.updateDrawingUI();
            return;
        }

        this.restoreSnapshot(this.previewSnapshot);
        this.drawShapeFromPoints(this.startPoint, point);
    }

    /**
     * Handle the end of a drawing action.
     */
    stopDrawing(e = null) {
        if (this.isDrawing) {
            if (this.currentTool !== 'freehand' && this.startPoint) {
                const point = e ? this.getPointerPosition(e) : this.lastPointer;
                this.restoreSnapshot(this.previewSnapshot);
                this.drawShapeFromPoints(this.startPoint, point);
                this.hasContent = true;
            }

            this.isDrawing = false;
            this.startPoint = null;
            this.lastPointer = null;
            this.previewSnapshot = null;
            this.element.classList.remove('is-drawing');
            this.ctx.beginPath(); // Reset the path
            this.updateDrawingUI();
        }
    }

    /**
     * Set the drawing color.
     * @param {string} color - The new color.
     */
    setColor(color) {
        this.currentColor = color;
        this.updateDrawingUI();
    }

    /**
     * Set the line width.
     * @param {number} width - The new line width.
     */
    setLineWidth(width) {
        this.currentLineWidth = width;
        this.updateDrawingUI();
    }

    setTool(tool) {
        this.currentTool = tool;
        this.updateDrawingUI();
    }

    updateDrawingUI() {
        const toolLabels = {
            freehand: 'Freehand',
            line: 'Line',
            rectangle: 'Box',
            ellipse: 'Oval'
        };

        this.toolButtons.forEach((button, tool) => {
            const isActive = tool === this.currentTool;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        if (this.surface) {
            this.surface.dataset.tool = this.currentTool;
            this.surface.classList.toggle('is-empty', !this.hasContent);
        }

        if (this.surfaceHint) {
            this.surfaceHint.textContent = this.hasContent
                ? ''
                : `${toolLabels[this.currentTool] || 'Freehand'} ready`;
        }

        if (this.statusBadge) {
            this.statusBadge.textContent = `${toolLabels[this.currentTool] || 'Freehand'} ${this.currentLineWidth}px`;
            this.statusBadge.style.setProperty('--drawing-tool-color', this.currentColor);
        }
    }

    getPointerPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    snapshotCanvas() {
        if (!this.canvas.width || !this.canvas.height) {
            return null;
        }

        const snapshot = document.createElement('canvas');
        snapshot.width = this.canvas.width;
        snapshot.height = this.canvas.height;
        snapshot.getContext('2d').drawImage(this.canvas, 0, 0);
        return snapshot;
    }

    restoreSnapshot(snapshot) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (snapshot) {
            this.ctx.drawImage(snapshot, 0, 0);
        }
    }

    drawShapeFromPoints(start, end) {
        if (!start || !end) {
            return;
        }

        const width = end.x - start.x;
        const height = end.y - start.y;

        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.currentLineWidth;
        this.ctx.beginPath();

        if (this.currentTool === 'line') {
            this.ctx.moveTo(start.x, start.y);
            this.ctx.lineTo(end.x, end.y);
        } else if (this.currentTool === 'rectangle') {
            this.ctx.strokeRect(start.x, start.y, width, height);
            return;
        } else if (this.currentTool === 'ellipse') {
            this.ctx.ellipse(
                start.x + (width / 2),
                start.y + (height / 2),
                Math.abs(width / 2),
                Math.abs(height / 2),
                0,
                0,
                Math.PI * 2
            );
        }

        this.ctx.stroke();
    }

    /**
     * Clear the entire canvas.
     */
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hasContent = false;
        this.updateDrawingUI();
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

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls drawing-tool-settings-controls';

        const helpText = document.createElement('div');
        helpText.className = 'widget-help-text';
        helpText.textContent = 'Adjust the drawing color and brush size here, then use Clear when you want a fresh board.';
        controls.appendChild(helpText);

        const drawSection = document.createElement('div');
        drawSection.className = 'widget-settings-section';

        const drawHeading = document.createElement('h3');
        drawHeading.textContent = 'Actions';
        drawSection.appendChild(drawHeading);

        const toolLabel = document.createElement('label');
        toolLabel.textContent = 'Tool';
        const toolSelect = document.createElement('select');
        [
            ['freehand', 'Freehand'],
            ['line', 'Straight line'],
            ['rectangle', 'Rectangle'],
            ['ellipse', 'Ellipse']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            toolSelect.appendChild(option);
        });
        toolSelect.value = this.currentTool;
        toolLabel.appendChild(toolSelect);
        drawSection.appendChild(toolLabel);

        const colorLabel = document.createElement('label');
        colorLabel.textContent = 'Brush color';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.currentColor;
        colorLabel.appendChild(colorInput);
        drawSection.appendChild(colorLabel);

        const sizeLabel = document.createElement('label');
        sizeLabel.textContent = 'Brush size';
        const sizeInput = document.createElement('input');
        sizeInput.type = 'range';
        sizeInput.min = '1';
        sizeInput.max = '20';
        sizeInput.value = String(this.currentLineWidth);
        sizeLabel.appendChild(sizeInput);
        drawSection.appendChild(sizeLabel);

        const sizeMeta = document.createElement('div');
        sizeMeta.className = 'widget-settings-meta';
        const sizeMetaLabel = document.createElement('strong');
        sizeMetaLabel.textContent = 'Status';
        const sizeMetaText = document.createElement('span');
        sizeMeta.append(sizeMetaLabel, sizeMetaText);
        drawSection.appendChild(sizeMeta);

        const actions = document.createElement('div');
        actions.className = 'widget-settings-actions';
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'control-button';
        clearButton.textContent = 'Clear Drawing';
        actions.appendChild(clearButton);
        drawSection.appendChild(actions);

        controls.appendChild(drawSection);

        const syncStatus = () => {
            sizeMetaText.textContent = `${toolSelect.options[toolSelect.selectedIndex]?.text || 'Freehand'} with ${this.currentLineWidth}px stroke in ${this.currentColor}.`;
        };

        toolSelect.addEventListener('change', (event) => {
            this.setTool(event.target.value);
            syncStatus();
        });

        colorInput.addEventListener('input', (event) => {
            this.colorPicker.value = event.target.value;
            this.setColor(event.target.value);
            syncStatus();
        });

        sizeInput.addEventListener('input', (event) => {
            this.lineWidthSelector.value = event.target.value;
            this.setLineWidth(event.target.value);
            syncStatus();
        });

        clearButton.addEventListener('click', () => this.clear());

        syncStatus();
        return controls;
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
            imageData: imageData,
            tool: this.currentTool,
            color: this.currentColor,
            lineWidth: this.currentLineWidth
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        if (data.tool) {
            this.setTool(data.tool);
        }
        if (data.color) {
            this.colorPicker.value = data.color;
            this.setColor(data.color);
        }
        if (data.lineWidth) {
            this.lineWidthSelector.value = String(data.lineWidth);
            this.setLineWidth(data.lineWidth);
        }
        if (data.imageData) {
            this.pendingImageData = data.imageData;
            this.restorePendingImage();
        }
    }

    restorePendingImage() {
        if (!this.pendingImageData || !this.canvas.width || !this.canvas.height) {
            return;
        }

        const img = new Image();
        const imageData = this.pendingImageData;
        img.onload = () => {
            if (!this.ctx) {
                return;
            }
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
            this.hasContent = true;
            this.updateDrawingUI();
            if (this.pendingImageData === imageData) {
                this.pendingImageData = null;
            }
        };
        img.src = imageData;
    }

    onWidgetLayout() {
        this.setupCanvas();
    }
}
