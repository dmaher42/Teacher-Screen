const BEHAVIOUR_TRACKER_CATEGORIES = [
    { id: 'talking-over', label: 'Talking over a speaker', shortLabel: 'Talking over' },
    { id: 'calling-out', label: 'Calling out', shortLabel: 'Calling out' },
    { id: 'out-of-seat', label: 'Out of seat', shortLabel: 'Out of seat' },
    { id: 'not-ready', label: 'Not ready / delayed transition', shortLabel: 'Not ready' }
];

const BEHAVIOUR_TRACKER_SCHEMA_VERSION = 1;
const BEHAVIOUR_TRACKER_MAX_EVENTS = 250;
const BEHAVIOUR_TRACKER_MAX_UNDO = 20;

function behaviourTrackerIsProjectorMode() {
    return window.APP_MODE === 'projector'
        || document.body?.classList.contains('projector-view')
        || (window.TeacherScreenAppMode
            && typeof window.TeacherScreenAppMode.isProjectorMode === 'function'
            && window.TeacherScreenAppMode.isProjectorMode());
}

function behaviourTrackerClampNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function behaviourTrackerFormatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function behaviourTrackerMakeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return `${prefix}-${window.crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

class BehaviourTrackerWidget {
    constructor() {
        this.schemaVersion = BEHAVIOUR_TRACKER_SCHEMA_VERSION;
        this.categories = BEHAVIOUR_TRACKER_CATEGORIES.map((category) => ({ ...category }));
        this.selectedCategoryId = this.categories[0].id;
        this.students = [];
        this.events = [];
        this.publicObservationCount = 0;
        this.elapsedMs = 0;
        this.runningSince = null;
        this.undoStack = [];
        this.projectorMode = behaviourTrackerIsProjectorMode();
        this.intervalId = null;
        this.lastAnnouncement = '';
        this.controlWindow = null;
        this.controlRoot = null;

        this.element = document.createElement('section');
        this.element.className = 'behaviour-tracker-widget-content';
        this.element.dataset.mode = this.projectorMode ? 'public' : 'class';
        this.element.tabIndex = -1;
        this.element.setAttribute('aria-label', 'Class learning-time display');

        this.handleKeyDown = this.onKeyDown.bind(this);

        this.render();
        this.startDisplayClock();
    }

    getCurrentElapsed(now = Date.now()) {
        if (!Number.isFinite(this.runningSince)) {
            return this.elapsedMs;
        }

        return this.elapsedMs + Math.max(0, now - this.runningSince);
    }

    getSelectedCategory() {
        return this.categories.find((category) => category.id === this.selectedCategoryId)
            || this.categories[0];
    }

    getStudentCount(studentId) {
        return this.events.filter((event) => event.studentId === studentId).length;
    }

    getSerializableSnapshot() {
        return {
            elapsedMs: this.elapsedMs,
            runningSince: this.runningSince,
            selectedCategoryId: this.selectedCategoryId,
            students: this.students.map((student) => ({ ...student })),
            events: this.events.map((event) => ({ ...event }))
        };
    }

    restoreSnapshot(snapshot) {
        if (!snapshot) return;

        this.elapsedMs = behaviourTrackerClampNumber(snapshot.elapsedMs);
        this.runningSince = Number.isFinite(snapshot.runningSince) ? snapshot.runningSince : null;
        this.selectedCategoryId = this.categories.some((category) => category.id === snapshot.selectedCategoryId)
            ? snapshot.selectedCategoryId
            : this.categories[0].id;
        this.students = this.sanitizeStudents(snapshot.students);
        this.events = this.sanitizeEvents(snapshot.events);
    }

    pushUndo(label) {
        this.undoStack.push({
            label,
            snapshot: this.getSerializableSnapshot()
        });

        if (this.undoStack.length > BEHAVIOUR_TRACKER_MAX_UNDO) {
            this.undoStack.shift();
        }
    }

    notifyChange(message = '') {
        if (message) {
            this.lastAnnouncement = message;
        }

        this.render();
        this.renderControlWindow();
        window.TeacherScreenWidgetState.notifyChanged(this, 'learning-time-updated');
    }

    focusShortcuts() {
        window.requestAnimationFrame(() => {
            if (this.controlWindow && !this.controlWindow.closed && this.controlRoot) {
                this.controlRoot.focus({ preventScroll: true });
            }
        });
    }

    openControlWindow() {
        if (this.projectorMode) return;

        if (this.controlWindow && !this.controlWindow.closed) {
            this.controlWindow.focus();
            this.focusShortcuts();
            return;
        }

        const popup = window.open(
            '',
            '_blank',
            'popup=yes,width=560,height=780,resizable=yes,scrollbars=yes'
        );

        if (!popup) {
            this.lastAnnouncement = 'The private controls could not open. Allow pop-ups for this local app and try again.';
            this.render();
            return;
        }

        this.controlWindow = popup;
        const popupDocument = popup.document;
        popupDocument.documentElement.lang = document.documentElement.lang || 'en';
        popupDocument.head.replaceChildren();

        const title = popupDocument.createElement('title');
        title.textContent = 'Private behaviour controls';
        const meta = popupDocument.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1';
        const stylesheet = popupDocument.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL('css/behaviour-tracker.css?v=4', document.baseURI).href;
        const windowStyles = popupDocument.createElement('style');
        windowStyles.textContent = `
            html, body { min-height: 100%; margin: 0; background: #fbfdfc; }
            body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
            .behaviour-controller-root { min-height: 100vh; height: auto; overflow: visible; }
        `;
        popupDocument.head.append(title, meta, stylesheet, windowStyles);
        popupDocument.body.className = 'behaviour-controller-window';
        popup.addEventListener('beforeunload', () => {
            this.controlWindow = null;
            this.controlRoot = null;
        }, { once: true });

        this.renderControlWindow();
        popup.focus();
        this.focusShortcuts();
    }

    renderControlWindow() {
        if (!this.controlWindow || this.controlWindow.closed || this.projectorMode) return;

        const popupDocument = this.controlWindow.document;
        const root = popupDocument.createElement('main');
        root.className = 'behaviour-tracker-widget-content behaviour-controller-root';
        root.dataset.mode = 'private';
        root.tabIndex = 0;
        root.setAttribute('aria-label', 'Private behaviour and lost learning-time controls');
        root.addEventListener('keydown', this.handleKeyDown);
        root.appendChild(this.renderTeacherView());
        popupDocument.body.replaceChildren(root);
        this.controlRoot = root;
    }

    toggleTimer() {
        if (this.projectorMode) return;

        const now = Date.now();
        if (Number.isFinite(this.runningSince)) {
            this.pushUndo('Resume learning');
            this.elapsedMs = this.getCurrentElapsed(now);
            this.runningSince = null;
            this.notifyChange(`Learning resumed. Total lost learning time is ${behaviourTrackerFormatTime(this.elapsedMs)}.`);
        } else {
            this.pushUndo('Pause learning');
            this.runningSince = now;
            this.notifyChange('Learning paused. The lost learning-time timer is running.');
        }

        this.focusShortcuts();
    }

    selectCategory(categoryId) {
        if (this.projectorMode) return;
        if (!this.categories.some((category) => category.id === categoryId)) return;

        this.selectedCategoryId = categoryId;
        const category = this.getSelectedCategory();
        this.notifyChange(`${category.label} selected.`);
        this.focusShortcuts();
    }

    logMark(student = null) {
        if (this.projectorMode) return;

        const category = this.getSelectedCategory();
        const studentName = student?.name || null;
        this.pushUndo(studentName ? `Mark for ${studentName}` : 'Class mark');
        this.events.push({
            id: behaviourTrackerMakeId('observation'),
            categoryId: category.id,
            categoryLabel: category.label,
            studentId: student?.id || null,
            studentName,
            occurredAt: Date.now()
        });
        this.events = this.events.slice(-BEHAVIOUR_TRACKER_MAX_EVENTS);

        this.notifyChange(studentName
            ? `${category.shortLabel} recorded privately for ${studentName}.`
            : `${category.shortLabel} recorded as a class observation.`);
        this.focusShortcuts();
    }

    undoLastAction() {
        if (this.projectorMode || this.undoStack.length === 0) return;

        const previous = this.undoStack.pop();
        this.restoreSnapshot(previous.snapshot);
        this.notifyChange(`${previous.label} undone.`);
        this.focusShortcuts();
    }

    saveRoster(rawNames) {
        if (this.projectorMode) return;

        const names = String(rawNames || '')
            .split(/\r?\n|,/)
            .map((name) => name.trim().replace(/\s+/g, ' '))
            .filter(Boolean)
            .slice(0, 40);
        const existingByName = new Map(this.students.map((student) => [student.name.toLocaleLowerCase(), student]));
        const seen = new Set();
        const nextStudents = [];

        names.forEach((name) => {
            const key = name.toLocaleLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            const existing = existingByName.get(key);
            nextStudents.push(existing || { id: behaviourTrackerMakeId('student'), name });
        });

        this.pushUndo('Roster change');
        this.students = nextStudents;
        this.notifyChange(`${this.students.length} student${this.students.length === 1 ? '' : 's'} saved locally in this screen.`);
        this.focusShortcuts();
    }

    clearLesson() {
        if (this.projectorMode) return;

        const hasLessonData = this.events.length > 0 || this.getCurrentElapsed() > 0;
        if (!hasLessonData) return;
        const confirmWindow = this.controlWindow && !this.controlWindow.closed ? this.controlWindow : window;
        if (!confirmWindow.confirm('Clear this lesson\'s observations and lost-time total? The roster will be kept.')) return;

        this.pushUndo('Clear lesson');
        this.elapsedMs = 0;
        this.runningSince = null;
        this.events = [];
        this.notifyChange('Lesson totals cleared. The roster was kept.');
        this.focusShortcuts();
    }

    onKeyDown(event) {
        const target = event.target;
        if (target?.matches?.('input, textarea, select, [contenteditable="true"]')
            || target?.isContentEditable) {
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            this.undoLastAction();
            return;
        }

        if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;

        if (event.key === ' ' && !target?.matches?.('button')) {
            event.preventDefault();
            this.toggleTimer();
            return;
        }

        const shortcutNumber = Number.parseInt(event.key, 10);
        if (shortcutNumber >= 1 && shortcutNumber <= this.categories.length) {
            event.preventDefault();
            this.selectCategory(this.categories[shortcutNumber - 1].id);
        }
    }

    startDisplayClock() {
        this.stopDisplayClock();
        this.intervalId = window.setInterval(() => {
            if (!Number.isFinite(this.runningSince)) return;
            this.updateLiveTimer();
        }, 250);
    }

    stopDisplayClock() {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    updateLiveTimer() {
        const updateTimerInRoot = (root, showLiveElapsed) => {
            const timer = root?.querySelector?.('[data-behaviour-timer]');
            if (!timer) return;
            const elapsed = showLiveElapsed ? this.getCurrentElapsed() : this.elapsedMs;
            const formatted = behaviourTrackerFormatTime(elapsed);
            timer.textContent = formatted;
            timer.setAttribute('aria-label', `${formatted} lost learning time`);
        };

        updateTimerInRoot(this.element, !Number.isFinite(this.runningSince));
        updateTimerInRoot(this.controlRoot, true);
    }

    createButton(label, className, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    renderTimerPanel({ publicView = false } = {}) {
        const panel = document.createElement('div');
        panel.className = publicView ? 'behaviour-public-timer' : 'behaviour-timer-panel';
        const running = Number.isFinite(this.runningSince);
        const displayedElapsed = publicView && running ? this.elapsedMs : this.getCurrentElapsed();
        const formattedElapsed = behaviourTrackerFormatTime(displayedElapsed);
        panel.dataset.running = running ? 'true' : 'false';

        const eyebrow = document.createElement('p');
        eyebrow.className = 'behaviour-eyebrow';
        eyebrow.textContent = publicView
            ? (running ? 'Learning is paused' : 'Learning is in progress')
            : 'Lost learning time';

        const time = document.createElement('p');
        time.className = 'behaviour-timer-value';
        time.dataset.behaviourTimer = '';
        time.textContent = formattedElapsed;
        time.setAttribute('aria-label', `${formattedElapsed} lost learning time`);

        panel.append(eyebrow, time);

        if (publicView) {
            const message = document.createElement('p');
            message.className = 'behaviour-public-message';
            message.textContent = running
                ? 'The completed total will update when learning resumes.'
                : 'This total changes only when learning has actually stopped.';
            panel.appendChild(message);
            return panel;
        }

        const toggle = this.createButton(
            running ? 'Resume learning' : 'Pause learning',
            `behaviour-timer-toggle${running ? ' is-running' : ''}`,
            () => this.toggleTimer()
        );
        toggle.setAttribute('aria-pressed', running ? 'true' : 'false');
        toggle.setAttribute('aria-label', running
            ? 'Resume learning and stop the lost learning-time timer'
            : 'Pause learning and start the lost learning-time timer');

        const helper = document.createElement('p');
        helper.className = 'behaviour-timer-helper';
        helper.textContent = running
            ? 'Timer running - tap when teaching resumes.'
            : 'Start this only when teaching or learning actually stops.';

        panel.append(toggle, helper);
        return panel;
    }

    renderCategoryPicker() {
        const section = document.createElement('section');
        section.className = 'behaviour-control-section';
        const heading = document.createElement('div');
        heading.className = 'behaviour-section-heading';
        heading.innerHTML = '<strong>1. Choose the behaviour</strong><span>Keys 1-4</span>';
        section.appendChild(heading);

        const grid = document.createElement('div');
        grid.className = 'behaviour-category-grid';
        this.categories.forEach((category, index) => {
            const selected = category.id === this.selectedCategoryId;
            const button = this.createButton(
                `${index + 1}. ${category.shortLabel}`,
                `behaviour-category${selected ? ' is-selected' : ''}`,
                () => this.selectCategory(category.id)
            );
            button.dataset.categoryId = category.id;
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
            button.title = category.label;
            grid.appendChild(button);
        });

        section.appendChild(grid);
        return section;
    }

    renderMarkingPanel() {
        const section = document.createElement('section');
        section.className = 'behaviour-control-section behaviour-marking-section';
        const heading = document.createElement('div');
        heading.className = 'behaviour-section-heading';
        heading.innerHTML = '<strong>2. Record it</strong><span>Private teacher notes</span>';
        section.appendChild(heading);

        const classMark = this.createButton(
            'Class / anonymous mark',
            'behaviour-class-mark',
            () => this.logMark()
        );
        classMark.dataset.action = 'class-mark';
        classMark.setAttribute('aria-label', `Record ${this.getSelectedCategory().label} without naming a student`);
        section.appendChild(classMark);

        if (this.students.length > 0) {
            const grid = document.createElement('div');
            grid.className = 'behaviour-student-grid';
            this.students.forEach((student) => {
                const button = this.createButton('', 'behaviour-student-mark', () => this.logMark(student));
                button.dataset.studentId = student.id;
                button.setAttribute('aria-label', `Record ${this.getSelectedCategory().label} for ${student.name}`);

                const name = document.createElement('span');
                name.className = 'behaviour-student-name';
                name.textContent = student.name;
                const count = document.createElement('span');
                count.className = 'behaviour-student-count';
                count.textContent = String(this.getStudentCount(student.id));
                count.setAttribute('aria-label', `${this.getStudentCount(student.id)} observations`);
                button.append(name, count);
                grid.appendChild(button);
            });
            section.appendChild(grid);
        }

        const rosterDetails = document.createElement('details');
        rosterDetails.className = 'behaviour-roster-details';
        const summary = document.createElement('summary');
        summary.textContent = this.students.length > 0 ? 'Edit private roster' : 'Add an optional private roster';
        rosterDetails.appendChild(summary);

        const rosterHint = document.createElement('p');
        rosterHint.textContent = 'Use first names or initials, one per line. Names stay in this browser and never appear on the projector.';
        const textarea = document.createElement('textarea');
        textarea.className = 'behaviour-roster-input';
        textarea.rows = 4;
        textarea.placeholder = 'Alex\nBailey\nCasey';
        textarea.value = this.students.map((student) => student.name).join('\n');
        textarea.setAttribute('aria-label', 'Student first names or initials, one per line');
        const saveRoster = this.createButton('Save roster', 'behaviour-secondary-button', () => this.saveRoster(textarea.value));
        saveRoster.dataset.action = 'save-roster';
        rosterDetails.append(rosterHint, textarea, saveRoster);
        section.appendChild(rosterDetails);

        return section;
    }

    renderRecentEvents() {
        const section = document.createElement('section');
        section.className = 'behaviour-recent-section';
        const heading = document.createElement('div');
        heading.className = 'behaviour-section-heading';
        const total = document.createElement('strong');
        total.textContent = `${this.events.length} observation${this.events.length === 1 ? '' : 's'} this lesson`;
        const privateLabel = document.createElement('span');
        privateLabel.textContent = 'Teacher only';
        heading.append(total, privateLabel);
        section.appendChild(heading);

        if (this.events.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'behaviour-empty';
            empty.textContent = 'No observations yet. The timer and marks are deliberately separate.';
            section.appendChild(empty);
            return section;
        }

        const list = document.createElement('ol');
        list.className = 'behaviour-recent-list';
        this.events.slice(-4).reverse().forEach((event) => {
            const item = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = event.studentName
                ? `${event.categoryLabel} - ${event.studentName}`
                : `${event.categoryLabel} - class`;
            const time = document.createElement('time');
            time.dateTime = new Date(event.occurredAt).toISOString();
            time.textContent = new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            item.append(label, time);
            list.appendChild(item);
        });
        section.appendChild(list);
        return section;
    }

    renderTeacherView() {
        const shell = document.createElement('div');
        shell.className = 'behaviour-tracker-shell';

        const intro = document.createElement('div');
        intro.className = 'behaviour-tracker-intro';
        const titleWrap = document.createElement('div');
        const kicker = document.createElement('span');
        kicker.className = 'behaviour-kicker';
        kicker.textContent = 'Private teacher tool';
        const title = document.createElement('h2');
        title.textContent = 'Learning-time tracker';
        titleWrap.append(kicker, title);

        const undo = this.createButton('Undo', 'behaviour-undo-button', () => this.undoLastAction());
        undo.disabled = this.undoStack.length === 0;
        undo.dataset.action = 'undo';
        undo.title = this.undoStack.length > 0
            ? `Undo ${this.undoStack[this.undoStack.length - 1].label}`
            : 'Nothing to undo';
        intro.append(titleWrap, undo);
        shell.append(intro, this.renderTimerPanel(), this.renderCategoryPicker(), this.renderMarkingPanel(), this.renderRecentEvents());

        const footer = document.createElement('div');
        footer.className = 'behaviour-tracker-footer';
        const shortcut = document.createElement('span');
        shortcut.textContent = 'Space: timer | Ctrl+Z: undo';
        const clear = this.createButton('Clear lesson', 'behaviour-clear-button', () => this.clearLesson());
        clear.disabled = this.events.length === 0 && this.getCurrentElapsed() === 0;
        clear.dataset.action = 'clear-lesson';
        footer.append(shortcut, clear);
        shell.appendChild(footer);

        const live = document.createElement('p');
        live.className = 'behaviour-sr-only';
        live.setAttribute('aria-live', 'polite');
        live.textContent = this.lastAnnouncement;
        shell.appendChild(live);
        return shell;
    }

    renderPublicView({ includeTeacherControls = false } = {}) {
        const shell = document.createElement('div');
        shell.className = 'behaviour-public-shell';
        const kicker = document.createElement('p');
        kicker.className = 'behaviour-public-kicker';
        kicker.textContent = 'Our learning time';
        const title = document.createElement('h2');
        title.textContent = 'Lost learning time';
        shell.append(kicker, title, this.renderTimerPanel({ publicView: true }));

        const totalObservations = this.projectorMode ? this.publicObservationCount : this.events.length;
        const observationCount = document.createElement('p');
        observationCount.className = 'behaviour-public-observations';
        observationCount.textContent = `${totalObservations} low-level disruption${totalObservations === 1 ? '' : 's'} noted this lesson`;
        shell.appendChild(observationCount);

        if (includeTeacherControls) {
            const actions = document.createElement('div');
            actions.className = 'behaviour-public-actions';
            const openControls = this.createButton(
                'Open private controls',
                'behaviour-open-controls',
                () => this.openControlWindow()
            );
            openControls.dataset.action = 'open-controls';
            const note = document.createElement('span');
            note.textContent = 'Student names appear only in the separate teacher window.';
            actions.append(openControls, note);
            shell.appendChild(actions);
        }

        const privacy = document.createElement('p');
        privacy.className = 'behaviour-public-privacy';
        privacy.textContent = 'Only whole-class totals are shown here.';
        shell.appendChild(privacy);
        return shell;
    }

    render() {
        this.element.replaceChildren(this.projectorMode
            ? this.renderPublicView()
            : this.renderPublicView({ includeTeacherControls: true }));
    }

    sanitizeStudents(students) {
        if (!Array.isArray(students)) return [];

        const seenIds = new Set();
        return students
            .map((student) => ({
                id: typeof student?.id === 'string' && student.id ? student.id : behaviourTrackerMakeId('student'),
                name: typeof student?.name === 'string' ? student.name.trim().slice(0, 60) : ''
            }))
            .filter((student) => student.name && !seenIds.has(student.id) && seenIds.add(student.id))
            .slice(0, 40);
    }

    sanitizeEvents(events) {
        if (!Array.isArray(events)) return [];
        const categoryIds = new Set(this.categories.map((category) => category.id));

        return events
            .filter((event) => event && categoryIds.has(event.categoryId))
            .map((event) => {
                const category = this.categories.find((candidate) => candidate.id === event.categoryId);
                return {
                    id: typeof event.id === 'string' && event.id ? event.id : behaviourTrackerMakeId('observation'),
                    categoryId: category.id,
                    categoryLabel: category.label,
                    studentId: typeof event.studentId === 'string' ? event.studentId : null,
                    studentName: typeof event.studentName === 'string' ? event.studentName.trim().slice(0, 60) : null,
                    occurredAt: behaviourTrackerClampNumber(event.occurredAt, Date.now())
                };
            })
            .slice(-BEHAVIOUR_TRACKER_MAX_EVENTS);
    }

    serialize() {
        return {
            type: 'BehaviourTrackerWidget',
            schemaVersion: this.schemaVersion,
            elapsedMs: this.getCurrentElapsed(),
            runningSince: null,
            selectedCategoryId: this.selectedCategoryId,
            observationCount: this.events.length,
            students: this.projectorMode ? [] : this.students.map((student) => ({ ...student })),
            events: this.projectorMode ? [] : this.events.map((event) => ({ ...event }))
        };
    }

    serializeForProjector() {
        return {
            type: 'BehaviourTrackerWidget',
            schemaVersion: this.schemaVersion,
            elapsedMs: this.elapsedMs,
            runningSince: this.runningSince,
            selectedCategoryId: this.selectedCategoryId,
            observationCount: this.events.length,
            students: [],
            events: []
        };
    }

    deserialize(data = {}) {
        this.elapsedMs = behaviourTrackerClampNumber(data.elapsedMs);
        this.runningSince = this.projectorMode && Number.isFinite(data.runningSince) && data.runningSince <= Date.now()
            ? data.runningSince
            : null;
        this.selectedCategoryId = this.categories.some((category) => category.id === data.selectedCategoryId)
            ? data.selectedCategoryId
            : this.categories[0].id;
        this.students = this.projectorMode ? [] : this.sanitizeStudents(data.students);
        this.events = this.projectorMode ? [] : this.sanitizeEvents(data.events);
        this.publicObservationCount = this.projectorMode
            ? Math.floor(behaviourTrackerClampNumber(data.observationCount))
            : this.events.length;
        this.undoStack = [];
        this.render();
        this.renderControlWindow();
    }

    applySyncedState(data = {}) {
        this.deserialize(data);
    }

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls behaviour-settings-controls';

        const note = document.createElement('p');
        note.className = 'widget-settings-meta';
        note.textContent = 'Student names stay in the private pop-out on this browser. The classroom canvas and projector show totals only.';
        controls.appendChild(note);

        if (!this.projectorMode) {
            const openControls = this.createButton('Open private controls', 'control-button', () => this.openControlWindow());
            openControls.dataset.action = 'open-controls';
            const clear = this.createButton('Clear current lesson totals', 'control-button modal-danger-btn', () => this.clearLesson());
            clear.disabled = this.events.length === 0 && this.getCurrentElapsed() === 0;
            controls.append(openControls, clear);
        }

        return controls;
    }

    onWidgetLayout() {
        this.updateLiveTimer();
    }

    onLayoutDiscard() {
        this.stopDisplayClock();
        if (this.controlWindow && !this.controlWindow.closed) {
            this.controlWindow.close();
        }
        this.controlWindow = null;
        this.controlRoot = null;
    }

    remove() {
        this.onLayoutDiscard();
        this.element.remove();
        document.dispatchEvent(new CustomEvent('widgetRemoved', { detail: { widget: this } }));
    }
}

window.BehaviourTrackerWidget = BehaviourTrackerWidget;
