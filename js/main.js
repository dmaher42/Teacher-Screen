import { WidgetRegistry, createWidgetByType, getRegistryWidgetKey, listAvailableWidgets } from './widgets/widget-registry.js';
import { eventBus } from './core/event-bus.js';
import {
    saveState,
    loadSavedState,
    captureLocalStorageState,
    restoreLocalStorageState,
    safeParseLocalStorage,
    isValidLayout,
    runMigrations
} from './services/state-manager.js';
import { startPresentationDiagnostics } from './utils/presentation-debug.js';

const mainResolvedAppMode = window.TeacherScreenAppMode ? window.TeacherScreenAppMode.APP_MODE : 'teacher';
console.log('Teacher-Screen App Mode:', mainResolvedAppMode);
const mainAppBus = window.TeacherScreenAppBus ? window.TeacherScreenAppBus.appBus : null;
const mainIsTeacherMode = window.TeacherScreenAppMode ? window.TeacherScreenAppMode.isTeacherMode : () => mainResolvedAppMode === 'teacher';

if (mainAppBus) {
    mainAppBus.init();
    console.log('AppBus initialised');
}

startPresentationDiagnostics();

if (mainAppBus && mainIsTeacherMode()) {
    window.testBroadcast = () => {
        mainAppBus.emit('debug-event', { message: 'Hello from teacher' });
    };
}

/**
 * Main application class for the Custom Classroom Screen.
 * This class initializes the app, manages widgets, and handles user interactions.
 */

function debounce(fn, delay = 250) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

const THEMES = [
    'theme-ocean',
    'theme-professional',
    'theme-light'
];

function applyTheme(themeName) {
    const nextTheme = THEMES.includes(themeName) ? themeName : 'theme-professional';
    THEMES.forEach(theme => document.body.classList.remove(theme));
    document.body.classList.add(nextTheme);
    localStorage.setItem('selectedTheme', nextTheme);
}

function resetAppState() {
    localStorage.removeItem('classroomScreenState');
    localStorage.removeItem('widgetLayout');
    localStorage.removeItem('background');
    localStorage.removeItem('selectedTheme');
}

const PROJECTOR_SYNC_TOKEN_KEY = 'teacher-screen-projector-sync-token';

function createProjectorSyncToken() {
    const makeToken = () => {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    };

    try {
        const stored = sessionStorage.getItem(PROJECTOR_SYNC_TOKEN_KEY);
        if (stored) {
            return stored;
        }

        const token = makeToken();
        sessionStorage.setItem(PROJECTOR_SYNC_TOKEN_KEY, token);
        return token;
    } catch (error) {
        console.warn('Unable to persist projector sync token', error);
        return makeToken();
    }
}

class ClassroomScreenApp {
    constructor() {
        // Windows / Documents
        this.teacherWindow = window.opener && !window.opener.closed ? window.opener : window;
        const teacherDocument = this.teacherWindow.document;

        // DOM Elements
        this.appContainer = document.getElementById('app-container');
        this.studentView = document.getElementById('student-view'); // Using the new landmark ID
        this.teacherPanel = document.getElementById('teacher-panel');
        this.widgetsContainer = document.getElementById('widgets-container');
        this.closeTeacherPanelBtn = document.getElementById('close-teacher-panel');
        this.themeSelector = document.getElementById('theme-selector');
        this.backgroundSelector = document.getElementById('background-selector');
        this.presetNameInput = document.getElementById('preset-name');
        this.presetListElement = document.getElementById('preset-list');
        this.helpDialog = document.getElementById('help-dialog');
        this.tourDialog = document.getElementById('tour-dialog');
        this.fab = document.getElementById('add-widget-btn');
        this.widgetModal = document.getElementById('widget-modal');
        this.widgetSettingsModal = this.ensureWidgetSettingsModal(teacherDocument);
        this.navTabs = document.querySelectorAll('.nav-tab');
        this.panelBackdrop = document.querySelector('.panel-backdrop');
        this.widgetSelectorButtons = [];
        this.importDialog = document.getElementById('import-dialog');
        this.importJsonInput = document.getElementById('import-json-input');
        this.importSummary = document.getElementById('import-summary');
        this.confirmImportButton = document.getElementById('confirm-import');
        this.nameEntryDialog = document.getElementById('name-entry-dialog');
        this.presetClassInput = document.getElementById('preset-class-name');
        this.presetPeriodInput = document.getElementById('preset-period');
        this.presetClassFilterInput = document.getElementById('preset-class-filter');
        this.presetPeriodFilterSelect = document.getElementById('preset-period-filter');
        this.layoutPresetSelect = document.getElementById('layout-preset');
        this.applyLayoutPresetButton = document.getElementById('apply-layout-preset');
        this.reduceMotionToggle = document.getElementById('reduce-motion-toggle');
        this.savedNotesListElement = document.getElementById('saved-notes-list');
        this.savedNotesEmptyState = document.getElementById('saved-notes-empty');
        this.layoutNameInput = document.getElementById('layout-name-input');
        this.saveLayoutButton = document.getElementById('save-layout-btn');
        this.savedLayoutsList = document.getElementById('saved-layouts-list');
        this.plannerModal = document.getElementById('planner-modal');
        this.plannerModalCloseBtn = this.plannerModal ? this.plannerModal.querySelector('.modal-close-btn') : null;
        this.plannerGrid = document.getElementById('planner-calendar-grid');

        this.agendaModal = document.getElementById('agenda-modal');
        this.agendaList = document.getElementById('agenda-list');
        this.agendaModalCloseBtn = this.agendaModal ? this.agendaModal.querySelector('.modal-close-btn') : null;

        // App State
        this.widgets = [];
        this.isTeacherPanelOpen = false;
        this.presetsKey = 'classroomLayoutPresets';
        this.presets = [];
        this.hasSavedState = !!localStorage.getItem('classroomScreenState');
        this.lessonPlanEditor = null;
        this.appVersion = '2.3.0'; // Version for state management
        this.schemaVersion = 1; // Numeric schema version for data migrations
        this.savedNotes = [];
        this.scheduleStorageKey = 'teacherScreenSchedule';
        this.noteIdToLink = null;
        this.projectorSyncToken = createProjectorSyncToken();
        window.__TeacherProjectorSyncToken = this.projectorSyncToken;

        this.projectorChannel = new BroadcastChannel('teacher-screen-sync');
        this.eventBusSubscriptions = [];

        this.handleWidgetRemovedEvent = (payload) => {
            if (payload && payload.widget) {
                this.handleWidgetRemoved(payload.widget);
            }
        };

        // Managers
        this.saveState = debounce(this.saveState.bind(this), 300);

        const layoutHost = this.widgetsContainer || this.studentView;
        this.layoutManager = new LayoutManager(layoutHost);
        this.layoutManager.setEditable(true);
        this.layoutManager.onLayoutChange = (payload) => {
            if (payload && payload.type === 'widget-update') {
                this.applyProjectorLayoutDelta(payload, 'projector');
                eventBus.emit('widget:moved', { payload, source: 'projector' });
                return;
            }
            eventBus.emit('layout:updated', { source: 'teacher', payload });
        };
        this.backgroundManager = new BackgroundManager(this.studentView);

        this.themes = [
            { name: 'Professional', id: 'theme-professional', swatch: '#6366f1' },
            { name: 'Ocean', id: 'theme-ocean', swatch: '#38bdf8' },
            { name: 'Light', id: 'theme-light', swatch: '#2563eb' }
        ];

        this.defaultPresets = [
            {
                name: 'Default',
                className: '',
                period: '',
                theme: 'theme-professional',
                background: {
                    type: 'gradient',
                    value: 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)'
                },
                layout: { widgets: [] },
                lessonPlan: null
            },
            {
                name: 'Focus Mode',
                className: 'All Classes',
                period: 'Afternoon',
                theme: 'theme-ocean',
                background: {
                    type: 'solid',
                    value: '#1a1a1a'
                },
                layout: { widgets: [{ type: 'TimerWidget', id: 'widget-1', position: { x: 10, y: 10 }, size: { width: 300, height: 200 } }] },
                lessonPlan: null
            }
        ];
    }

    ensureWidgetSettingsModal(hostDocument) {
        // Always attach the settings modal to the teacher window so it never renders on the projector.
        let modal = hostDocument.getElementById('widget-settings-modal');

        if (modal) {
            return modal;
        }

        modal = document.getElementById('widget-settings-modal');

        if (modal && hostDocument !== document) {
            hostDocument.body.appendChild(modal);
        }

        return modal;
    }

    init() {
        this.setupInternalEventBus();
        this.setupEventListeners();
        this.initLessonPlanner();

        const noteToLink = localStorage.getItem('noteToLink');
        if (noteToLink) {
            this.noteIdToLink = noteToLink;
            localStorage.removeItem('noteToLink');
            setTimeout(() => {
                this.showNotification("A note is ready to be linked. Click a time slot.");
                this.openPlannerModal();
            }, 500);
        }

        try {
            this.loadSavedState();
        } catch (error) {
            console.error('State restore failed. Resetting application state.', error);
            resetAppState();
        }
        this.backgroundManager.init();
        this.layoutManager.init();
        this.updateProjectorVisibility();
        this.setupPresetControls();
        this.renderBackgroundSelector();

        const savedTheme = localStorage.getItem('selectedTheme') || 'theme-professional';
        this.switchTheme(savedTheme);

        this.renderThemeSelector();
        this.renderWidgetModal();
        this.displaySavedLayouts();
        this.initializeSavedNotes();

        if (this.widgets.length === 0) {
            this.addWidget('timer');
        }

        this.showWelcomeTourIfNeeded();

        const savedRM = localStorage.getItem('reduceMotion');
        if (savedRM === '1') {
            document.documentElement.style.setProperty('--reduce-motion', 1);
            if (this.reduceMotionToggle) this.reduceMotionToggle.checked = true;
        }

        this.updateProjectorVisibility();
    }

    setupInternalEventBus() {
        this.subscribeToEventBus('widget:removed', ({ widget }) => {
            this.handleWidgetRemoved(widget);
        });

        this.subscribeToEventBus('timer:started', ({ minutes, showNotification = true } = {}) => {
            if (!Number.isFinite(minutes) || minutes <= 0) {
                return;
            }

            if (showNotification) {
                this.showNotification(`Timer started for ${Math.round(minutes * 100) / 100} minutes.`);
            }
        });

        this.subscribeToEventBus('timer:stopped', ({ showNotification = true } = {}) => {
            if (showNotification) {
                this.showNotification('Timer stopped.');
            }
        });

        this.subscribeToEventBus('layout:updated', ({ source = 'teacher' } = {}) => {
            this.saveState(source);
        });

    }

    subscribeToEventBus(eventName, handler) {
        eventBus.on(eventName, handler);
        this.eventBusSubscriptions.push({ eventName, handler });
    }

    setupEventListeners() {
        if (this.reduceMotionToggle) {
            this.reduceMotionToggle.addEventListener('change', () => {
                const value = this.reduceMotionToggle.checked ? 1 : 0;
                document.documentElement.style.setProperty('--reduce-motion', value);
                localStorage.setItem('reduceMotion', value);
            });
        }

        this.projectorChannel.onmessage = (event) => {
            const message = event.data || {};
            if (this.projectorSyncToken && message.syncToken !== this.projectorSyncToken) {
                return;
            }

            if (message.type === 'request-sync') {
                const state = this.buildStateSnapshot();
                this.projectorChannel.postMessage({
                    type: 'layout-update',
                    state,
                    source: 'teacher',
                    syncToken: this.projectorSyncToken
                });
                return;
            }

            if (message.type === 'layout-delta-from-projector' && message.source === 'projector' && message.delta) {
                this.applyProjectorLayoutDelta(message.delta, 'teacher');
                return;
            }

            if (message.type === 'layout-update-from-projector' && message.source === 'projector' && message.layout) {
                this.applyProjectorLayoutUpdate(message.layout);
            }
        };

        window.addEventListener('storage', () => {
            this.updateProjectorVisibility();
        });


        if (this.plannerModalCloseBtn) {
            this.plannerModalCloseBtn.addEventListener('click', () => this.closePlannerModal());
        }

        if (this.plannerModal) {
            this.plannerModal.addEventListener('click', (event) => {
                if (event.target === this.plannerModal) {
                    this.closePlannerModal();
                }
            });
        }


        if (this.agendaModalCloseBtn) {
            this.agendaModalCloseBtn.addEventListener('click', () => this.closeAgendaModal());
        }

        if (this.agendaModal) {
            this.agendaModal.addEventListener('click', (event) => {
                if (event.target === this.agendaModal) {
                    this.closeAgendaModal();
                }
            });
        }

        if (this.agendaList) {
            this.agendaList.addEventListener('click', (event) => {
                const button = event.target.closest('button');
                if (!button || !button.dataset.layoutName) return;
                this.loadLayout(button.dataset.layoutName);
                this.closeAgendaModal();
            });
        }

        if (this.saveLayoutButton) {
            this.saveLayoutButton.addEventListener('click', () => this.saveLayoutFromModal());
        }

        if (this.savedLayoutsList) {
            this.savedLayoutsList.addEventListener('click', (event) => {
                const targetButton = event.target.closest('button');
                if (!targetButton) return;

                const action = targetButton.dataset.action;
                const name = targetButton.dataset.name;

                if (!name) return;

                if (action === 'load') this.loadLayout(name);
                if (action === 'delete') this.deleteLayout(name);
            });
        }

        if (this.plannerGrid) {
            this.plannerGrid.addEventListener('click', (event) => {
                const slot = event.target.closest('.planner-slot');
                if (!slot || !slot.dataset.datetime) return;
                this.showDropdownInSlot(slot);
            });
        }

        // Navigation and Panel
        this.navTabs.forEach(tab => tab.addEventListener('click', () => this.handleNavClick(tab.dataset.tab)));
        this.closeTeacherPanelBtn.addEventListener('click', () => this.toggleTeacherPanel(false));
        this.panelBackdrop.addEventListener('click', () => this.toggleTeacherPanel(false));

        // FAB and Modals
        const addBtn = document.getElementById('add-widget-btn');

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                console.log('Add widget clicked');
                this.openWidgetPicker();
            });
            console.log('Add widget button handler attached');
        }
        this.widgetModal.querySelector('.modal-close').addEventListener('click', () => this.closeDialog(this.widgetModal));
        this.setupDialogControls();

        this.initializeWidgetSelector();

        // Accordion Cards
        const detailsElements = document.querySelectorAll('.control-card details');
        detailsElements.forEach(details => {
            details.addEventListener('toggle', () => {
                if (details.open) {
                    detailsElements.forEach(otherDetails => {
                        if (otherDetails !== details) {
                            otherDetails.open = false;
                        }
                    });
                }
            });
        });

        // Other controls...
        document.getElementById('start-timer').addEventListener('click', () => this.startTimerFromControls());
        document.getElementById('stop-timer').addEventListener('click', () => this.stopTimerFromControls());

        // Widget Settings Modal Logic
        document.addEventListener('openWidgetSettings', (e) => this.openWidgetSettings(e.detail.widget));

        const settingsModalCloseBtn = this.widgetSettingsModal.querySelector('.modal-close-btn');
        if (settingsModalCloseBtn) {
            settingsModalCloseBtn.addEventListener('click', () => this.closeWidgetSettings());
        }

        this.widgetSettingsModal.addEventListener('click', (e) => {
            if (e.target === this.widgetSettingsModal) {
                this.closeWidgetSettings();
            }
        });

        // New Timer Presets (5, 10, 15 min)
        const preset5 = document.getElementById('timer-preset-5');
        if (preset5) {
            preset5.addEventListener('click', () => {
                document.getElementById('timer-hours').value = 0;
                document.getElementById('timer-minutes').value = 5;
                document.getElementById('timer-seconds').value = 0;
                this.startTimerFromControls();
            });
        }

        const preset10 = document.getElementById('timer-preset-10');
        if (preset10) {
            preset10.addEventListener('click', () => {
                document.getElementById('timer-hours').value = 0;
                document.getElementById('timer-minutes').value = 10;
                document.getElementById('timer-seconds').value = 0;
                this.startTimerFromControls();
            });
        }

        const preset15 = document.getElementById('timer-preset-15');
        if (preset15) {
            preset15.addEventListener('click', () => {
                document.getElementById('timer-hours').value = 0;
                document.getElementById('timer-minutes').value = 15;
                document.getElementById('timer-seconds').value = 0;
                this.startTimerFromControls();
            });
        }

        document.getElementById('reset-layout').addEventListener('click', () => this.resetLayout());
        document.getElementById('save-preset').addEventListener('click', () => this.savePreset());
        eventBus.on('widget:removed', this.handleWidgetRemovedEvent);
        document.addEventListener('widgetRemoved', (event) => this.handleWidgetRemoved(event.detail.widget));

        // Request Open Planner
        document.addEventListener('requestOpenPlanner', () => {
            this.closeWidgetSettings();
            this.openPlannerModal();
        });

        // Export/Import
        document.getElementById('export-layout').addEventListener('click', () => this.handleExportLayout());
        document.getElementById('import-layout').addEventListener('click', () => this.openDialog(this.importDialog));
        this.confirmImportButton.addEventListener('click', () => this.handleConfirmImport());

        // Preset Filters
        this.presetClassFilterInput.addEventListener('input', () => this.renderPresetList());
        this.presetPeriodFilterSelect.addEventListener('change', () => this.renderPresetList());

        if (this.applyLayoutPresetButton) {
            this.applyLayoutPresetButton.addEventListener('click', () => this.applyLayoutPreset());
        }

    }

    handleNavClick(tab) {
        eventBus.emit('scene:changed', { tab });

        // Update tab states
        this.navTabs.forEach(t => {
            const isSelected = t.dataset.tab === tab;
            t.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            if (isSelected) t.classList.add('active');
            else t.classList.remove('active');
        });

        // Show corresponding panel, hide others
        // We use the ID convention: {tab}-view
        const viewId = `${tab}-view`;
        document.querySelectorAll('.view').forEach(view => {
            if (view.id === viewId) {
                view.hidden = false;
            } else {
                view.hidden = true;
            }
        });

        if (tab === 'notes') {
            this.renderSavedNotesList();
        }

        // Teacher Panel Logic
        if (tab === 'classroom') {
            // Ensure student view is ready
            this.toggleTeacherPanel(true);
        } else {
            // For other views, close the teacher panel or keep it?
            // Usually dashboard etc might not need the floating teacher panel.
            // But let's close it to focus on the content, unless designed otherwise.
            this.toggleTeacherPanel(false);

            // If it's a placeholder view, we might still show the notification
            // but now we have actual DOM elements showing "Coming soon".
            // So the notification is optional or redundant.
            // I'll keep the notification for feedback if it's empty.
            if (tab !== 'classroom') {
                 // this.showNotification(`${tab.charAt(0).toUpperCase() + tab.slice(1)} view active`);
            }
        }
    }

    initializeSavedNotes() {
        if (window.SavedNotesStore && typeof window.SavedNotesStore.getAll === 'function') {
            this.savedNotes = window.SavedNotesStore.getAll();
        }

        if (this.savedNotesListElement) {
            this.savedNotesListElement.addEventListener('click', (event) => {
                const actionButton = event.target.closest('[data-note-action]');
                if (!actionButton) return;

                const noteId = actionButton.dataset.noteId;
                const action = actionButton.dataset.noteAction;
                if (!noteId || !action) return;

                if (action === 'open') this.openSavedNote(noteId);
                if (action === 'delete') this.deleteSavedNote(noteId);
            });
        }

        document.addEventListener('savedNotesUpdated', (event) => {
            this.savedNotes = event.detail?.notes || (window.SavedNotesStore?.getAll?.() || []);
            this.renderSavedNotesList();
        });

        this.renderSavedNotesList();
    }

    toggleTeacherPanel(forceState = null) {
        this.isTeacherPanelOpen = forceState !== null ? forceState : !this.isTeacherPanelOpen;
        this.teacherPanel.classList.toggle('open', this.isTeacherPanelOpen);
        this.panelBackdrop.classList.toggle('visible', this.isTeacherPanelOpen);
        this.studentView.classList.toggle('panel-open', this.isTeacherPanelOpen);
    }

    initializeWidgetSelector() {
        const selector = document.getElementById('widget-selector');
        if (!selector) return;

        selector.innerHTML = '';
        Object.entries(WidgetRegistry).forEach(([key, widget]) => {
            this.createToolbarButton(widget.icon, widget.label, key, selector);
        });

        this.widgetSelectorButtons = Array.from(selector.querySelectorAll('.widget-selector-btn'));

        document.addEventListener('click', (event) => {
            const widgetButton = event.target.closest('.widget-selector-btn');
            if (!widgetButton || !this.widgetSelectorButtons.includes(widgetButton)) return;

            const widgetType = widgetButton.dataset.widget;
            if (!widgetType) return;

            this.openWidgetPicker(widgetType);
        });
    }

    createToolbarButton(icon, name, key, container) {
        const button = document.createElement('button');
        button.className = 'widget-selector-btn';
        button.dataset.widget = key;
        button.type = 'button';
        button.setAttribute('aria-label', name);

        const iconSpan = document.createElement('span');
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.textContent = icon;

        const label = document.createElement('span');
        label.className = 'visually-hidden';
        label.textContent = name;

        button.appendChild(iconSpan);
        button.appendChild(label);
        container.appendChild(button);
    }

    setActiveWidgetButton(type) {
        if (!this.widgetSelectorButtons || !this.widgetSelectorButtons.length) return;
        const targetButton = this.widgetSelectorButtons.find((btn) => btn.dataset.widget === type);
        this.widgetSelectorButtons.forEach((btn) => {
            btn.classList.toggle('active', btn === targetButton);
        });
    }

    renderSavedNotesList() {
        if (!this.savedNotesListElement) return;

        this.savedNotesListElement.innerHTML = '';
        const emptyState = this.savedNotesEmptyState;
        const notes = Array.isArray(this.savedNotes) ? [...this.savedNotes] : [];

        if (!notes.length) {
            if (emptyState) {
                emptyState.hidden = false;
                this.savedNotesListElement.appendChild(emptyState);
            }
            return;
        }

        if (emptyState) {
            emptyState.hidden = true;
        }

        notes
            .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
            .forEach((note) => {
                const card = document.createElement('div');
                card.className = 'saved-note-card';
                card.setAttribute('role', 'listitem');

                const meta = document.createElement('div');
                meta.className = 'saved-note-meta';

                const title = document.createElement('span');
                title.className = 'saved-note-title';
                title.textContent = note.title || 'Untitled Note';

                const updated = document.createElement('span');
                updated.className = 'saved-note-updated';
                updated.textContent = `Updated ${this.formatNoteDate(note.updatedAt)}`;

                const preview = document.createElement('p');
                preview.className = 'saved-note-preview';
                preview.textContent = this.getNotePreviewText(note.content);

                meta.appendChild(title);
                meta.appendChild(updated);
                meta.appendChild(preview);

                const actions = document.createElement('div');
                actions.className = 'saved-note-actions';

                const openBtn = document.createElement('button');
                openBtn.type = 'button';
                openBtn.className = 'control-button';
                openBtn.dataset.noteAction = 'open';
                openBtn.dataset.noteId = note.id;
                openBtn.textContent = 'Open';

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'control-button';
                deleteBtn.dataset.noteAction = 'delete';
                deleteBtn.dataset.noteId = note.id;
                deleteBtn.textContent = 'Delete';

                actions.appendChild(openBtn);
                actions.appendChild(deleteBtn);

                card.appendChild(meta);
                card.appendChild(actions);

                this.savedNotesListElement.appendChild(card);
            });
    }

    openSavedNote(noteId) {
        if (!window.SavedNotesStore) return;
        const note = window.SavedNotesStore.get(noteId);
        if (!note) {
            this.showNotification('Note could not be found.', 'error');
            return;
        }

        this.handleNavClick('classroom');

        const existing = this.layoutManager.widgets.find((info) => info.widget instanceof NotesWidget && info.widget.noteId === noteId);
        let widget = existing ? existing.widget : null;

        if (!widget) {
            widget = new NotesWidget(note);
            this.layoutManager.addWidget(widget);
            this.widgets.push(widget);
        } else {
            widget.applySavedNote(note);
        }

        this.saveState();
        this.showNotification(`Opened note "${note.title || 'Note'}"`);
    }

    deleteSavedNote(noteId) {
        if (!window.SavedNotesStore) return;
        const note = window.SavedNotesStore.get(noteId);
        if (!note) return;

        if (!confirm(`Delete note "${note.title || 'Untitled Note'}"?`)) return;

        window.SavedNotesStore.delete(noteId);
        this.savedNotes = window.SavedNotesStore.getAll();
        this.renderSavedNotesList();
        this.showNotification('Note deleted.');
    }

    getNotePreviewText(content = '') {
        const temp = document.createElement('div');
        temp.innerHTML = content || '';
        const text = (temp.textContent || '').trim();
        if (!text) return 'No content saved yet.';
        return text.length > 180 ? `${text.slice(0, 177)}...` : text;
    }

    formatNoteDate(dateValue) {
        if (!dateValue) return 'just now';
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return 'recently';
        return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }

    addWidget(type) {
        let widget;
        try {
            widget = createWidgetByType(type);
            if (!widget) {
                throw new Error(`Unknown widget type: ${type}`);
            }

            const widgetElement = this.layoutManager.addWidget(widget);
            this.widgets.push(widget);
            this.setActiveWidgetButton(type);
            eventBus.emit('widget:created', { type, widget, element: widgetElement });
            
            const placeholder = this.widgetsContainer.querySelector('.widget-placeholder');
            if (placeholder) placeholder.remove();
            
            this.saveState();
            this.showNotification(`${this.getFriendlyWidgetName(type)} Added!`);
            this.closeDialog(this.widgetModal);
        } catch (error) {
            console.error('Failed to add widget:', error);
            this.showNotification('Failed to add widget.', 'error');
        }
    }

    getFriendlyWidgetName(type) {
        const key = getRegistryWidgetKey(type);
        return WidgetRegistry[key]?.label || 'Widget';
    }

    renderWidgetModal(focusWidgetType = null) {
        const container = this.widgetModal.querySelector('.widget-categories');
        container.innerHTML = '';

        const categories = {};
        listAvailableWidgets().forEach((widget) => {
            const categoryName = widget.category || 'Secondary';
            if (!categories[categoryName]) {
                categories[categoryName] = [];
            }
            categories[categoryName].push(widget);
        });

        Object.entries(categories).forEach(([categoryName, widgets]) => {
            const section = document.createElement('section');
            section.className = 'widget-category-section';

            const heading = document.createElement('h4');
            heading.className = 'widget-category-title';
            heading.textContent = categoryName;
            section.appendChild(heading);

            widgets.forEach((widget) => {
                const button = document.createElement('button');
                button.className = 'widget-category-btn';
                button.dataset.widget = widget.key;
                if (focusWidgetType && widget.key === focusWidgetType) {
                    button.classList.add('is-target');
                }
                button.innerHTML = `
                    <span class="category-icon" aria-hidden="true">${widget.icon || '🧩'}</span>
                    <span>${widget.label}</span>
                `;
                button.addEventListener('click', () => this.addWidget(widget.key));
                section.appendChild(button);
            });

            container.appendChild(section);
        });
    }

    renderThemeSelector() {
        this.themeSelector.innerHTML = '';
        this.themes.forEach(theme => {
            const label = document.createElement('label');
            label.className = 'theme-option';
            label.innerHTML = `
                <input type="radio" name="theme" value="${theme.id}">
                <span class="theme-swatch" style="background-color: ${theme.swatch};"></span>
                <span>${theme.name}</span>
            `;
            const input = label.querySelector('input');
            input.checked = document.body.classList.contains(theme.id);
            input.addEventListener('change', () => {
                this.switchTheme(theme.id);
                this.saveState();
            });
            this.themeSelector.appendChild(label);
        });
    }

    switchTheme(themeName) {
        applyTheme(themeName);
    }

    getLayoutStorageKey(name) {
        return `layouts_${name}`;
    }

    openPlannerModal() {
        if (!this.plannerModal) return;
        this.generateWeeklyPlanner();
        this.plannerModal.classList.add('visible');
    }

    closePlannerModal() {
        if (!this.plannerModal) return;
        this.plannerModal.classList.remove('visible');
    }

    getSchedule() {
        try {
            const raw = localStorage.getItem(this.scheduleStorageKey) || '{}';
            const parsed = JSON.parse(raw);
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        } catch (error) {
            console.warn('Unable to parse schedule, resetting.', error);
            return {};
        }
    }

    saveSchedule(schedule) {
        localStorage.setItem(this.scheduleStorageKey, JSON.stringify(schedule));
    }

    getWeekStart(date = new Date()) {
        const start = new Date(date);
        const day = start.getDay();
        const diffToMonday = (day + 6) % 7;
        start.setDate(start.getDate() - diffToMonday);
        start.setHours(0, 0, 0, 0);
        return start;
    }

    formatSlotKeyForDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}-${hour}:${minutes}`;
    }

    showDropdownInSlot(slotElement) {
        const targetDatetime = slotElement.dataset.datetime;

        // Refresh grid to close any other open dropdowns and restore their text
        this.generateWeeklyPlanner();

        const newSlot = this.plannerGrid.querySelector(`.planner-slot[data-datetime="${targetDatetime}"]`);
        if (!newSlot) return;

        const savedLayoutKeys = Object.keys(localStorage).filter(key => key.startsWith('layouts_'));
        const layoutNames = savedLayoutKeys.map(key => key.replace('layouts_', '')).sort();

        // Container
        const wrapper = document.createElement('div');
        wrapper.className = 'recurrence-wrapper';
        wrapper.addEventListener('click', (e) => e.stopPropagation());

        const select = document.createElement('select');
        select.className = 'layout-dropdown';

        const defaultOption = document.createElement('option');
        defaultOption.text = 'Select a layout...';
        defaultOption.value = '';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        select.appendChild(defaultOption);

        layoutNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.text = name;
            select.appendChild(option);
        });

        const clearOption = document.createElement('option');
        clearOption.value = '__CLEAR__';
        clearOption.text = 'Clear Slot';
        select.appendChild(clearOption);

        const cancelOption = document.createElement('option');
        cancelOption.value = '__CANCEL__';
        cancelOption.text = 'Cancel';
        select.appendChild(cancelOption);

        select.addEventListener('change', (e) => {
            const selectedValue = e.target.value;

            if (selectedValue === '__CANCEL__') {
                this.generateWeeklyPlanner();
                return;
            }

            const schedule = this.getSchedule();

            if (selectedValue === '__CLEAR__') {
                delete schedule[targetDatetime];
            } else {
                schedule[targetDatetime] = {
                    layout: selectedValue,
                    noteId: this.noteIdToLink || null
                };

                if (this.noteIdToLink) {
                    this.showNotification('Note linked to slot.');
                    this.noteIdToLink = null;
                }
            }

            this.saveSchedule(schedule);

            // If clearing, close immediately. Otherwise keep open for recurrence options.
            if (selectedValue === '__CLEAR__') {
                this.generateWeeklyPlanner();
            }
        });

        wrapper.appendChild(select);

        // Recurrence Options
        const recurrenceDiv = document.createElement('div');
        recurrenceDiv.className = 'recurrence-options';

        const header = document.createElement('div');
        header.className = 'recurrence-header';
        header.textContent = 'Repeat weekly on:';
        recurrenceDiv.appendChild(header);

        const daysDiv = document.createElement('div');
        daysDiv.className = 'recurrence-days';
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const dayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday' };

        days.forEach(day => {
            const label = document.createElement('label');
            label.className = 'day-checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = dayMap[day];

            // Auto-check the current day of the slot
            // Safe way: parse date manually to avoid timezone issues with Date(string)
            const parts = targetDatetime.split('-');
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const d = parseInt(parts[2]);
            const checkDate = new Date(year, month, d);

            if (checkDate.toLocaleDateString('en-US', { weekday: 'long' }) === dayMap[day]) {
                checkbox.checked = true;
            }

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(day));
            daysDiv.appendChild(label);
        });
        recurrenceDiv.appendChild(daysDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'recurrence-actions';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'save-recurring-btn';
        saveBtn.textContent = 'Save Recurring';

        saveBtn.addEventListener('click', () => {
            const selectedLayout = select.value;
            if (!selectedLayout || selectedLayout === '__CLEAR__' || selectedLayout === '__CANCEL__') {
                this.showNotification('Please select a layout first.', 'warning');
                return;
            }

            const checkedDays = Array.from(daysDiv.querySelectorAll('input:checked')).map(cb => cb.value);
            if (checkedDays.length === 0) {
                this.showNotification('Select at least one day.', 'warning');
                return;
            }

            const time = targetDatetime.split('-').pop(); // HH:MM

            const newRecurring = {
                layoutName: selectedLayout,
                days: checkedDays,
                time: time
            };

            const recurringLessons = safeParseLocalStorage('teacherScreenRecurringLessons') || [];
            recurringLessons.push(newRecurring);
            localStorage.setItem('teacherScreenRecurringLessons', JSON.stringify(recurringLessons));

            this.showNotification('Recurring lesson saved.');
            this.generateWeeklyPlanner();
        });

        actionsDiv.appendChild(saveBtn);
        recurrenceDiv.appendChild(actionsDiv);

        wrapper.appendChild(recurrenceDiv);

        newSlot.textContent = '';
        newSlot.appendChild(wrapper);
        select.focus();

        // Click outside listener to close
        const clickOutsideHandler = (e) => {
            if (!newSlot.contains(e.target)) {
                document.removeEventListener('click', clickOutsideHandler);
                if (document.body.contains(newSlot)) {
                    this.generateWeeklyPlanner();
                }
            }
        };

        setTimeout(() => {
            document.addEventListener('click', clickOutsideHandler);
        }, 0);
    }

    generateWeeklyPlanner() {
        if (!this.plannerGrid) return;

        const schedule = this.getSchedule();
        const recurringLessons = safeParseLocalStorage('teacherScreenRecurringLessons') || [];
        const startOfWeek = this.getWeekStart();
        const days = Array.from({ length: 5 }, (_, index) => {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + index);
            return date;
        });
        const hours = Array.from({ length: 9 }, (_, index) => 8 + index);

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const timeHeader = document.createElement('th');
        timeHeader.textContent = 'Time';
        headerRow.appendChild(timeHeader);

        days.forEach((date) => {
            const th = document.createElement('th');
            th.textContent = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        hours.forEach((hour) => {
            const row = document.createElement('tr');
            const timeCell = document.createElement('th');
            timeCell.textContent = `${String(hour).padStart(2, '0')}:00`;
            row.appendChild(timeCell);

            days.forEach((date) => {
                const slotDate = new Date(date);
                slotDate.setHours(hour, 0, 0, 0);
                const slotKey = this.formatSlotKeyForDate(slotDate);

                const cell = document.createElement('td');
                cell.classList.add('planner-slot');
                cell.dataset.datetime = slotKey;

                let entry = schedule[slotKey];
                let layoutName = (typeof entry === 'object' && entry !== null) ? entry.layout : entry;

                if (!layoutName) {
                    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
                    const timeString = `${String(hour).padStart(2, '0')}:00`;
                    const match = recurringLessons.find(r =>
                        r.days && r.days.includes(dayName) && r.time === timeString
                    );
                    if (match) {
                        layoutName = match.layoutName;
                    }
                }

                if (layoutName) {
                    cell.classList.add('scheduled');
                    cell.textContent = layoutName;
                } else {
                    cell.textContent = '—';
                }

                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);

        this.plannerGrid.innerHTML = '';
        this.plannerGrid.appendChild(table);
    }

    loadTodaysLesson() {
        const schedule = this.getSchedule();
        const recurringLessons = safeParseLocalStorage('teacherScreenRecurringLessons') || [];

        const now = new Date();
        now.setMinutes(0, 0, 0);
        const slotKey = this.formatSlotKeyForDate(now);

        let entry = schedule[slotKey];
        let layoutName = (typeof entry === 'object' && entry !== null) ? entry.layout : entry;

        if (!layoutName) {
            const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
            const hour = now.getHours();
            const timeString = `${String(hour).padStart(2, '0')}:00`;

            const match = recurringLessons.find(r =>
                r.days && r.days.includes(dayName) && r.time === timeString
            );

            if (match) {
                layoutName = match.layoutName;
            }
        }

        if (layoutName) {
            this.loadLayout(layoutName);
        } else {
            this.showNotification('No lesson scheduled for the current time.', 'warning');
        }
    }

    openAgendaModal() {
        if (!this.agendaModal) return;
        this.displayTodaysAgenda();
        this.agendaModal.classList.add('visible');
    }

    closeAgendaModal() {
        if (!this.agendaModal) return;
        this.agendaModal.classList.remove('visible');
    }

    displayTodaysAgenda() {
        if (!this.agendaList) return;

        const schedule = this.getSchedule();
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const datePrefix = `${year}-${month}-${day}`;

        // Find lessons for today
        const todaysLessons = Object.entries(schedule)
            .filter(([key, layoutName]) => key.startsWith(datePrefix))
            .sort((a, b) => a[0].localeCompare(b[0])); // Sort by time

        this.agendaList.innerHTML = '';

        if (todaysLessons.length === 0) {
            this.agendaList.innerHTML = '<div class="agenda-empty">No lessons scheduled for today.</div>';
            return;
        }

        todaysLessons.forEach(([key, value]) => {
            const layoutName = (typeof value === 'object' && value !== null) ? value.layout : value;

            // Key format: YYYY-MM-DD-HH:MM
            const timePart = key.split('-').pop(); // HH:MM

            const item = document.createElement('div');
            item.className = 'agenda-item';

            const infoDiv = document.createElement('div');
            infoDiv.style.display = 'flex';
            infoDiv.style.alignItems = 'center';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'agenda-time';
            timeSpan.textContent = timePart;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'agenda-layout-name';
            nameSpan.textContent = layoutName;

            infoDiv.appendChild(timeSpan);
            infoDiv.appendChild(nameSpan);

            const loadButton = document.createElement('button');
            loadButton.className = 'control-button modal-primary';
            loadButton.textContent = 'Load';
            loadButton.dataset.layoutName = layoutName;

            item.appendChild(infoDiv);
            item.appendChild(loadButton);

            this.agendaList.appendChild(item);
        });
    }

    saveLayoutFromModal() {
        const layoutName = this.layoutNameInput ? this.layoutNameInput.value.trim() : '';
        if (!layoutName) {
            this.showNotification('Please enter a layout name.', 'warning');
            return;
        }

        const layoutData = this.layoutManager.serialize();

        const payload = {
            name: layoutName,
            savedAt: Date.now(),
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: layoutData,
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null,
            storage: captureLocalStorageState()
        };

        localStorage.setItem(this.getLayoutStorageKey(layoutName), JSON.stringify(payload));
        this.displaySavedLayouts();
        if (this.layoutNameInput) {
            this.layoutNameInput.value = '';
        }
        this.showNotification('Layout saved.');
    }

    loadLayout(layoutName) {
        const raw = localStorage.getItem(this.getLayoutStorageKey(layoutName));
        if (!raw) {
            this.showNotification('Layout not found.', 'warning');
            return;
        }

        try {
            const data = JSON.parse(raw);

            if (data.storage) {
                restoreLocalStorageState(data.storage);
            }

            if (data.theme) {
                this.switchTheme(data.theme);
            }

            if (data.background) {
                this.backgroundManager.deserialize(data.background);
            }

            const normalizedLayout = data.layout && Array.isArray(data.layout.widgets)
                ? {
                    ...data.layout,
                    widgets: data.layout.widgets.map((widgetData) => {
                        if (!widgetData || typeof widgetData !== 'object') {
                            return widgetData;
                        }

                        if (typeof widgetData.visibleOnProjector === 'boolean') {
                            return widgetData;
                        }

                        if (typeof widgetData.isVisible === 'boolean') {
                            return {
                                ...widgetData,
                                visibleOnProjector: widgetData.isVisible
                            };
                        }

                        return widgetData;
                    })
                }
                : data.layout;

            this.widgets = [];
            if (normalizedLayout && normalizedLayout.widgets) {
                this.layoutManager.deserialize(normalizedLayout, (widgetData) => {
                    const widget = createWidgetByType(widgetData.type);
                    if (widget) {
                        this.widgets.push(widget);
                    }
                    return widget;
                });
            }

            if (data.lessonPlan && this.lessonPlanEditor) {
                this.lessonPlanEditor.setContents(data.lessonPlan);
            }

            this.updateProjectorVisibility();
            this.saveState();
            this.showNotification(`Loaded layout "${layoutName}".`);
        } catch (error) {
            console.error('Failed to load layout', error);
            this.showNotification('Unable to load that layout.', 'error');
        }
    }

    deleteLayout(layoutName) {
        if (!confirm(`Delete layout "${layoutName}"?`)) return;
        localStorage.removeItem(this.getLayoutStorageKey(layoutName));
        this.displaySavedLayouts();
        this.showNotification(`Deleted layout "${layoutName}".`);
    }

    displaySavedLayouts() {
        if (!this.savedLayoutsList) return;

        const layoutKeys = Object.keys(localStorage).filter(key => key.startsWith('layouts_'));
        if (layoutKeys.length === 0) {
            this.savedLayoutsList.innerHTML = '<p>No saved layouts yet. Create one to get started.</p>';
            return;
        }

        const fragment = document.createDocumentFragment();
        layoutKeys.sort().forEach((key) => {
            const raw = localStorage.getItem(key);
            if (!raw) return;

            let data;
            try {
                data = JSON.parse(raw);
            } catch (e) {
                return;
            }

            const name = key.replace('layouts_', '');
            const item = document.createElement('div');
            item.className = 'saved-layout-item';

            const meta = document.createElement('div');
            meta.className = 'saved-layout-meta';
            const title = document.createElement('strong');
            title.textContent = name;
            const date = document.createElement('span');
            date.textContent = data?.savedAt ? `Saved ${new Date(data.savedAt).toLocaleString()}` : 'Saved layout';
            meta.appendChild(title);
            meta.appendChild(date);

            const actions = document.createElement('div');
            actions.className = 'saved-layout-actions';

            const loadBtn = document.createElement('button');
            loadBtn.className = 'control-button modal-primary';
            loadBtn.dataset.action = 'load';
            loadBtn.dataset.name = name;
            loadBtn.textContent = 'Load';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'control-button';
            deleteBtn.dataset.action = 'delete';
            deleteBtn.dataset.name = name;
            deleteBtn.textContent = 'Delete';

            actions.appendChild(loadBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(meta);
            item.appendChild(actions);

            fragment.appendChild(item);
        });

        this.savedLayoutsList.innerHTML = '';
        this.savedLayoutsList.appendChild(fragment);
    }

    buildStateSnapshot() {
        return {
            version: this.appVersion,
            schemaVersion: this.schemaVersion,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
    }

    saveState(source = 'teacher') {
        const state = this.buildStateSnapshot();
        saveState(state, {
            source,
            projectorChannel: this.projectorChannel,
            syncToken: this.projectorSyncToken
        });
    }

    applyProjectorLayoutDelta(delta, source = 'teacher') {
        if (!delta || delta.type !== 'widget-update') {
            return;
        }

        this.layoutManager.applyLayoutDelta(delta);
        this.saveState(source);

        if (source === 'teacher' && this.projectorChannel) {
            this.projectorChannel.postMessage({
                type: 'layout-delta',
                source: 'teacher',
                delta,
                syncToken: this.projectorSyncToken
            });
        }
    }


    applyProjectorLayoutUpdate(layout) {
        if (!layout || !Array.isArray(layout.widgets)) {
            return;
        }

        const existingState = safeParseLocalStorage('classroomScreenState');

        const mergedState = existingState && typeof existingState === 'object' ? existingState : this.buildStateSnapshot();
        mergedState.layout = layout;

        this.widgets = [];
        this.layoutManager.deserialize(layout, (widgetData) => {
                    const widget = createWidgetByType(widgetData.type);
                    if (widget) {
                        this.widgets.push(widget);
                    }
                    return widget;
        });

        this.updateProjectorVisibility();
        this.saveState();
        this.showNotification('Layout updated from projector.');
    }

    setupPresetControls() {
        const storedPresets = safeParseLocalStorage(this.presetsKey);
        this.presets = Array.isArray(storedPresets) ? storedPresets : [];

        this.presets.forEach((preset) => {
            preset.className = preset.className || '';
            preset.period = preset.period || '';
        });

        this.renderPresetList();
        this.renderLayoutPresetOptions();
    }

    savePresets() {
        localStorage.setItem(this.presetsKey, JSON.stringify(this.presets));
        this.renderLayoutPresetOptions();
    }

    renderLayoutPresetOptions() {
        if (!this.layoutPresetSelect) return;

        this.layoutPresetSelect.innerHTML = '<option value="">Select preset</option>';

        this.presets.forEach((preset) => {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name;
            this.layoutPresetSelect.appendChild(option);
        });
    }

    savePreset() {
        const name = this.presetNameInput ? this.presetNameInput.value.trim() : '';
        if (!name) {
            this.showNotification('Enter a preset name first.', 'error');
            return;
        }

        if (this.presets.some((preset) => preset.name === name)) {
            this.showNotification(`Preset "${name}" already exists. Use Overwrite.`, 'error');
            return;
        }

        const preset = {
            name,
            className: this.presetClassInput ? this.presetClassInput.value.trim() : '',
            period: this.presetPeriodInput ? this.presetPeriodInput.value.trim() : '',
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };

        this.presets.push(preset);
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Preset "${name}" saved.`);
    }

    loadPreset(name) {
        const preset = this.presets.find((item) => item.name === name);
        if (!preset) {
            this.showNotification('Preset not found.', 'error');
            return;
        }

        if (preset.theme) this.switchTheme(preset.theme);
        if (preset.background) this.backgroundManager.deserialize(preset.background);
        if (preset.lessonPlan && this.lessonPlanEditor) this.lessonPlanEditor.setContents(preset.lessonPlan);

        this.widgets = [];
        this.layoutManager.deserialize(preset.layout, (widgetData) => {
            const widget = createWidgetByType(widgetData.type);
            if (widget) {
                this.widgets.push(widget);
            }
            return widget;
        });

        this.updateProjectorVisibility();
        this.saveState();
        this.showNotification(`Preset "${preset.name}" loaded.`);
    }

    applyLayoutPreset() {
        if (!this.layoutPresetSelect) return;

        const selectedName = this.layoutPresetSelect.value;
        if (!selectedName) {
            this.showNotification('Select a preset first.', 'error');
            return;
        }

        this.loadPreset(selectedName);
    }

    overwritePreset(name) {
        if (this.presetNameInput) this.presetNameInput.value = name;

        const className = this.presetClassInput ? this.presetClassInput.value.trim() : '';
        const period = this.presetPeriodInput ? this.presetPeriodInput.value.trim() : '';

        const presetIndex = this.presets.findIndex(preset => preset.name === name);
        if (presetIndex === -1) {
            this.showNotification('Preset not found.', 'error');
            return;
        }
        this.presets[presetIndex] = {
            name,
            className,
            period,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Preset "${name}" overwritten.`);
    }

    deletePreset(name) {
        const presetIndex = this.presets.findIndex(preset => preset.name === name);
        if (presetIndex === -1) {
            this.showNotification('Preset not found.', 'error');
            return;
        }
        if (!confirm(`Delete preset "${name}"?`)) {
            return;
        }
        this.presets.splice(presetIndex, 1);
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Preset "${name}" deleted.`);
    }

    getSerializableState() {
        return {
            version: this.appVersion,
            schemaVersion: this.schemaVersion,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
    }

    handleExportLayout() {
        const exportPayload = {
            schemaVersion: this.schemaVersion,
            appVersion: this.appVersion,
            state: this.getSerializableState(),
            presets: this.presets || []
        };

        const jsonString = JSON.stringify(exportPayload, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'classroom-layout-presets.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('Layout and presets exported.');
    }

    handleConfirmImport() {
        const jsonString = this.importJsonInput.value;
        if (!jsonString) {
            this.importSummary.textContent = 'Error: Input is empty.';
            this.importSummary.style.color = 'red';
            return;
        }

        try {
            const parsed = JSON.parse(jsonString);

            if (typeof parsed.schemaVersion !== 'number' || !parsed.state || !Array.isArray(parsed.presets)) {
                throw new Error('Invalid JSON structure.');
            }

            let state = runMigrations(parsed.state, this.schemaVersion);

            const summary = `
                Ready to import:
                - ${parsed.presets.length} presets
                - ${state.layout?.widgets?.length || 0} widgets
                - Theme: ${state.theme || 'default'}
            `;
            this.importSummary.textContent = summary;
            this.importSummary.style.color = 'green';

            // Normalize imported presets
            parsed.presets.forEach(p => {
                p.className = p.className || '';
                p.period = p.period || '';
            });

            this.presets = parsed.presets;
            this.savePresets();
            this.renderPresetList();

            if (state.theme) this.switchTheme(state.theme);
            if (state.background) this.backgroundManager.deserialize(state.background);
            if (state.lessonPlan && this.lessonPlanEditor) this.lessonPlanEditor.setContents(state.lessonPlan);

            this.widgets = [];
            this.layoutManager.deserialize(state.layout, (widgetData) => {
                    const widget = createWidgetByType(widgetData.type);
                    if (widget) {
                        this.widgets.push(widget);
                    }
                    return widget;
            });

            this.updateProjectorVisibility();
            this.saveState();
            this.closeDialog(this.importDialog);
            this.showNotification('Layout and presets imported successfully.');

        } catch (error) {
            this.importSummary.textContent = `Error: ${error.message}`;
            this.importSummary.style.color = 'red';
            console.error('Import failed:', error);
        }
    }

    renderPresetList() {
        if (!this.presetListElement) return;

        const classFilter = this.presetClassFilterInput.value.toLowerCase();
        const periodFilter = this.presetPeriodFilterSelect.value.toLowerCase();

        const filteredPresets = this.presets.filter(preset => {
            const classNameMatch = !classFilter || (preset.className && preset.className.toLowerCase().includes(classFilter));
            const periodMatch = !periodFilter || (preset.period && preset.period.toLowerCase() === periodFilter);
            return classNameMatch && periodMatch;
        });

        this.presetListElement.innerHTML = '';
        if (filteredPresets.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.textContent = 'No presets match your filters.';
            this.presetListElement.appendChild(emptyState);
            return;
        }

        filteredPresets.forEach(preset => {
            const item = document.createElement('div');
            item.className = 'preset-item';

            const name = document.createElement('span');
            name.className = 'preset-name';
            name.textContent = preset.name;

            const subtext = document.createElement('span');
            subtext.className = 'preset-subtext';
            const classInfo = preset.className || 'No Class';
            const periodInfo = preset.period || 'Any Period';
            subtext.textContent = `${classInfo} — ${periodInfo}`;

            const mainInfo = document.createElement('div');
            mainInfo.className = 'preset-main-info';
            mainInfo.appendChild(name);
            mainInfo.appendChild(subtext);

            const actions = document.createElement('div');
            actions.className = 'preset-actions';

            const loadButton = document.createElement('button');
            loadButton.type = 'button';
            loadButton.className = 'control-button';
            loadButton.textContent = 'Load';
            loadButton.dataset.action = 'load';
            loadButton.dataset.name = preset.name;

            const overwriteButton = document.createElement('button');
            overwriteButton.type = 'button';
            overwriteButton.className = 'control-button';
            overwriteButton.textContent = 'Overwrite';
            overwriteButton.dataset.action = 'overwrite';
            overwriteButton.dataset.name = preset.name;

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'control-button';
            deleteButton.textContent = 'Delete';
            deleteButton.dataset.action = 'delete';
            deleteButton.dataset.name = preset.name;

            // Event delegation for preset actions
            item.addEventListener('click', (e) => {
                const button = e.target.closest('button');
                if (!button) return;

                const action = button.dataset.action;
                const presetName = button.dataset.name;

                if (action === 'load') this.loadPreset(presetName);
                if (action === 'overwrite') this.overwritePreset(presetName);
                if (action === 'delete') this.deletePreset(presetName);
            });

            actions.appendChild(loadButton);
            actions.appendChild(overwriteButton);
            actions.appendChild(deleteButton);

            item.appendChild(mainInfo);
            item.appendChild(actions);

            this.presetListElement.appendChild(item);
        });
    }

    loadSavedState() {
        loadSavedState({
            applyState: (state) => this.applyState(state),
            resetAppState,
            showNotification: (message) => this.showNotification(message),
            schemaVersion: this.schemaVersion
        });
    }

    applyState(state) {
        try {
            // Run migration pipeline
            state = runMigrations(state, this.schemaVersion);

            if (!isValidLayout(state.layout)) {
                console.warn('Invalid layout detected. Resetting layout state.');
                resetAppState();
                return;
            }

            // Restore theme
            if (state.theme) {
                this.switchTheme(state.theme);
            }

            // Restore background
            if (state.background) {
                this.backgroundManager.deserialize(state.background);
            }

            // Restore layout and widgets
            if (state.layout && state.layout.widgets) {
                this.widgets = [];
                this.layoutManager.deserialize(state.layout, (widgetData) => {
                    // This factory function recreates widgets from saved data
                    const widget = createWidgetByType(widgetData.type);
                    if (widget) {
                        this.widgets.push(widget);
                    }
                    return widget;
                });
                this.updateProjectorVisibility();
            }

            // Restore lesson plan
            if (state.lessonPlan && this.lessonPlanEditor) {
                this.lessonPlanEditor.setContents(state.lessonPlan);
            }
        } catch (err) {
            console.error('State load failed; resetting.', err);
            localStorage.removeItem('classroomScreenState');
            this.showNotification("Your previous layout was corrupted; reset to defaults.", "warning");
        }
    }

    resetLayout() {
        if (confirm('Are you sure you want to reset the layout? This will remove all widgets.')) {
            this.widgets = [];
            this.widgetsContainer.innerHTML = '<div class="widget-placeholder"><p>Add your first widget from the Teacher Controls!</p></div>';
            if (this.layoutManager) {
                this.layoutManager.widgets = [];
            }
            this.backgroundManager.reset();
            if (this.lessonPlanEditor) {
                this.lessonPlanEditor.setContents([]);
            }
            this.saveState();
            this.showNotification('Layout has been reset.');
        }
    }

    handleWidgetRemoved(widget) {
        if (!widget) return;
        this.widgets = this.widgets.filter(existing => existing !== widget);
        if (this.layoutManager && Array.isArray(this.layoutManager.widgets)) {
            this.layoutManager.widgets = this.layoutManager.widgets.filter(info => info.widget !== widget);
        }
        if (this.widgets.length === 0 && !this.widgetsContainer.querySelector('.widget-placeholder')) {
            this.widgetsContainer.innerHTML = '<div class="widget-placeholder"><p>Add your first widget from the Teacher Controls!</p></div>';
        }
        this.saveState();
    }

    startTimerFromControls() {
        const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (timerWidget) {
            const hours = parseInt(document.getElementById('timer-hours').value, 10) || 0;
            const minutes = parseInt(document.getElementById('timer-minutes').value, 10) || 0;
            const seconds = parseInt(document.getElementById('timer-seconds').value, 10) || 0;
            // The existing TimerWidget.start() takes minutes, or we need to update it to take arbitrary time?
            // The existing startTimerFromControls uses timerWidget.set(totalSeconds) which doesn't seem to exist in the TimerWidget code I read.
            // Let's re-read TimerWidget carefully. It has start(minutes). It has this.time = chosenMinutes * 60.
            // It does NOT have a set(seconds) method. The current implementation in main.js seems to be broken or relying on a different version?
            // "timerWidget.set(totalSeconds)" -> checking TimerWidget source again.
            // TimerWidget has start(minutes), tick(), stop(), notifyComplete(), etc. No set().
            // So I should fix this method as well while I am here, or at least implement the new one correctly.

            // Wait, looking at TimerWidget.start(minutes):
            // const customMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
            // ... this.time = chosenMinutes * 60;

            // The user input in teacher panel has HH:MM:SS.
            // If I want to support seconds, I might need to update TimerWidget to support starting with seconds or modify how I call it.
            // But my task is "Timer quick-preset buttons".

            // Let's implement startTimerPresetFromControls first.

            const totalMinutes = (hours * 60) + minutes + (seconds / 60);
            if (totalMinutes > 0) {
                eventBus.emit('timer:start', { widgetId: timerWidget.widgetId, minutes: totalMinutes });
            } else {
                this.showNotification('Please set a timer duration.', 'warning');
            }
        } else {
            this.showNotification('No timer widget found. Add one first!', 'error');
        }
    }

    startTimerPresetFromControls(minutes) {
        let timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (!timerWidget) {
            // "Finds first TimerWidget and calls widget.start(minutes)"
            // If none exists, maybe I should create one? The instructions say "Finds first TimerWidget".
            // I'll stick to finding. If not found, I'll notify.
            this.showNotification('No timer widget found. Add one first!', 'error');
            return;
        }

        eventBus.emit('timer:start', { widgetId: timerWidget.widgetId, minutes });
    }

    stopTimerFromControls() {
        const timerWidget = this.widgets.find(widget => widget instanceof TimerWidget);
        if (timerWidget) {
            eventBus.emit('timer:stop', { widgetId: timerWidget.widgetId });
        } else {
            this.showNotification('No timer widget found.', 'error');
        }
    }

    renderBackgroundSelector() {
        if (!this.backgroundSelector) return;
        this.backgroundSelector.innerHTML = '';
        const backgrounds = this.backgroundManager.getAvailableBackgrounds();

        for (const type in backgrounds) {
            backgrounds[type].forEach((value, index) => {
                const swatch = document.createElement('div');
                swatch.className = 'background-swatch';
                swatch.tabIndex = 0;
                swatch.setAttribute('role', 'button');
                swatch.setAttribute(
                    'aria-label',
                    type === 'solid'
                        ? `Solid background ${value}`
                        : type === 'gradient'
                            ? `Gradient background ${index + 1}`
                            : `Image background ${index + 1}`
                );

                if (type === 'solid') {
                    swatch.style.backgroundColor = value;
                } else if (type === 'gradient') {
                    swatch.style.backgroundImage = value;
                } else if (type === 'image') {
                    swatch.style.backgroundImage = `url(${value})`;
                    swatch.style.backgroundSize = 'cover';
                    swatch.style.backgroundPosition = 'center';
                }

                const applyBackground = () => {
                    this.backgroundManager.setBackground(type, value);
                    this.saveState();
                };

                swatch.addEventListener('click', applyBackground);
                swatch.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        applyBackground();
                    }
                });

                this.backgroundSelector.appendChild(swatch);
            });
        }
    }

    showNotification(message, type = 'success') {
        const existingNotification = document.querySelector('.notification-toast');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification-toast ${type}`;
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        notification.textContent = message;
        this.appContainer.appendChild(notification);

        // Announce to screen reader via live region
        const liveRegion = document.getElementById('live-region');
        if (liveRegion) {
            liveRegion.textContent = '';
            window.requestAnimationFrame(() => {
                liveRegion.textContent = message;
            });
        }

        void notification.offsetWidth;

        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    setupDialogControls() {
        const dialogs = [
            this.helpDialog,
            this.tourDialog,
            this.widgetModal,
            this.importDialog,
            this.nameEntryDialog
        ].filter(Boolean);
        dialogs.forEach((dialog) => {
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) {
                    this.closeDialog(dialog);
                }
            });

            dialog.querySelectorAll('[data-close], .modal-close').forEach((btn) => {
                btn.addEventListener('click', () => this.closeDialog(dialog));
            });
        });
    }

    openDialog(dialog) {
        if (!dialog) return;
        if (!dialog.open) {
            dialog.showModal();
        }
    }

    openWidgetPicker(focusWidgetType = null) {
        this.renderWidgetModal(focusWidgetType);
        this.openDialog(this.widgetModal);

        if (!focusWidgetType) return;

        window.requestAnimationFrame(() => {
            const target = this.widgetModal.querySelector(`.widget-category-btn[data-widget="${focusWidgetType}"]`);
            if (target && typeof target.focus === 'function') {
                target.focus({ preventScroll: true });
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        });
    }

    closeDialog(dialog) {
        if (dialog && dialog.open) {
            dialog.close();
        }
    }

    closeAllDialogs() {
        [this.helpDialog, this.tourDialog, this.widgetModal].forEach((dialog) => {
            if (dialog && dialog.open) {
                dialog.close();
            }
        });
    }

    showWelcomeTourIfNeeded() {
        const tourSeen = localStorage.getItem('welcomeTourSeen');
        if (this.hasSavedState || tourSeen) {
            return;
        }
        this.openDialog(this.tourDialog);
        localStorage.setItem('welcomeTourSeen', 'true');
    }

    initLessonPlanner() {
        if (document.getElementById('lesson-plan-editor')) {
            this.lessonPlanEditor = new Quill('#lesson-plan-editor', {
                theme: 'snow',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['link', 'image']
                    ]
                }
            });

            this.lessonPlanEditor.on('text-change', () => {
                this.saveState();
            });
        }
    }

    openWidgetSettings(widget) {
        if (!this.widgetSettingsModal) return;

        const modalBody = this.widgetSettingsModal.querySelector('.modal-body');
        const modalTitle = this.widgetSettingsModal.querySelector('.modal-title');

        if (!modalBody || !modalTitle) return;

        // Clear previous content
        modalBody.innerHTML = '';

        // Set Title
        modalTitle.textContent = `${widget.constructor.name.replace('Widget', '')} Settings`;

        // Get controls from the widget
        // We assume widgets have a 'controlsOverlay' property or a 'getControls' method
        // Based on TimerWidget analysis, it has 'controlsOverlay'.

        let controlsNode = null;
        if (typeof widget.getControls === 'function') {
            controlsNode = widget.getControls();
        } else if (widget.controlsOverlay) {
            controlsNode = widget.controlsOverlay;
        } else {
            // Fallback for widgets that haven't been refactored yet
            const p = document.createElement('p');
            p.textContent = 'Settings not available for this widget yet.';
            controlsNode = p;
        }

        // If controls are detached from widget, append them.
        // NOTE: Appending moves the node from its current location (if any) to the modal.
        // This is exactly what we want if it was hidden in the widget.
        if (controlsNode) {
            modalBody.appendChild(controlsNode);
        }

        // --- NEW: Add Common Controls (Close, Projector, Help) ---
        // Since we removed the header bar, we need to add these controls to the settings modal.

        const commonControls = document.createElement('div');
        commonControls.className = 'modal-common-controls';
        commonControls.style.marginTop = '20px';
        commonControls.style.paddingTop = '15px';
        commonControls.style.borderTop = '1px solid #ddd';
        commonControls.style.display = 'flex';
        commonControls.style.justifyContent = 'space-between';
        commonControls.style.alignItems = 'center';

        // Remove Widget Button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'control-button';
        removeBtn.textContent = 'Remove Widget';
        removeBtn.style.backgroundColor = '#e74c3c'; // Red-ish
        removeBtn.style.color = 'white';
        removeBtn.addEventListener('click', () => {
             this.layoutManager.removeWidget(widget);
             this.closeWidgetSettings();
        });

        // Toggle Projector Visibility
        const projectorToggle = document.createElement('label');
        projectorToggle.className = 'widget-settings-toggle';
        const widgetInfo = this.layoutManager.widgets.find(w => w.widget === widget);
        const isVisible = widgetInfo ? widgetInfo.visibleOnProjector : true;
        projectorToggle.innerHTML = `
            <input type="checkbox" id="projectorToggle" ${isVisible ? 'checked' : ''}>
            Show on projector
        `;
        const projectorToggleInput = projectorToggle.querySelector('input');
        if (projectorToggleInput) {
            projectorToggleInput.addEventListener('change', (event) => {
                if (!widgetInfo) return;
                widgetInfo.visibleOnProjector = event.target.checked;
                this.layoutManager.saveLayout();
                this.updateProjectorVisibility();
            });
        }

        // Help Button
        const helpBtn = document.createElement('button');
        helpBtn.className = 'control-button';
        helpBtn.textContent = 'Help / Info';
        helpBtn.addEventListener('click', () => {
             if (typeof widget.toggleHelp === 'function') {
                 widget.toggleHelp();
             } else {
                 alert('No help available for this widget.');
             }
        });

        const rightGroup = document.createElement('div');
        rightGroup.style.display = 'flex';
        rightGroup.style.gap = '10px';
        rightGroup.appendChild(helpBtn);
        rightGroup.appendChild(projectorToggle);

        commonControls.appendChild(removeBtn);
        commonControls.appendChild(rightGroup);

        modalBody.appendChild(commonControls);
        // ---------------------------------------------------------

        this.activeSettingsWidget = widget;
        this.widgetSettingsModal.classList.add('visible');

        // Delay widget-specific initialization until after the modal is visible.
        setTimeout(() => {
            if (this.activeSettingsWidget && typeof this.activeSettingsWidget.onSettingsOpen === 'function') {
                this.activeSettingsWidget.onSettingsOpen();
            }
        }, 150);
    }

    closeWidgetSettings() {
        if (!this.widgetSettingsModal) return;
        this.widgetSettingsModal.classList.remove('visible');

        // Optional: Move controls back to the widget?
        // Or just leave them detached until next open?
        // If we leave them detached, the widget instance still holds the reference 'controlsOverlay',
        // so it's fine. It just won't be in the DOM.

        // If the widget has a specific method to handle closing settings (e.g., to pause previews), call it.
        if (this.activeSettingsWidget && typeof this.activeSettingsWidget.onSettingsClose === 'function') {
            this.activeSettingsWidget.onSettingsClose();
        }

        this.saveState();
        this.activeSettingsWidget = null;
    }

    updateProjectorVisibility() {
        if (!this.layoutManager || !Array.isArray(this.layoutManager.widgets)) return;

        const isProjector = window.TeacherScreenAppMode
            ? window.TeacherScreenAppMode.isProjectorMode()
            : false;

        this.layoutManager.widgets.forEach((info) => {
            if (!info || !info.element) return;
            if (isProjector && info.visibleOnProjector === false) {
                info.element.style.display = 'none';
            } else {
                info.element.style.display = 'block';
            }
        });
    }
}

function startApp() {
    const studentMain = document.getElementById('student-view');

    if (!studentMain) {
        console.error('Layout container #student-view not found');
        return;
    }

    const app = new ClassroomScreenApp();
    app.init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
