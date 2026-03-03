const REVEAL_CHANNEL_NAME = 'teacher-screen-reveal-sync';

class RevealSync {
    constructor() {
        this.channel = new BroadcastChannel(REVEAL_CHANNEL_NAME);
    }

    sendSlideState(state) {
        this.channel.postMessage({
            type: 'reveal-slide-change',
            payload: state
        });
    }

    onSlideState(callback) {
        this.channel.onmessage = (event) => {
            if (event.data?.type === 'reveal-slide-change') {
                callback(event.data.payload);
            }
        };
    }
}

if (typeof window !== 'undefined') {
    window.REVEAL_CHANNEL_NAME = REVEAL_CHANNEL_NAME;
    window.RevealSync = RevealSync;
}

