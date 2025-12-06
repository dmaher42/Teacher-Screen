/**
 * Noise Meter Widget Class
 * Wraps the NoiseMeter canvas visualization inside a widget container.
 */
class NoiseMeterWidget {
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'noise-meter-widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Use Start Measuring to begin listening. Close the widget to stop the meter when you are done.';

        // Create canvas for the noise meter visualization
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'noise-meter-canvas';
        this.canvas.width = 300;
        this.canvas.height = 80;

        // Create control button to start microphone capture
        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start Measuring';
        this.startButton.addEventListener('click', () => this.start());

        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.textContent = 'Microphone off. Press start to listen.';

        // Assemble widget
        this.element.appendChild(this.helpText);
        this.element.appendChild(this.canvas);
        this.element.appendChild(this.startButton);
        this.element.appendChild(this.status);

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
            this.startButton.textContent = 'Listening...';
            this.startButton.disabled = true;
            this.setStatus('Noise meter is now listening.');
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
            type: 'NoiseMeterWidget',
            started: this.started
        };
    }

    /**
     * Deserialize the widget state.
     * @param {object} _data
     */
    deserialize(data) {
        this.started = !!(data && data.started);
        if (this.started) {
            this.setStatus('Microphone permissions required to resume.');
        }
    }

    /**
     * Update status text inside the widget.
     * @param {string} message
     */
    setStatus(message) {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.add('action-flash');
        setTimeout(() => this.status.classList.remove('action-flash'), 900);
    }

    toggleHelp() {
        const isVisible = this.helpText.style.display === 'block';
        this.helpText.style.display = isVisible ? 'none' : 'block';
    }
}
