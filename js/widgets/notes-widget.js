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
        this.isExpanded = false;

        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'notes-widget-content';
        this.element.style.height = '100%';
        this.element.style.width = '100%';
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';

        // --- Create Display Section (Preview) ---
        this.mainDisplay = document.createElement('div');
        this.mainDisplay.className = 'widget-display';
        this.mainDisplay.style.overflowY = 'auto';
        this.mainDisplay.style.padding = '10px';
        this.mainDisplay.style.backgroundColor = '#fff';
        this.mainDisplay.style.color = '#333';
        this.mainDisplay.style.height = '100%';
        this.mainDisplay.style.width = '100%';
        this.mainDisplay.style.textAlign = 'left';
        this.mainDisplay.style.cursor = 'pointer'; // Indicate clickability

        // Create the notes display preview
        this.display = document.createElement('div');
        this.display.id = 'notes-display-preview';
        this.display.className = 'notes-display';
        // Apply tidy preview styles as requested
        this.display.style.fontSize = '0.8em';
        this.display.style.minHeight = '50px';
        this.display.style.width = '100%';

        this.mainDisplay.appendChild(this.display);

        // --- Create Controls Section (Only for Settings Modal) ---
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls';

        // Header for settings
        const header = document.createElement('h3');
        header.textContent = 'Note Settings';
        this.controlsOverlay.appendChild(header);

        // Link to Planner Button
        const linkBtn = document.createElement('button');
        linkBtn.id = 'link-to-planner-btn';
        linkBtn.textContent = 'Link to Planner';
        linkBtn.className = 'control-button';
        linkBtn.addEventListener('click', () => {
             localStorage.setItem('noteToLink', this.noteId);
             document.dispatchEvent(new CustomEvent('requestOpenPlanner'));
        });
        this.controlsOverlay.appendChild(linkBtn);

        // Delete Note Button (Added for better management)
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete Note';
        deleteBtn.className = 'control-button';
        deleteBtn.style.marginTop = '10px';
        deleteBtn.style.backgroundColor = '#ff6b6b';
        deleteBtn.style.color = 'white';
        deleteBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete this note?')) {
                SavedNotesStore.delete(this.noteId);
                this.remove();
            }
        });
        this.controlsOverlay.appendChild(deleteBtn);

        // Append display to element initially
        this.element.appendChild(this.mainDisplay);

        // --- Editor Container (Created on demand or hidden) ---
        // We'll create it here but not append it until expanded
        this.editorContainerWrapper = document.createElement('div');
        this.editorContainerWrapper.className = 'notes-editor-wrapper';
        this.editorContainerWrapper.style.display = 'none';
        this.editorContainerWrapper.style.flexDirection = 'column';
        this.editorContainerWrapper.style.height = '100%';

        this.element.appendChild(this.editorContainerWrapper);

        // Click listener for expansion
        this.element.addEventListener('click', (e) => {
            // Prevent expansion if clicking buttons or specific interactive elements
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }
            // If expanded, only collapse if clicking outside the editor (e.g. on the close button we might add, or if we want toggle behavior)
            // The requirement says: "Click it to type, click it again to save and minimize."
            // But if I am typing in the editor, I don't want to collapse.
            // So we toggle ONLY if not clicking inside the editor content area when expanded?
            // Actually, Quill intercepts clicks.
            // Let's implement a distinct expand/collapse logic.

            if (!this.isExpanded) {
                this.expand();
            }
        });

        // State
        this.quillEditor = null;
        this.savedContent = noteData.content || '';
        this.noteId = noteData.id || this.generateNoteId();
        this.title = noteData.title || 'Untitled Note';
        this.updatedAt = noteData.updatedAt || new Date().toISOString();

        // Initial preview update
        this.updateDisplay();
    }

    expand() {
        if (this.isExpanded) return;
        this.isExpanded = true;

        // Add expanded class
        this.element.classList.add('expanded');

        // Hide preview
        this.mainDisplay.style.display = 'none';

        // Show editor wrapper
        this.editorContainerWrapper.style.display = 'flex';

        // Recreate structure to ensure clean state
        this.editorContainerWrapper.innerHTML = '';

        // Create Header
        this.expandedHeader = document.createElement('div');
        this.expandedHeader.className = 'notes-expanded-header';
        this.expandedHeader.style.display = 'flex';
        this.expandedHeader.style.justifyContent = 'space-between';
        this.expandedHeader.style.alignItems = 'center';
        this.expandedHeader.style.padding = '8px';
        this.expandedHeader.style.background = '#f4f4f4';
        this.expandedHeader.style.borderBottom = '1px solid #ddd';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = 'Editing Note';
        titleSpan.style.fontWeight = 'bold';

        const minimizeBtn = document.createElement('button');
        minimizeBtn.innerHTML = '&times;';
        minimizeBtn.title = 'Save and Minimize';
        minimizeBtn.style.background = 'none';
        minimizeBtn.style.border = 'none';
        minimizeBtn.style.fontSize = '1.5rem';
        minimizeBtn.style.cursor = 'pointer';
        minimizeBtn.style.padding = '0 5px';

        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapse();
        });

        this.expandedHeader.appendChild(titleSpan);
        this.expandedHeader.appendChild(minimizeBtn);

        this.editorContainerWrapper.appendChild(this.expandedHeader);

        // Create Editor Container
        this.editorContainer = document.createElement('div');
        this.editorContainer.id = 'editor-container-' + Math.random().toString(36).substr(2, 9);
        this.editorContainer.style.flex = '1';
        this.editorContainer.style.backgroundColor = '#fff';
        this.editorContainerWrapper.appendChild(this.editorContainer);

        // Create/Initialize Quill
        this.initializeEditor();
    }

    collapse() {
        if (!this.isExpanded) return;

        // Save content
        if (this.quillEditor) {
            this.savedContent = this.quillEditor.root.innerHTML;
            this.persistNote();
        }

        this.isExpanded = false;
        this.element.classList.remove('expanded');

        // Destroy Quill and clear DOM
        this.quillEditor = null;
        this.editorContainer = null;
        this.editorContainerWrapper.innerHTML = '';

        // Hide editor wrapper
        this.editorContainerWrapper.style.display = 'none';

        // Show preview
        this.updateDisplay();
        this.mainDisplay.style.display = 'block';
    }

    /**
     * Called when the widget settings modal is opened.
     * @returns {HTMLElement} The controls overlay.
     */
    getControls() {
        // Only returns management controls
        return this.controlsOverlay;
    }

    /**
     * Initializes the Quill editor.
     */
    onSettingsOpen() {
        // No longer initializing editor in settings modal
    }

    onSettingsClose() {
        // Settings modal is just for management now.
        // If we allowed title editing there, we would save it here.
    }

    initializeEditor() {
        if (!this.editorContainer) return;

        // Double check container exists in DOM
        const container = document.getElementById(this.editorContainer.id);
        if (!container) return;

        if (this.quillEditor) return; // Already initialized

        this.quillEditor = new Quill(container, {
            theme: 'snow',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    ['link', 'clean']
                ]
            }
        });

        // Load content
        if (this.savedContent) {
            this.quillEditor.root.innerHTML = this.savedContent;
        }

        // Focus
        this.quillEditor.focus();
    }

    updateDisplay() {
        if (this.display) {
            // Strip HTML for preview or keep simple formatting?
            // Requirement: "shows a compact preview (e.g., the note's title and first few characters)"
            // We'll use the HTML content but truncated, or text content.
            // Using innerHTML allows some formatting to show through which is nice.
            // But let's limit the height via CSS.
            this.display.innerHTML = this.savedContent || '<em style="color:#888;">Click to add a note...</em>';
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
        // If currently editing, save first
        if (this.isExpanded && this.quillEditor) {
             this.savedContent = this.quillEditor.root.innerHTML;
        }

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
        // Don't persist immediately on load to avoid spamming storage events
    }

    generateNoteId() {
        return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
}
