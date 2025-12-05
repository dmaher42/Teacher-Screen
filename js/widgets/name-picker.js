/**
 * Name Picker Widget Class
 * Creates a widget to randomly pick names from a list.
 */
class NamePickerWidget {
    /**
     * Constructor for NamePickerWidget.
     */
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'widget';
        this.element.dataset.widgetType = 'name-picker';

        // Create the widget header
        this.header = document.createElement('div');
        this.header.className = 'widget-header';

        this.title = document.createElement('div');
        this.title.className = 'widget-title';
        this.title.textContent = 'Name Picker';

        this.helpButton = document.createElement('button');
        this.helpButton.className = 'widget-help';
        this.helpButton.textContent = '?';

        this.closeButton = document.createElement('button');
        this.closeButton.className = 'widget-close';
        this.closeButton.innerHTML = '&times;';
        this.closeButton.addEventListener('click', () => this.remove());

        this.controls = document.createElement('div');
        this.controls.className = 'widget-controls';
        this.controls.appendChild(this.helpButton);
        this.controls.appendChild(this.closeButton);

        this.header.appendChild(this.title);
        this.header.appendChild(this.controls);

        // Create the widget content area
        this.content = document.createElement('div');
        this.content.className = 'widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.textContent = 'Click Pick a Name to spin through the list. When all names are chosen, reset the list to start over.';
        this.helpButton.addEventListener('click', () => {
            const isVisible = this.helpText.style.display === 'block';
            this.helpText.style.display = isVisible ? 'none' : 'block';
        });

        // Create the name display
        this.display = document.createElement('div');
        this.display.className = 'name-picker-display';
        this.display.textContent = 'Click to pick a name';

        // Create the control button
        this.pickButton = document.createElement('button');
        this.pickButton.className = 'pick-button';
        this.pickButton.textContent = 'Pick a Name';
        this.pickButton.addEventListener('click', () => this.pickRandom());

        // Assemble the widget
        this.content.appendChild(this.helpText);
        this.content.appendChild(this.display);
        this.content.appendChild(this.pickButton);
        this.element.appendChild(this.header);
        this.element.appendChild(this.content);

        // Name Picker state
        this.originalNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fiona', 'George', 'Hannah']; // Default list
        this.names = [...this.originalNames];
        this.picking = false;
    }

    /**
     * Start the random name picking animation.
     */
    pickRandom() {
        if (this.picking || this.names.length === 0) return;

        this.picking = true;
        let iterations = 0;
        const maxIterations = 20;

        const interval = setInterval(() => {
            const randomIndex = Math.floor(Math.random() * this.names.length);
            this.display.textContent = this.names[randomIndex];
            iterations++;

            if (iterations >= maxIterations) {
                clearInterval(interval);
                this.picking = false;

                // Remove the selected name temporarily
                const selectedName = this.names.splice(randomIndex, 1)[0];
                this.display.textContent = `Selected: ${selectedName}`;

                // If all names have been picked, change button to reset
                if (this.names.length === 0) {
                    this.pickButton.textContent = 'Reset List';
                    this.pickButton.onclick = () => this.reset();
                }
            }
        }, 100);
    }

    /**
     * Reset the list of names back to the original.
     */
    reset() {
        this.names = [...this.originalNames];
        this.display.textContent = 'Click to pick a name';
        this.pickButton.textContent = 'Pick a Name';
        this.pickButton.onclick = () => this.pickRandom();
    }

    /**
     * Remove the widget from the DOM.
     */
    remove() {
        this.element.remove();
        // Notify the app to update its widget list
        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    /**
     * Serialize the widget's state for saving to localStorage.
     * @returns {object} The serialized state.
     */
    serialize() {
        return {
            type: 'NamePickerWidget',
            originalNames: this.originalNames,
            names: this.names
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        this.originalNames = data.originalNames || ['Alice', 'Bob', 'Charlie'];
        this.names = data.names || [...this.originalNames];
        
        if (this.names.length === 0) {
            this.display.textContent = 'List is empty';
            this.pickButton.textContent = 'Reset List';
            this.pickButton.onclick = () => this.reset();
        } else {
            this.display.textContent = 'Click to pick a name';
            this.pickButton.textContent = 'Pick a Name';
            this.pickButton.onclick = () => this.pickRandom();
        }
    }
}
