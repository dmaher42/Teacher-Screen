class MaskWidget {
    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'widget mask-widget';
        this.element.innerHTML = `
            <div class="widget-header">
                <span class="widget-title">Mask</span>
                <div class="widget-controls">
                    <button class="widget-close">&times;</button>
                </div>
            </div>
            <div class="widget-content">
                <p>Resize to cover content</p>
            </div>
        `;
    }
}
