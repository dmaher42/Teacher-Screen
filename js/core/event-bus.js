const EVENT_BUS_DEBUG = typeof window !== 'undefined' && window.EVENT_BUS_DEBUG === true;

class EventBus {
    constructor() {
        this.events = {};
    }

    on(event, handler) {
        if (!event || typeof handler !== 'function') return;

        if (!this.events[event]) {
            this.events[event] = new Set();
        }

        this.events[event].add(handler);
    }

    off(event, handler) {
        if (!event || typeof handler !== 'function' || !this.events[event]) return;

        this.events[event].delete(handler);
        if (this.events[event].size === 0) {
            delete this.events[event];
        }
    }

    emit(event, payload) {
        if (!event) return;

        if (EVENT_BUS_DEBUG) {
            console.log(`[EventBus] ${event}`, payload);
        }

        const handlers = this.events[event];
        if (!handlers || handlers.size === 0) return;

        for (const handler of handlers) {
            try {
                handler(payload);
            } catch (error) {
                console.error('EventBus handler error:', error);
            }
        }
    }
}

export const eventBus = new EventBus();

if (typeof window !== 'undefined') {
    window.TeacherScreenEventBus = {
        eventBus
    };
}
