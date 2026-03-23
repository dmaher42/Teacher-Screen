import { getRevealDeck } from './reveal-manager.js';

const appBus = window.TeacherScreenAppBus ? window.TeacherScreenAppBus.appBus : null;
let listenersRegistered = false;

function resolveDeck(deckOverride = null) {
    if (deckOverride && typeof deckOverride === 'object') {
        return deckOverride;
    }

    return getRevealDeck();
}

export function enterPresentationMode() {
    appBus && appBus.emit && appBus.emit('presentation:start');
}

export function exitPresentationMode() {
    appBus && appBus.emit && appBus.emit('presentation:stop');
}

export function nextSlide(deckOverride = null) {
    appBus && appBus.emit && appBus.emit('presentation:next');
    const deck = resolveDeck(deckOverride);
    if (!deck || typeof deck.next !== 'function') return;
    deck.next();
}

export function prevSlide(deckOverride = null) {
    appBus && appBus.emit && appBus.emit('presentation:prev');
    const deck = resolveDeck(deckOverride);
    if (!deck || typeof deck.prev !== 'function') return;
    deck.prev();
}

export function registerPresentationAppBusHandlers() {
    if (!appBus || typeof appBus.on !== 'function' || listenersRegistered) return;

    appBus.on('presentation:next', () => {
        const deck = resolveDeck();
        if (deck && typeof deck.next === 'function') {
            deck.next();
        }
    });

    appBus.on('presentation:prev', () => {
        const deck = resolveDeck();
        if (deck && typeof deck.prev === 'function') {
            deck.prev();
        }
    });

    listenersRegistered = true;
}
