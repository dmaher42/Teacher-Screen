/**
 * UrlViewerWidget
 * Simple web page viewer with URL bar, reload, and presentation mode.
 */
class UrlViewerWidget {
    constructor() {
        this.layoutType = 'stage';
        this.element = document.createElement('div');
        this.element.className = 'url-viewer-widget-content';

        this.currentUrl = '';

        this.element.innerHTML = `
            <div class="url-viewer-body">
                <div class="url-viewer-input-row">
                    <input
                        type="text"
                        class="url-viewer-input"
                        placeholder="Enter a web address (e.g. https://example.com)"
                    >
                </div>
                <div class="url-viewer-content">
                    <!-- iframe injected here -->
                </div>
            </div>
            <div class="widget-control-bar">
                <div class="primary-actions">
                    <button type="button" class="control-button load-url-button">Load</button>
                    <button type="button" class="control-button reload-url-button" disabled>Reload</button>
                    <button type="button" class="control-button present-button">Present</button>
                    <button type="button" class="control-button exit-present-button" style="display:none;">Exit</button>
                </div>
                <div class="secondary-actions">
                    <button type="button" class="control-button open-newtab-button" title="Open in new tab" disabled>
                        <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>
                        <span class="visually-hidden">Open in new tab</span>
                    </button>
                </div>
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

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls url-viewer-settings-controls';

        const helpText = document.createElement('div');
        helpText.className = 'widget-help-text';
        helpText.textContent = 'Load a website into the widget, reload the current page, or open it in a separate tab.';
        controls.appendChild(helpText);

        const sourceSection = document.createElement('div');
        sourceSection.className = 'widget-settings-section';

        const sourceHeading = document.createElement('h3');
        sourceHeading.textContent = 'Source';
        sourceSection.appendChild(sourceHeading);

        const sourceLabel = document.createElement('label');
        sourceLabel.textContent = 'Web address';
        const sourceInput = document.createElement('input');
        sourceInput.type = 'text';
        sourceInput.value = this.input.value || this.currentUrl || '';
        sourceInput.placeholder = 'https://example.com';
        sourceLabel.appendChild(sourceInput);
        sourceSection.appendChild(sourceLabel);

        const sourceActions = document.createElement('div');
        sourceActions.className = 'widget-settings-actions';

        const loadButton = document.createElement('button');
        loadButton.type = 'button';
        loadButton.className = 'control-button';
        loadButton.textContent = 'Load URL';

        const reloadButton = document.createElement('button');
        reloadButton.type = 'button';
        reloadButton.className = 'control-button';
        reloadButton.textContent = 'Reload URL';
        reloadButton.disabled = !this.currentUrl;

        sourceActions.append(loadButton, reloadButton);
        sourceSection.appendChild(sourceActions);
        controls.appendChild(sourceSection);

        const viewSection = document.createElement('div');
        viewSection.className = 'widget-settings-section';

        const viewHeading = document.createElement('h3');
        viewHeading.textContent = 'Actions';
        viewSection.appendChild(viewHeading);

        const viewActions = document.createElement('div');
        viewActions.className = 'widget-settings-actions';

        const openNewTabButton = document.createElement('button');
        openNewTabButton.type = 'button';
        openNewTabButton.className = 'control-button';
        openNewTabButton.textContent = 'Open in New Tab';
        openNewTabButton.disabled = !this.currentUrl;

        const presentToggleButton = document.createElement('button');
        presentToggleButton.type = 'button';
        presentToggleButton.className = 'control-button';
        presentToggleButton.textContent = this.element.classList.contains('presentation-mode')
            ? 'Exit Presentation Mode'
            : 'Enter Presentation Mode';

        viewActions.append(openNewTabButton, presentToggleButton);
        viewSection.appendChild(viewActions);
        controls.appendChild(viewSection);

        const statusCard = document.createElement('div');
        statusCard.className = 'widget-settings-meta';
        const statusLabel = document.createElement('strong');
        statusLabel.textContent = 'Status';
        const statusText = document.createElement('span');
        statusCard.append(statusLabel, statusText);
        controls.appendChild(statusCard);

        const syncStatus = () => {
            const activeUrl = this.currentUrl || this.input.value.trim();
            sourceInput.value = this.input.value || activeUrl;
            reloadButton.disabled = !activeUrl;
            openNewTabButton.disabled = !activeUrl;
            presentToggleButton.textContent = this.element.classList.contains('presentation-mode')
                ? 'Exit Presentation Mode'
                : 'Enter Presentation Mode';
            statusText.textContent = activeUrl || 'No page loaded yet.';
        };

        loadButton.addEventListener('click', () => {
            const raw = sourceInput.value.trim();
            if (!raw) {
                syncStatus();
                return;
            }

            const normalized = this.normalizeUrl(raw);
            this.input.value = normalized;
            this.loadUrl(normalized);
            syncStatus();
        });

        reloadButton.addEventListener('click', () => {
            this.handleReloadClick();
            syncStatus();
        });

        openNewTabButton.addEventListener('click', () => {
            this.handleOpenNewTabClick();
            syncStatus();
        });

        presentToggleButton.addEventListener('click', () => {
            if (this.element.classList.contains('presentation-mode')) {
                this.exitPresentationMode();
            } else {
                this.enterPresentationMode();
            }
            syncStatus();
        });

        sourceInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            loadButton.click();
        });

        syncStatus();
        return controls;
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

    setEditable() {}

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
