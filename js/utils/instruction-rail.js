// Legacy instructions remain in saved data as a recovery copy. Shared content is
// rendered, edited, moved and resized only by the normal Text Board widget.
const clone = value => JSON.parse(JSON.stringify(value));
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
export const isSharedTextBoard = record => record?.type === 'RichTextWidget' && record.data?.showOnEveryPage === true;

function normalizeBoards(layout = {}) {
    const seen = new Set();
    const widgets = (Array.isArray(layout.widgets) ? layout.widgets : []).filter(isSharedTextBoard).map((record, index) => {
        const copy = clone(record);
        const base = typeof record.id === 'string' && record.id ? record.id : `shared-text-${index}`;
        let id = base;
        for (let suffix = 1; seen.has(id); suffix++) id = `${base}-copy-${suffix}`;
        copy.id = id;
        seen.add(id);
        return copy;
    });
    return { mode: 'dashboard', widgets, viewport: {
        width: positive(layout.viewport?.width, 1000), height: positive(layout.viewport?.height, 1000)
    } };
}

export function normalizeInstructions(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const number = (key, fallback, min, max) => Number.isFinite(Number(source[key]))
        ? Math.max(min, Math.min(max, Number(source[key]))) : fallback;
    const state = {
        visible: source.visible === true,
        width: number('width', 30, 22, 45), height: number('height', 100, 20, 100),
        x: number('x', 100, 0, 100), y: number('y', 0, 0, 100), fontSize: number('fontSize', 28, 20, 48),
        today: typeof source.today === 'string' ? source.today.slice(0, 4000) : '',
        now: typeof source.now === 'string' ? source.now.slice(0, 4000) : '',
        next: typeof source.next === 'string' ? source.next.slice(0, 4000) : '',
        textBoardsMigrated: true, boards: normalizeBoards(source.boards)
    };
    if (source.textBoardsMigrated === true) return state;
    if (!state.visible && ![state.today, state.now, state.next].some(Boolean)) return state;
    const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, '<br>');
    const width = state.width * 10;
    const height = state.height * 10;
    state.boards = normalizeBoards({ viewport: { width: 1000, height: 1000 }, widgets: [{
        id: 'shared-legacy-instructions', type: 'RichTextWidget', layoutType: 'grid', viewport: { width: 1000, height: 1000 },
        x: (1000 - width) * state.x / 100, y: (1000 - height) * state.y / 100,
        width, height, minimized: !state.visible,
        projectorVisibilityConfigured: true, visibleOnProjector: state.visible,
        data: { customTitle: 'Student instructions',
            content: [state.today, state.now, state.next].map(text => `<p>${escape(text) || '<br>'}</p>`).join('<p><br></p>'),
            showOnEveryPage: true, keepInFront: true, displayMode: true, presentationMode: 'normal',
            instructionAppearance: true, instructionFontSize: state.fontSize }
    }] });
    return state;
}

export function capturePersistentTextBoards(app) {
    if (app.isApplyingProjectSnapshot || !app.layoutManager) return;
    const instructions = normalizeInstructions(app.projectState?.instructions);
    const layout = app.layoutManager.serialize();
    instructions.boards = normalizeBoards({ ...layout, widgets: layout.widgets.filter(isSharedTextBoard) });
    app.projectState.instructions = instructions;
}

export function pageOnlyLayout(layout = {}) {
    return { ...clone(layout), widgets: (layout.widgets || []).filter(record => !isSharedTextBoard(record)).map(clone) };
}

export function layoutWithSharedTextBoards(layout = {}, instructions) {
    const shared = normalizeInstructions(instructions).boards;
    const viewport = { width: positive(layout.viewport?.width, shared.viewport.width), height: positive(layout.viewport?.height, shared.viewport.height) };
    const sharedIds = new Set(shared.widgets.map(record => record.id));
    const page = pageOnlyLayout(layout);
    const widgets = page.widgets.map(record => sharedIds.has(record.id) ? { ...record, id: `page-local-${record.id}` } : record);
    for (const record of shared.widgets) {
        if (record.viewport) { widgets.push(clone(record)); continue; }
        widgets.push({ ...clone(record), x: record.x * viewport.width / shared.viewport.width,
            y: record.y * viewport.height / shared.viewport.height,
            width: record.width * viewport.width / shared.viewport.width,
            height: record.height * viewport.height / shared.viewport.height });
    }
    return { ...page, viewport, widgets };
}

export function renderInstructions() {
    const student = document.getElementById('student-view');
    if (!student) return;
    // Retain the existing media/fullscreen host, but retire the separate panel.
    let media = document.getElementById('student-media');
    if (!media) {
        media = document.createElement('div'); media.id = 'student-media'; student.prepend(media);
        const widgets = document.getElementById('widgets-container'); if (widgets) media.append(widgets);
        const root = document.getElementById('presentation-root'); if (root) media.append(root);
    }
    document.getElementById('instruction-rail')?.remove();
    student.classList.remove('has-instructions');
}

export function setupInstructionEditor(app) {
    // Keep one untouched local recovery copy before the first upgrade writes.
    try {
        const key = 'teacherScreenTextBoardUpgradeBackup-v1';
        if (!localStorage.getItem(key)) {
            const state = localStorage.getItem('classroomScreenState');
            const presets = localStorage.getItem(app.presetsKey);
            if (state || presets) localStorage.setItem(key, JSON.stringify({ state, presets, savedAt: Date.now() }));
        }
    } catch (error) { console.warn('Text Board recovery copy could not be stored; original instructions are still retained in deck data.', error); }
    const editor = document.getElementById('instruction-editor');
    editor.querySelector('[data-add-shared-text-board]').addEventListener('click', () => {
        app.addWidget('rich-text', { initialData: { content: '<p>Write your student instructions here.</p>', showOnEveryPage: true, keepInFront: true } });
        app.toggleTeacherPanel(false);
        app.saveStateImmediately();
    });
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
    editor.addEventListener('click', async (event) => {
        const mode = event.target.dataset.presentInstructions;
        if (!mode) return;
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


export function refreshInstructionEditor() { renderInstructions(); }
