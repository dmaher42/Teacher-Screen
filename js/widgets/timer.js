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
        this.element.className = 'timer-widget-content';

        // --- Create Display Section ---
        this.mainDisplay = document.createElement('div');
        this.mainDisplay.className = 'widget-display';

        // Create the timer display
        this.display = document.createElement('div');
        this.display.className = 'timer-display';
        this.display.textContent = '00:00';

        this.mainDisplay.appendChild(this.display);

        // --- Create Controls Section ---
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Choose a preset or set an interval with work/break durations. Start to begin, Stop to pause, and customize the alert sound.';

        // Timer presets
        this.presetContainer = document.createElement('div');
        this.presetContainer.className = 'timer-presets';

        const presetLabel = document.createElement('label');
        presetLabel.textContent = 'Quick Select: ';
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

        // --- NAMED PRESETS SECTION ---
        this.namedPresets = []; // Array of { name: "Name", minutes: 5 }
        this.selectedPresetName = null;

        this.namedPresetSection = document.createElement('div');
        this.namedPresetSection.className = 'named-preset-section';
        this.namedPresetSection.style.marginBottom = '10px';
        this.namedPresetSection.style.borderTop = '1px solid #eee';
        this.namedPresetSection.style.paddingTop = '5px';

        // Add Preset Form
        const addPresetForm = document.createElement('div');
        addPresetForm.className = 'add-preset-form';
        addPresetForm.style.display = 'flex';
        addPresetForm.style.gap = '5px';
        addPresetForm.style.marginBottom = '5px';

        this.newPresetName = document.createElement('input');
        this.newPresetName.type = 'text';
        this.newPresetName.placeholder = 'Name';
        this.newPresetName.style.width = '80px';

        this.newPresetTime = document.createElement('input');
        this.newPresetTime.type = 'number';
        this.newPresetTime.placeholder = 'Min';
        this.newPresetTime.min = '1';
        this.newPresetTime.style.width = '50px';

        const addPresetBtn = document.createElement('button');
        addPresetBtn.textContent = 'Add';
        addPresetBtn.addEventListener('click', () => this.addNamedPreset());

        addPresetForm.appendChild(this.newPresetName);
        addPresetForm.appendChild(this.newPresetTime);
        addPresetForm.appendChild(addPresetBtn);

        // List of presets
        this.namedPresetList = document.createElement('ul');
        this.namedPresetList.className = 'named-preset-list';
        this.namedPresetList.style.listStyle = 'none';
        this.namedPresetList.style.padding = '0';
        this.namedPresetList.style.margin = '0';
        this.namedPresetList.style.maxHeight = '100px';
        this.namedPresetList.style.overflowY = 'auto';

        this.namedPresetSection.appendChild(document.createTextNode('Custom Presets:'));
        this.namedPresetSection.appendChild(addPresetForm);
        this.namedPresetSection.appendChild(this.namedPresetList);


        // --- AUTO RESTART SECTION ---
        this.autoRestartContainer = document.createElement('div');
        this.autoRestartContainer.className = 'auto-restart-container';

        const autoRestartLabel = document.createElement('label');
        this.autoRestartCheckbox = document.createElement('input');
        this.autoRestartCheckbox.type = 'checkbox';

        autoRestartLabel.appendChild(this.autoRestartCheckbox);
        autoRestartLabel.appendChild(document.createTextNode(' Auto-restart when finished'));
        this.autoRestartContainer.appendChild(autoRestartLabel);


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
        this.controlsOverlay.appendChild(this.helpText);
        this.controlsOverlay.appendChild(this.presetContainer);
        this.controlsOverlay.appendChild(this.namedPresetSection);
        this.controlsOverlay.appendChild(this.autoRestartContainer);
        this.controlsOverlay.appendChild(this.intervalContainer);
        this.controlsOverlay.appendChild(this.soundButton);
        this.controlsOverlay.appendChild(this.soundMenu);
        this.controlsOverlay.appendChild(this.controls);
        this.controlsOverlay.appendChild(this.status);

        this.element.appendChild(this.mainDisplay);
        // this.element.appendChild(this.controlsOverlay); // Controls are now handled by the modal

        // Timer state
        this.time = 0;
        this.totalTime = 0; // Store total time for auto-restart
        this.interval = null;
        this.running = false;
        this.isIntervalMode = false;
        this.currentPhase = null;
    }

    addNamedPreset(name, minutes) {
        const presetName = name || this.newPresetName.value.trim();
        const presetTime = minutes || parseInt(this.newPresetTime.value, 10);

        if (!presetName || isNaN(presetTime) || presetTime <= 0) {
            this.setStatus('Invalid preset data.', 'warning');
            return;
        }

        // Avoid duplicates by name
        const existingIndex = this.namedPresets.findIndex(p => p.name === presetName);
        if (existingIndex !== -1) {
             this.namedPresets[existingIndex].minutes = presetTime;
        } else {
            this.namedPresets.push({ name: presetName, minutes: presetTime });
        }

        this.newPresetName.value = '';
        this.newPresetTime.value = '';
        this.renderNamedPresets();
    }

    renderNamedPresets() {
        this.namedPresetList.innerHTML = '';
        this.namedPresets.forEach(preset => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '2px 0';

            const span = document.createElement('span');
            span.textContent = `${preset.name} (${preset.minutes}m)`;
            span.style.cursor = 'pointer';
            span.style.textDecoration = 'underline';
            if (this.selectedPresetName === preset.name) {
                span.style.fontWeight = 'bold';
            }

            span.addEventListener('click', () => {
                this.selectPreset(preset.name);
            });

            const delBtn = document.createElement('button');
            delBtn.textContent = 'x';
            delBtn.style.marginLeft = '10px';
            delBtn.style.fontSize = '0.8em';
            delBtn.style.padding = '0 4px';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeNamedPreset(preset.name);
            });

            li.appendChild(span);
            li.appendChild(delBtn);
            this.namedPresetList.appendChild(li);
        });
    }

    removeNamedPreset(name) {
        this.namedPresets = this.namedPresets.filter(p => p.name !== name);
        if (this.selectedPresetName === name) {
            this.selectedPresetName = null;
        }
        this.renderNamedPresets();
    }

    selectPreset(name) {
        const preset = this.namedPresets.find(p => p.name === name);
        if (preset) {
            this.selectedPresetName = name;
            // Stop current timer if running? Requirement: "Clicking a preset selects that timer duration but does NOT auto-start."
            if (this.running) {
                this.stop();
            }
            this.time = preset.minutes * 60;
            this.totalTime = this.time;
            this.updateDisplay();
            this.renderNamedPresets(); // Re-render to update bold selection
            this.setStatus(`Selected "${name}" (${preset.minutes}m).`);
        }
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
                this.totalTime = this.time;
                this.setStatus(`Interval started: Work for ${workMinutes} minute(s).`);
            } else {
                // Priority: Argument -> Current Time (if set by preset) -> Dropdown -> Default
                let chosenMinutes;
                if (Number.isFinite(minutes) && minutes > 0) {
                     chosenMinutes = minutes;
                     this.time = chosenMinutes * 60;
                } else if (this.time > 0 && this.selectedPresetName) {
                     // Using currently selected preset or manually set time via preset click
                     chosenMinutes = this.time / 60;
                } else {
                    const presetValue = this.presetSelect ? parseInt(this.presetSelect.value, 10) : null;
                    chosenMinutes = !isNaN(presetValue) ? presetValue : 5;
                    this.time = chosenMinutes * 60;
                }

                this.totalTime = this.time;
                this.setStatus(`Timer started for ${Math.round(chosenMinutes * 10) / 10} minute(s).`);
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
                // Auto-restart logic
                if (this.autoRestartCheckbox.checked) {
                    this.notifyComplete();
                    this.time = this.totalTime;
                    this.updateDisplay();
                    this.setStatus('Auto-restarting...', 'success');
                } else {
                    this.stop();
                    this.notifyComplete();
                }
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

    toggleHelp() {
        const isVisible = this.helpText.style.display === 'block';
        this.helpText.style.display = isVisible ? 'none' : 'block';
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
            presetMinutes: this.presetSelect ? parseInt(this.presetSelect.value, 10) : 5,
            namedPresets: this.namedPresets,
            selectedPreset: this.selectedPresetName,
            autoRestart: this.autoRestartCheckbox.checked
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

        // Restore Named Presets
        if (Array.isArray(data.namedPresets)) {
            this.namedPresets = data.namedPresets;
            this.renderNamedPresets();
        }

        // Restore Selected Preset
        if (data.selectedPreset) {
            this.selectedPresetName = data.selectedPreset;
            this.renderNamedPresets(); // To highlight
        }

        // Restore Auto Restart
        if (data.autoRestart) {
            this.autoRestartCheckbox.checked = data.autoRestart;
        }

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

        // Recover totalTime if we can infer it, otherwise default to current time
        // If we have a selected preset, use that.
        if (this.selectedPresetName) {
            const preset = this.namedPresets.find(p => p.name === this.selectedPresetName);
            if (preset) {
                this.totalTime = preset.minutes * 60;
            } else {
                 this.totalTime = this.time;
            }
        } else {
             this.totalTime = this.time;
        }


        this.setStatus(this.running ? 'Timer running...' : 'Ready to start a timer.');
    }
}
