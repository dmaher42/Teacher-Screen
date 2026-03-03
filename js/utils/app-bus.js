const CHANNEL_NAME = 'teacher-screen-bus';
const APP_MODE = window.TeacherScreenAppMode ? window.TeacherScreenAppMode.APP_MODE : 'teacher';

class AppBus {
    constructor() {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.listeners = {};
    }

    emit(eventType, payload) {
        this.channel.postMessage({
            type: eventType,
            payload,
            source: APP_MODE,
            timestamp: Date.now()
        });
    }

    on(eventType, callback) {
        if (!this.listeners[eventType]) {
            this.listeners[eventType] = [];
        }

        this.listeners[eventType].push(callback);
    }

    init() {
        this.channel.onmessage = (event) => {
            const { type, payload, source } = event.data || {};

            // Prevent same-mode loop
            if (source === APP_MODE) return;

            const handlers = this.listeners[type] || [];
            handlers.forEach((handler) => handler(payload, source));
        };
    }
}

const appBus = new AppBus();

if (typeof window !== 'undefined') {
    window.TeacherScreenAppBus = {
        appBus
    };
}
