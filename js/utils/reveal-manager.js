const REVEAL_SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.2/dist/reveal.js';
const REVEAL_CSS_HREF = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.2/dist/reveal.css';

function ensureRevealState() {
    if (!window.__RevealState) {
        window.__RevealState = {
            initialized: false,
            ready: false,
            deck: null
        };
    }

    return window.__RevealState;
}

function getRevealOptions() {
    return {
        controls: false,
        progress: true,
        slideNumber: false,
        hash: false,
        keyboard: false,
        scrollActivationWidth: null
    };
}

function ensureRevealCss() {
    if (document.querySelector('link[data-teacher-screen-reveal="base"]')) {
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

function ensurePresentationRoot(container) {
    if (!container) return null;

    let root = container.querySelector('#presentation-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'presentation-root';
        container.appendChild(root);
    }

    if (!root.dataset.locked) {
        root.dataset.locked = 'true';
    }

    let revealElement = root.querySelector('.reveal');
    if (!revealElement) {
        revealElement = document.createElement('div');
        revealElement.className = 'reveal';

        const slidesElement = document.createElement('div');
        slidesElement.className = 'slides';
        revealElement.appendChild(slidesElement);
        root.appendChild(revealElement);
    }

    if (!revealElement.dataset.frozen) {
        revealElement.dataset.frozen = 'true';
        Object.freeze(revealElement);
    }

    return root;
}

export function mountPresentationMarkup(container, html) {
    const root = ensurePresentationRoot(container);
    if (!root) return null;

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const incomingReveal = temp.querySelector('.reveal');
    const slidesTarget = root.querySelector('.slides');
    if (!slidesTarget) return root;

    if (incomingReveal) {
        const incomingSlides = incomingReveal.querySelector('.slides');
        slidesTarget.innerHTML = incomingSlides ? incomingSlides.innerHTML : incomingReveal.innerHTML;
    } else {
        slidesTarget.innerHTML = `<section>${html}</section>`;
    }

    return root;
}

export function hasMountedReveal(container) {
    if (!container || typeof container.querySelector !== 'function') return false;
    return !!container.querySelector('#presentation-root .reveal .slides');
}

export async function initializeReveal(container) {
    const revealState = ensureRevealState();

    if (revealState.initialized) {
        console.warn('[Reveal] initialization blocked (already initialized)');
        return revealState.deck;
    }

    ensureRevealCss();
    await ensureRevealScript();

    const root = ensurePresentationRoot(container);
    if (!root) {
        console.warn('[Reveal] presentation root not available');
        return null;
    }

    if (typeof window.Reveal !== 'function') {
        console.warn('[Reveal] library not available');
        return null;
    }

    const deck = new window.Reveal(root.querySelector('.reveal'), getRevealOptions());
    revealState.deck = deck;
    revealState.initialized = true;

    deck.initialize();

    deck.on('ready', () => {
        revealState.ready = true;
        console.log('[Reveal] ready');
    });

    console.log('[Reveal] initialized');
    return deck;
}

export async function initReveal(container) {
    return initializeReveal(container);
}

export function layoutReveal(container) {
    const deck = window.__RevealState && window.__RevealState.deck;
    if (!deck || typeof deck.layout !== 'function') {
        return;
    }

    if (container && !hasMountedReveal(container)) {
        return;
    }

    if (typeof deck.isReady === 'function' && !deck.isReady()) {
        return;
    }

    deck.layout();
}
