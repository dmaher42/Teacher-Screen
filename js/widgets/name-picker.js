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

        // Assemble the widget
        this.content.appendChild(this.helpText);
        this.content.appendChild(this.groupControls);
        this.content.appendChild(this.importExportControls);
        this.content.appendChild(this.display);
        this.content.appendChild(this.pickButton);
        this.content.appendChild(this.status);
        this.element.appendChild(this.header);
        this.element.appendChild(this.content);

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
     * Add a new group with an empty name list.
     */
    addGroup() {
        const groupName = prompt('Enter a name for the new group:');
        const trimmedName = groupName ? groupName.trim() : '';
        if (!trimmedName || this.groups[trimmedName]) return;

        this.groups[trimmedName] = {
            originalNames: [],
            names: []
        };
        this.currentGroup = trimmedName;
        this.refreshGroupOptions();
        this.updateDisplayState();
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
}
