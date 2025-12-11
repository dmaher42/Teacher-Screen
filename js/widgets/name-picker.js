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

        // --- Create Display Section ---
        this.mainDisplay = document.createElement('div');
        this.mainDisplay.className = 'widget-display';
        this.mainDisplay.title = 'Click to pick a name';
        this.mainDisplay.style.cursor = 'pointer';
        this.mainDisplay.style.flexDirection = 'column'; // Allow stacking if needed

        this.display = document.createElement('div');
        this.display.className = 'name-picker-display';
        this.display.textContent = 'Click to pick';
        // Remove default border/padding from display class if it conflicts with widget-display
        this.display.style.border = 'none';
        this.display.style.background = 'transparent';
        this.display.style.fontSize = '1.5rem';

        this.mainDisplay.appendChild(this.display);

        this.handlePickRequest = () => {
            if (this.names && this.names.length === 0 && this.originalNames && this.originalNames.length > 0) {
                 this.reset();
            } else {
                 this.pickRandom();
            }
        };

        // Add click handler to the main display for the primary action
        this.mainDisplay.addEventListener('click', this.handlePickRequest);

        // --- Create Controls Section ---
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.style.display = 'none'; // Initially hidden
        this.helpText.textContent = 'Click the tile to pick a name. Use settings to manage groups and names.';

        // Group selection controls
        this.groupControls = document.createElement('div');
        this.groupControls.className = 'name-picker-group-controls';
        this.groupControls.style.marginBottom = '10px';

        const groupLabel = document.createElement('label');
        groupLabel.textContent = 'Current Group: ';

        this.groupSelect = document.createElement('select');
        this.groupSelect.setAttribute('aria-label', 'Select name group');
        this.groupSelect.style.marginBottom = '5px';
        this.groupSelect.addEventListener('change', (event) => this.switchGroup(event.target.value));

        groupLabel.appendChild(this.groupSelect);

        this.groupActionButtons = document.createElement('div');
        this.groupActionButtons.className = 'button-group';

        this.addGroupButton = document.createElement('button');
        this.addGroupButton.textContent = 'Add Group';
        this.addGroupButton.className = 'control-button';
        this.addGroupButton.setAttribute('aria-label', 'Add group');
        this.addGroupButton.addEventListener('click', () => this.addGroup());

        this.deleteGroupButton = document.createElement('button');
        this.deleteGroupButton.textContent = 'Delete Group';
        this.deleteGroupButton.className = 'control-button';
        this.deleteGroupButton.setAttribute('aria-label', 'Delete current group');
        this.deleteGroupButton.addEventListener('click', () => this.deleteGroup());

        this.groupActionButtons.appendChild(this.addGroupButton);
        this.groupActionButtons.appendChild(this.deleteGroupButton);

        this.groupControls.appendChild(groupLabel);
        this.groupControls.appendChild(this.groupActionButtons);

        // Import/Export controls
        this.importExportControls = document.createElement('div');
        this.importExportControls.className = 'name-picker-import-export';
        this.importExportControls.style.marginBottom = '10px';

        this.importButton = document.createElement('button');
        this.importButton.textContent = 'Import Names';
        this.importButton.className = 'control-button';
        this.importButton.setAttribute('aria-label', 'Import names');
        this.importButton.addEventListener('click', () => this.fileInput.click());

        this.importSpinner = document.createElement('span');
        this.importSpinner.className = 'inline-spinner';
        this.importSpinner.setAttribute('aria-hidden', 'true');
        this.importSpinner.style.display = 'none';
        this.importButton.appendChild(this.importSpinner);

        this.exportButton = document.createElement('button');
        this.exportButton.textContent = 'Export Names';
        this.exportButton.className = 'control-button';
        this.exportButton.setAttribute('aria-label', 'Export names');
        this.exportButton.addEventListener('click', () => this.exportNames());

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.txt,.csv';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', (event) => this.importNames(event));

        const ieButtonGroup = document.createElement('div');
        ieButtonGroup.className = 'button-group';
        ieButtonGroup.appendChild(this.importButton);
        ieButtonGroup.appendChild(this.exportButton);

        this.importExportControls.appendChild(ieButtonGroup);
        this.importExportControls.appendChild(this.fileInput);

        // Pick Button (Optional in settings, but useful fallback)
        this.pickButton = document.createElement('button');
        this.pickButton.className = 'control-button pick-button';
        this.pickButton.textContent = 'Pick a Name';
        this.pickButton.style.width = '100%';
        this.pickButton.style.marginTop = '10px';
        this.pickButton.setAttribute('aria-label', 'Pick a name');
        this.pickButton.addEventListener('click', this.handlePickRequest);

        this.status = document.createElement('div');
        this.status.className = 'widget-status';
        this.status.style.marginTop = '10px';
        this.status.textContent = 'Pick a name to begin.';

        // Assemble controls overlay
        this.controlsOverlay.appendChild(this.helpText);
        this.controlsOverlay.appendChild(this.groupControls);
        this.controlsOverlay.appendChild(document.createElement('hr')); // Visual separator
        this.controlsOverlay.appendChild(this.importExportControls);
        this.controlsOverlay.appendChild(this.pickButton);
        this.controlsOverlay.appendChild(this.status);

        // Assemble the widget
        this.element.appendChild(this.mainDisplay);
        this.element.appendChild(this.status);

        const controlBar = document.createElement('div');
        controlBar.className = 'widget-control-bar';

        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions';
        this.inlinePickButton = document.createElement('button');
        this.inlinePickButton.className = 'control-button pick-button';
        this.inlinePickButton.textContent = 'Pick a Name';
        this.inlinePickButton.addEventListener('click', this.handlePickRequest);
        primaryActions.appendChild(this.inlinePickButton);

        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'control-button';
        resetButton.textContent = 'Reset List';
        resetButton.title = 'Reset remaining names';
        resetButton.addEventListener('click', () => this.reset());
        secondaryActions.appendChild(resetButton);

        controlBar.append(primaryActions, secondaryActions);
        this.element.appendChild(controlBar);

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
                this.display.textContent = selectedName;
                this.lastPicked = selectedName;
                this.setStatus(`Picked ${selectedName}. ${groupData.names.length} remaining.`);

                // If all names have been picked, change button to reset
                if (groupData.names.length === 0) {
                    this.pickButton.textContent = 'Reset List';
                    this.mainDisplay.title = 'Click to Reset';
                }
            }
        }, 80);
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
            // Restore last picked name to display if list isn't reset
            // But if list was reset, updateDisplayState sets "Click to pick"
            // If we have a last picked name and it's NOT in the current list, we might show it?
            // Simpler: Just show click to pick or the result if user left it there.
            // But logic in pickRandom removed it from names.
            // If data.names matches logic...
            // Let's just trust updateDisplayState.
             if (this.lastPicked) this.display.textContent = this.lastPicked;
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
            if (groupData.originalNames.length === 0) {
                 this.display.textContent = 'Empty List';
                 this.mainDisplay.title = 'Add names in settings';
                 this.pickButton.textContent = 'List Empty';
                 this.pickButton.disabled = true;
            } else {
                 this.display.textContent = 'All Picked';
                 this.mainDisplay.title = 'Click to Reset';
                 this.pickButton.textContent = 'Reset List';
                 this.pickButton.disabled = false;
            }

            const statusMessage = groupData.originalNames.length === 0
                ? 'List is empty. Import or add names to begin.'
                : 'All names have been picked. Reset to start over.';
            this.setStatus(statusMessage, 'warning');
        } else {
            this.display.textContent = 'Click to pick';
            this.mainDisplay.title = 'Click to pick a name';
            this.pickButton.textContent = 'Pick a Name';
            this.pickButton.disabled = false;

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
