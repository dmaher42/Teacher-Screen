/**
 * Noise Meter Widget Class
 * Wraps the NoiseMeter canvas visualization inside a widget container.
 */
class NoiseMeterWidget {
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'widget';
        this.element.dataset.widgetType = 'noise-meter';

        // Create the widget header
        this.header = document.createElement('div');
        this.header.className = 'widget-header';

        this.title = document.createElement('div');
        this.title.className = 'widget-title';
        this.title.textContent = 'Noise Meter';

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
        this.helpText.textContent = 'Use Start Measuring to begin listening. Close the widget to stop the meter when you are done.';
        this.helpButton.addEventListener('click', () => {
            const isVisible = this.helpText.style.display === 'block';
            this.helpText.style.display = isVisible ? 'none' : 'block';
        });

        // Create canvas for the noise meter visualization
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'noise-meter-canvas';
        this.canvas.width = 300;
        this.canvas.height = 80;

        // Create control button to start microphone capture
        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start Measuring';
        this.startButton.addEventListener('click', () => this.start());

        // Assemble widget
        this.content.appendChild(this.helpText);
        this.content.appendChild(this.canvas);
        this.content.appendChild(this.startButton);
        this.element.appendChild(this.header);
        this.element.appendChild(this.content);

        // Initialize NoiseMeter instance
        this.meter = new NoiseMeter(this.canvas);
        this.started = false;
    }

    /**
     * Begin capturing audio and drawing the noise meter visualization.
     */
    start() {
        if (this.meter && !this.started) {
            this.started = true;
            this.meter.start();
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
            type: 'NoiseMeterWidget'
        };
    }

    /**
     * Deserialize the widget state.
     * @param {object} _data
     */
    deserialize(_data) {
        // No state to restore currently.
    }
}
