const SIZE_PRESETS = {
    compact: { width: 25, fontSize: 24 },
    standard: { width: 30, fontSize: 28 },
    large: { width: 30, fontSize: 30 },
    'high-visibility': { width: 40, fontSize: 38 }
};
let instructionEditorApp = null;

// Deck-level public text only. Never accept arbitrary properties or HTML.
export function normalizeInstructions(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const number = (key, fallback, min, max) => Number.isFinite(Number(source[key]))
        ? Math.max(min, Math.min(max, Number(source[key]))) : fallback;
    return {
        visible: source.visible === true,
        width: number('width', 30, 22, 45),
        height: number('height', 100, 20, 100),
        x: number('x', 100, 0, 100),
        y: number('y', 0, 0, 100),
        fontSize: number('fontSize', 28, 20, 48),
        today: typeof source.today === 'string' ? source.today.slice(0, 4000) : '',
        now: typeof source.now === 'string' ? source.now.slice(0, 4000) : '',
        next: typeof source.next === 'string' ? source.next.slice(0, 4000) : ''
    };
}

export function renderInstructions(value) {
    const state = normalizeInstructions(value);
    const student = document.getElementById('student-view');
    if (!student) return;
    let media = document.getElementById('student-media');
    if (!media) {
        media = document.createElement('div');
        media.id = 'student-media';
        student.prepend(media);
        media.append(document.getElementById('widgets-container'));
        const root = document.getElementById('presentation-root');
        if (root) media.append(root);
        const rail = document.createElement('aside');
        rail.id = 'instruction-rail';
        rail.setAttribute('aria-label', 'Lesson instructions');
        for (const key of ['today', 'now', 'next']) {
            const section = document.createElement('section');
            const text = document.createElement('p');
            text.dataset.instruction = key;
            section.append(text);
            rail.append(section);
        }
        student.append(rail);
        new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(media);
    }
    const visible = state.visible && !document.body.classList.contains('instructions-media-only');
    student.classList.toggle('has-instructions', visible);
    student.style.setProperty('--instruction-width', `${state.width}%`);
    student.style.setProperty('--instruction-height-ratio', String(state.height / 100));
    student.style.setProperty('--instruction-x-ratio', String(state.x / 100));
    student.style.setProperty('--instruction-y-ratio', String(state.y / 100));
    student.style.setProperty('--instruction-font-size', `${state.fontSize}px`);
    const rail = document.getElementById('instruction-rail');
    rail.hidden = !visible;
    for (const key of ['today', 'now', 'next']) rail.querySelector(`[data-instruction="${key}"]`).textContent = state[key];
    if (instructionEditorApp) setupInstructionDragging(instructionEditorApp);
}

function setupInstructionDragging(app) {
    const editor = document.getElementById('instruction-editor');
    const rail = document.getElementById('instruction-rail');
    if (rail.querySelector('.instruction-move-handle')) return;
    const student = document.getElementById('student-view');
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'instruction-move-handle';
    handle.textContent = '⠿ Move instructions';
    handle.setAttribute('aria-label', 'Move student instructions');
    handle.title = 'Drag to move. Arrow keys move the panel; Home resets its position.';
    rail.prepend(handle);
    rail.classList.add('has-move-handle');
    const setPosition = (x, y) => {
        app.projectState.instructions = normalizeInstructions({ ...app.projectState.instructions, x, y });
        renderInstructions(app.projectState.instructions);
        app.saveState();
    };
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = rail.getBoundingClientRect();
        drag = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, deckId: app.projectState.currentDeckId };
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', (event) => {
        if (!drag || drag.pointerId !== event.pointerId || drag.deckId !== app.projectState.currentDeckId) return;
        const bounds = student.getBoundingClientRect();
        const panel = rail.getBoundingClientRect();
        const topInset = Number.parseFloat(getComputedStyle(student).getPropertyValue('--instruction-top')) || 0;
        const travelX = Math.max(0, bounds.width - panel.width);
        const travelY = Math.max(0, bounds.height - topInset - panel.height);
        const state = normalizeInstructions(app.projectState.instructions);
        setPosition(travelX > 0 ? (event.clientX - bounds.left - drag.offsetX) / travelX * 100 : state.x,
            travelY > 0 ? (event.clientY - bounds.top - topInset - drag.offsetY) / travelY * 100 : state.y);
    });
    const finishDrag = (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag = null;
        handle.classList.remove('is-dragging');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        app.saveStateImmediately();
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('lostpointercapture', finishDrag);
    handle.addEventListener('keydown', (event) => {
        const movement = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[event.key];
        if (!movement && event.key !== 'Home') return;
        event.preventDefault();
        event.stopPropagation();
        const state = normalizeInstructions(app.projectState.instructions);
        setPosition(movement ? state.x + movement[0] : 100, movement ? state.y + movement[1] : 0);
        app.saveStateImmediately();
    });
    editor.querySelector('[data-reset-instruction-position]').addEventListener('click', () => {
        setPosition(100, 0);
        app.saveStateImmediately();
    });
}

export function setupInstructionEditor(app) {
    instructionEditorApp = app;
    const editor = document.getElementById('instruction-editor');
    // The normal teacher chrome is outside the element fullscreen top layer.
    // Keep recovery actions inside that layer, outside serialised student media.
    const recovery = document.createElement('nav');
    recovery.id = 'instruction-presentation-controls';
    recovery.setAttribute('aria-label', 'Teacher presentation controls');
    recovery.hidden = true;
    for (const [action, label] of [['exit', 'Exit presentation'], ['home', 'Home'], ['controls', 'Teacher Controls']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'control-button';
        button.dataset.presentationAction = action;
        button.textContent = label;
        recovery.append(button);
    }
    let presentationTarget = null;
    const restoreTeacherChrome = () => {
        recovery.hidden = true;
        presentationTarget?.classList.remove('instruction-presentation-surface');
        presentationTarget = null;
        document.body.classList.remove('instructions-media-only');
        renderInstructions(app.projectState.instructions);
    };
    const leavePresentation = async (action = 'exit') => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
        } catch {
            app.showNotification('Press Esc to leave fullscreen.', 'warning');
            return;
        }
        restoreTeacherChrome();
        if (action === 'home') app.handleNavClick('dashboard');
        if (action === 'controls') app.toggleTeacherPanel(true);
    };
    recovery.addEventListener('click', (event) => {
        const action = event.target.closest('[data-presentation-action]')?.dataset.presentationAction;
        if (action) void leavePresentation(action);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && presentationTarget && document.fullscreenElement === presentationTarget) {
            event.preventDefault();
            void leavePresentation();
        }
    });
    editor.addEventListener('input', (event) => {
        const key = event.target.dataset.instructionField;
        if (!key) return;
        const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        app.projectState.instructions = normalizeInstructions({ ...app.projectState.instructions, [key]: value });
        refreshInstructionEditor(app.projectState.instructions);
        app.saveState();
    });
    editor.addEventListener('change', (event) => {
        if (!event.target.matches('[data-instruction-size-preset]')) return;
        const preset = SIZE_PRESETS[event.target.value];
        if (!preset) return;
        app.projectState.instructions = normalizeInstructions({ ...app.projectState.instructions, ...preset });
        refreshInstructionEditor(app.projectState.instructions);
        app.saveState();
    });
    editor.addEventListener('click', async (event) => {
        const mode = event.target.dataset.presentInstructions;
        if (!mode) return;
        if (mode === 'whole') {
            app.projectState.instructions = normalizeInstructions({ ...app.projectState.instructions, visible: true });
            refreshInstructionEditor(app.projectState.instructions);
            app.saveState();
        }
        document.body.classList.toggle('instructions-media-only', mode === 'media');
        renderInstructions(app.projectState.instructions);
        app.toggleTeacherPanel(false);
        const target = mode === 'media' ? document.getElementById('student-media') : document.getElementById('student-view');
        presentationTarget = target;
        target.classList.add('instruction-presentation-surface');
        target.append(recovery);
        recovery.hidden = false;
        try { await target.requestFullscreen(); } catch {
            restoreTeacherChrome();
            app.showNotification('Fullscreen is unavailable in this browser.', 'warning');
        }
    });
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            restoreTeacherChrome();
        }
    });
}

export function refreshInstructionEditor(value) {
    const state = normalizeInstructions(value);
    renderInstructions(state);
    const presetSelect = document.querySelector('[data-instruction-size-preset]');
    if (presetSelect) presetSelect.value = Object.entries(SIZE_PRESETS)
        .find(([, preset]) => preset.width === state.width && preset.fontSize === state.fontSize)?.[0] || 'custom';
    document.querySelectorAll('[data-instruction-field]').forEach((input) => {
        const value = state[input.dataset.instructionField];
        if (input.type === 'checkbox') input.checked = value;
        else if (document.activeElement !== input) input.value = value;
    });
    const heightOutput = document.querySelector('[data-instruction-height-output]');
    if (heightOutput) heightOutput.textContent = `${state.height}%`;
}
