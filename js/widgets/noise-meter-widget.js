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
        this.helpText.textContent = 'Use Start Measuring to begin listening. Calibrate to set the baseline noise level. Adjust offsets to control sensitivity.';

        // Create canvas for the noise meter visualization
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'noise-meter-canvas';
        this.canvas.width = 300;
        this.canvas.height = 80;

        // Settings Container
        this.settingsContainer = document.createElement('div');
        this.settingsContainer.className = 'noise-meter-settings';
        this.settingsContainer.style.marginTop = '10px';
        this.settingsContainer.style.display = 'flex';
        this.settingsContainer.style.flexWrap = 'wrap';
        this.settingsContainer.style.gap = '10px';
        this.settingsContainer.style.alignItems = 'center';

        // Calibrate Button
        this.calibrateButton = document.createElement('button');
        this.calibrateButton.textContent = 'Calibrate';
        this.calibrateButton.className = 'control-button small';
        this.calibrateButton.addEventListener('click', () => this.calibrate());

        // Offset Inputs
        const quietLabel = document.createElement('label');
        quietLabel.textContent = 'Quiet Offset: ';
        this.quietOffsetInput = document.createElement('input');
        this.quietOffsetInput.type = 'number';
        this.quietOffsetInput.value = '10';
        this.quietOffsetInput.style.width = '50px';
        this.quietOffsetInput.addEventListener('change', () => this.updateThresholds());
        quietLabel.appendChild(this.quietOffsetInput);

        const loudLabel = document.createElement('label');
        loudLabel.textContent = 'Loud Offset: ';
        this.loudOffsetInput = document.createElement('input');
        this.loudOffsetInput.type = 'number';
        this.loudOffsetInput.value = '50';
        this.loudOffsetInput.style.width = '50px';
        this.loudOffsetInput.addEventListener('change', () => this.updateThresholds());
        loudLabel.appendChild(this.loudOffsetInput);

        this.settingsContainer.appendChild(this.calibrateButton);
        this.settingsContainer.appendChild(quietLabel);
        this.settingsContainer.appendChild(loudLabel);


        // Create control button to start microphone capture
        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start Measuring';
        this.startButton.addEventListener('click', () => this.start());

        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.textContent = 'Microphone off. Press start to listen.';

        // Level Status Display
        this.levelDisplay = document.createElement('div');
        this.levelDisplay.className = 'level-status';
        this.levelDisplay.style.fontWeight = 'bold';
        this.levelDisplay.style.marginTop = '5px';
        this.levelDisplay.textContent = '-';

        // Assemble widget
        this.element.appendChild(this.helpText);
        this.element.appendChild(this.canvas);
        this.element.appendChild(this.levelDisplay); // New status display
        this.element.appendChild(this.startButton);
        this.element.appendChild(this.settingsContainer); // New settings
        this.element.appendChild(this.status);

        // State
        this.baselineLevel = 0;
        this.quietOffset = 10;
        this.loudOffset = 50;
        this.isCalibrating = false;
        this.calibrationSamples = [];

        // Initialize NoiseMeter instance
        this.meter = new NoiseMeter(this.canvas, (average) => this.handleUpdate(average));
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

    handleUpdate(average) {
        if (this.isCalibrating) {
            this.calibrationSamples.push(average);
            this.levelDisplay.textContent = `Calibrating... (${this.calibrationSamples.length} samples)`;
            return;
        }

        // Logic for thresholds
        const quietThreshold = this.baselineLevel + this.quietOffset;
        const loudThreshold = this.baselineLevel + this.loudOffset;

        // Pass to meter for colors
        this.meter.setThresholds(quietThreshold, loudThreshold);

        // Update Text
        if (average < quietThreshold) {
            this.levelDisplay.textContent = "Very quiet";
            this.levelDisplay.style.color = "green";
        } else if (average < loudThreshold) {
            this.levelDisplay.textContent = "OK";
            this.levelDisplay.style.color = "#d4a017"; // Darker yellow/orange
        } else {
            this.levelDisplay.textContent = "Too loud!";
            this.levelDisplay.style.color = "red";
        }
    }

    updateThresholds() {
        this.quietOffset = parseInt(this.quietOffsetInput.value, 10) || 10;
        this.loudOffset = parseInt(this.loudOffsetInput.value, 10) || 50;
    }

    calibrate() {
        if (!this.started) {
            this.start();
        }

        this.isCalibrating = true;
        this.calibrationSamples = [];
        this.calibrateButton.disabled = true;
        this.setStatus("Calibrating baseline for 5 seconds...");

        setTimeout(() => {
            this.finishCalibration();
        }, 5000);
    }

    finishCalibration() {
        this.isCalibrating = false;
        this.calibrateButton.disabled = false;

        if (this.calibrationSamples.length > 0) {
            const sum = this.calibrationSamples.reduce((a, b) => a + b, 0);
            this.baselineLevel = sum / this.calibrationSamples.length;
            this.setStatus(`Baseline calibrated: ${Math.round(this.baselineLevel)}`);
        } else {
             this.setStatus("Calibration failed (no samples).");
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
            started: this.started,
            baselineLevel: this.baselineLevel,
            quietOffset: this.quietOffset,
            loudOffset: this.loudOffset
        };
    }

    /**
     * Deserialize the widget state.
     * @param {object} data
     */
    deserialize(data) {
        this.started = !!(data && data.started);
        if (this.started) {
            this.setStatus('Microphone permissions required to resume.');
        }

        if (typeof data.baselineLevel === 'number') {
            this.baselineLevel = data.baselineLevel;
        }
        if (typeof data.quietOffset === 'number') {
            this.quietOffset = data.quietOffset;
            this.quietOffsetInput.value = this.quietOffset;
        }
        if (typeof data.loudOffset === 'number') {
            this.loudOffset = data.loudOffset;
            this.loudOffsetInput.value = this.loudOffset;
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
