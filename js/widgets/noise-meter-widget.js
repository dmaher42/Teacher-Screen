let noiseMeterThresholdControlSequence = 0;

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
        this.layoutType = 'grid';
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
        this.canvas.setAttribute('aria-hidden', 'true');

        this.meterDisplay = document.createElement('div');
        this.meterDisplay.className = 'noise-meter-display';
        this.meterDisplay.dataset.noiseState = 'ready';

        this.classroomStatus = document.createElement('div');
        this.classroomStatus.className = 'noise-meter-classroom-status';
        this.classroomStatus.setAttribute('role', 'status');
        this.classroomStatus.setAttribute('aria-live', 'polite');

        this.classroomStatusDot = document.createElement('span');
        this.classroomStatusDot.className = 'noise-meter-status-dot';
        this.classroomStatusDot.setAttribute('aria-hidden', 'true');

        this.classroomStatusText = document.createElement('span');
        this.classroomStatusText.className = 'noise-meter-status-text';
        this.classroomStatusText.textContent = 'Ready to Learn';
        this.classroomStatus.append(this.classroomStatusDot, this.classroomStatusText);

        this.warningCounter = document.createElement('div');
        this.warningCounter.className = 'noise-meter-warning-counter';
        this.warningCounter.setAttribute('role', 'status');
        this.warningCounter.setAttribute('aria-live', 'polite');
        this.warningCounterLabel = document.createElement('span');
        this.warningCounterLabel.textContent = 'Warnings';
        this.warningCounterValue = document.createElement('strong');
        this.warningCounterValue.textContent = '0';
        this.warningCounter.append(this.warningCounterLabel, this.warningCounterValue);

        this.scale = document.createElement('div');
        this.scale.className = 'noise-meter-scale';
        this.scale.setAttribute('aria-hidden', 'true');
        this.scale.innerHTML = `
            <span data-state="ready">Quiet</span>
            <span data-state="warning">Getting Loud</span>
            <span data-state="loud">Too Loud</span>
        `;

        const statusRow = document.createElement('div');
        statusRow.className = 'noise-meter-status-row';
        statusRow.append(this.classroomStatus, this.warningCounter);
        this.meterDisplay.append(statusRow, this.canvas, this.scale);

        this.thresholdControl = document.createElement('div');
        this.thresholdControl.className = 'noise-meter-threshold-control';
        const thresholdHeading = document.createElement('div');
        thresholdHeading.className = 'noise-meter-threshold-heading';
        const thresholdLabel = document.createElement('label');
        thresholdLabel.textContent = 'Noise limit';
        this.thresholdOutput = document.createElement('output');
        this.thresholdOutput.textContent = 'Balanced';
        thresholdHeading.append(thresholdLabel, this.thresholdOutput);
        this.thresholdInput = document.createElement('input');
        this.thresholdInput.type = 'range';
        this.thresholdInput.min = '80';
        this.thresholdInput.max = '200';
        this.thresholdInput.step = '10';
        this.thresholdInput.value = '150';
        this.thresholdInput.setAttribute('aria-label', 'Accepted classroom noise level');
        noiseMeterThresholdControlSequence += 1;
        this.thresholdInput.id = `noise-meter-threshold-${noiseMeterThresholdControlSequence}`;
        thresholdLabel.htmlFor = this.thresholdInput.id;
        const thresholdScale = document.createElement('div');
        thresholdScale.className = 'noise-meter-threshold-scale';
        thresholdScale.setAttribute('aria-hidden', 'true');
        thresholdScale.innerHTML = '<span>Quieter</span><span>Louder</span>';
        this.thresholdControl.append(thresholdHeading, this.thresholdInput, thresholdScale);

        // Start button (can be placed inside a modal or overlay)
        this.startButton = document.createElement('button');
        this.startButton.type = 'button';
        this.startButton.className = 'widget-primary-button';
        this.startButton.textContent = 'Start Measuring';

        // Status text
        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.textContent = 'Microphone off. Press start to listen.';

        this.resetCountButton = document.createElement('button');
        this.resetCountButton.type = 'button';
        this.resetCountButton.textContent = 'Reset count';
        this.resetCountButton.setAttribute('aria-label', 'Reset noise warning count');

        // Teacher setup lives in Widget settings so the classroom surface stays
        // focused on the student-facing noise signal.
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls';
        this.controlsOverlay.append(
            this.thresholdControl,
            this.startButton,
            this.resetCountButton,
            this.status
        );

        // Assemble the compact student-facing surface.
        this.element.append(this.helpText, this.meterDisplay);

        // NoiseMeter instance and state
        this.lastLevel = 0;
        this.lastLevelBroadcastAt = 0;
        this.warningCount = 0;
        this.warningArmed = true;
        this.tooLoudThreshold = 150;
        this.warningRearmThreshold = 120;
        this.meter = new NoiseMeter(this.canvas, (level) => this.handleMeterLevel(level));
        this.started = false;      // "Was actively listening when serialized"
        this.isListening = false;  // "Currently listening right now"
        this.isStarting = false;   // Prevent overlapping permission requests
        this.updateVisualState(0);
        this.updateNoiseThresholdControl();

        // Bind handlers so we can remove them later
        this.handleStartClick = this.start.bind(this);
        this.handleResetCountClick = this.resetWarningCount.bind(this);
        this.handleThresholdInput = this.onThresholdInput.bind(this);
        this.startButton.addEventListener('click', this.handleStartClick);
        this.resetCountButton.addEventListener('click', this.handleResetCountClick);
        this.thresholdInput.addEventListener('input', this.handleThresholdInput);
    }

    setEditable() {}

    onWidgetLayout() {
        const width = Math.max(180, Math.floor(this.canvas.clientWidth || this.element.clientWidth || this.canvas.width || 300));
        const height = Math.max(80, Math.floor(this.canvas.clientHeight || this.canvas.height || 80));

        if (this.canvas.width === width && this.canvas.height === height) {
            return;
        }

        this.canvas.width = width;
        this.canvas.height = height;
        this.meter?.renderLevel?.(this.lastLevel);
    }

    handleMeterLevel(level) {
        this.lastLevel = Math.min(255, Math.max(0, Number(level) || 0));
        this.updateVisualState(this.lastLevel);
        if (!this.isListening || this.isProjectorMode?.()) return;

        if (this.lastLevel <= this.warningRearmThreshold) {
            this.warningArmed = true;
        } else if (this.lastLevel >= this.tooLoudThreshold && this.warningArmed) {
            this.warningArmed = false;
            this.warningCount += 1;
            this.updateWarningCounter();
            this.meter?.playWarningTone?.();
            window.TeacherScreenWidgetState.notifyChanged(this, 'noise-warning-recorded');
        }

        const now = performance.now();
        if (now - this.lastLevelBroadcastAt < 100) return;
        this.lastLevelBroadcastAt = now;
        this.broadcastLevel(this.lastLevel, true);
    }

    broadcastLevel(level, listening = this.isListening) {
        const eventBus = window.TeacherScreenEventBus?.eventBus;
        if (!eventBus || !this.widgetId || this.isProjectorMode?.()) return false;
        eventBus.emit('noise-meter:level', {
            widgetId: this.widgetId,
            level: Math.min(255, Math.max(0, Number(level) || 0)),
            listening: listening === true,
            warningCount: this.warningCount,
            noiseThreshold: this.tooLoudThreshold
        });
        return true;
    }

    applySyncedLevel(level, warningCount = this.warningCount, noiseThreshold = this.tooLoudThreshold) {
        this.lastLevel = Math.min(255, Math.max(0, Number(level) || 0));
        this.warningCount = Math.max(0, Math.floor(Number(warningCount) || 0));
        this.setNoiseThreshold(noiseThreshold, { notify: false, broadcast: false });
        this.meter?.renderLevel?.(this.lastLevel);
        this.updateVisualState(this.lastLevel);
        this.updateWarningCounter();
    }

    describeNoiseThreshold(value = this.tooLoudThreshold) {
        if (value <= 100) return 'Quiet';
        if (value <= 140) return 'Calm';
        if (value <= 170) return 'Balanced';
        return 'Lively';
    }

    updateNoiseThresholdControl() {
        const description = this.describeNoiseThreshold();
        if (this.thresholdInput) {
            this.thresholdInput.value = String(this.tooLoudThreshold);
            this.thresholdInput.setAttribute('aria-valuetext', description);
        }
        if (this.thresholdOutput) this.thresholdOutput.textContent = description;
    }

    setNoiseThreshold(value, { notify = true, broadcast = true } = {}) {
        const minimum = Number(this.thresholdInput?.min) || 80;
        const maximum = Number(this.thresholdInput?.max) || 200;
        const step = Number(this.thresholdInput?.step) || 10;
        const requested = Number(value);
        const safeValue = Number.isFinite(requested) ? requested : 150;
        this.tooLoudThreshold = Math.min(maximum, Math.max(minimum, Math.round(safeValue / step) * step));
        this.warningRearmThreshold = Math.max(30, this.tooLoudThreshold - 30);
        this.warningArmed = this.lastLevel <= this.warningRearmThreshold;
        this.updateNoiseThresholdControl();
        this.updateVisualState(this.lastLevel);
        if (broadcast) this.broadcastLevel(this.lastLevel, this.isListening);
        if (notify) window.TeacherScreenWidgetState.notifyChanged(this, 'noise-threshold-changed');
    }

    onThresholdInput(event) {
        this.setNoiseThreshold(event?.target?.value);
    }

    updateWarningCounter() {
        if (this.warningCounterValue) {
            this.warningCounterValue.textContent = String(this.warningCount);
        }
        this.warningCounter?.classList.remove('is-incremented');
        void this.warningCounter?.offsetWidth;
        this.warningCounter?.classList.add('is-incremented');
    }

    resetWarningCount() {
        this.warningCount = 0;
        this.warningArmed = this.lastLevel <= this.warningRearmThreshold;
        this.updateWarningCounter();
        this.broadcastLevel(this.lastLevel, this.isListening);
        window.TeacherScreenWidgetState.notifyChanged(this, 'noise-warning-count-reset');
    }

    updateVisualState(level = 0) {
        const safeLevel = Math.min(255, Math.max(0, Number(level) || 0));
        const warningThreshold = Math.max(40, this.tooLoudThreshold - 100);
        const state = safeLevel < warningThreshold
            ? 'ready'
            : safeLevel < this.tooLoudThreshold
                ? 'warning'
                : 'loud';
        const label = state === 'ready'
            ? 'Ready to Learn'
            : state === 'warning'
                ? 'Getting Loud'
                : 'Too Loud';

        if (this.meterDisplay) this.meterDisplay.dataset.noiseState = state;
        if (this.classroomStatusText) this.classroomStatusText.textContent = label;
        this.scale?.querySelectorAll('[data-state]').forEach((item) => {
            const isActive = item.dataset.state === state;
            item.classList.toggle('is-active', isActive);
            if (isActive) item.setAttribute('aria-current', 'true');
            else item.removeAttribute('aria-current');
        });
    }

    /**
     * Begin capturing audio and drawing the noise meter visualization.
     * Handles both sync and Promise-returning NoiseMeter.start() implementations.
     */
    start() {
        if (!this.meter || this.isListening || this.isStarting) return;

        this.isStarting = true;
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
        this.isStarting = false;
        this.isListening = true;
        this.started = true;
        this.startButton.textContent = 'Listening…';
        this.startButton.disabled = true;
        this.setStatus('Noise meter is now listening.');
        this.broadcastLevel(this.lastLevel, true);
        window.TeacherScreenWidgetState.notifyChanged(this, 'microphone-started');
    }

    /**
     * Called when microphone capture fails (permissions, no device, etc.).
     */
    onStartError(err) {
        console.error('Noise meter start error:', err);
        this.isStarting = false;
        this.isListening = false;
        this.started = false;

        this.startButton.textContent = 'Start Measuring';
        this.startButton.disabled = false;

        this.setStatus(this.getMicrophoneErrorMessage(err));
    }

    getMicrophoneErrorMessage(err) {
        const errorName = String(err?.name || '');
        const errorMessage = String(err?.message || '');

        if (!window.isSecureContext || errorName === 'InsecureContextError') {
            return 'Microphone access needs the secure Teacher Screen website.';
        }
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function'
            || errorName === 'NotSupportedError') {
            return 'This browser cannot provide microphone access. Open Teacher Screen in Chrome and try again.';
        }
        if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
            if (/system/i.test(errorMessage)) {
                return 'Microphone access is blocked by Windows. Allow desktop apps to use the microphone, then try again.';
            }
            return 'Microphone permission is blocked for Teacher Screen. Allow Microphone in the site controls, then try again.';
        }
        if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
            return 'No microphone was found. Connect or enable a microphone, then try again.';
        }
        if (errorName === 'NotReadableError' || errorName === 'TrackStartError' || errorName === 'AbortError') {
            return 'The microphone is busy or unavailable. Close other audio apps, then try again.';
        }
        return 'The microphone could not start. Check the browser microphone control, then try again.';
    }

    /**
     * Stop capturing audio and update UI.
     * Safe to call multiple times.
     */
    stop() {
        if (!this.meter || (!this.isListening && !this.isStarting)) return;

        this.isStarting = false;
        this.isListening = false;
        this.started = false;

        try {
            if (typeof this.meter.stop === 'function') {
                this.meter.stop();
            }
        } catch (err) {
            console.warn('Noise meter stop error:', err);
        }

        this.startButton.disabled = false;
        this.startButton.textContent = 'Start Measuring';
        this.setStatus('Microphone off. Press start to listen.');
        this.updateVisualState(0);
        this.broadcastLevel(0, false);
        window.TeacherScreenWidgetState.notifyChanged(this, 'microphone-stopped');
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
        this.resetCountButton.removeEventListener('click', this.handleResetCountClick);
        this.thresholdInput.removeEventListener('input', this.handleThresholdInput);

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
            started: this.isListening,
            warningCount: this.warningCount,
            noiseThreshold: this.tooLoudThreshold
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
        this.isStarting = false;
        this.warningCount = Math.max(0, Math.floor(Number(data?.warningCount) || 0));
        this.setNoiseThreshold(data?.noiseThreshold, { notify: false, broadcast: false });
        this.warningArmed = true;
        this.updateWarningCounter();

        if (wasStarted) {
            this.setStatus('Microphone paused. Press Start Measuring to resume.');
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
