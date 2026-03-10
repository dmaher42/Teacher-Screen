const REVEAL_SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.2/dist/reveal.js';
const REVEAL_CSS_HREF = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.2/dist/reveal.css';

function isProjectorView() {
    if (window.TeacherScreenAppMode && typeof window.TeacherScreenAppMode.isProjectorMode === 'function') {
        return window.TeacherScreenAppMode.isProjectorMode();
    }

    const normalizedPath = window.location.pathname.toLowerCase();
    return normalizedPath === '/projector'
        || normalizedPath === '/projector/'
        || normalizedPath.endsWith('/projector.html')
        || normalizedPath.endsWith('/projector/index.html');
}

function getRevealOptions() {
    const projectorMode = isProjectorView();

    return {
        embedded: true,
        keyboard: !projectorMode,
        hash: true,
        slideNumber: true,
        controls: !projectorMode,
        progress: !projectorMode
    };
}

function ensureRevealCss() {
    if (document.querySelector(`link[data-teacher-screen-reveal="base"]`)) {
        return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = REVEAL_CSS_HREF;
    link.dataset.teacherScreenReveal = 'base';
    document.head.appendChild(link);
}

function ensureRevealScript() {
    if (window.Reveal) {
        return Promise.resolve();
    }

    if (window.__teacherScreenRevealScriptPromise) {
        return window.__teacherScreenRevealScriptPromise;
    }

    window.__teacherScreenRevealScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = REVEAL_SCRIPT_SRC;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Reveal.js'));
        document.head.appendChild(script);
    });

    return window.__teacherScreenRevealScriptPromise;
}

export async function initReveal(container) {
    ensureRevealCss();
    await ensureRevealScript();

    const revealElement = container.querySelector('.reveal');
    if (!revealElement) {
        console.warn('[reveal-manager] .reveal element not found in container');
        return null;
    }

    if (container.__teacherScreenRevealDeck && typeof container.__teacherScreenRevealDeck.layout === 'function') {
        container.__teacherScreenRevealDeck.layout();
        return container.__teacherScreenRevealDeck;
    }

    if (typeof window.Reveal === 'function') {
        const deck = new window.Reveal(revealElement);
        await deck.initialize(getRevealOptions());
        console.log('[Reveal] deck initialized');
        container.__teacherScreenRevealDeck = deck;
        return deck;
    }

    if (window.Reveal && typeof window.Reveal.initialize === 'function') {
        await window.Reveal.initialize(getRevealOptions());
        console.log('[Reveal] deck initialized');
        container.__teacherScreenRevealDeck = window.Reveal;
        return window.Reveal;
    }

    return null;
}

export function layoutReveal(container) {
    if (!container) return;

    const revealElement = container.querySelector('.reveal');
    if (!revealElement) return;

    const deck = revealElement.Reveal;

    if (!deck || typeof deck.layout !== 'function' || typeof deck.isReady !== 'function' || !deck.isReady()) {
        return;
    }

    deck.layout();
}
