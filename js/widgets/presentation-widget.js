class PresentationWidget {
    constructor() {
        this.layoutType = 'grid';
        this.currentPresentation = '';
        this.presentations = [
            { value: 'cyber-safety', label: 'Cyber Safety' },
            { value: 'roman-empire', label: 'Roman Empire' },
            { value: 'athletics-training', label: 'Athletics Training' }
        ];

        this.element = document.createElement('div');
        this.element.className = 'presentation-widget-content';

        const options = this.presentations
            .map((presentation) => `<option value="${presentation.value}">${presentation.label}</option>`)
            .join('');

        this.element.innerHTML = `
            <div class="presentation-widget-controls">
                <select class="presentation-select" aria-label="Select presentation">
                    ${options}
                </select>
                <button type="button" class="control-button presentation-load-button">Load</button>
            </div>
            <div class="presentation-widget-stage" style="height: calc(100% - 3rem); overflow: hidden;"></div>
        `;

        this.select = this.element.querySelector('.presentation-select');
        this.loadButton = this.element.querySelector('.presentation-load-button');
        this.stage = this.element.querySelector('.presentation-widget-stage');

        this.handleLoadClick = this.handleLoadClick.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.handleStageInteraction = this.handleStageInteraction.bind(this);

        this.loadButton.addEventListener('click', this.handleLoadClick);
        this.element.addEventListener('click', this.handleStageInteraction);
        this.element.addEventListener('focusin', this.handleStageInteraction);

        this.resizeObserver = new ResizeObserver(this.handleResize);
        this.resizeObserver.observe(this.element);
    }

    async handleLoadClick() {
        const selectedName = this.select.value;
        if (!selectedName) return;

        await this.loadPresentationByName(selectedName);
    }

    async loadPresentationByName(name) {
        if (!name) return;

        console.log('[presentation-widget] loading presentation');

        const [{ loadPresentation }, { activateReveal }] = await Promise.all([
            import('./../utils/presentation-loader.js'),
            import('./../utils/reveal-manager.js')
        ]);
        await loadPresentation(this.stage, name);
        activateReveal(this.stage);
        this.currentPresentation = name;
    }

    handleStageInteraction() {
        import('./../utils/reveal-manager.js').then(({ activateReveal }) => {
            activateReveal(this.stage);
        });
    }

    handleResize() {
        import('./../utils/reveal-manager.js').then(({ getRevealDeck, hasMountedReveal, layoutReveal }) => {
            const deck = getRevealDeck(this.stage);
            if (deck && typeof deck.layout === 'function') {
                layoutReveal(this.stage);
                return;
            }

            // If Reveal did not initialize previously (e.g. widget restored while hidden),
            // retry loading the selected presentation when the widget is resized/visible.
            if (this.currentPresentation && !hasMountedReveal(this.stage)) {
                this.loadPresentationByName(this.currentPresentation);
            }
        });
    }

    serialize() {
        return {
            type: 'PresentationWidget',
            currentPresentation: this.currentPresentation || this.select.value || ''
        };
    }

    deserialize(data = {}) {
        const selectedName = data.currentPresentation || '';
        if (!selectedName) return;

        this.select.value = selectedName;
        this.loadPresentationByName(selectedName);
    }

    setEditable() {}

    remove() {
        this.loadButton.removeEventListener('click', this.handleLoadClick);
        this.element.removeEventListener('click', this.handleStageInteraction);
        this.element.removeEventListener('focusin', this.handleStageInteraction);
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        import('./../utils/reveal-manager.js')
            .then(({ destroyReveal }) => {
                destroyReveal(this.stage);
            })
            .catch((error) => {
                console.warn('[presentation-widget] failed to destroy reveal instance', error);
            });

        this.element.remove();
    }
}

if (typeof window !== 'undefined') {
    window.PresentationWidget = PresentationWidget;
}
