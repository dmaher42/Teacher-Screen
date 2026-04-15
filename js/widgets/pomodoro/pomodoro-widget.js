const POMODORO_RHYTHMS = {
    classic: { label: '25 / 5', workMinutes: 25, breakMinutes: 5 },
    extended: { label: '50 / 10', workMinutes: 50, breakMinutes: 10 }
};

const getPomodoroEventBus = () => (window.TeacherScreenEventBus ? window.TeacherScreenEventBus.eventBus : null);

class PomodoroWidget {
    constructor() {
        this.layoutType = 'grid';
        this.mode = 'classic';
        this.phase = 'work';
        this.running = false;
        this.interval = null;
        this.remainingSeconds = this.getWorkDurationSeconds();
        this.customWorkSeconds = null;
        this.latestStatusMessage = 'Ready to focus.';
        this.audioContext = null;
        this.widgetId = null;
        this.widgetInfo = null;
        this.eventBusUnsubscribers = [];

        this.handleTimerStartEvent = this.handleTimerStartEvent.bind(this);
        this.handleTimerStopEvent = this.handleTimerStopEvent.bind(this);
        this.handleTimerResetEvent = this.handleTimerResetEvent.bind(this);

        this.element = document.createElement('div');
        this.element.className = 'pomodoro-widget-content';

        this.displayCard = document.createElement('section');
        this.displayCard.className = 'pomodoro-display';

        this.displayHeader = document.createElement('div');
        this.displayHeader.className = 'pomodoro-display__header';

        this.phaseBadge = document.createElement('div');
        this.phaseBadge.className = 'pomodoro-phase-badge';

        this.rhythmBadge = document.createElement('div');
        this.rhythmBadge.className = 'pomodoro-rhythm-badge';

        this.displayHeader.append(this.phaseBadge, this.rhythmBadge);

        this.displayTime = document.createElement('div');
        this.displayTime.className = 'pomodoro-time';

        this.progressTrack = document.createElement('div');
        this.progressTrack.className = 'pomodoro-progress';

        this.progressFill = document.createElement('div');
        this.progressFill.className = 'pomodoro-progress__fill';
        this.progressTrack.appendChild(this.progressFill);

        this.status = document.createElement('div');
        this.status.className = 'widget-status pomodoro-status';
        this.status.textContent = this.latestStatusMessage;

        this.displayCard.append(this.displayHeader, this.displayTime, this.progressTrack, this.status);

        this.controlBar = document.createElement('div');
        this.controlBar.className = 'widget-control-bar pomodoro-control-bar';

        this.primaryActions = document.createElement('div');
        this.primaryActions.className = 'primary-actions';

        this.secondaryActions = document.createElement('div');
        this.secondaryActions.className = 'secondary-actions';

        this.startPauseButton = this.createControlButton('Start', () => this.toggleStartPause(), 'control-button modal-primary');
        this.resetButton = this.createControlButton('Reset', () => this.reset(), 'control-button control-button--ghost');
        this.settingsButton = this.createControlButton('', () => this.openSettings(), 'control-button control-button--ghost pomodoro-settings-button');
        this.settingsButton.setAttribute('aria-label', 'Pomodoro settings');
        this.settingsButton.title = 'Pomodoro settings';
        this.settingsButton.innerHTML = '<i class="fas fa-gear" aria-hidden="true"></i>';
        this.primaryActions.append(this.startPauseButton, this.resetButton);
        this.secondaryActions.append(this.settingsButton);
        this.controlBar.append(this.primaryActions, this.secondaryActions);

        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls pomodoro-settings-controls';

        const settingsTitle = document.createElement('h3');
        settingsTitle.textContent = 'Pomodoro Rhythm';

        const settingsHelp = document.createElement('p');
        settingsHelp.className = 'widget-help-text pomodoro-settings-description';
        settingsHelp.textContent = 'Choose the rhythm that fits the lesson. The widget will auto-switch from work to break.';

        this.rhythmGroup = document.createElement('div');
        this.rhythmGroup.className = 'pomodoro-rhythm-toggle';

        this.rhythmButtons = new Map();
        ['classic', 'extended'].forEach((mode) => {
            const config = POMODORO_RHYTHMS[mode];
            const button = this.createControlButton(config.label, () => this.setMode(mode), 'control-button pomodoro-rhythm-option');
            button.dataset.mode = mode;
            this.rhythmButtons.set(mode, button);
            this.rhythmGroup.appendChild(button);
        });

        this.controlsOverlay.append(settingsTitle, settingsHelp, this.rhythmGroup);

        this.element.append(this.displayCard, this.controlBar);

        this.render();
        this.subscribeToTimerEvents();
    }

    createControlButton(label, onClick, className = 'control-button') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    getRhythmConfig(mode = this.mode) {
        return POMODORO_RHYTHMS[mode] || POMODORO_RHYTHMS.classic;
    }

    getWorkDurationSeconds(mode = this.mode) {
        return this.getRhythmConfig(mode).workMinutes * 60;
    }

    getBreakDurationSeconds(mode = this.mode) {
        return this.getRhythmConfig(mode).breakMinutes * 60;
    }

    getCurrentPhaseDurationSeconds() {
        if (this.phase === 'break') {
            return this.getBreakDurationSeconds();
        }

        return this.customWorkSeconds || this.getWorkDurationSeconds();
    }

    getPhaseLabel() {
        return this.phase === 'break' ? 'Break' : 'Focus';
    }

    getCountdownText() {
        return this.formatTime(this.remainingSeconds);
    }

    getDisplayText() {
        return `${this.getPhaseLabel()}: ${this.getCountdownText()}`;
    }

    getTimerStateSnapshot(extra = {}) {
        return {
            type: 'PomodoroWidget',
            widgetId: this.widgetId,
            running: this.running,
            remainingSeconds: this.remainingSeconds,
            display: this.getDisplayText(),
            isIntervalMode: true,
            currentPhase: this.phase === 'break' ? 'Break' : 'Work',
            statusMessage: this.latestStatusMessage,
            rhythmMode: this.mode,
            rhythmLabel: this.getRhythmConfig().label,
            workDuration: this.getWorkDurationSeconds() / 60,
            breakDuration: this.getBreakDurationSeconds() / 60,
            ...extra
        };
    }

    emitTimerState(eventName = 'timer:updated', extra = {}) {
        const eventBus = getPomodoroEventBus();
        if (!eventBus) {
            return;
        }

        try {
            eventBus.emit(eventName, this.getTimerStateSnapshot(extra));
        } catch (error) {
            console.error(`[PomodoroWidget] Failed to emit ${eventName}`, error);
        }
    }

    subscribeToTimerEvents() {
        const eventBus = getPomodoroEventBus();
        if (!eventBus) {
            return;
        }

        this.eventBusUnsubscribers.push(
            eventBus.on('timer:start', this.handleTimerStartEvent),
            eventBus.on('timer:stop', this.handleTimerStopEvent),
            eventBus.on('timer:reset', this.handleTimerResetEvent)
        );
    }

    unsubscribeFromTimerEvents() {
        this.eventBusUnsubscribers.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.eventBusUnsubscribers = [];
    }

    handleTimerStartEvent(payload = {}) {
        if (payload.widgetId && this.widgetId && payload.widgetId !== this.widgetId) {
            return;
        }

        const durationSeconds = Number.isFinite(payload.seconds) && payload.seconds > 0
            ? Math.floor(payload.seconds)
            : Number.isFinite(payload.minutes) && payload.minutes > 0
                ? Math.floor(payload.minutes * 60)
                : null;

        this.start({ durationSeconds });
    }

    handleTimerStopEvent(payload = {}) {
        if (payload.widgetId && this.widgetId && payload.widgetId !== this.widgetId) {
            return;
        }

        this.pause();
    }

    handleTimerResetEvent(payload = {}) {
        if (payload.widgetId && this.widgetId && payload.widgetId !== this.widgetId) {
            return;
        }

        this.reset();
    }

    toggleStartPause() {
        if (this.running) {
            this.pause();
        } else {
            this.start();
        }
    }

    start({ durationSeconds = null } = {}) {
        if (this.running) {
            return;
        }

        if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
            this.phase = 'work';
            this.remainingSeconds = Math.floor(durationSeconds);
            this.customWorkSeconds = this.remainingSeconds;
        } else if (!this.phase || this.remainingSeconds <= 0) {
            this.phase = 'work';
            this.remainingSeconds = this.getWorkDurationSeconds();
            this.customWorkSeconds = null;
        } else if (this.phase === 'work' && this.customWorkSeconds === null && this.remainingSeconds > this.getWorkDurationSeconds()) {
            this.remainingSeconds = this.getWorkDurationSeconds();
        }

        this.running = true;
        this.clearTimerInterval();
        this.interval = window.setInterval(() => this.tick(), 1000);
        this.setStatus(this.phase === 'break' ? 'Break resumed.' : 'Focus started.');
        this.render();
        this.emitTimerState('timer:updated');
        this.emitTimerState('timer:started', { minutes: this.remainingSeconds / 60, seconds: this.remainingSeconds });
    }

    pause(emitEvent = true) {
        if (!this.running) {
            return;
        }

        this.clearTimerInterval();
        this.running = false;
        this.setStatus(`${this.getPhaseLabel()} paused.`);
        this.render();
        this.emitTimerState('timer:updated');

        if (emitEvent) {
            this.emitTimerState('timer:stopped');
        }
    }

    reset(emitEvent = true) {
        this.clearTimerInterval();
        this.running = false;
        this.phase = 'work';
        this.customWorkSeconds = null;
        this.remainingSeconds = this.getWorkDurationSeconds();
        this.setStatus('Ready to focus.');
        this.render();
        this.emitTimerState('timer:updated');

        if (emitEvent) {
            this.emitTimerState('timer:reset');
        }
    }

    tick() {
        if (!this.running) {
            return;
        }

        if (this.remainingSeconds <= 1) {
            this.advancePhase();
            return;
        }

        this.remainingSeconds -= 1;
        this.render();
        this.emitTimerState('timer:updated');
    }

    advancePhase() {
        const nextPhase = this.phase === 'break' ? 'work' : 'break';
        this.playChime();

        this.phase = nextPhase;
        if (nextPhase === 'break') {
            this.remainingSeconds = this.getBreakDurationSeconds();
            this.customWorkSeconds = null;
            this.setStatus('Work complete. Break started automatically.');
        } else {
            this.remainingSeconds = this.getWorkDurationSeconds();
            this.setStatus('Break complete. Focus started automatically.');
        }

        this.render();
        this.emitTimerState('timer:updated');
    }

    clearTimerInterval() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    setMode(mode) {
        const nextMode = mode === 'extended' ? 'extended' : 'classic';
        if (this.mode === nextMode) {
            this.updateModeButtons();
            return;
        }

        this.clearTimerInterval();
        this.running = false;
        this.mode = nextMode;
        this.phase = 'work';
        this.customWorkSeconds = null;
        this.remainingSeconds = this.getWorkDurationSeconds();
        this.setStatus(`Rhythm set to ${this.getRhythmConfig().label}.`);
        this.render();
        this.emitTimerState('timer:updated');
        this.emitTimerState('timer:reset');
    }

    updateModeButtons() {
        this.rhythmButtons.forEach((button, mode) => {
            button.classList.toggle('is-active', this.mode === mode);
            button.setAttribute('aria-pressed', this.mode === mode ? 'true' : 'false');
        });
    }

    render() {
        this.phaseBadge.textContent = this.phase === 'break' ? 'Break' : 'Focus';
        this.rhythmBadge.textContent = this.getRhythmConfig().label;
        this.displayTime.textContent = this.getCountdownText();
        this.startPauseButton.textContent = this.running ? 'Pause' : (this.phase === 'break' ? 'Resume' : 'Start');

        const currentDuration = Math.max(1, this.getCurrentPhaseDurationSeconds());
        const elapsed = Math.max(0, currentDuration - this.remainingSeconds);
        const progress = Math.min(100, Math.max(0, (elapsed / currentDuration) * 100));
        this.progressFill.style.width = `${progress}%`;

        this.status.textContent = this.latestStatusMessage;
        this.updateModeButtons();
    }

    formatTime(totalSeconds = 0) {
        const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
        const minutes = Math.floor(safeSeconds / 60);
        const seconds = safeSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    setStatus(message) {
        this.latestStatusMessage = message || 'Ready to focus.';
        if (this.status) {
            this.status.textContent = this.latestStatusMessage;
        }
    }

    openSettings() {
        document.dispatchEvent(new CustomEvent('openWidgetSettings', { detail: { widget: this } }));
    }

    ensureAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            return null;
        }

        if (!this.audioContext) {
            this.audioContext = new AudioContextClass();
        }

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }

        return this.audioContext;
    }

    playChime() {
        const audioContext = this.ensureAudioContext();
        if (!audioContext) {
            return;
        }

        const startTime = audioContext.currentTime + 0.02;
        const notes = [880, 1175];

        notes.forEach((frequency, index) => {
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const noteStart = startTime + (index * 0.12);

            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, noteStart);
            gain.gain.exponentialRampToValueAtTime(0.18, noteStart + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.18);

            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start(noteStart);
            oscillator.stop(noteStart + 0.22);
        });
    }

    getControls() {
        return this.controlsOverlay;
    }

    setEditable() {}

    serialize() {
        return {
            type: 'PomodoroWidget',
            mode: this.mode,
            phase: this.phase,
            running: this.running,
            remainingSeconds: this.remainingSeconds,
            customWorkSeconds: this.customWorkSeconds,
            latestStatusMessage: this.latestStatusMessage
        };
    }

    deserialize(data = {}) {
        this.mode = data.mode === 'extended' ? 'extended' : 'classic';
        this.phase = data.phase === 'break' ? 'break' : 'work';
        this.customWorkSeconds = Number.isFinite(data.customWorkSeconds) && data.customWorkSeconds > 0
            ? Math.floor(data.customWorkSeconds)
            : null;
        this.remainingSeconds = Number.isFinite(data.remainingSeconds) && data.remainingSeconds >= 0
            ? Math.floor(data.remainingSeconds)
            : this.getCurrentPhaseDurationSeconds();
        this.running = false;
        this.latestStatusMessage = data.latestStatusMessage || 'Ready to focus.';
        this.render();
        this.emitTimerState('timer:updated');
    }

    remove() {
        this.unsubscribeFromTimerEvents();
        this.clearTimerInterval();
        this.element.remove();

        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }
}

var TimerWidget = PomodoroWidget;

if (typeof window !== 'undefined') {
    window.PomodoroWidget = PomodoroWidget;
    window.TimerWidget = TimerWidget;
}
