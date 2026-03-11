const appBus = window.TeacherScreenAppBus ? window.TeacherScreenAppBus.appBus : null;
let listenersRegistered = false;

function getDeck() {
    return window.__RevealState ? window.__RevealState.deck : null;
}

export function enterPresentationMode() {
    appBus && appBus.emit && appBus.emit('presentation:start');
}

export function exitPresentationMode() {
    appBus && appBus.emit && appBus.emit('presentation:stop');
}

export function nextSlide() {
    appBus && appBus.emit && appBus.emit('presentation:next');
    const deck = getDeck();
    if (!deck || typeof deck.next !== 'function') return;
    deck.next();
}

export function prevSlide() {
    appBus && appBus.emit && appBus.emit('presentation:prev');
    const deck = getDeck();
    if (!deck || typeof deck.prev !== 'function') return;
    deck.prev();
}

export function registerPresentationAppBusHandlers() {
    if (!appBus || typeof appBus.on !== 'function' || listenersRegistered) return;

    appBus.on('presentation:next', () => {
        const deck = getDeck();
        if (deck && typeof deck.next === 'function') {
            deck.next();
        }
    });

    appBus.on('presentation:prev', () => {
        const deck = getDeck();
        if (deck && typeof deck.prev === 'function') {
            deck.prev();
        }
    });

    listenersRegistered = true;
}
