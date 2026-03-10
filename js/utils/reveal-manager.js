export function initReveal(container) {
    const revealEl = container.querySelector('.reveal');

    if (!revealEl) {
        console.warn('[Reveal] container not found');
        return;
    }

    if (!window.Reveal || typeof window.Reveal.initialize !== 'function') {
        console.warn('[Reveal] library not loaded');
        return;
    }

    if (typeof window.Reveal.isReady === 'function' && !window.Reveal.isReady()) {
        window.Reveal.initialize({
            embedded: true,
            hash: true,
            slideNumber: true,
            controls: true,
            progress: true
        });
        console.log('[Reveal] presentation initialized');
        return;
    }

    window.Reveal.sync();
    console.log('[Reveal] presentation initialized');
}

export function layoutReveal(container) {
    if (!container || !window.Reveal || typeof window.Reveal.layout !== 'function') return;
    if (!container.querySelector('.reveal')) return;
    window.Reveal.layout();
}
