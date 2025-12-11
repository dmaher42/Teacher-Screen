/**
 * UrlViewerWidget
 * Simple web page viewer with URL bar, reload, and presentation mode.
 */
class UrlViewerWidget {
    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'url-viewer-widget-content';

        this.currentUrl = '';

        this.element.innerHTML = `
            <div class="url-viewer-controls secondary-control">
                <input 
                    type="text" 
                    class="url-viewer-input" 
                    placeholder="Enter a web address (e.g. https://example.com)"
                >
                <button type="button" class="control-button load-url-button">Load</button>
                <button type="button" class="control-button reload-url-button" disabled>Reload</button>
                <button type="button" class="control-button open-newtab-button" disabled>Open in New Tab</button>
                <button type="button" class="control-button present-button">Present</button>
                <button type="button" class="control-button exit-present-button" style="display:none;">Exit</button>
            </div>
            <div class="url-viewer-content">
                <!-- iframe injected here -->
            </div>
        `;

        this.input = this.element.querySelector('.url-viewer-input');
        this.contentArea = this.element.querySelector('.url-viewer-content');
        this.loadBtn = this.element.querySelector('.load-url-button');
        this.reloadBtn = this.element.querySelector('.reload-url-button');
        this.openNewTabBtn = this.element.querySelector('.open-newtab-button');
        this.presentBtn = this.element.querySelector('.present-button');
        this.exitPresentBtn = this.element.querySelector('.exit-present-button');

        // Bind handlers
        this.handleLoadClick = this.handleLoadClick.bind(this);
        this.handleReloadClick = this.handleReloadClick.bind(this);
        this.handleOpenNewTabClick = this.handleOpenNewTabClick.bind(this);
        this.handleInputKeyDown = this.handleInputKeyDown.bind(this);
        this.handlePresentClick = this.handlePresentClick.bind(this);
        this.handleExitPresentClick = this.handleExitPresentClick.bind(this);

        // Events
        this.loadBtn.addEventListener('click', this.handleLoadClick);
        this.reloadBtn.addEventListener('click', this.handleReloadClick);
        this.openNewTabBtn.addEventListener('click', this.handleOpenNewTabClick);
        this.input.addEventListener('keydown', this.handleInputKeyDown);
        this.presentBtn.addEventListener('click', this.handlePresentClick);
        this.exitPresentBtn.addEventListener('click', this.handleExitPresentClick);
    }

    // ---- Event handlers ----

    handleLoadClick() {
        const raw = this.input.value.trim();
        if (!raw) return;
        const url = this.normalizeUrl(raw);
        this.loadUrl(url);
    }

    handleReloadClick() {
        if (!this.currentUrl) return;
        this.loadUrl(this.currentUrl, { keepInput: true });
    }

    handleOpenNewTabClick() {
        if (!this.currentUrl) return;
        window.open(this.currentUrl, '_blank', 'noopener,noreferrer');
    }

    handleInputKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.handleLoadClick();
        }
    }

    handlePresentClick() {
        this.enterPresentationMode();
    }

    handleExitPresentClick() {
        this.exitPresentationMode();
    }

    // ---- Core behaviour ----

    normalizeUrl(raw) {
        // Allow relative URLs as-is
        const hasProtocol = /^https?:\/\//i.test(raw);
        const isRelative = raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../');

        if (!hasProtocol && !isRelative) {
            return `https://${raw}`;
        }
        return raw;
    }

    loadUrl(url, options = {}) {
        this.currentUrl = url;

        if (!options.keepInput) {
            this.input.value = url;
        }

        // Basic iframe
        this.contentArea.innerHTML = `
            <iframe 
                class="url-viewer-iframe"
                src="${url}"
                style="width: 100%; height: 100%; border: none;"
            ></iframe>
        `;

        this.reloadBtn.disabled = false;
        this.openNewTabBtn.disabled = false;
    }

    enterPresentationMode() {
        this.element.classList.add('presentation-mode');
        this.presentBtn.style.display = 'none';
        this.exitPresentBtn.style.display = 'inline-block';
    }

    exitPresentationMode() {
        this.element.classList.remove('presentation-mode');
        this.presentBtn.style.display = 'inline-block';
        this.exitPresentBtn.style.display = 'none';
    }

    // ---- Widget integration ----

    toggleHelp() {
        // Optional: integrate with your global help system if needed
    }

    serialize() {
        return {
            type: 'UrlViewerWidget',
            url: this.currentUrl || null
        };
    }

    deserialize(data) {
        if (data && data.url) {
            this.loadUrl(data.url, { keepInput: true });
        }
    }

    remove() {
        this.loadBtn.removeEventListener('click', this.handleLoadClick);
        this.reloadBtn.removeEventListener('click', this.handleReloadClick);
        this.openNewTabBtn.removeEventListener('click', this.handleOpenNewTabClick);
        this.input.removeEventListener('keydown', this.handleInputKeyDown);
        this.presentBtn.removeEventListener('click', this.handlePresentClick);
        this.exitPresentBtn.removeEventListener('click', this.handleExitPresentClick);

        this.element.remove();

        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }
}

if (typeof window !== 'undefined') {
    window.UrlViewerWidget = UrlViewerWidget;
}
