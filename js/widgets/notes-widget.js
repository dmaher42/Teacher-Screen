/**
 * Notes Widget Class
 * Creates a rich text editor widget using Quill.js.
 */
class NotesWidget {
    /**
     * Constructor for the NotesWidget.
     */
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'notes-widget-content';
        this.element.style.height = '100%';
        this.element.style.width = '100%';
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';

        // --- Create Display Section ---
        this.mainDisplay = document.createElement('div');
        this.mainDisplay.className = 'widget-display';
        this.mainDisplay.style.overflowY = 'auto';
        this.mainDisplay.style.padding = '10px';
        this.mainDisplay.style.backgroundColor = '#fff';
        this.mainDisplay.style.color = '#333';
        this.mainDisplay.style.height = '100%';
        this.mainDisplay.style.width = '100%';
        this.mainDisplay.style.textAlign = 'left';

        // Create the notes display preview
        this.display = document.createElement('div');
        this.display.id = 'notes-display-preview';
        this.display.className = 'notes-display';
        // Apply tidy preview styles as requested
        this.display.style.fontSize = '0.8em';
        this.display.style.minHeight = '50px';
        this.display.style.width = '100%';

        this.mainDisplay.appendChild(this.display);

        // --- Create Controls Section ---
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls';

        // Header
        const header = document.createElement('h3');
        header.textContent = 'Edit Notes';
        this.controlsOverlay.appendChild(header);

        // Editor container
        this.editorContainer = document.createElement('div');
        this.editorContainer.id = 'editor-container-' + Math.random().toString(36).substr(2, 9);
        this.editorContainer.style.height = '300px';
        this.controlsOverlay.appendChild(this.editorContainer);

        this.element.appendChild(this.mainDisplay);

        // State
        this.quillEditor = null;
        this.savedContent = '';
    }

    /**
     * Called when the widget settings modal is opened.
     * @returns {HTMLElement} The controls overlay.
     */
    getControls() {
        return this.controlsOverlay;
    }

    /**
     * Initializes the Quill editor after the modal becomes visible.
     */
    onSettingsOpen() {
        this.initializeEditor();
    }

    initializeEditor() {
        const container = document.getElementById(this.editorContainer.id);

        if (!container || this.quillEditor) {
            return;
        }

        this.quillEditor = new Quill('#' + this.editorContainer.id, {
            theme: 'snow',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, false] }],
                    ['bold', 'italic', 'underline'],
                    ['image', 'code-block']
                ]
            }
        });

        // Load content
        if (this.savedContent) {
            this.quillEditor.root.innerHTML = this.savedContent;
        }
    }

    /**
     * Called when the settings modal is closed.
     * Saves the content from Quill.
     */
    onSettingsClose() {
        if (this.quillEditor) {
            this.savedContent = this.quillEditor.root.innerHTML;
            this.updateDisplay();
        }
    }

    updateDisplay() {
        if (this.display) {
            this.display.innerHTML = this.savedContent;
        }
    }

    /**
     * Remove the widget from the DOM.
     */
    remove() {
        this.element.remove();
        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    /**
     * Serialize the widget's state for saving to localStorage.
     * @returns {object} The serialized state.
     */
    serialize() {
        return {
            type: 'NotesWidget',
            content: this.savedContent
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        if (data.content) {
            this.savedContent = data.content;
            this.updateDisplay();
        }
    }
}
