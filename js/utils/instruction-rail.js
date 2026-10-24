import { sanitizePresentationMarkup } from './reveal-manager.js';
import { createWidgetByType } from '../widgets/widget-registry.js';

function sanitizeOutline(html) {
    const root = document.createElement('div');
    root.innerHTML = sanitizePresentationMarkup(html);
    // Text formatting only: imported markup cannot escape the rail or create controls.
    root.querySelectorAll('video,audio,source,track').forEach(node => node.remove());
    root.querySelectorAll('*').forEach(node => {
        node.removeAttribute('id');
        node.removeAttribute('hidden');
        const allowed = ['color', 'background-color', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-align', 'text-decoration'];
        for (const property of Array.from(node.style)) if (!allowed.includes(property)) node.style.removeProperty(property);
        if (node.className) node.className = node.className.split(/\s+/).filter(name => /^(ql-(align|indent|size|font|direction|line-spacing)-[\w-]+|ql-ui|display-callout)$/.test(name)).join(' ');
    });
    return root.innerHTML;
}

const SIZE_PRESETS = {
    compact: { width: 25, fontSize: 24 },
    standard: { width: 30, fontSize: 28 },
    large: { width: 30, fontSize: 30 },
    'high-visibility': { width: 40, fontSize: 38 }
};

// One deck-level outline. Legacy plain text becomes escaped rich text once.
export function normalizeInstructions(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const number = (key, fallback, min, max) => Number.isFinite(Number(source[key]))
        ? Math.max(min, Math.min(max, Number(source[key]))) : fallback;
    const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const html = typeof source.html === 'string' ? source.html : ['today', 'now', 'next']
        .filter(key => typeof source[key] === 'string' && source[key])
        .map(key => `<h2>${key[0].toUpperCase() + key.slice(1)}</h2><p>${escape(source[key]).replaceAll('\n', '<br>')}</p>`).join('');
    const result = {
        visible: source.visible === true,
        width: number('width', 30, 22, 45),
        fontSize: number('fontSize', 28, 20, 48),
        html: sanitizeOutline(html)
    };
    if (source.origin?.widget?.type === 'RichTextWidget') {
        const saved = source.origin.widget;
        result.origin = {
            pageId: typeof source.origin.pageId === 'string' ? source.origin.pageId : '',
            widget: {
                type: 'RichTextWidget',
                ...Object.fromEntries(['x', 'y', 'width', 'height'].filter(key => Number.isFinite(saved[key])).map(key => [key, saved[key]])),
                data: { customTitle: String(saved.data?.customTitle || '').slice(0, 80), displayMode: saved.data?.displayMode === true },
                visibleOnProjector: saved.visibleOnProjector !== false,
                minimized: saved.minimized === true,
                projectorVisibilityConfigured: saved.projectorVisibilityConfigured === true
            },
            previous: publicInstructions(source.origin.previous)
        };
    }
    return result;
}

export function publicInstructions(value = {}) {
    const { origin: _origin, ...publicState } = normalizeInstructions({ ...value, origin: undefined });
    return publicState;
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
        const outline = document.createElement('div');
        outline.id = 'instruction-outline';
        outline.className = 'ql-editor';
        rail.append(outline);
        student.append(rail);
        new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(media);
    }
    const visible = state.visible && !document.body.classList.contains('instructions-media-only');
    student.classList.toggle('has-instructions', visible);
    student.style.setProperty('--instruction-width', `${state.width}%`);
    student.style.setProperty('--instruction-font-size', `${state.fontSize}px`);
    const rail = document.getElementById('instruction-rail');
    rail.hidden = !visible;
    const outline = rail.querySelector('#instruction-outline');
    if (outline.innerHTML !== state.html) outline.innerHTML = state.html;
}

export function setupInstructionEditor(app) {
    const editor = document.getElementById('instruction-editor');
    let board = null;
    let updating = false;
    const refreshBoard = () => {
        if (!board) return;
        const state = normalizeInstructions(app.projectState.instructions);
        if (board.serialize().content !== state.html) {
            updating = true;
            board.deserialize({ content: state.html });
            updating = false;
        }
    };
    const ensureBoard = () => {
        if (!board) {
            board = createWidgetByType('rich-text');
            editor.querySelector('#instruction-outline-editor').append(board.element);
            refreshBoard();
        }
    };
    editor.closest('details').addEventListener('toggle', () => { if (editor.closest('details').open) ensureBoard(); });
    document.addEventListener('instructions-refreshed', () => {
        if (editor.closest('details').open) ensureBoard();
        refreshBoard();
    });
    document.addEventListener('widgetChanged', (event) => {
        if (updating || !board || event.detail?.widget !== board) return;
        app.projectState.instructions = normalizeInstructions({ ...app.projectState.instructions, html: board.serialize().content });
        renderInstructions(app.projectState.instructions);
        app.saveState();
    });
    const unpin = () => {
        const state = normalizeInstructions(app.projectState.instructions);
        if (!state.origin) return;
        const saved = { ...state.origin.widget, data: { ...state.origin.widget.data, content: state.html, presentationMode: 'normal' } };
        const page = app.projectState.pages.find(candidate => candidate.id === state.origin.pageId) || app.getActiveProjectPage();
        if (page.id === app.projectState.activePageId) {
            const restored = createWidgetByType('rich-text');
            restored.deserialize(saved.data);
            app.layoutManager.addWidget(restored, saved.x, saved.y, saved.width, saved.height);
            const info = app.layoutManager.widgets.find(candidate => candidate.widget === restored);
            info.visibleOnProjector = saved.visibleOnProjector;
            info.projectorVisibilityConfigured = saved.projectorVisibilityConfigured;
            app.layoutManager.refreshWidgetProjectorVisibilityControl(info);
            app.layoutManager.setWidgetMinimized(info, saved.minimized);
            app.widgets.push(restored);
        } else {
            page.snapshot.layout.widgets.push({ ...saved, id: `outline-${Date.now()}` });
        }
        app.projectState.instructions = state.origin.previous;
        refreshInstructionEditor(app.projectState.instructions);
        app.saveState();
    };
    editor.querySelector('[data-unpin-outline]').addEventListener('click', unpin);
    document.addEventListener('pin-lesson-outline', (event) => {
        const widget = event.detail?.widget;
        if (widget?.constructor?.name !== 'RichTextWidget') return;
        const saved = app.layoutManager.serialize().widgets.find(candidate => candidate.id === widget.widgetId);
        if (!saved) return;
        const source = new DOMParser().parseFromString(saved.data.content || '', 'text/html');
        if (source.querySelector('iframe,video,audio,object,embed')) {
            app.showNotification('Remove embedded media before pinning this board.', 'warning');
            return;
        }
        unpin();
        const previous = publicInstructions(app.projectState.instructions);
        const html = saved.data.content;
        delete saved.data.content;
        app.projectState.instructions = normalizeInstructions({ ...previous, html, visible: true, origin: { pageId: app.projectState.activePageId, widget: saved, previous } });
        app.layoutManager.removeWidget(widget);
        refreshInstructionEditor(app.projectState.instructions);
        app.saveState();
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
    const unpin = document.querySelector('[data-unpin-outline]');
    if (unpin) unpin.hidden = !state.origin;
    document.dispatchEvent(new Event('instructions-refreshed'));
}
