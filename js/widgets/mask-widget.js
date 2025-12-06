class MaskWidget {
    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'mask-widget-content';
        this.element.innerHTML = `<p>Resize to cover content</p>`;
    }

    toggleHelp() {
        // No help text defined for this widget yet.
    }

    serialize() {
        return {
            type: 'MaskWidget',
        };
    }
}
