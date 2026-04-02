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
        this.layoutType = 'overlay';
        this.isExpanded = false;
        this.quillTextChangeHandler = null;

        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'notes-widget-content';
        this.element.style.height = '100%';
        this.element.style.width = '100%';
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';

        // --- Create Display Section (Preview) ---
        this.mainDisplay = document.createElement('div');
        this.mainDisplay.className = 'widget-display notes-main-display';
        this.mainDisplay.title = 'Open the quick note editor';
        this.mainDisplay.addEventListener('click', () => {
            if (!this.isExpanded) {
                this.expand();
            }
        });

        // Create the notes display preview
        this.display = document.createElement('div');
        this.display.className = 'notes-display';

        this.previewCard = document.createElement('div');
        this.previewCard.className = 'notes-preview-card';

        this.previewHeader = document.createElement('div');
        this.previewHeader.className = 'notes-preview-header';

        this.previewLabel = document.createElement('span');
        this.previewLabel.className = 'notes-preview-label';
        this.previewLabel.textContent = 'Quick Note';

        this.previewMeta = document.createElement('span');
        this.previewMeta.className = 'notes-preview-meta';

        this.previewHeader.appendChild(this.previewLabel);
        this.previewHeader.appendChild(this.previewMeta);

        this.previewTitle = document.createElement('div');
        this.previewTitle.className = 'notes-preview-title';

        this.previewSnippet = document.createElement('div');
        this.previewSnippet.className = 'notes-preview-snippet';

        this.previewCard.appendChild(this.previewHeader);
        this.previewCard.appendChild(this.previewTitle);
        this.previewCard.appendChild(this.previewSnippet);
        this.display.appendChild(this.previewCard);

        this.mainDisplay.appendChild(this.display);

        // --- Create Controls Section (Only for Settings Modal) ---
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls notes-settings-controls';

        // Header for settings
        const header = document.createElement('h3');
        header.textContent = 'Quick Note Settings';
        this.controlsOverlay.appendChild(header);

        // Link to Planner Button
        const linkBtn = document.createElement('button');
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
        deleteBtn.className = 'control-button modal-danger-btn';
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

        const titleBlock = document.createElement('div');
        titleBlock.className = 'notes-expanded-copy';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'notes-expanded-title';
        titleSpan.textContent = this.title || 'Editing note';

        const subtitleSpan = document.createElement('span');
        subtitleSpan.className = 'notes-expanded-subtitle';
        subtitleSpan.textContent = 'Write something useful, then save to keep it on the card and in the Notes library.';

        this.expandedMeta = document.createElement('span');
        this.expandedMeta.className = 'notes-expanded-meta';

        titleBlock.appendChild(titleSpan);
        titleBlock.appendChild(subtitleSpan);
        titleBlock.appendChild(this.expandedMeta);

        const minimizeBtn = document.createElement('button');
        minimizeBtn.innerHTML = '&times;';
        minimizeBtn.title = 'Save and Minimize';
        minimizeBtn.className = 'notes-close-button';

        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapse();
        });

        this.expandedHeader.appendChild(titleBlock);
        this.expandedHeader.appendChild(minimizeBtn);

        this.editorContainerWrapper.appendChild(this.expandedHeader);

        // Create Editor Container
        this.editorContainer = document.createElement('div');
        this.editorContainer.id = 'editor-container-' + Math.random().toString(36).substr(2, 9);
        this.editorContainer.style.flex = '1';
        this.editorContainer.style.backgroundColor = 'var(--card-background, #ffffff)';
        this.editorContainerWrapper.appendChild(this.editorContainer);

        const controlBar = document.createElement('div');
        controlBar.className = 'widget-control-bar';

        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions';
        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save and Close';
        saveButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapse();
        });
        primaryActions.appendChild(saveButton);

        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';
        const continueButton = document.createElement('button');
        continueButton.textContent = 'Keep Editing';
        continueButton.title = 'Keep writing';
        continueButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.quillEditor) {
                this.quillEditor.focus();
            }
        });
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '&times;';
        closeButton.title = 'Close editor';
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapse();
        });
        secondaryActions.appendChild(continueButton);
        secondaryActions.appendChild(closeButton);

        controlBar.append(primaryActions, secondaryActions);
        this.editorContainerWrapper.appendChild(controlBar);
        this.updateExpandedHeader();

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

        this.destroyEditor();
        this.resetEditorShell();

        // Show preview
        this.updateDisplay();
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

        this.quillTextChangeHandler = () => {
            if (!this.quillEditor) return;
            this.savedContent = this.quillEditor.root.innerHTML;
            this.title = this.getTitleFromContent();
            this.updatedAt = new Date().toISOString();
            this.updateDisplay();
            this.updateExpandedHeader();
            document.dispatchEvent(new CustomEvent('widgetChanged', { detail: { widget: this } }));
        };
        this.quillEditor.on('text-change', this.quillTextChangeHandler);

        // Load content
        if (this.savedContent) {
            this.quillEditor.root.innerHTML = this.savedContent;
        }

        // Focus
        this.quillEditor.focus();
    }

    updateDisplay() {
        if (!this.display) return;

        const hasContent = !!(this.savedContent && this.savedContent.trim());
        const previewTitle = this.title || this.getTitleFromContent();
        const previewSnippet = hasContent ? this.getPreviewSnippet(this.savedContent, 150) : 'Click to add a note.';

        this.previewTitle.textContent = previewTitle || 'Quick note';
        this.previewSnippet.textContent = previewSnippet;
        this.previewSnippet.classList.toggle('is-empty', !hasContent);
        this.previewMeta.textContent = hasContent ? `Updated ${this.formatUpdatedAt(this.updatedAt)}` : 'Tap to open';
        this.mainDisplay.title = hasContent
            ? `Open "${previewTitle}"`
            : 'Open the quick note editor';
        this.updateExpandedHeader();
    }

    updateExpandedHeader() {
        if (!this.expandedHeader) return;

        const titleNode = this.expandedHeader.querySelector('.notes-expanded-title');
        if (titleNode) {
            titleNode.textContent = this.title || 'Editing note';
        }

        if (this.expandedMeta) {
            const wordCount = this.getWordCount(this.savedContent);
            const wordLabel = wordCount === 1 ? '1 word' : `${wordCount} words`;
            this.expandedMeta.textContent = this.savedContent && this.savedContent.trim()
                ? `${wordLabel} | Updated ${this.formatUpdatedAt(this.updatedAt)}`
                : 'Nothing saved yet';
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
        this.updateDisplay();
    }

    getTitleFromContent() {
        const temp = document.createElement('div');
        temp.innerHTML = this.savedContent;
        const text = (temp.textContent || '').trim();
        if (!text) return 'Untitled Note';
        return text.split('\n')[0].slice(0, 80);
    }

    getPreviewSnippet(html, limit = 140) {
        const temp = document.createElement('div');
        temp.innerHTML = html || '';
        const text = (temp.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) {
            return 'Click to add a note.';
        }

        if (text.length <= limit) {
            return text;
        }

        return `${text.slice(0, limit).trimEnd()}…`;
    }

    getWordCount(html = '') {
        const temp = document.createElement('div');
        temp.innerHTML = html || '';
        const text = (temp.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) {
            return 0;
        }

        return text.split(/\s+/).filter(Boolean).length;
    }

    formatUpdatedAt(value) {
        if (!value) {
            return 'just now';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return 'just now';
        }

        return date.toLocaleString([], {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    }

    /**
     * Remove the widget from the DOM.
     */
    remove() {
        this.destroyEditor();
        this.resetEditorShell();
        this.element.remove();
        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    destroyEditor() {
        if (this.quillEditor && this.quillTextChangeHandler) {
            this.quillEditor.off('text-change', this.quillTextChangeHandler);
        }

        this.quillTextChangeHandler = null;
        this.quillEditor = null;
        this.editorContainer = null;
    }

    resetEditorShell() {
        this.isExpanded = false;
        this.element.classList.remove('expanded');
        this.editorContainerWrapper.innerHTML = '';
        this.editorContainerWrapper.style.display = 'none';
        this.mainDisplay.style.display = 'block';
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

    setEditable() {}

    generateNoteId() {
        return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
}
