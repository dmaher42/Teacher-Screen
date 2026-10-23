// Deck-level public text only. Never accept arbitrary properties or HTML.
export function normalizeInstructions(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const number = (key, fallback, min, max) => Number.isFinite(Number(source[key]))
        ? Math.max(min, Math.min(max, Number(source[key]))) : fallback;
    return {
        visible: source.visible === true,
        width: number('width', 30, 22, 45),
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
            const heading = document.createElement('h2');
            heading.textContent = key[0].toUpperCase() + key.slice(1);
            const text = document.createElement('p');
            text.dataset.instruction = key;
            section.append(heading, text);
            rail.append(section);
        }
        student.append(rail);
        new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(media);
    }
    const visible = state.visible && !document.body.classList.contains('instructions-media-only');
    student.classList.toggle('has-instructions', visible);
    student.style.setProperty('--instruction-width', `${state.width}%`);
    student.style.setProperty('--instruction-font-size', `${state.fontSize}px`);
    const rail = document.getElementById('instruction-rail');
    rail.hidden = !visible;
    for (const key of ['today', 'now', 'next']) rail.querySelector(`[data-instruction="${key}"]`).textContent = state[key];
}

export function setupInstructionEditor(app) {
    const editor = document.getElementById('instruction-editor');
    editor.addEventListener('input', (event) => {
        const key = event.target.dataset.instructionField;
        if (!key) return;
        const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        app.projectState.instructions = normalizeInstructions({ ...app.projectState.instructions, [key]: value });
        renderInstructions(app.projectState.instructions);
        app.saveState();
    });
    editor.addEventListener('click', async (event) => {
        const presetKey = event.target.dataset.instructionPresetKey;
        const presetVal = event.target.dataset.instructionPresetVal;
        if (presetKey && presetVal) {
            app.projectState.instructions = normalizeInstructions({
                ...app.projectState.instructions,
                [presetKey]: Number(presetVal)
            });
            refreshInstructionEditor(app.projectState.instructions);
            app.saveState();
            return;
        }
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
        try { await target.requestFullscreen(); } catch {
            document.body.classList.remove('instructions-media-only');
            renderInstructions(app.projectState.instructions);
            app.showNotification('Fullscreen is unavailable in this browser.', 'warning');
        }
    });
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            document.body.classList.remove('instructions-media-only');
            renderInstructions(app.projectState.instructions);
        }
    });
}

export function refreshInstructionEditor(value) {
    const state = normalizeInstructions(value);
    renderInstructions(state);
    document.querySelectorAll('[data-instruction-field]').forEach((input) => {
        const value = state[input.dataset.instructionField];
        if (input.type === 'checkbox') input.checked = value;
        else if (document.activeElement !== input) input.value = value;
    });
}
