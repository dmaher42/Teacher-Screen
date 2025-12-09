/**
 * Name Picker Widget Class
 * Creates a widget to randomly pick names from a list.
 */
class NamePickerWidget {
    static modalInitialized = false;
    static modalElements = null;

    /**
     * Constructor for NamePickerWidget.
     */
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'name-picker-widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Click Pick a Name to spin through the list. When all names are chosen, reset the list to start over.';

        // Create controls container
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls';

        // Group selection controls
        this.groupControls = document.createElement('div');
        this.groupControls.className = 'name-picker-group-controls';

        this.groupSelect = document.createElement('select');
        this.groupSelect.setAttribute('aria-label', 'Select name group');
        this.groupSelect.addEventListener('change', (event) => this.switchGroup(event.target.value));

        this.addGroupButton = document.createElement('button');
        this.addGroupButton.textContent = 'Add Group';
        this.addGroupButton.setAttribute('aria-label', 'Add group');
        this.addGroupButton.addEventListener('click', () => this.addGroup());

        this.deleteGroupButton = document.createElement('button');
        this.deleteGroupButton.textContent = 'Delete Group';
        this.deleteGroupButton.setAttribute('aria-label', 'Delete current group');
        this.deleteGroupButton.addEventListener('click', () => this.deleteGroup());

        this.groupControls.appendChild(this.groupSelect);
        this.groupControls.appendChild(this.addGroupButton);
        this.groupControls.appendChild(this.deleteGroupButton);

        // Import/Export controls
        this.importExportControls = document.createElement('div');
        this.importExportControls.className = 'name-picker-import-export';

        this.importButton = document.createElement('button');
        this.importButton.textContent = 'Import';
        this.importButton.setAttribute('aria-label', 'Import names');
        this.importButton.addEventListener('click', () => this.fileInput.click());

        this.importSpinner = document.createElement('span');
        this.importSpinner.className = 'inline-spinner';
        this.importSpinner.setAttribute('aria-hidden', 'true');
        this.importSpinner.style.display = 'none';
        this.importButton.appendChild(this.importSpinner);

        this.exportButton = document.createElement('button');
        this.exportButton.textContent = 'Export';
        this.exportButton.setAttribute('aria-label', 'Export names');
        this.exportButton.addEventListener('click', () => this.exportNames());

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.txt,.csv';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', (event) => this.importNames(event));

        this.importExportControls.appendChild(this.importButton);
        this.importExportControls.appendChild(this.exportButton);
        this.importExportControls.appendChild(this.fileInput);

        // Create the name display
        this.display = document.createElement('div');
        this.display.className = 'name-picker-display';
        this.display.textContent = 'Click to pick a name';

        // Create the control button
        this.pickButton = document.createElement('button');
        this.pickButton.className = 'pick-button';
        this.pickButton.textContent = 'Pick a Name';
        this.pickButton.setAttribute('aria-label', 'Pick a name');

        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.textContent = 'Pick a name to begin.';

        // Assemble controls overlay
        this.controlsOverlay.appendChild(this.helpText);
        this.controlsOverlay.appendChild(this.groupControls);
        this.controlsOverlay.appendChild(this.importExportControls);
        this.controlsOverlay.appendChild(this.pickButton); // Pick button also moved to settings? Or kept in display?
        // User asked for "Widgets are simple displays by default. Hovering over a widget reveals a small settings icon. Clicking this icon opens a modal overlay... with that widget's controls."
        // For NamePicker, the "Pick" button is the main interaction. It should probably remain on the widget display or be available in both?
        // "Widgets are simple displays by default."
        // A simple display for a name picker is the name.
        // If I move the pick button to settings, I have to open settings to pick a name. That might be annoying.
        // BUT, the request says "Clicking this icon opens a modal overlay ... with that widget's controls."
        // Maybe "Pick" is considered a primary action, not a setting.
        // However, looking at the request: "e.g., Timer ... add a settings icon button ... controls to load."
        // Timer controls: Start, Stop, Reset.
        // If Timer start/stop are in modal, then NamePicker Pick should probably be in modal too, OR the user considers "Pick" the main function.
        // Let's stick to the prompt: "Widgets are simple displays by default."
        // I'll move the Pick button to the modal for now to strictly follow "simple display".
        // Actually, for a Name Picker, picking IS the display update.
        // Let's put Pick button in controlsOverlay.
        this.controlsOverlay.appendChild(this.status);

        // Assemble the widget
        this.element.appendChild(this.display);
        // this.element.appendChild(this.controlsOverlay); // Controls moved to modal

        // Name Picker state
        const defaultNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fiona', 'George', 'Hannah'];
        this.groups = {
            Default: {
                originalNames: defaultNames,
                names: [...defaultNames]
            }
        };
        this.currentGroup = 'Default';
        this.refreshGroupOptions();
        this.updateDisplayState();
        this.picking = false;
        this.lastPicked = null;
    }

    /**
     * Fetch and configure the shared modal used for adding items.
     */
    static getModalElements() {
        if (NamePickerWidget.modalInitialized) {
            return NamePickerWidget.modalElements;
        }

        const dialog = document.getElementById('name-entry-dialog');
        const input = document.getElementById('name-entry-input');
        const title = document.getElementById('name-entry-title');
        const confirmButton = document.getElementById('name-entry-confirm');

        if (!dialog || !input || !title || !confirmButton) {
            NamePickerWidget.modalInitialized = true;
            NamePickerWidget.modalElements = null;
            return null;
        }

        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                dialog.close();
            }
        });

        dialog.addEventListener('close', () => {
            input.value = '';
        });

        dialog.querySelectorAll('[data-close], .modal-close').forEach((btn) => {
            btn.addEventListener('click', () => dialog.close());
        });

        NamePickerWidget.modalInitialized = true;
        NamePickerWidget.modalElements = { dialog, input, title, confirmButton };
        return NamePickerWidget.modalElements;
    }

    /**
     * Start the random name picking animation.
     */
    pickRandom() {
        const groupData = this.getGroupData();
        if (!groupData || this.picking || groupData.names.length === 0) return;

        this.picking = true;
        let iterations = 0;
        const maxIterations = 20;

        const interval = setInterval(() => {
            const randomIndex = Math.floor(Math.random() * groupData.names.length);
            this.display.textContent = groupData.names[randomIndex];
            this.flashDisplay();
            iterations++;

            if (iterations >= maxIterations) {
                clearInterval(interval);
                this.picking = false;

                // Remove the selected name temporarily
                const selectedName = groupData.names.splice(randomIndex, 1)[0];
                this.display.textContent = `Selected: ${selectedName}`;
                this.lastPicked = selectedName;
                this.setStatus(`Picked ${selectedName}. ${groupData.names.length} remaining.`);

                // If all names have been picked, change button to reset
                if (groupData.names.length === 0) {
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
        const groupData = this.getGroupData();
        if (!groupData) return;

        groupData.names = [...groupData.originalNames];
        this.updateDisplayState();
        this.lastPicked = null;
        this.setStatus('Name list reset. Ready to pick again.');
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
            groups: this.groups,
            currentGroup: this.currentGroup,
            lastPicked: this.lastPicked
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        const defaultNames = ['Alice', 'Bob', 'Charlie'];
        this.groups = data.groups || {
            Default: {
                originalNames: defaultNames,
                names: [...defaultNames]
            }
        };
        this.currentGroup = data.currentGroup && this.groups[data.currentGroup] ? data.currentGroup : Object.keys(this.groups)[0];
        this.lastPicked = data.lastPicked || null;

        this.refreshGroupOptions();
        this.updateDisplayState();
        if (this.lastPicked) {
            this.setStatus(`Last picked: ${this.lastPicked}.`);
        }
    }

    /**
     * Get the data for the current group.
     */
    getGroupData() {
        return this.groups[this.currentGroup];
    }

    /**
     * Update the UI based on the current group's state.
     */
    updateDisplayState() {
        const groupData = this.getGroupData();
        if (!groupData) return;

        this.originalNames = groupData.originalNames;
        this.names = groupData.names;

        this.groupSelect.value = this.currentGroup;

        if (groupData.names.length === 0) {
            this.display.textContent = 'List is empty';
            this.pickButton.textContent = 'Reset List';
            this.pickButton.onclick = () => this.reset();
            const statusMessage = groupData.originalNames.length === 0
                ? 'List is empty. Import or add names to begin.'
                : 'All names have been picked. Reset to start over.';
            this.setStatus(statusMessage, 'warning');
        } else {
            this.display.textContent = 'Click to pick a name';
            this.pickButton.textContent = 'Pick a Name';
            this.pickButton.onclick = () => this.pickRandom();
            const remaining = groupData.names.length;
            this.setStatus(`${remaining} name${remaining === 1 ? '' : 's'} ready to pick.`);
        }

        this.deleteGroupButton.disabled = Object.keys(this.groups).length <= 1 || this.currentGroup === 'Default';
    }

    /**
     * Refresh the dropdown options for groups.
     */
    refreshGroupOptions() {
        this.groupSelect.innerHTML = '';
        Object.keys(this.groups).forEach((groupName) => {
            const option = document.createElement('option');
            option.value = groupName;
            option.textContent = groupName;
            this.groupSelect.appendChild(option);
        });
        this.groupSelect.value = this.currentGroup;
    }

    /**
     * Switch the active group.
     * @param {string} groupName
     */
    switchGroup(groupName) {
        if (!this.groups[groupName]) return;
        this.currentGroup = groupName;
        this.updateDisplayState();
    }

    /**
     * Open the shared modal and handle confirmation for creating a group.
     */
    showAddGroupModal() {
        const modal = NamePickerWidget.getModalElements();
        if (!modal) return false;

        const { dialog, input, title, confirmButton } = modal;
        title.textContent = 'Add New Group';
        input.placeholder = 'e.g., Period 3 - Science';
        input.value = '';

        const submitGroup = () => {
            if (!this.addGroupByName(input.value)) {
                return;
            }
            dialog.close();
        };

        confirmButton.onclick = (event) => {
            event.preventDefault();
            submitGroup();
        };

        input.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitGroup();
            } else if (event.key === 'Escape') {
                dialog.close();
            }
        };

        dialog.showModal();
        input.focus();
        return true;
    }

    /**
     * Add a new group with an empty name list.
     */
    addGroup() {
        const modalOpened = this.showAddGroupModal();
        if (modalOpened) return;

        const groupName = prompt('Enter a name for the new group:');
        this.addGroupByName(groupName);
    }

    /**
     * Create a group using the provided name if valid.
     * @param {string} groupName
     */
    addGroupByName(groupName) {
        const trimmedName = groupName ? groupName.trim() : '';
        if (!trimmedName) {
            this.setStatus('Please enter a group name to add.', 'warning');
            return false;
        }

        if (this.groups[trimmedName]) {
            this.setStatus('That group already exists.', 'warning');
            return false;
        }

        this.groups[trimmedName] = {
            originalNames: [],
            names: []
        };
        this.currentGroup = trimmedName;
        this.refreshGroupOptions();
        this.updateDisplayState();
        this.setStatus(`Added group "${trimmedName}".`);
        return true;
    }

    /**
     * Delete the currently selected group if allowed.
     */
    deleteGroup() {
        if (this.currentGroup === 'Default' || Object.keys(this.groups).length <= 1) return;

        delete this.groups[this.currentGroup];
        this.currentGroup = 'Default' in this.groups ? 'Default' : Object.keys(this.groups)[0];
        this.refreshGroupOptions();
        this.updateDisplayState();
    }

    /**
     * Import names from a text or CSV file into the current group.
     * @param {Event} event
     */
    importNames(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.showImportLoading(true);

        const reader = new FileReader();
        reader.onload = () => {
            const importedNames = reader.result
                .split(/\r?\n/)
                .map((name) => name.trim())
                .filter((name) => name.length > 0);

            const groupData = this.getGroupData();
            if (!groupData) {
                this.showImportLoading(false);
                return;
            }

            if (importedNames.length > 0) {
                // Replace the current group's names with the imported list
                groupData.originalNames = importedNames;
                groupData.names = [...importedNames];
                this.lastPicked = null;
                this.updateDisplayState();
                this.setStatus(`Imported ${importedNames.length} name(s).`);
            } else {
                this.setStatus('No names found in file. Please try again.', 'warning');
            }
            this.showImportLoading(false);
        };
        reader.onerror = () => {
            this.setStatus('Import failed. Please try again.', 'warning');
            this.showImportLoading(false);
        };
        reader.readAsText(file);

        // Reset the input so the same file can be selected again if needed
        event.target.value = '';
    }

    /**
     * Export the current group's names as a text file.
     */
    exportNames() {
        const groupData = this.getGroupData();
        if (!groupData) return;

        const blob = new Blob([groupData.originalNames.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.currentGroup || 'names'}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Update status text within the widget.
     * @param {string} message
     * @param {string} tone
     */
    setStatus(message, tone = 'success') {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.toggle('warning', tone === 'warning');
        this.status.classList.add('action-flash');
        setTimeout(() => this.status.classList.remove('action-flash'), 800);
    }

    /**
     * Add a quick flash to the display for feedback.
     */
    flashDisplay() {
        if (!this.display) return;
        this.display.classList.add('action-flash');
        setTimeout(() => this.display.classList.remove('action-flash'), 1000);
    }

    /**
     * Toggle a loading indicator during imports.
     * @param {boolean} isLoading
     */
    showImportLoading(isLoading) {
        if (this.importSpinner) {
            this.importSpinner.style.display = isLoading ? 'inline-block' : 'none';
        }
        this.importButton.disabled = isLoading;
        this.exportButton.disabled = isLoading;
    }

    toggleHelp() {
        const isVisible = this.helpText.style.display === 'block';
        this.helpText.style.display = isVisible ? 'none' : 'block';
    }
}
