// Linked decks stay interactive in the teacher's iframe. Send its rendered
// picture to the paired projector, never a second independently running deck.
const CHANNEL_NAME = 'teacher-screen-presentation-mirror';

function teacherToken() {
    if (window.__TeacherProjectorSyncToken) return window.__TeacherProjectorSyncToken;
    try {
        return sessionStorage.getItem('teacher-screen-projector-sync-token');
    } catch {
        return null;
    }
}

export class TeacherPresentationMirror {
    constructor() {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.session = null;
        this.channel.onmessage = ({ data }) => {
            if (!data || !teacherToken() || data.token !== teacherToken()) return;
            const session = this.session;
            if (!session?.stream) return;
            if (data.kind === 'ready' && data.receiverId) this.connectProjector(data.receiverId);
        };
        window.addEventListener('pagehide', () => this.stop());
    }

    isActive(widget) { return this.session?.widget === widget; }

    isSupported() {
        return Boolean(navigator.mediaDevices?.getDisplayMedia && window.RestrictionTarget
            && window.BrowserCaptureMediaStreamTrack?.prototype.restrictTo);
    }

    setStatus(message) {
        this.session?.widget.updateControls();
        this.session?.widget.setStatus(message);
    }

    async start(widget, target) {
        this.stop();
        const session = { id: crypto.randomUUID(), widget, stream: null };
        this.session = session;
        this.setStatus('Choose this Teacher Screen tab in the sharing prompt. Only the presentation will be sent.');
        let stream;
        try {
            // Call before the first await, while the teacher's click is active.
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30, max: 30 } }, audio: false,
                preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude'
            });
            if (this.session !== session) {
                stream.getTracks().forEach((track) => track.stop());
                return false;
            }
            const [track] = stream.getVideoTracks();
            if (track.getSettings().displaySurface !== 'browser' || typeof track.restrictTo !== 'function') {
                throw new Error('Choose the Teacher Screen browser tab, rather than a window or entire screen.');
            }
            // Restrict the rendered subtree, including the cross-origin iframe.
            // This excludes teacher menus even when they overlap the slides.
            // No picture is passed to the projector until this succeeds.
            await track.restrictTo(await RestrictionTarget.fromElement(target));
            if (this.session !== session || !target.isConnected) {
                stream.getTracks().forEach((item) => item.stop());
                return false;
            }
            session.stream = stream;
            track.addEventListener('ended', () => this.stop(widget), { once: true });
            target.querySelector('iframe')?.focus({ preventScroll: true });
            this.setStatus('Live sync ready. Use the controls inside the presentation; the projector follows. Sound is not shared.');
            this.channel.postMessage({ kind: 'available', token: teacherToken(), sessionId: session.id });
            return true;
        } catch (error) {
            stream?.getTracks().forEach((track) => track.stop());
            if (this.session !== session) return false;
            this.stop(widget);
            widget.setStatus(error.name === 'NotAllowedError'
                ? 'Sharing was cancelled or blocked. Choose Sync to projector to try again.'
                : error.message.includes('Choose the Teacher') ? error.message
                    : 'Could not share the presentation. Choose this Teacher Screen tab in Chrome or Edge, or import a PDF.');
            return false;
        }
    }

    connectProjector(receiverId) {
        const session = this.session;
        if (!session?.stream) return;
        try {
            const projector = session.widget.projectorWindow;
            const receiver = projector && !projector.closed
                ? projector.__TeacherScreenProjectorApp?.presentationMirror : null;
            if (!receiver || receiver.receiverId !== receiverId || receiver.token !== teacherToken()) return;
            // Same-origin paired windows can share a MediaStream directly. The
            // stream is already restricted before it reaches the projector.
            receiver.receiveStream(session.stream, session.id);
            this.setStatus('Live on projector. Use the controls inside the presentation. Sound is not shared.');
        } catch {
            this.setStatus('Reopen the paired projector from Teacher Screen to connect.');
        }
    }

    stop(widget = null) {
        const session = this.session;
        if (!session || (widget && widget !== session.widget)) return;
        this.session = null;
        this.channel.postMessage({ kind: 'ended', token: teacherToken(), sessionId: session.id });
        session.stream?.getTracks().forEach((track) => track.stop());
        session.widget.updateControls();
        session.widget.setStatus('Projector sync stopped.');
    }
}

export function installTeacherPresentationMirror() {
    window.TeacherScreenPresentationMirror = new TeacherPresentationMirror();
}

export class ProjectorPresentationMirror {
    constructor(token) {
        this.token = token;
        this.receiverId = crypto.randomUUID();
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.sessionId = null;
        this.channel.onmessage = ({ data }) => this.handleMessage(data).catch(() => {
            if (data?.sessionId === this.sessionId) {
                this.showWaiting('Presentation connection interrupted. Reopen the projector from Teacher Screen.');
            }
        });
        this.request = () => this.channel.postMessage({ kind: 'ready', token, receiverId: this.receiverId });
        this.request();
        window.addEventListener('focus', this.request);
        window.addEventListener('pageshow', this.request);
        this.pageHide = () => this.reset();
        window.addEventListener('pagehide', this.pageHide);
        this.retryTimer = setInterval(() => {
            if (!this.sessionId) this.request();
        }, 3000);
    }

    ensureSurface() {
        if (this.surface) return;
        this.surface = document.createElement('div');
        this.surface.className = 'presentation-mirror-projector';
        this.surface.setAttribute('aria-label', 'Live presentation from Teacher Screen');
        this.surface.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000;display:grid;place-items:center;';
        this.video = document.createElement('video');
        this.video.autoplay = true;
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.style.cssText = 'width:100%;height:100%;object-fit:contain;';
        this.message = document.createElement('p');
        this.message.style.cssText = 'position:absolute;color:#fff;font:20px sans-serif;text-align:center;padding:24px;';
        this.surface.append(this.video, this.message);
        document.body.appendChild(this.surface);
    }

    showWaiting(message) {
        this.ensureSurface();
        this.video.srcObject = null;
        this.message.hidden = false;
        this.message.textContent = message;
    }

    async handleMessage(data) {
        if (!this.token || !data || data.token !== this.token) return;
        if (data.kind === 'available') {
            this.request();
            return;
        }
        if (data.kind === 'ended' && data.sessionId === this.sessionId) {
            this.reset();
            return;
        }
    }

    receiveStream(stream, sessionId) {
        if (this.sessionId === sessionId && this.video?.srcObject?.id === stream.id) return;
        this.reset();
        this.sessionId = sessionId;
        this.ensureSurface();
        this.video.srcObject = stream;
        this.message.textContent = 'Connecting to Teacher Screen…';
        this.video.play().then(() => {
            if (this.sessionId === sessionId) this.message.hidden = true;
        }).catch(() => {
            if (this.sessionId !== sessionId) return;
            this.message.textContent = 'Click the presentation to start playback.';
            this.surface.onclick = () => this.video.play().then(() => { if (this.message) this.message.hidden = true; });
        });
        this.video.onended = () => {
            if (this.sessionId === sessionId) this.reset();
        };
    }

    reset() {
        if (this.video) this.video.srcObject = null;
        this.surface?.remove();
        this.surface = this.video = this.message = null;
        this.sessionId = null;
    }

    destroy() {
        clearInterval(this.retryTimer);
        window.removeEventListener('focus', this.request);
        window.removeEventListener('pageshow', this.request);
        window.removeEventListener('pagehide', this.pageHide);
        this.reset();
        this.channel.close();
    }
}
