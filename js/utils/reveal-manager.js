const REVEAL_SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.2/dist/reveal.js';
const REVEAL_CSS_HREF = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.2/dist/reveal.css';

function isProjectorView() {
    if (window.TeacherScreenAppMode && typeof window.TeacherScreenAppMode.isProjectorMode === 'function') {
        return window.TeacherScreenAppMode.isProjectorMode();
    }

    return window.location.pathname.includes('/projector');
}

function getRevealOptions() {
    return {
        embedded: true,
        keyboard: true,
        hash: true,
        slideNumber: true,
        controls: true,
        progress: true
    };
}

function bindTeacherSlideSync(revealApi) {
    if (isProjectorView() || typeof revealApi?.on !== 'function' || revealApi.__teacherScreenSlideSyncBound) {
        return;
    }

    revealApi.on('slidechanged', () => {
        const state = typeof revealApi.getState === 'function' ? revealApi.getState() : { indexh: 0, indexv: 0 };
        const data = {
            type: 'slide-update',
            indexh: state.indexh,
            indexv: state.indexv
        };

        console.log('[sync] teacher slide update', data);
        localStorage.setItem('teacher-slide', JSON.stringify(data));
    });

    revealApi.__teacherScreenSlideSyncBound = true;
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
        bindTeacherSlideSync(deck);
        console.log('[Reveal] deck initialized');
        container.__teacherScreenRevealDeck = deck;
        return deck;
    }

    if (window.Reveal && typeof window.Reveal.initialize === 'function') {
        await window.Reveal.initialize(getRevealOptions());
        bindTeacherSlideSync(window.Reveal);
        console.log('[Reveal] deck initialized');
        container.__teacherScreenRevealDeck = window.Reveal;
        return window.Reveal;
    }

    return null;
}
