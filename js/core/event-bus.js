const EVENT_BUS_DEBUG = typeof window !== 'undefined' && typeof window.EVENT_BUS_DEBUG === 'boolean'
    ? window.EVENT_BUS_DEBUG
    : false;

class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(eventName, handler) {
        if (typeof handler !== 'function') {
            return () => {};
        }

        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }

        const handlers = this.listeners.get(eventName);
        handlers.add(handler);

        return () => this.off(eventName, handler);
    }

    off(eventName, handler) {
        const handlers = this.listeners.get(eventName);
        if (!handlers) return;

        handlers.delete(handler);
        if (handlers.size === 0) {
            this.listeners.delete(eventName);
        }
    }

    emit(eventName, payload) {
        const handlers = this.listeners.get(eventName);

        if (EVENT_BUS_DEBUG) {
            console.log(`[EventBus] ${eventName}`, payload || '');
        }

        if (!handlers || handlers.size === 0) return;

        handlers.forEach((handler) => {
            try {
                handler(payload);
            } catch (error) {
                console.error(`[EventBus] Handler error for "${eventName}"`, error);
            }
        });
    }
}

export { EVENT_BUS_DEBUG };
export const eventBus = new EventBus();

if (typeof window !== 'undefined') {
    window.TeacherScreenEventBus = {
        eventBus,
        EVENT_BUS_DEBUG
    };
}
