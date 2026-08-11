const REVEAL_SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.js';
const REVEAL_CSS_HREF = 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.css';
const REVEAL_SCRIPT_TIMEOUT_MS = 2500;
const revealStateStore = new WeakMap();

const SAFE_PRESENTATION_TAGS = new Set([
    'a', 'abbr', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
    'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
    's', 'samp', 'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u', 'ul', 'var', 'video', 'audio'
]);
const DROP_PRESENTATION_TAGS = new Set([
    'base', 'button', 'embed', 'form', 'head', 'iframe', 'input', 'link', 'meta', 'noscript',
    'object', 'option', 'portal', 'script', 'select', 'style', 'svg', 'template', 'textarea', 'title'
]);
const SAFE_PRESENTATION_ATTRIBUTES = new Set([
    'alt', 'autoplay', 'class', 'colspan', 'controls', 'crossorigin', 'decoding', 'height', 'hidden',
    'id', 'kind', 'label', 'lang', 'loading', 'loop', 'muted', 'open', 'playsinline', 'poster', 'preload',
    'rel', 'reversed', 'role', 'rowspan', 'scope', 'start', 'target', 'title', 'type', 'width'
]);
const SAFE_PRESENTATION_STYLE_PROPERTIES = new Set([
    'align-items', 'align-self', 'background', 'background-color', 'border', 'border-color',
    'border-radius', 'border-style', 'border-width', 'bottom', 'box-sizing', 'color', 'display', 'flex',
    'flex-basis', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-wrap', 'font-family', 'font-size',
    'font-style', 'font-weight', 'gap', 'height', 'justify-content', 'left', 'letter-spacing',
    'line-height', 'list-style', 'list-style-position', 'margin', 'margin-bottom', 'margin-left',
    'margin-right', 'margin-top', 'max-height', 'max-width', 'min-height', 'min-width', 'object-fit',
    'opacity', 'overflow', 'overflow-x', 'overflow-y', 'padding', 'padding-bottom', 'padding-left',
    'padding-right', 'padding-top', 'position', 'right', 'text-align', 'text-decoration',
    'text-transform', 'top', 'transform', 'transform-origin', 'vertical-align', 'white-space', 'width',
    'z-index'
]);
const PRESENTATION_URL_ATTRIBUTES = new Set(['href', 'poster', 'src']);
const PRESENTATION_DATA_URL_ATTRIBUTES = new Set([
    'data-background', 'data-background-image', 'data-background-video', 'data-src'
]);

function isSafePresentationUrl(rawValue = '', tagName = '', attributeName = '') {
    const value = String(rawValue || '').trim();
    if (!value) return false;

    if (value.startsWith('#')) return true;

    if (/^data:/i.test(value)) {
        if (tagName === 'img' && attributeName === 'src') {
            return /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(value);
        }
        if ((tagName === 'audio' || tagName === 'source') && attributeName === 'src') {
            return /^data:audio\/(?:aac|mpeg|ogg|wav|webm);base64,/i.test(value);
        }
        if ((tagName === 'video' || tagName === 'source') && attributeName === 'src') {
            return /^data:video\/(?:mp4|ogg|webm);base64,/i.test(value);
        }
        return false;
    }

    try {
        const parsed = new URL(value, document.baseURI);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
        if (attributeName === 'href' && (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:')) return true;
        if (parsed.protocol === 'blob:' && ['audio', 'img', 'source', 'track', 'video'].includes(tagName)) return true;
    } catch (error) {
        return false;
    }

    return false;
}

function sanitizePresentationStyle(rawStyle = '') {
    const declarations = String(rawStyle || '').split(';');
    const safeDeclarations = [];

    declarations.forEach((declaration) => {
        const separatorIndex = declaration.indexOf(':');
        if (separatorIndex <= 0) return;

        const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
        const value = declaration.slice(separatorIndex + 1).trim();
        if (!SAFE_PRESENTATION_STYLE_PROPERTIES.has(property) || !value) return;
        if (/[<>\\]/.test(value)
            || /(?:expression|javascript|vbscript)\s*[:(]/i.test(value)
            || /(?:url|image-set)\s*\(/i.test(value)
            || /@import|behavior\s*:|-moz-binding/i.test(value)) {
            return;
        }

        safeDeclarations.push(`${property}: ${value}`);
    });

    return safeDeclarations.join('; ');
}

function sanitizePresentationElement(element) {
    const tagName = element.tagName.toLowerCase();
    if (!SAFE_PRESENTATION_TAGS.has(tagName)) {
        if (DROP_PRESENTATION_TAGS.has(tagName)) {
            element.remove();
            return;
        }

        const children = Array.from(element.childNodes);
        children.forEach(sanitizePresentationNode);
        element.replaceWith(...children);
        return;
    }

    Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;

        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
            element.removeAttribute(attribute.name);
            return;
        }

        if (name === 'style') {
            const safeStyle = sanitizePresentationStyle(value);
            if (safeStyle) {
                element.setAttribute('style', safeStyle);
            } else {
                element.removeAttribute(attribute.name);
            }
            return;
        }

        if (PRESENTATION_URL_ATTRIBUTES.has(name)) {
            if (!isSafePresentationUrl(value, tagName, name)) {
                element.removeAttribute(attribute.name);
            }
            return;
        }

        if (name.startsWith('data-')) {
            if (name.includes('iframe')) {
                element.removeAttribute(attribute.name);
                return;
            }

            if (PRESENTATION_DATA_URL_ATTRIBUTES.has(name)) {
                const looksLikeStyleValue = name === 'data-background'
                    && !/[<>\\]/.test(value)
                    && !/(?:url|image-set|expression)\s*\(/i.test(value)
                    && ((typeof CSS !== 'undefined' && CSS.supports?.('color', value))
                        || (/gradient\s*\(/i.test(value)
                            && typeof CSS !== 'undefined'
                            && CSS.supports?.('background-image', value)));
                const urls = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
                if (!looksLikeStyleValue && (urls.length === 0 || !urls.every((url) => isSafePresentationUrl(url, tagName, name)))) {
                    element.removeAttribute(attribute.name);
                }
            }
            return;
        }

        if (name.startsWith('aria-') || SAFE_PRESENTATION_ATTRIBUTES.has(name)) {
            return;
        }

        element.removeAttribute(attribute.name);
    });

    if (tagName === 'a' && element.getAttribute('target') === '_blank') {
        element.setAttribute('rel', 'noopener noreferrer');
    }

    Array.from(element.childNodes).forEach(sanitizePresentationNode);
}

function sanitizePresentationNode(node) {
    if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        sanitizePresentationElement(node);
    }
}

export function sanitizePresentationMarkup(html = '') {
    const parsed = new DOMParser().parseFromString(typeof html === 'string' ? html : '', 'text/html');
    Array.from(parsed.body.childNodes).forEach(sanitizePresentationNode);
    return parsed.body.innerHTML;
}

function createRevealState(root = null) {
    return {
        initialized: false,
        ready: false,
        deck: null,
        root
    };
}

function setActiveRevealState(state) {
    if (typeof window !== 'undefined') {
        window.__RevealState = state || createRevealState();
    }
    return state;
}

function resolvePresentationRoot(container, createIfMissing = false) {
    if (!container || typeof container.querySelector !== 'function') {
        return null;
    }

    if (container.id === 'presentation-root') {
        return container;
    }

    let root = container.querySelector('#presentation-root');
    if (!root && createIfMissing) {
        root = ensurePresentationRoot(container);
    }

    return root;
}

function getStoredRevealState(root, createIfMissing = false) {
    if (!root) {
        return null;
    }

    let state = revealStateStore.get(root);
    if (!state && createIfMissing) {
        state = createRevealState(root);
        revealStateStore.set(root, state);
    }

    return state || null;
}

function getRevealOptions() {
    return {
        embedded: true,
        controls: false,
        progress: true,
        slideNumber: false,
        hash: false,
        keyboard: false,
        scrollActivationWidth: null
    };
}

function ensureRevealCss() {
    if (
        document.querySelector('link[data-teacher-screen-reveal="base"]') ||
        document.querySelector('link[href*="reveal.js"][href*="reveal.css"]')
    ) {
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
        let settled = false;

        const settle = (callback) => {
            if (settled) {
                return;
            }

            settled = true;
            window.clearTimeout(timeoutId);
            callback();
        };

        const fail = (error) => {
            window.__teacherScreenRevealScriptPromise = null;
            reject(error);
        };

        const timeoutId = window.setTimeout(() => {
            settle(() => {
                script.remove();
                fail(new Error('Timed out loading Reveal.js'));
            });
        }, REVEAL_SCRIPT_TIMEOUT_MS);

        script.src = REVEAL_SCRIPT_SRC;
        script.onload = () => settle(resolve);
        script.onerror = () => settle(() => fail(new Error('Failed to load Reveal.js')));
        document.head.appendChild(script);
    });

    return window.__teacherScreenRevealScriptPromise;
}

function ensurePresentationRoot(container) {
    if (!container) return null;

    let root = container.id === 'presentation-root'
        ? container
        : container.querySelector('#presentation-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'presentation-root';
        container.appendChild(root);
    }

    if (!root.dataset.locked) {
        root.dataset.locked = 'true';
    }

    root.style.width = '100%';
    root.style.height = '100%';
    root.style.position = 'relative';

    let revealElement = root.querySelector('.reveal');
    if (!revealElement) {
        revealElement = document.createElement('div');
        revealElement.className = 'reveal';

        const slidesElement = document.createElement('div');
        slidesElement.className = 'slides';
        revealElement.appendChild(slidesElement);
        root.appendChild(revealElement);
    }

    revealElement.style.width = '100%';
    revealElement.style.height = '100%';
    revealElement.style.minHeight = '0';

    const slidesElement = revealElement.querySelector('.slides');
    if (slidesElement) {
        slidesElement.style.width = '100%';
        slidesElement.style.height = '100%';
        slidesElement.style.minHeight = '0';
    }

    if (!revealElement.dataset.frozen) {
        revealElement.dataset.frozen = 'true';
        Object.freeze(revealElement);
    }

    return root;
}

export function getRevealState(container = null) {
    if (!container) {
        return window.__RevealState || createRevealState();
    }

    const root = resolvePresentationRoot(container, false);
    return getStoredRevealState(root, false) || createRevealState(root);
}

export function getRevealDeck(container = null) {
    const state = getRevealState(container);
    return state && state.deck ? state.deck : null;
}

export function activateReveal(container = null) {
    if (!container) {
        return getRevealState();
    }

    const root = resolvePresentationRoot(container, false);
    const state = getStoredRevealState(root, false);

    if (!state) {
        return null;
    }

    return setActiveRevealState(state);
}

export function destroyReveal(container) {
    const root = resolvePresentationRoot(container, false);
    const state = getStoredRevealState(root, false);

    if (!state) {
        return null;
    }

    if (state.deck && typeof state.deck.destroy === 'function') {
        try {
            state.deck.destroy();
        } catch (error) {
            console.warn('Reveal destroy failed', error);
        }
    }

    state.initialized = false;
    state.ready = false;
    state.deck = null;

    const revealElement = root && root.querySelector('.reveal');
    if (revealElement) {
        revealElement.className = 'reveal';
    }

    if (window.__RevealState === state) {
        setActiveRevealState(state);
    }

    return state;
}

export function mountPresentationMarkup(container, html) {
    const root = ensurePresentationRoot(container);
    if (!root) return null;

    const safeHtml = sanitizePresentationMarkup(html);
    const temp = document.createElement('div');
    temp.innerHTML = safeHtml;

    const incomingReveal = temp.querySelector('.reveal');
    const slidesTarget = root.querySelector('.slides');
    if (!slidesTarget) return root;

    if (incomingReveal) {
        const incomingSlides = incomingReveal.querySelector('.slides');
        slidesTarget.innerHTML = incomingSlides ? incomingSlides.innerHTML : incomingReveal.innerHTML;
    } else {
        slidesTarget.innerHTML = `<section>${safeHtml}</section>`;
    }

    return root;
}

export function hasMountedReveal(container) {
    const root = resolvePresentationRoot(container, false);
    if (!root || typeof root.querySelector !== 'function') return false;
    return !!root.querySelector('.reveal .slides');
}

export async function initializeReveal(container) {
    ensureRevealCss();
    await ensureRevealScript();

    const root = ensurePresentationRoot(container);
    if (!root) {
        console.warn('[Reveal] presentation root not available');
        return null;
    }

    const revealState = getStoredRevealState(root, true);

    if (revealState.initialized && revealState.deck) {
        setActiveRevealState(revealState);
        return revealState.deck;
    }

    if (!window.Reveal) {
        console.warn('[Reveal] library not available');
        return null;
    }

    const revealElement = root.querySelector('.reveal');
    if (!revealElement) {
        console.warn('[Reveal] container not available');
        return null;
    }

    const RevealCtor = window.Reveal;
    let deck = null;

    if (typeof RevealCtor === 'function') {
        deck = new RevealCtor(revealElement, getRevealOptions());
    } else if (typeof RevealCtor.initialize === 'function') {
        deck = RevealCtor;
    }

    if (!deck || typeof deck.initialize !== 'function') {
        console.warn('[Reveal] library not available');
        return null;
    }

    revealState.deck = deck;
    revealState.initialized = true;
    revealState.ready = false;
    setActiveRevealState(revealState);

    if (typeof deck.on === 'function') {
        deck.on('ready', () => {
            revealState.ready = true;
            setActiveRevealState(revealState);
        });
    }

    if (deck === RevealCtor) {
        await deck.initialize(getRevealOptions());
    } else {
        await deck.initialize();
    }

    revealState.ready = true;
    setActiveRevealState(revealState);

    return deck;
}

export async function initReveal(container) {
    return initializeReveal(container);
}

export function layoutReveal(container) {
    const root = resolvePresentationRoot(container, false);
    if (!root) {
        return;
    }

    const revealState = getStoredRevealState(root, false);
    const deck = revealState && revealState.deck;
    if (!deck || typeof deck.layout !== 'function') {
        return;
    }

    if (!hasMountedReveal(container)) {
        return;
    }

    if (typeof deck.isReady === 'function' && !deck.isReady()) {
        return;
    }

    deck.layout();
}
