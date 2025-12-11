/**
 * Noise Meter Widget Class
 * Wraps the NoiseMeter canvas visualization inside a widget container.
 *
 * Responsibilities:
 * - Manage NoiseMeter lifecycle (start / stop / cleanup).
 * - Expose a simple widget DOM structure (canvas + optional controls).
 * - Provide status messaging and basic error handling.
 */
class NoiseMeterWidget {
    constructor() {
        // Root container for the widget
        this.element = document.createElement('div');
        this.element.className = 'noise-meter-widget-content';
        this.element.setAttribute('role', 'group');
        this.element.setAttribute('aria-label', 'Noise meter');

        // Help text (toggled from external help control)
        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent =
            'Use “Start Measuring” to begin listening. Close or stop the widget to turn the microphone off.';

        // Canvas for the visualization
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'noise-meter-canvas';
        this.canvas.width = 300;
        this.canvas.height = 80;

        // Start button (can be placed inside a modal or overlay)
        this.startButton = document.createElement('button');
        this.startButton.type = 'button';
        this.startButton.className = 'widget-primary-button';
        this.startButton.textContent = 'Start Measuring';

        // Status text
        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.textContent = 'Microphone off. Press start to listen.';

        // Controls overlay (not appended here if controls live in a separate modal)
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls';
        const modalHelp = this.helpText.cloneNode(true);
        const modalStartButton = this.startButton.cloneNode(true);
        modalStartButton.addEventListener('click', () => this.start());
        const modalStatus = this.status.cloneNode(true);
        this.controlsOverlay.appendChild(modalHelp);
        this.controlsOverlay.appendChild(modalStartButton);
        this.controlsOverlay.appendChild(modalStatus);

        // Assemble widget content
        this.element.appendChild(this.helpText);
        this.element.appendChild(this.canvas);
        this.element.appendChild(this.status);
        const controlBar = document.createElement('div');
        controlBar.className = 'widget-control-bar';

        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions';
        primaryActions.appendChild(this.startButton);

        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';

        controlBar.append(primaryActions, secondaryActions);
        this.element.appendChild(controlBar);

        // NoiseMeter instance and state
        this.meter = new NoiseMeter(this.canvas);
        this.started = false;      // "Was actively listening when serialized"
        this.isListening = false;  // "Currently listening right now"

        // Bind handlers so we can remove them later
        this.handleStartClick = this.start.bind(this);
        this.handleVisibilityChange = this.onVisibilityChange.bind(this);

        this.startButton.addEventListener('click', this.handleStartClick);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    /**
     * Begin capturing audio and drawing the noise meter visualization.
     * Handles both sync and Promise-returning NoiseMeter.start() implementations.
     */
    start() {
        if (!this.meter || this.isListening) return;

        this.setStatus('Requesting microphone access…');
        this.startButton.disabled = true;
        this.startButton.textContent = 'Starting…';

        try {
            const result = this.meter.start && this.meter.start();

            // If NoiseMeter.start() returns a promise, wait for it
            if (result && typeof result.then === 'function') {
                result
                    .then(() => this.onStartSuccess())
                    .catch((err) => this.onStartError(err));
            } else {
                // Synchronous start
                this.onStartSuccess();
            }
        } catch (err) {
            this.onStartError(err);
        }
    }

    /**
     * Called when microphone capture successfully starts.
     * Updates state and UI.
     */
    onStartSuccess() {
        this.isListening = true;
        this.started = true;
        this.startButton.textContent = 'Listening…';
        this.startButton.disabled = true;
        this.setStatus('Noise meter is now listening.');
    }

    /**
     * Called when microphone capture fails (permissions, no device, etc.).
     */
    onStartError(err) {
        console.error('Noise meter start error:', err);
        this.isListening = false;
        this.started = false;

        this.startButton.textContent = 'Start Measuring';
        this.startButton.disabled = false;

        const message =
            'Unable to access the microphone. Please check permissions and try again.';
        this.setStatus(message);
    }

    /**
     * Stop capturing audio and update UI.
     * Safe to call multiple times.
     */
    stop() {
        if (!this.meter || !this.isListening) return;

        try {
            if (typeof this.meter.stop === 'function') {
                this.meter.stop();
            }
        } catch (err) {
            console.warn('Noise meter stop error:', err);
        }

        this.isListening = false;
        this.started = false;

        this.startButton.disabled = false;
        this.startButton.textContent = 'Start Measuring';
        this.setStatus('Microphone off. Press start to listen.');
    }

    /**
     * Automatically pause the meter when the tab is hidden to avoid
     * unnecessary mic usage and distractions.
     */
    onVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            this.stop();
        }
    }

    /**
     * Remove the widget from the DOM and notify listeners.
     * Also stops the meter and cleans up listeners.
     */
    remove() {
        // Stop listening and free audio resources
        this.stop();

        // If NoiseMeter exposes a destroy/cleanup method, call it
        if (this.meter && typeof this.meter.destroy === 'function') {
            try {
                this.meter.destroy();
            } catch (err) {
                console.warn('Noise meter destroy error:', err);
            }
        }

        this.startButton.removeEventListener('click', this.handleStartClick);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);

        this.element.remove();

        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    /**
     * Serialize the widget state.
     * @returns {{type: string, started: boolean}}
     */
    serialize() {
        return {
            type: 'NoiseMeterWidget',
            // "started" means "was listening when saved" (we cannot auto-start on load without user interaction)
            started: this.isListening
        };
    }

    /**
     * Deserialize the widget state.
     * Note: we cannot auto-start the microphone due to browser restrictions.
     * @param {object} data
     */
    deserialize(data) {
        const wasStarted = !!(data && data.started);
        this.started = wasStarted;
        this.isListening = false;

        if (wasStarted) {
            this.setStatus('Previously listening. Press start to resume (microphone permissions required).');
        } else {
            this.setStatus('Microphone off. Press start to listen.');
        }

        this.startButton.disabled = false;
        this.startButton.textContent = 'Start Measuring';
    }

    /**
     * Update status text inside the widget.
     * @param {string} message
     */
    setStatus(message) {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.add('action-flash');
        setTimeout(() => {
            // Guard in case widget was removed
            if (this.status) {
                this.status.classList.remove('action-flash');
            }
        }, 900);
    }

    /**
     * Toggle help text visibility.
     */
    toggleHelp() {
        const isVisible = this.helpText.style.display === 'block';
        this.helpText.style.display = isVisible ? 'none' : 'block';
    }
}
