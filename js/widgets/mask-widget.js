class MaskWidget {
    constructor() {
        this.layoutType = 'overlay';
        this.element = document.createElement('div');
        this.element.className = 'mask-widget-content';
        this.element.innerHTML = `<p>Resize to cover content</p>`;
    }

    getControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-content-controls mask-widget-settings-controls';

        const helpText = document.createElement('div');
        helpText.className = 'widget-help-text';
        helpText.textContent = 'The mask widget works by resizing and positioning it over content you want hidden from view.';
        controls.appendChild(helpText);

        const infoSection = document.createElement('div');
        infoSection.className = 'widget-settings-section';
        const heading = document.createElement('h3');
        heading.textContent = 'How to Use';
        infoSection.appendChild(heading);

        const note = document.createElement('div');
        note.className = 'widget-settings-meta';
        const label = document.createElement('strong');
        label.textContent = 'Tip';
        const text = document.createElement('span');
        text.textContent = 'Drag and resize the mask directly on the classroom screen. There are no extra settings for this widget.';
        note.append(label, text);
        infoSection.appendChild(note);

        controls.appendChild(infoSection);
        return controls;
    }

    toggleHelp() {
        // No help text defined for this widget yet.
    }

    serialize() {
        return {
            type: 'MaskWidget',
        };
    }

    setEditable() {}
}
