class PresentationWidget {
    constructor() {
        this.layoutType = 'grid';
        this.currentPresentation = '';
        const appModeUtils = window.TeacherScreenAppMode || {};
        this.isProjectorMode = appModeUtils.isProjectorMode || (() => window.APP_MODE === 'projector');
        this.presentations = [
            { value: 'cyber-safety', label: 'Cyber Safety' },
            { value: 'roman-empire', label: 'Roman Empire' },
            { value: 'athletics-training', label: 'Athletics Training' }
        ];

        this.element = document.createElement('div');
        this.element.className = 'presentation-widget-content';
        this.element.classList.toggle('presentation-widget--projector', this.isProjectorMode());

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
            <div class="presentation-widget-stage"></div>
            <div class="presentation-widget-preview" hidden>
                <span class="presentation-widget-preview__label">Up next</span>
                <span class="presentation-widget-preview__text"></span>
            </div>
        `;

        this.select = this.element.querySelector('.presentation-select');
        this.loadButton = this.element.querySelector('.presentation-load-button');
        this.stage = this.element.querySelector('.presentation-widget-stage');
        this.previewSection = this.element.querySelector('.presentation-widget-preview');
        this.previewText = this.element.querySelector('.presentation-widget-preview__text');

        this.handleLoadClick = this.handleLoadClick.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.handleStageInteraction = this.handleStageInteraction.bind(this);
        this.updateSlidePreview = this.updateSlidePreview.bind(this);

        this.loadButton.addEventListener('click', this.handleLoadClick);
        this.element.addEventListener('click', this.handleStageInteraction);
        this.element.addEventListener('focusin', this.handleStageInteraction);

        this.resizeObserver = new ResizeObserver(this.handleResize);
        this.resizeObserver.observe(this.element);

        this.slidePreviewObserver = new MutationObserver(this.updateSlidePreview);
        this.slidePreviewObserver.observe(this.stage, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ['class', 'style']
        });

        if (this.isProjectorMode()) {
            this.previewSection.hidden = true;
        }
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
        this.updateSlidePreview();
    }

    handleStageInteraction() {
        import('./../utils/reveal-manager.js').then(({ activateReveal }) => {
            activateReveal(this.stage);
        });
        this.updateSlidePreview();
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
        this.updateSlidePreview();
    }

    summarizeSlideText(slide) {
        if (!slide) return '';

        const text = (slide.innerText || slide.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) {
            return '';
        }

        return text.length > 120 ? `${text.slice(0, 117).trimEnd()}...` : text;
    }

    updateSlidePreview() {
        if (!this.previewSection || this.isProjectorMode()) {
            return;
        }

        const slides = Array.from(this.stage.querySelectorAll('.slides > section'));
        if (!slides.length || !this.currentPresentation) {
            this.previewSection.hidden = true;
            this.previewText.textContent = '';
            return;
        }

        let currentIndex = slides.findIndex((slide) => slide.classList.contains('present'));
        if (currentIndex < 0) {
            currentIndex = 0;
        }

        const nextSlide = slides[currentIndex + 1] || null;
        const nextText = this.summarizeSlideText(nextSlide);

        if (!nextText) {
            this.previewSection.hidden = false;
            this.previewText.textContent = 'No upcoming slide';
            return;
        }

        this.previewSection.hidden = false;
        this.previewText.textContent = nextText;
    }

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls presentation-widget-settings-controls';

        const helpText = document.createElement('div');
        helpText.className = 'widget-help-text';
        helpText.textContent = 'Choose one of the built-in presentations and load it into the widget.';
        controls.appendChild(helpText);

        const sourceSection = document.createElement('div');
        sourceSection.className = 'widget-settings-section';
        const sourceHeading = document.createElement('h3');
        sourceHeading.textContent = 'Presentation Source';
        sourceSection.appendChild(sourceHeading);

        const selectLabel = document.createElement('label');
        selectLabel.textContent = 'Presentation';
        const selectClone = this.select.cloneNode(true);
        selectClone.value = this.select.value;
        selectLabel.appendChild(selectClone);
        sourceSection.appendChild(selectLabel);

        const sourceActions = document.createElement('div');
        sourceActions.className = 'widget-settings-actions';
        const loadButton = document.createElement('button');
        loadButton.type = 'button';
        loadButton.className = 'control-button';
        loadButton.textContent = 'Load Presentation';
        sourceActions.appendChild(loadButton);
        sourceSection.appendChild(sourceActions);
        controls.appendChild(sourceSection);

        const statusCard = document.createElement('div');
        statusCard.className = 'widget-settings-meta';
        const statusLabel = document.createElement('strong');
        statusLabel.textContent = 'Current Presentation';
        const statusText = document.createElement('span');
        statusCard.append(statusLabel, statusText);
        controls.appendChild(statusCard);

        const syncStatus = () => {
            statusText.textContent = this.currentPresentation
                ? this.presentations.find((item) => item.value === this.currentPresentation)?.label || this.currentPresentation
                : 'No presentation loaded yet.';
        };

        loadButton.addEventListener('click', async () => {
            this.select.value = selectClone.value;
            await this.handleLoadClick();
            syncStatus();
        });

        selectClone.addEventListener('change', () => {
            this.select.value = selectClone.value;
            syncStatus();
        });

        syncStatus();
        return controls;
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
        if (this.slidePreviewObserver) {
            this.slidePreviewObserver.disconnect();
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
