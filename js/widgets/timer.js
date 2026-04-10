const timerEventBus = window.TeacherScreenEventBus ? window.TeacherScreenEventBus.eventBus : null;

/**
 * Timer Widget Class
 * Creates a countdown timer widget with start/stop functionality.
 */
class TimerWidget {
    /**
     * Constructor for the TimerWidget.
     */
    constructor() {
        this.layoutType = 'grid';
        this.soundGroupName = `timer-sound-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.presetSelectId = `timer-preset-select-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
        this.statusElements = [];

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Choose a preset or set an interval with work/break durations. Start to begin, Stop to pause, and customize the alert sound.';

        // Timer presets
        this.presetContainer = document.createElement('div');
        this.presetContainer.className = 'timer-presets';

        const presetLabel = document.createElement('label');
        presetLabel.textContent = 'Quick Select: ';
        presetLabel.htmlFor = this.presetSelectId;

        this.presetSelect = document.createElement('select');
        this.presetSelect.id = this.presetSelectId;
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

        // Add Preset Form
        const addPresetForm = document.createElement('div');
        addPresetForm.className = 'add-preset-form';

        this.newPresetName = document.createElement('input');
        this.newPresetName.type = 'text';
        this.newPresetName.placeholder = 'Name';
        this.newPresetName.className = 'timer-preset-name-input';

        this.newPresetTime = document.createElement('input');
        this.newPresetTime.type = 'number';
        this.newPresetTime.placeholder = 'Min';
        this.newPresetTime.min = '1';
        this.newPresetTime.className = 'timer-preset-time-input';

        const addPresetBtn = document.createElement('button');
        addPresetBtn.textContent = 'Add';
        addPresetBtn.addEventListener('click', () => this.addNamedPreset());

        addPresetForm.appendChild(this.newPresetName);
        addPresetForm.appendChild(this.newPresetTime);
        addPresetForm.appendChild(addPresetBtn);

        // List of presets
        this.namedPresetList = document.createElement('ul');
        this.namedPresetList.className = 'named-preset-list';

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
        this.intervalCheckbox.addEventListener('change', () => {
            this.isIntervalMode = this.intervalCheckbox.checked;
            this.intervalOptions.style.display = this.isIntervalMode ? 'block' : 'none';
            if (!this.isIntervalMode) {
                this.currentPhase = null;
            }
            this.updateDisplay();
        });

        intervalLabel.prepend(this.intervalCheckbox);
        this.intervalContainer.appendChild(intervalLabel);

        this.intervalOptions = document.createElement('div');
        this.intervalOptions.className = 'interval-options';
        this.intervalOptions.style.display = 'none';

        this.workInput = document.createElement('input');
        this.workInput.type = 'number';
        this.workInput.min = '1';
        this.workInput.value = '5';

        this.breakInput = document.createElement('input');
        this.breakInput.type = 'number';
        this.breakInput.min = '1';
        this.breakInput.value = '2';

        const workLabel = document.createElement('label');
        workLabel.textContent = 'Work Duration (min): ';
        workLabel.appendChild(this.workInput);

        const breakLabel = document.createElement('label');
        breakLabel.textContent = ' Break Duration (min): ';
        breakLabel.appendChild(this.breakInput);

        this.intervalOptions.appendChild(workLabel);
        this.intervalOptions.appendChild(breakLabel);

        this.intervalContainer.appendChild(this.intervalOptions);

        // Sound selection
        this.soundButton = document.createElement('button');
        this.soundButton.className = 'sound-button';
        this.soundButton.textContent = '🔊';
        this.soundButton.setAttribute('aria-label', 'Choose timer sound');
        this.soundButton.title = 'Choose timer sound';

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
            radio.name = this.soundGroupName;
            radio.value = option.url;
            radio.checked = index === 0;
            radio.addEventListener('change', () => {
                this.selectedSound = option.url;
            });
            wrapper.appendChild(radio);
            wrapper.appendChild(document.createTextNode(` ${option.label}`));
            this.soundMenu.appendChild(wrapper);
        });

        this.soundSettingsGroup = document.createElement('div');
        this.soundSettingsGroup.className = 'timer-sound-settings';

        const soundSettingsLabel = document.createElement('div');
        soundSettingsLabel.className = 'timer-sound-settings__label';
        soundSettingsLabel.textContent = 'Notification Sound';
        this.soundSettingsGroup.appendChild(soundSettingsLabel);

        this.soundSettingsList = document.createElement('div');
        this.soundSettingsList.className = 'timer-sound-settings__list';
        this.soundSettingsGroup.appendChild(this.soundSettingsList);

        this.soundSettingsRadios = [];
        this.soundOptions.forEach((option, index) => {
            const wrapper = document.createElement('label');
            wrapper.className = 'sound-option';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `${this.soundGroupName}-settings`;
            radio.value = option.url;
            radio.checked = index === 0;
            radio.addEventListener('change', () => {
                this.selectedSound = option.url;
                this.syncSoundInputs();
            });

            wrapper.appendChild(radio);
            wrapper.appendChild(document.createTextNode(` ${option.label}`));
            this.soundSettingsList.appendChild(wrapper);
            this.soundSettingsRadios.push(radio);
        });

        this.soundButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.soundMenu.style.display = this.soundMenu.style.display === 'block' ? 'none' : 'block';
            this.soundButton.setAttribute('aria-expanded', this.soundMenu.style.display === 'block');
        });

        this.handleDocumentClick = (event) => {
            if (!this.soundMenu.contains(event.target) && event.target !== this.soundButton) {
                this.soundMenu.style.display = 'none';
                this.soundButton.setAttribute('aria-expanded', 'false');
            }
        };
        document.addEventListener('click', this.handleDocumentClick);

        // Create the timer controls
        this.controls = document.createElement('div');
        this.controls.className = 'timer-controls';

        this.handleStartClick = () => this.start();
        this.handleStopClick = () => this.stop();

        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start';
        this.startButton.addEventListener('click', this.handleStartClick);

        this.stopButton = document.createElement('button');
        this.stopButton.textContent = 'Stop';
        this.stopButton.addEventListener('click', this.handleStopClick);

        this.controls.appendChild(this.startButton);
        this.controls.appendChild(this.stopButton);

        this.modalTimerControls = document.createElement('div');
        this.modalTimerControls.className = 'timer-controls timer-controls-modal';

        this.modalStartButton = document.createElement('button');
        this.modalStartButton.textContent = 'Start';
        this.modalStartButton.addEventListener('click', this.handleStartClick);

        this.modalStopButton = document.createElement('button');
        this.modalStopButton.textContent = 'Stop';
        this.modalStopButton.addEventListener('click', this.handleStopClick);

        this.modalTimerControls.appendChild(this.modalStartButton);
        this.modalTimerControls.appendChild(this.modalStopButton);

        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.textContent = 'Ready to start a timer.';
        this.statusElements.push(this.status);

        this.modalStatus = document.createElement('div');
        this.modalStatus.className = 'widget-status';
        this.modalStatus.textContent = this.status.textContent;
        this.statusElements.push(this.modalStatus);

        // Assemble the widget
        this.controlsOverlay.appendChild(this.helpText);
        this.controlsOverlay.appendChild(this.presetContainer);
        this.controlsOverlay.appendChild(this.namedPresetSection);
        this.controlsOverlay.appendChild(this.autoRestartContainer);
        this.controlsOverlay.appendChild(this.intervalContainer);
        this.controlsOverlay.appendChild(this.soundSettingsGroup);
        this.controlsOverlay.appendChild(this.modalTimerControls);
        this.controlsOverlay.appendChild(this.modalStatus);

        this.element.appendChild(this.mainDisplay);
        this.element.appendChild(this.status);
        const controlBar = document.createElement('div');
        controlBar.className = 'widget-control-bar';

        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions';
        primaryActions.appendChild(this.startButton);
        primaryActions.appendChild(this.stopButton);

        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';
        secondaryActions.appendChild(this.soundButton);

        controlBar.append(primaryActions, secondaryActions);
        this.element.appendChild(controlBar);

        // Timer state
        this.time = 0;
        this.totalTime = 0; // Store total time for auto-restart
        this.interval = null;
        this.running = false;
        this.isIntervalMode = false;
        this.currentPhase = null;
        this.latestStatusMessage = 'Ready to start a timer.';

        this.handleTimerStartEvent = this.handleTimerStartEvent.bind(this);
        this.handleTimerStopEvent = this.handleTimerStopEvent.bind(this);
        this.handleTimerResetEvent = this.handleTimerResetEvent.bind(this);
        this.subscribeToTimerEvents();
        this.syncSoundInputs();
    }

    subscribeToTimerEvents() {
        if (!timerEventBus) return;

        timerEventBus.on('timer:start', this.handleTimerStartEvent);
        timerEventBus.on('timer:stop', this.handleTimerStopEvent);
        timerEventBus.on('timer:reset', this.handleTimerResetEvent);
    }

    unsubscribeFromTimerEvents() {
        if (!timerEventBus) return;

        timerEventBus.off('timer:start', this.handleTimerStartEvent);
        timerEventBus.off('timer:stop', this.handleTimerStopEvent);
        timerEventBus.off('timer:reset', this.handleTimerResetEvent);
    }

    emitTimerEvent(eventName, payload) {
        if (!timerEventBus) return;

        try {
            timerEventBus.emit(eventName, payload);
        } catch (error) {
            console.error(`[TimerWidget] Failed to emit ${eventName}`, error);
        }
    }

    getDisplayText() {
        const minutes = Math.floor(this.time / 60);
        const seconds = this.time % 60;
        const label = this.isIntervalMode && this.currentPhase ? `${this.currentPhase}: ` : '';
        return `${label}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    getTimerStateSnapshot(extra = {}) {
        return {
            widgetId: this.widgetId || null,
            running: this.running,
            display: this.getDisplayText(),
            remainingSeconds: this.time,
            totalSeconds: this.totalTime,
            isIntervalMode: this.isIntervalMode,
            currentPhase: this.currentPhase,
            statusMessage: this.latestStatusMessage,
            ...extra
        };
    }

    emitTimerState(eventName = 'timer:updated', extra = {}) {
        this.emitTimerEvent(eventName, this.getTimerStateSnapshot(extra));
    }

    applySyncedState(snapshot = {}) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        if (typeof snapshot.isIntervalMode === 'boolean') {
            this.isIntervalMode = snapshot.isIntervalMode;
            if (this.intervalCheckbox) {
                this.intervalCheckbox.checked = this.isIntervalMode;
            }
            if (this.intervalOptions) {
                this.intervalOptions.style.display = this.isIntervalMode ? 'block' : 'none';
            }
        }

        this.currentPhase = typeof snapshot.currentPhase === 'string' ? snapshot.currentPhase : null;
        this.time = Number.isFinite(snapshot.remainingSeconds) ? Math.max(0, Math.floor(snapshot.remainingSeconds)) : 0;
        this.totalTime = Number.isFinite(snapshot.totalSeconds) ? Math.max(0, Math.floor(snapshot.totalSeconds)) : this.time;
        this.running = !!snapshot.running;
        const syncedStatus = typeof snapshot.statusMessage === 'string' && snapshot.statusMessage.trim()
            ? snapshot.statusMessage
            : (this.running ? 'Timer running...' : 'Ready to start a timer.');
        this.latestStatusMessage = syncedStatus;
        this.display.style.color = this.latestStatusMessage === 'Time is up!' ? 'red' : '';
        this.updateDisplay();
        this.statusElements.forEach((statusEl) => {
            if (!statusEl) return;
            statusEl.textContent = syncedStatus;
            statusEl.classList.toggle('warning', syncedStatus === 'Time is up!' || syncedStatus === 'Timer stopped.' || syncedStatus === 'Timer reset.');
        });
    }

    handleTimerStartEvent(payload = {}) {
        const targetId = payload && payload.widgetId ? payload.widgetId : null;
        if (targetId && targetId !== this.widgetId) return;

        const minutes = typeof payload.minutes === 'number' ? payload.minutes : null;
        this.start(minutes);
    }

    handleTimerStopEvent(payload = {}) {
        const targetId = payload && payload.widgetId ? payload.widgetId : null;
        if (targetId && targetId !== this.widgetId) return;

        this.stop(false);
    }

    handleTimerResetEvent(payload = {}) {
        const targetId = payload && payload.widgetId ? payload.widgetId : null;
        if (targetId && targetId !== this.widgetId) return;

        this.reset(false);
    }

    setEditable() {}

    getControls() {
        return this.controlsOverlay;
    }

    syncSoundInputs() {
        const selectedSound = this.selectedSound;

        Array.from(this.soundMenu.querySelectorAll('input[type="radio"]')).forEach((radio) => {
            radio.checked = radio.value === selectedSound;
        });

        this.soundSettingsRadios.forEach((radio) => {
            radio.checked = radio.value === selectedSound;
        });
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
        const hasExplicitMinutes = Number.isFinite(minutes) && minutes > 0;

        // Teacher controls can send a fresh duration while the timer is already running.
        if (this.running && hasExplicitMinutes) {
            clearInterval(this.interval);
            this.interval = null;
            this.running = false;
        }

        if (!this.running) {
            this.display.style.color = ''; // Reset color in case it was red
            if (this.isIntervalMode && !hasExplicitMinutes) {
                this.currentPhase = 'Work';
                const workMinutes = this.getWorkDuration();
                this.time = workMinutes * 60;
                this.totalTime = this.time;
                this.setStatus(`Interval started: Work for ${workMinutes} minute(s).`);
            } else {
                // Priority: Argument -> Current Time (if set by preset) -> Dropdown -> Default
                let chosenMinutes;
                if (hasExplicitMinutes) {
                     chosenMinutes = minutes;
                     this.currentPhase = null;
                     this.selectedPresetName = null;
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
            this.running = true;
            this.updateDisplay();
            this.flashDisplay();
            this.interval = setInterval(() => this.tick(), 1000);
            this.emitTimerState('timer:updated');
            this.emitTimerState('timer:started', { minutes: this.totalTime / 60 });
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
        this.display.textContent = this.getDisplayText();
        this.emitTimerState('timer:updated');
    }

    /**
     * Stop the timer.
     */
    stop(emitEvent = true) {
        clearInterval(this.interval);
        this.interval = null;
        this.running = false;
        this.setStatus('Timer stopped.', 'warning');
        this.flashDisplay();
        this.emitTimerState('timer:updated');

        if (emitEvent) {
            this.emitTimerState('timer:stopped');
        }
    }

    reset(emitEvent = true) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.running = false;
        this.time = 0;
        this.totalTime = 0;
        this.currentPhase = null;
        this.display.style.color = '';
        this.updateDisplay();
        this.setStatus('Timer reset.', 'warning');
        this.emitTimerState('timer:updated');

        if (emitEvent) {
            this.emitTimerState('timer:reset');
        }
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
        this.unsubscribeFromTimerEvents();
        document.removeEventListener('click', this.handleDocumentClick);
        this.startButton?.removeEventListener('click', this.handleStartClick);
        this.stopButton?.removeEventListener('click', this.handleStopClick);
        this.modalStartButton?.removeEventListener('click', this.handleStartClick);
        this.modalStopButton?.removeEventListener('click', this.handleStopClick);

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
        this.latestStatusMessage = message;
        this.statusElements.forEach((statusEl) => {
            if (!statusEl) return;
            statusEl.textContent = message;
            statusEl.classList.toggle('warning', tone === 'warning');
            statusEl.classList.add('action-flash');
            setTimeout(() => statusEl.classList.remove('action-flash'), 800);
        });
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
            this.syncSoundInputs();
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
        this.emitTimerState('timer:updated');
    }
}
