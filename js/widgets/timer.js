/**
 * Timer Widget Class
 * Creates a countdown timer widget with start/stop functionality.
 */
class TimerWidget {
    /**
     * Constructor for the TimerWidget.
     */
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'widget';
        this.element.dataset.widgetType = 'timer';

        // Create the widget header
        this.header = document.createElement('div');
        this.header.className = 'widget-header';

        this.title = document.createElement('div');
        this.title.className = 'widget-title';
        this.title.textContent = 'Timer';

        this.helpButton = document.createElement('button');
        this.helpButton.className = 'widget-help';
        this.helpButton.textContent = '?';

        this.closeButton = document.createElement('button');
        this.closeButton.className = 'widget-close';
        this.closeButton.innerHTML = '&times;';
        this.closeButton.addEventListener('click', () => this.remove());

        this.headerControls = document.createElement('div');
        this.headerControls.className = 'widget-controls';
        this.headerControls.appendChild(this.helpButton);
        this.headerControls.appendChild(this.closeButton);

        this.header.appendChild(this.title);
        this.header.appendChild(this.headerControls);

        // Create the widget content area
        this.content = document.createElement('div');
        this.content.className = 'widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.textContent = 'Choose a preset or set an interval with work/break durations. Start to begin, Stop to pause, and customize the alert sound.';
        this.helpButton.addEventListener('click', () => {
            const isVisible = this.helpText.style.display === 'block';
            this.helpText.style.display = isVisible ? 'none' : 'block';
        });

        // Create the timer display
        this.display = document.createElement('div');
        this.display.className = 'timer-display';
        this.display.textContent = '00:00';

        // Timer presets
        this.presetContainer = document.createElement('div');
        this.presetContainer.className = 'timer-presets';

        const presetLabel = document.createElement('label');
        presetLabel.textContent = 'Presets: ';
        presetLabel.htmlFor = 'timer-preset-select';

        this.presetSelect = document.createElement('select');
        this.presetSelect.id = 'timer-preset-select';
        [1, 5, 10, 15].forEach(minutes => {
            const option = document.createElement('option');
            option.value = minutes;
            option.textContent = `${minutes} min`;
            if (minutes === 5) {
                option.selected = true;
            }
            this.presetSelect.appendChild(option);
        });

        this.presetContainer.appendChild(presetLabel);
        this.presetContainer.appendChild(this.presetSelect);

        // Interval mode controls
        this.intervalContainer = document.createElement('div');
        this.intervalContainer.className = 'timer-interval';

        const intervalLabel = document.createElement('label');
        intervalLabel.textContent = ' Interval Mode ';

        this.intervalCheckbox = document.createElement('input');
        this.intervalCheckbox.type = 'checkbox';
        this.intervalCheckbox.id = 'timer-interval-toggle';
        this.intervalCheckbox.addEventListener('change', () => {
            this.isIntervalMode = this.intervalCheckbox.checked;
            this.intervalOptions.style.display = this.isIntervalMode ? 'block' : 'none';
            if (!this.isIntervalMode) {
                this.currentPhase = null;
            }
            this.updateDisplay();
        });

        intervalLabel.prepend(this.intervalCheckbox);
        intervalLabel.htmlFor = 'timer-interval-toggle';
        this.intervalContainer.appendChild(intervalLabel);

        this.intervalOptions = document.createElement('div');
        this.intervalOptions.className = 'interval-options';
        this.intervalOptions.style.display = 'none';

        this.workInput = document.createElement('input');
        this.workInput.type = 'number';
        this.workInput.min = '1';
        this.workInput.value = '5';
        this.workInput.id = 'timer-work-duration';

        this.breakInput = document.createElement('input');
        this.breakInput.type = 'number';
        this.breakInput.min = '1';
        this.breakInput.value = '2';
        this.breakInput.id = 'timer-break-duration';

        const workLabel = document.createElement('label');
        workLabel.textContent = 'Work Duration (min): ';
        workLabel.htmlFor = 'timer-work-duration';
        workLabel.appendChild(this.workInput);

        const breakLabel = document.createElement('label');
        breakLabel.textContent = ' Break Duration (min): ';
        breakLabel.htmlFor = 'timer-break-duration';
        breakLabel.appendChild(this.breakInput);

        this.intervalOptions.appendChild(workLabel);
        this.intervalOptions.appendChild(breakLabel);

        this.intervalContainer.appendChild(this.intervalOptions);

        // Sound selection
        this.soundButton = document.createElement('button');
        this.soundButton.className = 'sound-button';
        this.soundButton.textContent = '🔊';
        this.soundButton.setAttribute('aria-label', 'Choose timer sound');

        this.soundMenu = document.createElement('div');
        this.soundMenu.className = 'sound-menu';
        this.soundMenu.style.display = 'none';

        const soundTitle = document.createElement('div');
        soundTitle.className = 'sound-menu-title';
        soundTitle.textContent = 'Notification Sound';
        this.soundMenu.appendChild(soundTitle);

        // Prefer sound options defined in assets/sounds/sound-data.js
        this.soundOptions = (window.TIMER_SOUND_OPTIONS && Array.isArray(window.TIMER_SOUND_OPTIONS)) ? window.TIMER_SOUND_OPTIONS : [];
        if (this.soundOptions.length === 0) {
            // Fallback silent option if sound data failed to load
            this.soundOptions = [{ label: 'Default Beep', url: '' }];
        }

        this.selectedSound = this.soundOptions[0].url;

        this.soundOptions.forEach((option, index) => {
            const wrapper = document.createElement('label');
            wrapper.className = 'sound-option';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'timer-sound';
            radio.value = option.url;
            radio.checked = index === 0;
            radio.addEventListener('change', () => {
                this.selectedSound = option.url;
            });
            wrapper.appendChild(radio);
            wrapper.appendChild(document.createTextNode(` ${option.label}`));
            this.soundMenu.appendChild(wrapper);
        });

        this.soundButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.soundMenu.style.display = this.soundMenu.style.display === 'block' ? 'none' : 'block';
            this.soundButton.setAttribute('aria-expanded', this.soundMenu.style.display === 'block');
        });

        document.addEventListener('click', (event) => {
            if (!this.soundMenu.contains(event.target) && event.target !== this.soundButton) {
                this.soundMenu.style.display = 'none';
                this.soundButton.setAttribute('aria-expanded', 'false');
            }
        });

        // Create the timer controls
        this.controls = document.createElement('div');
        this.controls.className = 'timer-controls';

        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start';
        this.startButton.addEventListener('click', () => this.start());

        this.stopButton = document.createElement('button');
        this.stopButton.textContent = 'Stop';
        this.stopButton.addEventListener('click', () => this.stop());

        this.controls.appendChild(this.startButton);
        this.controls.appendChild(this.stopButton);

        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.textContent = 'Ready to start a timer.';

        // Assemble the widget
        this.content.appendChild(this.helpText);
        this.content.appendChild(this.display);
        this.content.appendChild(this.presetContainer);
        this.content.appendChild(this.intervalContainer);
        this.content.appendChild(this.soundButton);
        this.content.appendChild(this.soundMenu);
        this.content.appendChild(this.controls);
        this.content.appendChild(this.status);
        this.element.appendChild(this.header);
        this.element.appendChild(this.content);

        // Timer state
        this.time = 0;
        this.interval = null;
        this.running = false;
        this.isIntervalMode = false;
        this.currentPhase = null;
    }

    /**
     * Start the timer with a default of 5 minutes.
     * @param {number} minutes - The number of minutes to count down from.
     */
    start(minutes = null) {
        if (!this.running) {
            this.display.style.color = ''; // Reset color in case it was red
            if (this.isIntervalMode) {
                this.currentPhase = 'Work';
                const workMinutes = this.getWorkDuration();
                this.time = workMinutes * 60;
                this.setStatus(`Interval started: Work for ${workMinutes} minute(s).`);
            } else {
                const customMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
                const presetValue = this.presetSelect ? parseInt(this.presetSelect.value, 10) : null;
                const chosenMinutes = customMinutes || (!isNaN(presetValue) ? presetValue : 5);
                this.time = chosenMinutes * 60;
                this.setStatus(`Timer started for ${chosenMinutes} minute(s).`);
            }
            this.updateDisplay();
            this.flashDisplay();
            this.interval = setInterval(() => this.tick(), 1000);
            this.running = true;
        }
    }

    /**
     * Called every second to update the timer.
     */
    tick() {
        if (this.time > 0) {
            this.time--;
            this.updateDisplay();
        }
        if (this.time <= 0) {
            if (this.isIntervalMode) {
                this.notifyComplete();
                this.switchPhase();
            } else {
                this.stop();
                this.notifyComplete();
            }
        }
    }

    /**
     * Update the timer display.
     */
    updateDisplay() {
        const minutes = Math.floor(this.time / 60);
        const seconds = this.time % 60;
        const label = this.isIntervalMode && this.currentPhase ? `${this.currentPhase}: ` : '';
        this.display.textContent = `${label}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Stop the timer.
     */
    stop() {
        clearInterval(this.interval);
        this.interval = null;
        this.running = false;
        this.setStatus('Timer stopped.', 'warning');
        this.flashDisplay();
    }

    /**
     * Called when the timer reaches zero.
     */
    notifyComplete() {
        // Visual notification
        this.display.style.color = "red";
        this.setStatus('Time is up!', 'warning');
        this.flashDisplay();
        // Audio notification
        if (this.selectedSound) {
            const audio = new Audio(this.selectedSound);
            audio.play().catch(e => console.error("Audio playback failed:", e));
        }
    }

    /**
     * Switch between work and break phases when in interval mode.
     */
    switchPhase() {
        if (!this.running) {
            return;
        }
        if (this.currentPhase === 'Work') {
            this.currentPhase = 'Break';
            this.time = this.getBreakDuration() * 60;
            this.setStatus(`Break time for ${this.getBreakDuration()} minute(s).`);
        } else {
            this.currentPhase = 'Work';
            this.time = this.getWorkDuration() * 60;
            this.setStatus(`Work time for ${this.getWorkDuration()} minute(s).`);
        }
        this.display.style.color = '';
        this.updateDisplay();
    }

    /**
     * Get the current work duration, defaulting to 5 minutes.
     * @returns {number}
     */
    getWorkDuration() {
        const value = parseInt(this.workInput.value, 10);
        return value > 0 ? value : 5;
    }

    /**
     * Get the current break duration, defaulting to 2 minutes.
     * @returns {number}
     */
    getBreakDuration() {
        const value = parseInt(this.breakInput.value, 10);
        return value > 0 ? value : 2;
    }

    /**
     * Remove the widget from the DOM.
     */
    remove() {
        if (this.interval) {
            this.stop();
        }
        this.element.remove();
        // Notify the app to update its widget list
        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    /**
     * Provide a short status update within the widget.
     * @param {string} message
     * @param {string} tone
     */
    setStatus(message, tone = 'success') {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.toggle('warning', tone === 'warning');
        this.status.classList.add('action-flash');
        setTimeout(() => this.status.classList.remove('action-flash'), 800);
    }

    /**
     * Briefly flash the timer display for visual feedback.
     */
    flashDisplay() {
        if (!this.display) return;
        this.display.classList.add('action-flash');
        setTimeout(() => this.display.classList.remove('action-flash'), 1200);
    }

    /**
     * Serialize the widget's state for saving to localStorage.
     * @returns {object} The serialized state.
     */
    serialize() {
        return {
            type: 'TimerWidget',
            time: this.time,
            running: this.running,
            isIntervalMode: this.isIntervalMode,
            workDuration: this.getWorkDuration(),
            breakDuration: this.getBreakDuration(),
            currentPhase: this.currentPhase,
            selectedSound: this.selectedSound,
            presetMinutes: this.presetSelect ? parseInt(this.presetSelect.value, 10) : 5
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        this.time = data.time || 0;
        this.running = data.running || false;
        this.isIntervalMode = !!data.isIntervalMode;
        this.intervalCheckbox.checked = this.isIntervalMode;
        this.intervalOptions.style.display = this.isIntervalMode ? 'block' : 'none';
        if (typeof data.workDuration === 'number') {
            this.workInput.value = data.workDuration;
        }
        if (typeof data.breakDuration === 'number') {
            this.breakInput.value = data.breakDuration;
        }
        if (typeof data.presetMinutes === 'number' && this.presetSelect) {
            this.presetSelect.value = data.presetMinutes;
        }
        if (data.selectedSound) {
            this.selectedSound = data.selectedSound;
            const matchingOption = Array.from(this.soundMenu.querySelectorAll('input[type="radio"]')).find((radio) => radio.value === data.selectedSound);
            if (matchingOption) {
                matchingOption.checked = true;
            }
        }
        this.currentPhase = data.currentPhase || null;
        this.updateDisplay();
        if (this.running) {
            // Note: Restarting the interval after page load is complex,
            // for simplicity, we'll just restore the display time.
            this.running = false;
        }
        this.setStatus(this.running ? 'Timer running...' : 'Ready to start a timer.');
    }
}
