/**
 * RevealManagerWidget
 * Manages Reveal deck sources from URL or raw HTML and renders them in a persistent iframe.
 */
class RevealManagerWidget {
    constructor() {
        this.storageKey = 'revealDecks';
        this.activeDeck = null;

        this.element = document.createElement('div');
        this.element.className = 'reveal-manager-widget-content';

        const modeGroupName = `reveal-input-mode-${Date.now()}`;

        this.element.innerHTML = `
            <div class="reveal-manager-controls">
                <div class="reveal-manager-row">
                    <label>
                        <input type="radio" name="${modeGroupName}" value="url" checked>
                        URL
                    </label>
                    <label>
                        <input type="radio" name="${modeGroupName}" value="html">
                        HTML
                    </label>
                </div>
                <div class="reveal-manager-row">
                    <input type="text" class="reveal-deck-name" placeholder="Deck name">
                </div>
                <div class="reveal-manager-row reveal-url-row">
                    <input type="text" class="reveal-content-input" placeholder="https://your-reveal-deck-url">
                </div>
                <div class="reveal-manager-row reveal-html-row" style="display:none;">
                    <textarea class="reveal-content-textarea" placeholder="Paste full Reveal HTML here"></textarea>
                </div>
                <div class="reveal-manager-row reveal-manager-actions">
                    <button type="button" class="control-button reveal-launch-btn">Launch</button>
                    <button type="button" class="control-button reveal-save-btn">Save Deck</button>
                </div>
                <div class="reveal-manager-row reveal-manager-actions">
                    <button type="button" class="control-button reveal-nav-btn" data-direction="prev">Prev</button>
                    <button type="button" class="control-button reveal-nav-btn" data-direction="next">Next</button>
                    <button type="button" class="control-button reveal-nav-btn" data-direction="up">Up</button>
                    <button type="button" class="control-button reveal-nav-btn" data-direction="down">Down</button>
                </div>
                <div class="reveal-manager-row">
                    <select class="reveal-saved-select">
                        <option value="">Select saved deck</option>
                    </select>
                    <button type="button" class="control-button reveal-launch-saved-btn">Launch Saved</button>
                </div>
            </div>
            <div class="reveal-manager-frame-wrap"></div>
        `;

        this.modeRadios = Array.from(this.element.querySelectorAll('input[type="radio"]'));
        this.deckNameInput = this.element.querySelector('.reveal-deck-name');
        this.urlRow = this.element.querySelector('.reveal-url-row');
        this.htmlRow = this.element.querySelector('.reveal-html-row');
        this.urlInput = this.element.querySelector('.reveal-content-input');
        this.htmlInput = this.element.querySelector('.reveal-content-textarea');
        this.saveButton = this.element.querySelector('.reveal-save-btn');
        this.launchButton = this.element.querySelector('.reveal-launch-btn');
        this.savedSelect = this.element.querySelector('.reveal-saved-select');
        this.launchSavedButton = this.element.querySelector('.reveal-launch-saved-btn');
        this.frameWrap = this.element.querySelector('.reveal-manager-frame-wrap');
        this.navButtons = Array.from(this.element.querySelectorAll('.reveal-nav-btn'));

        // Keep a stable iframe reference for toolbar navigation, similar to React's useRef.
        this.iframeRef = { current: null };

        this.iframe = document.createElement('iframe');
        this.iframe.className = 'reveal-manager-iframe';
        this.iframe.title = 'Reveal deck frame';
        this.iframe.setAttribute('referrerpolicy', 'no-referrer');
        this.frameWrap.appendChild(this.iframe);
        this.iframeRef.current = this.iframe;

        this.handleModeChange = this.handleModeChange.bind(this);
        this.handleSaveDeck = this.handleSaveDeck.bind(this);
        this.handleLaunchFromInputs = this.handleLaunchFromInputs.bind(this);
        this.handleLaunchSaved = this.handleLaunchSaved.bind(this);
        this.handleNavButtonClick = this.handleNavButtonClick.bind(this);

        this.modeRadios.forEach((radio) => radio.addEventListener('change', this.handleModeChange));
        this.saveButton.addEventListener('click', this.handleSaveDeck);
        this.launchButton.addEventListener('click', this.handleLaunchFromInputs);
        this.launchSavedButton.addEventListener('click', this.handleLaunchSaved);
        this.navButtons.forEach((button) => button.addEventListener('click', this.handleNavButtonClick));

        this.renderSavedDeckOptions();
        this.updateModeUI();
    }

    getCurrentMode() {
        const selected = this.modeRadios.find((radio) => radio.checked);
        return selected ? selected.value : 'url';
    }

    setMode(mode) {
        this.modeRadios.forEach((radio) => {
            radio.checked = radio.value === mode;
        });
        this.updateModeUI();
    }

    updateModeUI() {
        const mode = this.getCurrentMode();
        this.urlRow.style.display = mode === 'url' ? '' : 'none';
        this.htmlRow.style.display = mode === 'html' ? '' : 'none';
    }

    handleModeChange() {
        this.updateModeUI();
    }

    getSavedDecks() {
        try {
            const parsed = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Unable to parse saved reveal decks:', error);
            return [];
        }
    }

    saveDecks(decks) {
        localStorage.setItem(this.storageKey, JSON.stringify(decks));
    }

    renderSavedDeckOptions() {
        const decks = this.getSavedDecks();
        const previousValue = this.savedSelect.value;

        this.savedSelect.innerHTML = '<option value="">Select saved deck</option>';

        decks.forEach((deck) => {
            const option = document.createElement('option');
            option.value = String(deck.id);
            option.textContent = `${deck.name} (${deck.type.toUpperCase()})`;
            this.savedSelect.appendChild(option);
        });

        if (previousValue) {
            this.savedSelect.value = previousValue;
        }
    }

    buildDeckFromInputs() {
        const type = this.getCurrentMode();
        const content = type === 'url' ? this.urlInput.value.trim() : this.htmlInput.value;

        if (!content.trim()) {
            return null;
        }

        return {
            id: Date.now(),
            name: (this.deckNameInput.value || 'Untitled Deck').trim(),
            type,
            content
        };
    }

    launchDeck(deck) {
        if (!deck) return;

        this.activeDeck = {
            id: deck.id,
            name: deck.name,
            type: deck.type,
            content: deck.content
        };

        if (deck.type === 'url') {
            this.iframe.srcdoc = '';
            this.iframe.src = deck.content;
        } else {
            this.iframe.removeAttribute('src');
            this.iframe.srcdoc = deck.content;
        }
    }

    sendKeyToIframe(direction) {
        const frame = this.iframeRef.current;
        if (!frame || !frame.contentWindow) return;

        // Reveal deck pages loaded in the iframe must listen for this event:
        // window.addEventListener("message", function(event) {
        //   if (event.data.type === "reveal-nav") {
        //     if (event.data.direction === "next") Reveal.next();
        //     if (event.data.direction === "prev") Reveal.prev();
        //     if (event.data.direction === "up") Reveal.up();
        //     if (event.data.direction === "down") Reveal.down();
        //   }
        // });
        frame.contentWindow.postMessage({ type: 'reveal-nav', direction }, '*');
    }

    handleNavButtonClick(event) {
        const direction = event.currentTarget.dataset.direction;
        if (!direction) return;
        this.sendKeyToIframe(direction);
    }

    handleLaunchFromInputs() {
        const deck = this.buildDeckFromInputs();
        if (!deck) return;
        this.launchDeck(deck);
    }

    handleSaveDeck() {
        const deck = this.buildDeckFromInputs();
        if (!deck) return;

        const decks = this.getSavedDecks();
        decks.push(deck);
        this.saveDecks(decks);
        this.renderSavedDeckOptions();
        this.savedSelect.value = String(deck.id);
    }

    handleLaunchSaved() {
        const selectedId = Number(this.savedSelect.value);
        if (!selectedId) return;

        const deck = this.getSavedDecks().find((item) => item.id === selectedId);
        if (!deck) return;

        this.setMode(deck.type);
        this.deckNameInput.value = deck.name;
        if (deck.type === 'url') {
            this.urlInput.value = deck.content;
        } else {
            this.htmlInput.value = deck.content;
        }

        this.launchDeck(deck);
    }

    serialize() {
        return {
            type: 'RevealManagerWidget',
            activeDeck: this.activeDeck
        };
    }

    deserialize(data) {
        if (!data || !data.activeDeck) return;

        const deck = data.activeDeck;
        this.setMode(deck.type || 'url');
        this.deckNameInput.value = deck.name || '';

        if (deck.type === 'html') {
            this.htmlInput.value = deck.content || '';
        } else {
            this.urlInput.value = deck.content || '';
        }

        this.launchDeck(deck);
    }

    toggleHelp() {
        // No help text defined for this widget yet.
    }

    remove() {
        this.modeRadios.forEach((radio) => radio.removeEventListener('change', this.handleModeChange));
        this.saveButton.removeEventListener('click', this.handleSaveDeck);
        this.launchButton.removeEventListener('click', this.handleLaunchFromInputs);
        this.launchSavedButton.removeEventListener('click', this.handleLaunchSaved);
        this.navButtons.forEach((button) => button.removeEventListener('click', this.handleNavButtonClick));
        this.element.remove();

        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }
}

if (typeof window !== 'undefined') {
    window.RevealManagerWidget = RevealManagerWidget;
}
