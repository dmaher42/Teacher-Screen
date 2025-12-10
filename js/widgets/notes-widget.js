/**
 * Notes Widget Class
 * Creates a rich text editor widget using Quill.js.
 */

const SAVED_NOTES_STORAGE_KEY = 'teacherScreenSavedNotes';

const SavedNotesStore = window.SavedNotesStore || {
    getAll() {
        try {
            const raw = localStorage.getItem(SAVED_NOTES_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Failed to parse saved notes.', error);
            return [];
        }
    },
    persist(notes) {
        localStorage.setItem(SAVED_NOTES_STORAGE_KEY, JSON.stringify(notes));
        document.dispatchEvent(new CustomEvent('savedNotesUpdated', { detail: { notes } }));
    },
    save(note) {
        const notes = this.getAll();
        const index = notes.findIndex((item) => item.id === note.id);
        const nextNote = {
            ...note,
            updatedAt: note.updatedAt || new Date().toISOString(),
        };
        if (index >= 0) {
            notes[index] = { ...notes[index], ...nextNote };
        } else {
            notes.push(nextNote);
        }
        this.persist(notes);
        return nextNote;
    },
    delete(id) {
        const filtered = this.getAll().filter((note) => note.id !== id);
        this.persist(filtered);
    },
    get(id) {
        return this.getAll().find((note) => note.id === id);
    },
};

window.SavedNotesStore = SavedNotesStore;

class NotesWidget {
    /**
     * Constructor for the NotesWidget.
     */
    constructor(noteData = {}) {
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

        // Link to Planner Button
        const linkBtn = document.createElement('button');
        linkBtn.id = 'link-to-planner-btn';
        linkBtn.textContent = 'Link to Planner';
        linkBtn.className = 'control-button';
        // User requested redirect to pages/planner.html, but in this SPA we open the Planner Modal instead.
        linkBtn.addEventListener('click', () => {
             localStorage.setItem('noteToLink', this.noteId);
             document.dispatchEvent(new CustomEvent('requestOpenPlanner'));
        });
        this.controlsOverlay.appendChild(linkBtn);

        // Editor container
        this.editorContainer = document.createElement('div');
        this.editorContainer.id = 'editor-container-' + Math.random().toString(36).substr(2, 9);
        this.editorContainer.style.height = '300px';
        this.controlsOverlay.appendChild(this.editorContainer);

        this.element.appendChild(this.mainDisplay);

        // State
        this.quillEditor = null;
        this.savedContent = noteData.content || '';
        this.noteId = noteData.id || this.generateNoteId();
        this.title = noteData.title || 'Untitled Note';
        this.updatedAt = noteData.updatedAt || new Date().toISOString();
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
            this.persistNote();
        }
    }

    updateDisplay() {
        if (this.display) {
            this.display.innerHTML = this.savedContent;
        }
    }

    persistNote() {
        const title = this.getTitleFromContent();
        const saved = SavedNotesStore.save({
            id: this.noteId,
            title,
            content: this.savedContent,
            updatedAt: new Date().toISOString(),
        });
        this.title = saved.title;
        this.updatedAt = saved.updatedAt;
    }

    getTitleFromContent() {
        const temp = document.createElement('div');
        temp.innerHTML = this.savedContent;
        const text = (temp.textContent || '').trim();
        if (!text) return 'Untitled Note';
        return text.split('\n')[0].slice(0, 80);
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
            content: this.savedContent,
            id: this.noteId,
            title: this.title,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        if (data.id) {
            this.noteId = data.id;
        }
        if (data.title) {
            this.title = data.title;
        }
        if (data.updatedAt) {
            this.updatedAt = data.updatedAt;
        }
        if (data.content) {
            this.savedContent = data.content;
        }
        this.updateDisplay();
        this.persistNote();
    }

    applySavedNote(data) {
        this.noteId = data.id || this.noteId || this.generateNoteId();
        this.savedContent = data.content || '';
        this.title = data.title || this.title;
        this.updatedAt = data.updatedAt || this.updatedAt;
        if (this.quillEditor) {
            this.quillEditor.root.innerHTML = this.savedContent;
        }
        this.updateDisplay();
    }

    generateNoteId() {
        return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
}
