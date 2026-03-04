import { APP_MODE } from './app-mode.js';

const CHANNEL_NAME = 'teacher-screen-bus';
const appBusMode = APP_MODE;

class AppBus {
    constructor() {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.listeners = {};
    }

    emit(eventType, payload) {
        this.channel.postMessage({
            type: eventType,
            payload,
            source: appBusMode,
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
            if (source === appBusMode) return;

            const handlers = this.listeners[type] || [];
            handlers.forEach((handler) => handler(payload, source));
        };
    }
}

export const appBus = new AppBus();

if (typeof window !== 'undefined') {
    window.TeacherScreenAppBus = {
        appBus
    };
}
