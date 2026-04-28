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

const THEME_META_COLORS = {
    'theme-light': '#ffffff',
    'theme-ocean': '#0f172a',
    'theme-professional': '#111827'
};

function syncDocumentThemeColor(themeName) {
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', THEME_META_COLORS[themeName] || THEME_META_COLORS['theme-professional']);
    }
}

function applyTheme(themeName) {
    const nextTheme = THEMES.includes(themeName) ? themeName : 'theme-professional';
    THEMES.forEach(theme => document.body.classList.remove(theme));
    document.body.classList.add(nextTheme);
    document.documentElement.style.colorScheme = nextTheme === 'theme-light' ? 'light' : 'dark';
    syncDocumentThemeColor(nextTheme);
    localStorage.setItem('selectedTheme', nextTheme);
}

function resetAppState() {
    localStorage.removeItem('classroomScreenState');
    localStorage.removeItem('widgetLayout');
    localStorage.removeItem('background');
    localStorage.removeItem('selectedTheme');
    localStorage.removeItem('drawingBoardVisible');
}

const PROJECTOR_SYNC_TOKEN_KEY = 'teacher-screen-projector-sync-token';
const MEMORY_CUE_IMPORT_QUEUE_KEY = 'memoryCuePendingNoteImports';
const DEFAULT_PROJECT_NAME = 'Weekly Project';
const DEFAULT_PAGE_ID = 'page-1';
const DEFAULT_PAGE_NAME = 'Page 1';
const WIDGET_PICKER_SHORTCUTS = {
    q: 'quiz-game',
    r: 'reveal-manager',
    t: 'rich-text'
};

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

function isShortcutEditableTarget(target) {
    if (!target || !(target instanceof Element)) {
        return false;
    }

    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return true;
    }

    return target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
}

function cloneSerializableData(value) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (error) {
            // Fall through to JSON cloning for values that do not clone cleanly.
        }
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return value;
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
        this.currentProjectName = document.getElementById('current-project-name');
        this.currentProjectPageSummary = document.getElementById('current-project-page-summary');
        this.mainPagePrev = document.getElementById('main-page-prev');
        this.mainPageCurrent = document.getElementById('main-page-current');
        this.mainPageNext = document.getElementById('main-page-next');
        this.teacherCurrentProjectName = document.getElementById('teacher-current-project-name');
        this.teacherCurrentProjectPageSummary = document.getElementById('teacher-current-project-page-summary');
        this.teacherPageSwitcher = document.getElementById('teacher-page-switcher');
        this.newProjectButton = document.getElementById('new-project-btn');
        this.newPageButton = document.getElementById('new-page-btn');
        this.movePageLeftButton = document.getElementById('move-page-left-btn');
        this.movePageRightButton = document.getElementById('move-page-right-btn');
        this.duplicatePageButton = document.getElementById('duplicate-page-btn');
        this.renamePageButton = document.getElementById('rename-page-btn');
        this.deletePageButton = document.getElementById('delete-page-btn');
        this.helpDialog = document.getElementById('help-dialog');
        this.tourDialog = document.getElementById('tour-dialog');
        this.fab = document.getElementById('add-widget-btn');
        this.widgetModal = document.getElementById('widget-modal');
        this.widgetSettingsModal = this.ensureWidgetSettingsModal(teacherDocument);
        this.navTabs = document.querySelectorAll('.nav-tab');
        this.currentSectionName = document.getElementById('current-section-name');
        this.sectionsToggleButton = document.getElementById('sections-toggle');
        this.sectionsMenu = document.getElementById('sections-menu');
        this.manageScreensButton = document.getElementById('manage-screens-btn');
        this.panelBackdrop = document.querySelector('.panel-backdrop');
        this.importDialog = document.getElementById('import-dialog');
        this.importJsonInput = document.getElementById('import-json-input');
        this.importSummary = document.getElementById('import-summary');
        this.confirmImportButton = document.getElementById('confirm-import');
        this.nameEntryDialog = document.getElementById('name-entry-dialog');
        this.presetClassInput = document.getElementById('preset-class-name');
        this.presetPeriodInput = document.getElementById('preset-period');
        this.classProfileSelect = document.getElementById('class-profile-select');
        this.saveSnapshotButton = document.getElementById('save-snapshot-btn');
        this.presetClassFilterInput = document.getElementById('preset-class-filter');
        this.presetPeriodFilterSelect = document.getElementById('preset-period-filter');
        this.layoutPresetSelect = document.getElementById('layout-preset');
        this.applyLayoutPresetButton = document.getElementById('apply-layout-preset');
        this.reduceMotionToggle = document.getElementById('reduce-motion-toggle');
        this.savedNotesListElement = document.getElementById('saved-notes-list');
        this.savedNotesEmptyState = document.getElementById('saved-notes-empty');
        this.notesPanelSummary = document.getElementById('notes-panel-summary');
        this.exportAllNotesButton = document.getElementById('export-all-notes-memory-cue');
        this.layoutNameInput = document.getElementById('planner-layout-name-input');
        this.saveLayoutButton = document.getElementById('planner-save-layout-btn');
        this.savedLayoutsList = document.getElementById('saved-layouts-list');
        this.openWeeklyPlannerButton = document.getElementById('open-weekly-planner-btn');
        this.openAgendaButton = document.getElementById('open-agenda-btn');
        this.plannerModal = document.getElementById('planner-modal');
        this.plannerModalCloseBtn = this.plannerModal ? this.plannerModal.querySelector('.modal-close-btn') : null;
        this.plannerGrid = document.getElementById('planner-calendar-grid');
        this.timerStatusBadge = document.getElementById('timer-status-badge');
        this.timerStatusDisplay = document.getElementById('timer-status-display');
        this.timerStatusMeta = document.getElementById('timer-status-meta');
        this.resetTimerButton = document.getElementById('reset-timer');
        this.presentationStatusBadge = document.getElementById('presentation-status-badge');
        this.presentationStatusDisplay = document.getElementById('presentation-status-display');
        this.presentationStatusContext = document.getElementById('presentation-status-context');
        this.presentationStatusMeta = document.getElementById('presentation-status-meta');
        this.presentationLastButton = document.getElementById('presentation-last-btn');
        this.presentationSourceTypeSelect = document.getElementById('presentation-source-type');
        this.presentationSourceNameInput = document.getElementById('presentation-source-name');
        this.presentationSourceUrlInput = document.getElementById('presentation-source-url');
        this.presentationLinkHint = document.getElementById('presentation-link-hint');
        this.presentationLinkValidation = document.getElementById('presentation-link-validation');
        this.presentationSaveLinkButton = document.getElementById('presentation-save-link-btn');
        this.presentationOpenLinkButton = document.getElementById('presentation-open-link-btn');
        this.presentationOpenProjectorLinkButton = document.getElementById('presentation-open-projector-link-btn');
        this.presentationSavedSelect = document.getElementById('presentation-saved-select');
        this.presentationSavedHint = document.getElementById('presentation-saved-hint');
        this.presentationOpenSavedButton = document.getElementById('presentation-open-saved-btn');
        this.presentationOpenSavedProjectorButton = document.getElementById('presentation-open-saved-projector-btn');
        this.presentationRenameSavedButton = document.getElementById('presentation-rename-saved-btn');
        this.presentationDeleteSavedButton = document.getElementById('presentation-delete-saved-btn');
        this.presentationManageButton = document.getElementById('presentation-manage-btn');
        this.presentationProjectorButton = document.getElementById('presentation-projector-btn');
        this.presentationPrevButton = document.getElementById('presentation-prev-btn');
        this.presentationNextButton = document.getElementById('presentation-next-btn');

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
        this.projectState = this.getDefaultProjectState();
        this.widgetPickerStateKey = 'teacherScreenWidgetPickerState';
        this.quickAddWidgetKeys = ['rich-text', 'reveal-manager', 'timer', 'drawing-tool'];
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
        const savedTheme = localStorage.getItem('selectedTheme') || 'theme-professional';
        this.switchTheme(savedTheme);
        this.backgroundManager.init(savedTheme);
        this.layoutManager.init();
        this.updateProjectorVisibility();
        this.setupPresetControls();
        this.renderBackgroundSelector();

        this.renderThemeSelector();
        this.renderWidgetModal();
        this.displaySavedLayouts();
        this.initializeSavedNotes();
        this.syncTimerControlsFromWidget();
        this.syncPresentationControlsFromWidget();
        this.renderProjectControls();
        this.renderPresentationSavedDeckOptions();
        this.updatePresentationLastDeckAction();

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

        this.subscribeToEventBus('timer:started', ({ minutes, showNotification = true, ...payload } = {}) => {
            this.syncTimerControlsFromPayload({ ...payload, minutes });
            this.syncTimerStateToProjector({ ...payload, minutes });
            if (!Number.isFinite(minutes) || minutes <= 0) {
                return;
            }

            if (showNotification) {
                this.showNotification(`Timer started for ${Math.round(minutes * 100) / 100} minutes.`);
            }
        });

        this.subscribeToEventBus('timer:stopped', ({ showNotification = true, ...payload } = {}) => {
            this.syncTimerControlsFromPayload(payload);
            this.syncTimerStateToProjector(payload);
            if (showNotification) {
                this.showNotification('Timer stopped.');
            }
        });

        this.subscribeToEventBus('timer:reset', (payload = {}) => {
            this.syncTimerControlsFromPayload(payload);
            this.syncTimerStateToProjector(payload);
        });

        this.subscribeToEventBus('timer:updated', (payload = {}) => {
            this.syncTimerControlsFromPayload(payload);
            this.syncTimerStateToProjector(payload);
        });

        this.subscribeToEventBus('presentation:state-changed', (payload = {}) => {
            this.syncPresentationControlsFromPayload(payload);
        });

        this.subscribeToEventBus('presentation:saved-decks-changed', ({ decks = null } = {}) => {
            this.renderPresentationSavedDeckOptions(decks);
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
            const isUntokenedSyncRequest = message.type === 'request-sync' && !message.syncToken;
            if (this.projectorSyncToken && message.syncToken !== this.projectorSyncToken && !isUntokenedSyncRequest) {
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

        if (this.layoutNameInput) {
            this.layoutNameInput.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                this.saveLayoutFromModal();
            });
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
        if (this.sectionsToggleButton) {
            this.sectionsToggleButton.addEventListener('click', () => this.toggleSectionsMenu());
        }
        document.addEventListener('click', (event) => {
            if (!this.sectionsMenu || this.sectionsMenu.hidden) return;

            const clickedInsideMenu = this.sectionsMenu.contains(event.target);
            const clickedToggle = this.sectionsToggleButton?.contains(event.target);
            if (!clickedInsideMenu && !clickedToggle) {
                this.closeSectionsMenu();
            }
        });
        document.addEventListener('keydown', (event) => {
            const key = (event.key || '').toLowerCase();

            if (event.key === 'Escape') {
                this.closeSectionsMenu();
                return;
            }

            if (this.widgetModal?.open && !isShortcutEditableTarget(event.target)) {
                const shortcutWidgetType = WIDGET_PICKER_SHORTCUTS[key];
                if (shortcutWidgetType && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    event.preventDefault();
                    this.addWidget(shortcutWidgetType);
                    return;
                }
            }

            const isWidgetPickerLauncher = key === 'w' && (event.ctrlKey || event.metaKey) && event.altKey;
            if (!isWidgetPickerLauncher) {
                return;
            }

            if (event.repeat || isShortcutEditableTarget(event.target)) {
                return;
            }

            event.preventDefault();
            this.openWidgetPickerForShortcut();
        });
        this.closeTeacherPanelBtn.addEventListener('click', () => this.toggleTeacherPanel(false));
        this.panelBackdrop.addEventListener('click', () => this.toggleTeacherPanel(false));

        if (this.manageScreensButton) {
            this.manageScreensButton.addEventListener('click', () => this.openManageScreensMenu());
        }

        if (this.openWeeklyPlannerButton) {
            this.openWeeklyPlannerButton.addEventListener('click', () => this.openPlannerModal());
        }

        if (this.openAgendaButton) {
            this.openAgendaButton.addEventListener('click', () => this.openAgendaModal());
        }

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

                    const panelContent = this.teacherPanel ? this.teacherPanel.querySelector('.panel-content') : null;
                    const summary = details.querySelector('summary');
                    if (panelContent && summary) {
                        window.requestAnimationFrame(() => {
                            const panelRect = panelContent.getBoundingClientRect();
                            const summaryRect = summary.getBoundingClientRect();
                            const currentScroll = panelContent.scrollTop;
                            const offsetTop = summaryRect.top - panelRect.top + currentScroll;
                            const targetScroll = Math.max(offsetTop - 12, 0);
                            panelContent.scrollTo({ top: targetScroll, behavior: 'smooth' });
                        });
                    }
                }
            });
        });

        // Other controls...
        document.getElementById('start-timer').addEventListener('click', () => this.startTimerFromControls());
        document.getElementById('stop-timer').addEventListener('click', () => this.stopTimerFromControls());
        if (this.resetTimerButton) {
            this.resetTimerButton.addEventListener('click', () => this.resetTimerFromControls());
        }

        if (this.presentationManageButton) {
            this.presentationManageButton.addEventListener('click', () => this.openPresentationControlsFromPanel());
        }

        if (this.presentationSourceTypeSelect) {
            this.presentationSourceTypeSelect.addEventListener('change', () => this.updatePresentationLinkInputs());
        }

        if (this.presentationSourceUrlInput) {
            this.presentationSourceUrlInput.addEventListener('input', () => this.syncPresentationSourceTypeFromUrl());
            this.presentationSourceUrlInput.addEventListener('blur', () => this.syncPresentationSourceTypeFromUrl());
        }

        if (this.presentationSaveLinkButton) {
            this.presentationSaveLinkButton.addEventListener('click', () => {
                void this.savePresentationLinkFromPanel();
            });
        }

        if (this.presentationLastButton) {
            this.presentationLastButton.addEventListener('click', () => {
                void this.presentLastDeckFromPanel();
            });
        }

        if (this.presentationOpenLinkButton) {
            this.presentationOpenLinkButton.addEventListener('click', () => {
                void this.openPresentationLinkFromPanel();
            });
        }

        if (this.presentationOpenProjectorLinkButton) {
            this.presentationOpenProjectorLinkButton.addEventListener('click', () => {
                void this.openPresentationLinkFromPanel({ openProjector: true });
            });
        }

        if (this.presentationSavedSelect) {
            this.presentationSavedSelect.addEventListener('change', () => this.updatePresentationSavedActions());
        }

        if (this.presentationOpenSavedButton) {
            this.presentationOpenSavedButton.addEventListener('click', () => {
                void this.openSavedPresentationFromPanel();
            });
        }

        if (this.presentationOpenSavedProjectorButton) {
            this.presentationOpenSavedProjectorButton.addEventListener('click', () => {
                void this.openSavedPresentationFromPanel({ openProjector: true });
            });
        }

        if (this.presentationRenameSavedButton) {
            this.presentationRenameSavedButton.addEventListener('click', () => {
                void this.renameSavedPresentationFromPanel();
            });
        }

        if (this.presentationDeleteSavedButton) {
            this.presentationDeleteSavedButton.addEventListener('click', () => {
                void this.deleteSavedPresentationFromPanel();
            });
        }

        if (this.presentationProjectorButton) {
            this.presentationProjectorButton.addEventListener('click', () => this.openPresentationProjectorFromPanel());
        }

        if (this.presentationPrevButton) {
            this.presentationPrevButton.addEventListener('click', () => this.navigatePresentationFromPanel('prev'));
        }

        if (this.presentationNextButton) {
            this.presentationNextButton.addEventListener('click', () => this.navigatePresentationFromPanel('next'));
        }

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

        // Timer presets set the duration first; Start remains the explicit action.
        const preset5 = document.getElementById('timer-preset-5');
        if (preset5) {
            preset5.addEventListener('click', () => this.applyTimerPresetToControls(5));
        }

        const preset10 = document.getElementById('timer-preset-10');
        if (preset10) {
            preset10.addEventListener('click', () => this.applyTimerPresetToControls(10));
        }

        const preset15 = document.getElementById('timer-preset-15');
        if (preset15) {
            preset15.addEventListener('click', () => this.applyTimerPresetToControls(15));
        }

        document.getElementById('reset-layout').addEventListener('click', () => this.resetLayout());
        document.getElementById('save-preset').addEventListener('click', () => this.savePreset());
        eventBus.on('widget:removed', this.handleWidgetRemovedEvent);
        document.addEventListener('widgetRemoved', (event) => this.handleWidgetRemoved(event.detail.widget));
        document.addEventListener('widgetChanged', () => this.saveState());

        // Request Open Planner
        document.addEventListener('requestOpenPlanner', () => {
            this.closeWidgetSettings();
            this.openPlannerModal();
        });

        // Export/Import
        document.getElementById('export-layout').addEventListener('click', () => this.handleExportLayout());
        document.getElementById('import-layout').addEventListener('click', () => this.openDialog(this.importDialog));
        this.confirmImportButton.addEventListener('click', () => this.handleConfirmImport());

        // Class screens
        if (this.classProfileSelect) {
            this.classProfileSelect.addEventListener('change', () => {
                this.syncPresetFilterFromClassProfile();
                if (this.classProfileSelect.value) {
                    this.loadLatestPresetForSelectedClass();
                }
            });
        }

        if (this.saveSnapshotButton) {
            this.saveSnapshotButton.addEventListener('click', () => {
                this.syncPresetFilterFromClassProfile();
                this.savePreset({ autoName: true });
            });
        }

        if (this.teacherPageSwitcher) {
            this.teacherPageSwitcher.addEventListener('click', (event) => {
                const button = event.target.closest('button[data-page-id]');
                if (!button || !button.dataset.pageId) {
                    return;
                }

                this.switchToPage(button.dataset.pageId);
            });
        }

        if (this.mainPagePrev) {
            this.mainPagePrev.addEventListener('click', () => {
                const normalizedState = this.getActiveProjectState();
                const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
                const activeIndex = this.getActiveProjectPageIndex(normalizedState);
                const targetPage = activeIndex > 0 ? pages[activeIndex - 1] : null;
                if (targetPage && targetPage.id) {
                    this.switchToPage(targetPage.id);
                }
            });
        }

        if (this.mainPageCurrent) {
            this.mainPageCurrent.addEventListener('click', () => {
                this.openManageScreensMenu();
            });
        }

        if (this.mainPageNext) {
            this.mainPageNext.addEventListener('click', () => {
                const normalizedState = this.getActiveProjectState();
                const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
                const activeIndex = this.getActiveProjectPageIndex(normalizedState);
                const targetPage = activeIndex >= 0 && activeIndex < pages.length - 1 ? pages[activeIndex + 1] : null;
                if (targetPage && targetPage.id) {
                    this.switchToPage(targetPage.id);
                }
            });
        }

        if (this.newProjectButton) {
            this.newProjectButton.addEventListener('click', () => this.createNewProject());
        }

        if (this.newPageButton) {
            this.newPageButton.addEventListener('click', () => this.createNewPage());
        }

        if (this.movePageLeftButton) {
            this.movePageLeftButton.addEventListener('click', () => this.moveCurrentPage(-1));
        }

        if (this.movePageRightButton) {
            this.movePageRightButton.addEventListener('click', () => this.moveCurrentPage(1));
        }

        if (this.duplicatePageButton) {
            this.duplicatePageButton.addEventListener('click', () => this.duplicateCurrentPage());
        }

        if (this.renamePageButton) {
            this.renamePageButton.addEventListener('click', () => this.renameCurrentPage());
        }

        if (this.deletePageButton) {
            this.deletePageButton.addEventListener('click', () => this.deleteCurrentPage());
        }

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
        this.updateCurrentSectionLabel(tab);
        this.closeSectionsMenu();

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

        if (tab === 'planner') {
            this.displaySavedLayouts();
        }

        if (tab !== 'planner' && this.plannerModal?.classList.contains('visible')) {
            this.closePlannerModal();
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

    updateCurrentSectionLabel(tab) {
        const selectedTab = Array.from(this.navTabs).find((navTab) => navTab.dataset.tab === tab);
        const sectionLabel = selectedTab?.textContent?.trim() || 'Classroom';

        if (this.currentSectionName) {
            this.currentSectionName.textContent = sectionLabel;
        }

        if (this.sectionsToggleButton) {
            this.sectionsToggleButton.setAttribute('aria-label', `Sections menu, current section ${sectionLabel}`);
            this.sectionsToggleButton.title = `Current section: ${sectionLabel}`;
        }
    }

    toggleSectionsMenu(forceOpen = null) {
        if (!this.sectionsMenu || !this.sectionsToggleButton) {
            return;
        }

        const shouldOpen = forceOpen === null ? this.sectionsMenu.hidden : forceOpen;
        this.sectionsMenu.hidden = !shouldOpen;
        this.sectionsToggleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }

    closeSectionsMenu() {
        this.toggleSectionsMenu(false);
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
                if (action === 'memory-cue') this.exportSavedNoteToMemoryCue(noteId);
            });
        }

        if (this.exportAllNotesButton) {
            this.exportAllNotesButton.addEventListener('click', () => this.exportAllSavedNotesToMemoryCue());
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

        if (this.isTeacherPanelOpen) {
            const panelContent = this.teacherPanel ? this.teacherPanel.querySelector('.panel-content') : null;
            if (panelContent) {
                panelContent.scrollTop = 0;
            }
            this.syncTimerControlsFromWidget();
            this.syncPresentationControlsFromWidget();
        }
    }

    renderSavedNotesList() {
        if (!this.savedNotesListElement) return;

        this.savedNotesListElement.innerHTML = '';
        const emptyState = this.savedNotesEmptyState;
        const notes = Array.isArray(this.savedNotes) ? [...this.savedNotes] : [];
        const sortedNotes = notes.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

        this.updateSavedNotesSummary(sortedNotes);

        if (!sortedNotes.length) {
            if (emptyState) {
                emptyState.hidden = false;
                this.savedNotesListElement.appendChild(emptyState);
            }
            return;
        }

        if (emptyState) {
            emptyState.hidden = true;
        }

        sortedNotes.forEach((note) => {
                const card = document.createElement('div');
                card.className = 'saved-note-card';
                card.setAttribute('role', 'listitem');

                const meta = document.createElement('div');
                meta.className = 'saved-note-meta';

                const header = document.createElement('div');
                header.className = 'saved-note-header';

                const title = document.createElement('span');
                title.className = 'saved-note-title';
                title.textContent = note.title || 'Untitled Note';

                const chips = document.createElement('div');
                chips.className = 'saved-note-chips';

                const wordChip = document.createElement('span');
                wordChip.className = 'saved-note-chip';
                const wordCount = this.getNoteWordCount(note.content);
                wordChip.textContent = wordCount === 1 ? '1 word' : `${wordCount} words`;

                const statusChip = document.createElement('span');
                statusChip.className = 'saved-note-chip saved-note-chip--accent';
                statusChip.textContent = 'Ready';

                const preview = document.createElement('p');
                preview.className = 'saved-note-preview';
                preview.textContent = this.getNotePreviewText(note.content);

                const footer = document.createElement('div');
                footer.className = 'saved-note-footer';

                const updated = document.createElement('span');
                updated.className = 'saved-note-updated';
                updated.textContent = `Updated ${this.formatNoteDate(note.updatedAt)}`;

                const source = document.createElement('span');
                source.className = 'saved-note-source';
                source.textContent = 'Open in Classroom to continue editing';

                chips.appendChild(wordChip);
                chips.appendChild(statusChip);
                header.appendChild(title);
                header.appendChild(chips);
                footer.appendChild(updated);
                footer.appendChild(source);

                meta.appendChild(header);
                meta.appendChild(preview);
                meta.appendChild(footer);

                const actions = document.createElement('div');
                actions.className = 'saved-note-actions';

                const openBtn = document.createElement('button');
                openBtn.type = 'button';
                openBtn.className = 'control-button';
                openBtn.dataset.noteAction = 'open';
                openBtn.dataset.noteId = note.id;
                openBtn.textContent = 'Open in Classroom';

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'control-button control-button--ghost';
                deleteBtn.dataset.noteAction = 'delete';
                deleteBtn.dataset.noteId = note.id;
                deleteBtn.textContent = 'Delete';

                const memoryCueBtn = document.createElement('button');
                memoryCueBtn.type = 'button';
                memoryCueBtn.className = 'control-button control-button--ghost';
                memoryCueBtn.dataset.noteAction = 'memory-cue';
                memoryCueBtn.dataset.noteId = note.id;
                memoryCueBtn.textContent = 'Send to Memory Cue';

                actions.appendChild(openBtn);
                actions.appendChild(memoryCueBtn);
                actions.appendChild(deleteBtn);

                card.appendChild(meta);
                card.appendChild(actions);

                this.savedNotesListElement.appendChild(card);
            });
    }

    updateSavedNotesSummary(notes = []) {
        if (!this.notesPanelSummary) {
            return;
        }

        if (!notes.length) {
            this.notesPanelSummary.innerHTML = '';
            return;
        }

        const totalWords = notes.reduce((sum, note) => sum + this.getNoteWordCount(note.content), 0);
        const summary = [
            `${notes.length} ${notes.length === 1 ? 'saved note' : 'saved notes'}`,
            `${totalWords} ${totalWords === 1 ? 'word' : 'words'} in library`
        ];

        if (notes[0]?.updatedAt) {
            summary.push(`Latest ${this.formatNoteDate(notes[0].updatedAt)}`);
        }

        this.notesPanelSummary.innerHTML = summary
            .map((item) => `<span class="notes-panel__summary-pill">${item}</span>`)
            .join('');
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

    async exportSavedNoteToMemoryCue(noteId) {
        if (!window.SavedNotesStore) return;

        const note = window.SavedNotesStore.get(noteId);
        if (!note) {
            this.showNotification('Note could not be found.', 'error');
            return;
        }

        const queued = this.queueMemoryCueNoteImports([this.buildMemoryCueNotePayload(note)]);
        if (!queued) {
            this.showNotification('Unable to queue the note for Memory Cue.', 'error');
            return;
        }

        const opened = this.openMemoryCueNotebook();
        this.showNotification(opened ? 'Note sent to Memory Cue.' : 'Note queued for Memory Cue. Open Memory Cue to finish the import.');
    }

    async exportAllSavedNotesToMemoryCue() {
        const notes = Array.isArray(this.savedNotes) ? [...this.savedNotes] : [];
        if (!notes.length) {
            this.showNotification('No saved notes available to export yet.', 'warning');
            return;
        }

        const queued = this.queueMemoryCueNoteImports(notes.map((note) => this.buildMemoryCueNotePayload(note)));
        if (!queued) {
            this.showNotification('Unable to queue notes for Memory Cue.', 'error');
            return;
        }

        const opened = this.openMemoryCueNotebook();
        const noteLabel = notes.length === 1 ? '1 note' : `${notes.length} notes`;
        this.showNotification(opened ? `Sent ${noteLabel} to Memory Cue.` : `Queued ${noteLabel} for Memory Cue. Open Memory Cue to finish the import.`);
    }

    buildMemoryCueNotePayload(note = {}) {
        const html = typeof note.content === 'string' ? note.content : '';
        const text = this.getNotePlainText(html);

        return {
            title: note.title || 'Untitled note',
            text: text || 'Untitled note',
            bodyHtml: html,
            folderId: 'school',
            parsedType: 'note',
            source: 'teach-screen',
            tags: ['teaching', 'teacher-screen'],
            updatedAt: note.updatedAt || new Date().toISOString(),
            metadata: {
                source: 'teach-screen',
                teaching: true,
                noteType: 'lesson-note',
                sourceNoteId: note.id || null,
                lessonCueBody: text || '',
                lessonCueHtml: html || '',
                lessonCueUpdatedAt: note.updatedAt || new Date().toISOString()
            }
        };
    }

    queueMemoryCueNoteImports(notes = []) {
        const nextNotes = Array.isArray(notes) ? notes.filter((note) => note && typeof note === 'object') : [];
        if (!nextNotes.length) {
            return false;
        }

        try {
            const raw = localStorage.getItem(MEMORY_CUE_IMPORT_QUEUE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            const existingQueue = Array.isArray(parsed) ? parsed : [];
            const queuedNotes = nextNotes.map((note) => ({
                ...note,
                queuedAt: new Date().toISOString(),
                sourceApp: 'teach-screen'
            }));

            localStorage.setItem(MEMORY_CUE_IMPORT_QUEUE_KEY, JSON.stringify([...existingQueue, ...queuedNotes]));
            return true;
        } catch (error) {
            console.warn('Unable to queue notes for Memory Cue.', error);
            return false;
        }
    }

    openMemoryCueNotebook() {
        try {
            const targetUrl = new URL('../mobile.html', window.location.href);
            const openedWindow = window.open(targetUrl.toString(), '_blank', 'noopener');
            return Boolean(openedWindow);
        } catch (error) {
            console.warn('Unable to open Memory Cue notebook.', error);
            return false;
        }
    }

    getNotePreviewText(content = '') {
        const temp = document.createElement('div');
        temp.innerHTML = content || '';
        const text = (temp.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return 'No content saved yet.';
        return text.length > 180 ? `${text.slice(0, 177).trimEnd()}...` : text;
    }

    getNoteWordCount(content = '') {
        const text = this.getNotePlainText(content);
        if (!text) {
            return 0;
        }

        return text.split(/\s+/).filter(Boolean).length;
    }

    getNotePlainText(content = '') {
        const temp = document.createElement('div');
        temp.innerHTML = content || '';
        return (temp.textContent || '').trim();
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
            eventBus.emit('widget:created', { type, widget, element: widgetElement });

            if (this.isRevealManagerWidget(widget)) {
                this.syncPresentationControlsFromWidget(widget);
            }
            
            const placeholder = this.widgetsContainer.querySelector('.widget-placeholder');
            if (placeholder) placeholder.remove();
            this.recordWidgetPickerUsage(type);
            
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

    getDefaultWidgetPickerState() {
        return {
            favorites: ['rich-text', 'reveal-manager', 'timer', 'drawing-tool'],
            recent: []
        };
    }

    getWidgetPickerState() {
        const fallback = this.getDefaultWidgetPickerState();

        try {
            const raw = localStorage.getItem(this.widgetPickerStateKey);
            if (!raw) {
                return fallback;
            }

            const parsed = JSON.parse(raw);
            const availableKeys = new Set(listAvailableWidgets().map((widget) => widget.key));
            const favorites = Array.isArray(parsed?.favorites)
                ? parsed.favorites.filter((key) => availableKeys.has(key))
                : fallback.favorites;
            const recent = Array.isArray(parsed?.recent)
                ? parsed.recent.filter((key) => availableKeys.has(key))
                : [];

            return {
                favorites: favorites.length ? favorites : fallback.favorites,
                recent
            };
        } catch (error) {
            console.warn('Unable to parse widget picker state:', error);
            return fallback;
        }
    }

    saveWidgetPickerState(state) {
        localStorage.setItem(this.widgetPickerStateKey, JSON.stringify(state));
    }

    recordWidgetPickerUsage(type) {
        const key = getRegistryWidgetKey(type);
        if (!key) {
            return;
        }

        const state = this.getWidgetPickerState();
        this.saveWidgetPickerState({
            ...state,
            recent: [key, ...state.recent.filter((item) => item !== key)].slice(0, 6)
        });
    }

    toggleWidgetPickerFavorite(widgetKey) {
        const key = getRegistryWidgetKey(widgetKey) || widgetKey;
        if (!key) {
            return;
        }

        const state = this.getWidgetPickerState();
        const isFavorite = state.favorites.includes(key);
        const favorites = isFavorite
            ? state.favorites.filter((item) => item !== key)
            : [...state.favorites, key];

        this.saveWidgetPickerState({
            ...state,
            favorites
        });
        this.renderWidgetModal(key);
    }

    createWidgetPickerButton(widget, { focusWidgetType = null, favorites = [] } = {}) {
        const card = document.createElement('div');
        card.className = 'widget-picker-card';

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

        const isFavorite = favorites.includes(widget.key);
        const favoriteButton = document.createElement('button');
        favoriteButton.type = 'button';
        favoriteButton.className = 'widget-favorite-btn';
        favoriteButton.dataset.favorite = isFavorite ? 'true' : 'false';
        favoriteButton.setAttribute('aria-label', isFavorite ? `Remove ${widget.label} from favorites` : `Add ${widget.label} to favorites`);
        favoriteButton.title = isFavorite ? 'Remove favorite' : 'Add favorite';
        favoriteButton.textContent = '\u2605';
        favoriteButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleWidgetPickerFavorite(widget.key);
        });

        card.appendChild(button);
        card.appendChild(favoriteButton);
        return card;
    }

    appendWidgetSection(container, title, widgets, { focusWidgetType = null, accent = false, favorites = [] } = {}) {
        if (!container || !Array.isArray(widgets) || widgets.length === 0) {
            return;
        }

        const section = document.createElement('section');
        section.className = `widget-category-section${accent ? ' widget-category-section--accent' : ''}`;

        const heading = document.createElement('h4');
        heading.className = 'widget-category-title';
        heading.textContent = title;
        section.appendChild(heading);

        widgets.forEach((widget) => {
            section.appendChild(this.createWidgetPickerButton(widget, { focusWidgetType, favorites }));
        });

        container.appendChild(section);
    }

    renderSmartWidgetModal(container, focusWidgetType = null) {
        const widgetPickerState = this.getWidgetPickerState();
        const availableWidgets = listAvailableWidgets();
        const widgetMap = new Map(availableWidgets.map((widget) => [widget.key, widget]));

        const quickAddWidgets = this.quickAddWidgetKeys
            .map((key) => widgetMap.get(key))
            .filter(Boolean);
        this.appendWidgetSection(container, 'Quick Add', quickAddWidgets, {
            focusWidgetType,
            accent: true,
            favorites: widgetPickerState.favorites
        });

        const favoriteWidgets = widgetPickerState.favorites
            .map((key) => widgetMap.get(key))
            .filter(Boolean)
            .filter((widget) => !this.quickAddWidgetKeys.includes(widget.key));
        this.appendWidgetSection(container, 'Favorites', favoriteWidgets, {
            focusWidgetType,
            favorites: widgetPickerState.favorites
        });

        const recentWidgets = widgetPickerState.recent
            .map((key) => widgetMap.get(key))
            .filter(Boolean)
            .filter((widget) => !this.quickAddWidgetKeys.includes(widget.key) && !widgetPickerState.favorites.includes(widget.key));
        this.appendWidgetSection(container, 'Recent', recentWidgets, {
            focusWidgetType,
            favorites: widgetPickerState.favorites
        });

        const categories = {};
        availableWidgets.forEach((widget) => {
            const categoryName = widget.category || 'Secondary';
            if (!categories[categoryName]) {
                categories[categoryName] = [];
            }
            categories[categoryName].push(widget);
        });

        ['Primary', 'Secondary'].forEach((categoryName) => {
            const widgets = (categories[categoryName] || []).slice().sort((a, b) => a.label.localeCompare(b.label));
            this.appendWidgetSection(container, categoryName, widgets, {
                focusWidgetType,
                favorites: widgetPickerState.favorites
            });
        });
    }

    renderWidgetModal(focusWidgetType = null) {
        const container = this.widgetModal.querySelector('.widget-categories');
        container.innerHTML = '';
        this.renderSmartWidgetModal(container, focusWidgetType);
        return;

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
        if (!this.themeSelector) {
            return;
        }

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

    syncThemeSelectorSelection(themeName) {
        if (!this.themeSelector) {
            return;
        }

        this.themeSelector.querySelectorAll('input[name="theme"]').forEach((input) => {
            input.checked = input.value === themeName;
        });
    }

    switchTheme(themeName) {
        applyTheme(themeName);
        this.syncThemeSelectorSelection(themeName);
        if (this.backgroundManager && typeof this.backgroundManager.syncTheme === 'function') {
            this.backgroundManager.syncTheme(themeName);
        }
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

    downloadJsonFile(filename, payload) {
        const jsonString = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    }

    async copyTextToClipboard(value) {
        if (!value || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            return false;
        }

        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch (error) {
            console.warn('Unable to copy export payload to clipboard.', error);
            return false;
        }
    }

    slugifyFilename(value = '') {
        const slug = String(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return slug || 'note';
    }

    buildStateSnapshot() {
        const normalizedProjectState = this.normalizeProjectState(this.projectState);
        const activePageId = normalizedProjectState.activePageId || DEFAULT_PAGE_ID;
        const pages = Array.isArray(normalizedProjectState.pages) ? normalizedProjectState.pages : [];
        const activePageIndex = pages.findIndex((page) => page && page.id === activePageId);
        const activePage = activePageIndex >= 0 ? pages[activePageIndex] : null;
        const activePageSnapshot = this.createPageSnapshot();
        const nextActivePageId = activePage && activePage.id ? activePage.id : activePageId;
        const nextPages = activePageIndex >= 0
            ? pages.map((page, index) => (index === activePageIndex
                ? this.createPageRecord({
                    id: nextActivePageId,
                    name: activePage.name || DEFAULT_PAGE_NAME,
                    snapshot: activePageSnapshot
                })
                : this.normalizePageRecord(page, index, normalizedProjectState)))
            : [...pages.map((page, index) => this.normalizePageRecord(page, index, normalizedProjectState)), this.createPageRecord({
                id: nextActivePageId,
                name: DEFAULT_PAGE_NAME,
                snapshot: activePageSnapshot
            })];
        const projectName = typeof normalizedProjectState.projectName === 'string' && normalizedProjectState.projectName.trim()
            ? normalizedProjectState.projectName.trim()
            : DEFAULT_PROJECT_NAME;
        const snapshot = {
            version: this.appVersion,
            schemaVersion: this.schemaVersion,
            projectName,
            activePageId: nextActivePageId,
            pages: nextPages,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            timerStates: this.collectTimerStateSnapshots(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null
        };
        snapshot.theme = activePageSnapshot.theme;
        snapshot.background = cloneSerializableData(activePageSnapshot.background);
        snapshot.layout = cloneSerializableData(activePageSnapshot.layout);
        snapshot.timerStates = cloneSerializableData(activePageSnapshot.timerStates);
        snapshot.lessonPlan = cloneSerializableData(activePageSnapshot.lessonPlan);
        this.projectState = {
            projectName,
            activePageId: nextActivePageId,
            pages: cloneSerializableData(nextPages)
        };
        return snapshot;
    }

    getDefaultProjectState() {
        return {
            projectName: DEFAULT_PROJECT_NAME,
            activePageId: DEFAULT_PAGE_ID,
            pages: []
        };
    }

    getActiveProjectState() {
        return this.normalizeProjectState(this.projectState);
    }

    getActiveProjectPage(state = this.getActiveProjectState()) {
        const pages = Array.isArray(state.pages) ? state.pages : [];
        return pages.find((page) => page && page.id === state.activePageId) || pages[0] || null;
    }

    getActiveProjectPageIndex(state = this.getActiveProjectState()) {
        const pages = Array.isArray(state.pages) ? state.pages : [];
        const activePageId = state.activePageId || (pages[0] && pages[0].id) || DEFAULT_PAGE_ID;
        return pages.findIndex((page) => page && page.id === activePageId);
    }

    createBlankPageSnapshot() {
        const themeName = document.body.className || 'theme-professional';

        return {
            theme: themeName,
            background: this.backgroundManager && typeof this.backgroundManager.getThemeDefaultBackground === 'function'
                ? this.backgroundManager.getThemeDefaultBackground(themeName)
                : null,
            layout: { mode: 'dashboard', widgets: [] },
            timerStates: [],
            lessonPlan: []
        };
    }

    makeUniquePageId(pages = []) {
        const existingIds = new Set((Array.isArray(pages) ? pages : []).map((page) => page && page.id).filter(Boolean));

        for (let index = 1; index < 1000; index += 1) {
            const candidate = `page-${index}`;
            if (!existingIds.has(candidate)) {
                return candidate;
            }
        }

        return `page-${Date.now()}`;
    }

    makeUniquePageName(baseName = DEFAULT_PAGE_NAME, pages = [], currentPageId = null) {
        const existingNames = new Set(
            (Array.isArray(pages) ? pages : [])
                .filter((page) => page && page.id !== currentPageId)
                .map((page) => (typeof page.name === 'string' && page.name.trim() ? page.name.trim() : ''))
                .filter(Boolean)
        );

        const base = typeof baseName === 'string' && baseName.trim() ? baseName.trim() : DEFAULT_PAGE_NAME;
        if (!existingNames.has(base)) {
            return base;
        }

        for (let index = 2; index < 100; index += 1) {
            const candidate = `${base} ${index}`;
            if (!existingNames.has(candidate)) {
                return candidate;
            }
        }

        return `${base} ${Date.now()}`;
    }

    ensureWidgetPlaceholder() {
        if (!this.widgetsContainer) {
            return;
        }

        if (this.widgetsContainer.querySelector('.widget-placeholder')) {
            return;
        }

        this.widgetsContainer.innerHTML = '<div class="widget-placeholder"><p>Add your first widget from the Teacher Controls!</p></div>';
    }

    saveCurrentPageSnapshot() {
        const normalizedState = this.normalizeProjectState(this.projectState);
        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        if (!pages.length) {
            const blankPage = this.createPageRecord({
                id: DEFAULT_PAGE_ID,
                name: DEFAULT_PAGE_NAME,
                snapshot: this.createBlankPageSnapshot()
            });
            this.projectState = {
                projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
                activePageId: blankPage.id,
                pages: [blankPage]
            };
            return this.getActiveProjectState();
        }

        const activePageIndex = this.getActiveProjectPageIndex(normalizedState);
        const resolvedIndex = activePageIndex >= 0 ? activePageIndex : 0;
        const activePage = pages[resolvedIndex] || pages[0];
        const snapshot = this.createPageSnapshot();
        const nextPages = pages.map((page, index) => (index === resolvedIndex
            ? this.createPageRecord({
                id: page.id,
                name: page.name,
                snapshot
            })
            : this.normalizePageRecord(page, index, normalizedState)));

        this.projectState = {
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: activePage.id,
            pages: cloneSerializableData(nextPages)
        };

        return this.getActiveProjectState();
    }

    moveCurrentPage(offset = 0) {
        if (!Number.isFinite(offset) || offset === 0) {
            return;
        }

        const normalizedState = this.saveCurrentPageSnapshot();
        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        if (pages.length < 2) {
            this.renderProjectControls();
            return;
        }

        const activeIndex = this.getActiveProjectPageIndex(normalizedState);
        if (activeIndex < 0) {
            return;
        }

        const targetIndex = activeIndex + offset;
        if (targetIndex < 0 || targetIndex >= pages.length) {
            this.renderProjectControls();
            return;
        }

        const reorderedPages = [...pages];
        const [movedPage] = reorderedPages.splice(activeIndex, 1);
        reorderedPages.splice(targetIndex, 0, movedPage);

        this.projectState = {
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: movedPage.id,
            pages: cloneSerializableData(reorderedPages)
        };

        this.renderProjectControls();
        this.saveState();
        this.showNotification(`Moved "${movedPage.name || DEFAULT_PAGE_NAME}" ${offset < 0 ? 'left' : 'right'}.`);
    }

    createNewProject(projectName = null) {
        const requestedName = typeof projectName === 'string' && projectName.trim()
            ? projectName.trim()
            : window.prompt('Enter a project name', DEFAULT_PROJECT_NAME);
        if (requestedName === null) {
            return;
        }

        const resolvedProjectName = requestedName && requestedName.trim() ? requestedName.trim() : DEFAULT_PROJECT_NAME;
        const blankPage = this.createPageRecord({
            id: this.makeUniquePageId(),
            name: DEFAULT_PAGE_NAME,
            snapshot: this.createBlankPageSnapshot()
        });

        this.projectState = {
            projectName: resolvedProjectName,
            activePageId: blankPage.id,
            pages: [blankPage]
        };

        this.applyPageSnapshot(blankPage.snapshot);
        this.renderProjectControls();
        this.saveState();
        this.showNotification(`Created project "${resolvedProjectName}".`);
    }

    createNewPage(pageName = '') {
        const normalizedState = this.saveCurrentPageSnapshot();
        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        const page = this.createPageRecord({
            id: this.makeUniquePageId(pages),
            name: this.makeUniquePageName(pageName || `Page ${pages.length + 1}`, pages),
            snapshot: this.createBlankPageSnapshot()
        });

        const nextPages = [...pages, page];
        this.projectState = {
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: page.id,
            pages: cloneSerializableData(nextPages)
        };

        this.applyPageSnapshot(page.snapshot);
        this.renderProjectControls();
        this.saveState();
        this.showNotification(`Created page "${page.name}".`);
    }

    switchToPage(pageId) {
        const normalizedState = this.saveCurrentPageSnapshot();
        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        const targetPage = pages.find((page) => page && page.id === pageId);

        if (!targetPage) {
            return;
        }

        if (normalizedState.activePageId === targetPage.id) {
            this.renderProjectControls();
            return;
        }

        this.projectState = {
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: targetPage.id,
            pages: cloneSerializableData(pages)
        };

        this.applyPageSnapshot(targetPage.snapshot);
        this.renderProjectControls();
        this.saveState();
    }

    duplicateCurrentPage() {
        const normalizedState = this.saveCurrentPageSnapshot();
        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        const activePage = this.getActiveProjectPage(normalizedState);
        if (!activePage) {
            return;
        }

        const currentIndex = this.getActiveProjectPageIndex(normalizedState);
        const duplicate = this.createPageRecord({
            id: this.makeUniquePageId(pages),
            name: this.makeUniquePageName(`${activePage.name || DEFAULT_PAGE_NAME} Copy`, pages),
            snapshot: cloneSerializableData(activePage.snapshot)
        });
        const insertIndex = currentIndex >= 0 ? currentIndex + 1 : pages.length;
        const nextPages = [...pages.slice(0, insertIndex), duplicate, ...pages.slice(insertIndex)];

        this.projectState = {
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: duplicate.id,
            pages: cloneSerializableData(nextPages)
        };

        this.applyPageSnapshot(duplicate.snapshot);
        this.renderProjectControls();
        this.saveState();
        this.showNotification(`Duplicated "${activePage.name || DEFAULT_PAGE_NAME}".`);
    }

    renameCurrentPage() {
        const normalizedState = this.getActiveProjectState();
        const activePage = this.getActiveProjectPage(normalizedState);
        if (!activePage) {
            return;
        }

        const nextName = window.prompt('Enter a new page title', activePage.name || DEFAULT_PAGE_NAME);
        if (nextName === null) {
            return;
        }

        const resolvedName = nextName.trim();
        if (!resolvedName) {
            this.showNotification('Page title cannot be blank.', 'warning');
            return;
        }

        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        this.projectState = {
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: activePage.id,
            pages: pages.map((page) => (page.id === activePage.id
                ? this.createPageRecord({
                    id: page.id,
                    name: resolvedName,
                    snapshot: page.snapshot
                })
                : this.normalizePageRecord(page, pages.indexOf(page), normalizedState)))
        };

        this.renderProjectControls();
        this.saveState();
        this.showNotification(`Renamed page to "${resolvedName}".`);
    }

    deleteCurrentPage() {
        const normalizedState = this.saveCurrentPageSnapshot();
        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        if (!pages.length) {
            return;
        }

        const activePage = this.getActiveProjectPage(normalizedState);
        const activeIndex = this.getActiveProjectPageIndex(normalizedState);
        const pageLabel = activePage && activePage.name ? activePage.name : DEFAULT_PAGE_NAME;

        if (!window.confirm(`Delete page "${pageLabel}"? The project will keep at least one blank page.`)) {
            return;
        }

        let nextPages = pages.filter((page) => page && page.id !== activePage.id);
        let nextActivePage = nextPages[activeIndex] || nextPages[activeIndex - 1] || nextPages[0] || null;

        if (nextPages.length === 0) {
            nextActivePage = this.createPageRecord({
                id: this.makeUniquePageId(),
                name: DEFAULT_PAGE_NAME,
                snapshot: this.createBlankPageSnapshot()
            });
            nextPages = [nextActivePage];
        }

        this.projectState = {
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: nextActivePage.id,
            pages: cloneSerializableData(nextPages)
        };

        this.applyPageSnapshot(nextActivePage.snapshot);
        this.renderProjectControls();
        this.saveState();
        this.showNotification(`Deleted "${pageLabel}".`);
    }

    createPageSnapshot(source = {}) {
        const layout = source.layout && isValidLayout(source.layout)
            ? source.layout
            : (this.layoutManager ? this.layoutManager.serialize() : { mode: 'dashboard', widgets: [] });
        const background = source.background
            || (this.backgroundManager ? this.backgroundManager.serialize() : null);
        const lessonPlan = source.lessonPlan !== undefined
            ? source.lessonPlan
            : (this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null);
        const timerStates = Array.isArray(source.timerStates)
            ? source.timerStates
            : this.collectTimerStateSnapshots();

        return {
            theme: typeof source.theme === 'string' && source.theme.trim()
                ? source.theme
                : document.body.className || 'theme-professional',
            background: cloneSerializableData(background),
            layout: cloneSerializableData(layout),
            timerStates: cloneSerializableData(timerStates),
            lessonPlan: cloneSerializableData(lessonPlan)
        };
    }

    createPageRecord({ id, name, snapshot } = {}) {
        const pageId = typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_PAGE_ID;
        const pageName = typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_PAGE_NAME;

        return {
            id: pageId,
            name: pageName,
            snapshot: this.createPageSnapshot(snapshot)
        };
    }

    normalizePageRecord(page, index = 0, fallbackState = {}) {
        if (!page || typeof page !== 'object') {
            return this.createPageRecord({
                id: `${DEFAULT_PAGE_ID}-${index + 1}`,
                name: `${DEFAULT_PAGE_NAME} ${index + 1}`,
                snapshot: fallbackState
            });
        }

        const pageSource = page.snapshot && typeof page.snapshot === 'object' ? page.snapshot : page;
        const pageId = typeof page.id === 'string' && page.id.trim()
            ? page.id.trim()
            : `${DEFAULT_PAGE_ID}-${index + 1}`;
        const pageName = typeof page.name === 'string' && page.name.trim()
            ? page.name.trim()
            : `${DEFAULT_PAGE_NAME} ${index + 1}`;

        return {
            id: pageId,
            name: pageName,
            snapshot: this.createPageSnapshot({
                ...fallbackState,
                ...pageSource
            })
        };
    }

    normalizeProjectState(state = {}) {
        const sourceState = state && typeof state === 'object' ? state : {};
        const projectName = typeof sourceState.projectName === 'string' && sourceState.projectName.trim()
            ? sourceState.projectName.trim()
            : DEFAULT_PROJECT_NAME;
        const hasPages = Array.isArray(sourceState.pages) && sourceState.pages.length > 0;
        const pages = hasPages
            ? sourceState.pages.map((page, index) => this.normalizePageRecord(page, index, sourceState))
            : [this.createPageRecord({
                id: DEFAULT_PAGE_ID,
                name: DEFAULT_PAGE_NAME,
                snapshot: {
                    theme: sourceState.theme,
                    background: sourceState.background,
                    layout: sourceState.layout,
                    timerStates: sourceState.timerStates,
                    lessonPlan: sourceState.lessonPlan
                }
            })];
        const activePageId = typeof sourceState.activePageId === 'string' && sourceState.activePageId.trim()
            ? sourceState.activePageId.trim()
            : pages[0].id;
        const activePage = pages.find((page) => page.id === activePageId) || pages[0];

        return {
            ...sourceState,
            projectName,
            activePageId: activePage.id,
            pages,
            theme: activePage.snapshot.theme,
            background: cloneSerializableData(activePage.snapshot.background),
            layout: cloneSerializableData(activePage.snapshot.layout),
            timerStates: cloneSerializableData(activePage.snapshot.timerStates),
            lessonPlan: cloneSerializableData(activePage.snapshot.lessonPlan)
        };
    }

    renderProjectControls() {
        const normalizedState = this.normalizeProjectState(this.projectState);
        const pages = Array.isArray(normalizedState.pages) ? normalizedState.pages : [];
        const activePageId = normalizedState.activePageId || (pages[0] && pages[0].id) || DEFAULT_PAGE_ID;
        const activePageIndex = pages.findIndex((page) => page && page.id === activePageId);
        const projectName = normalizedState.projectName || DEFAULT_PROJECT_NAME;
        const pageSummary = pages.length > 0
            ? `Page ${activePageIndex >= 0 ? activePageIndex + 1 : 1} of ${pages.length}`
            : 'Page 1 of 1';
        const currentPageLabel = activePageIndex >= 0 ? `${activePageIndex + 1}` : '1';
        const canMoveLeft = activePageIndex > 0;
        const canMoveRight = activePageIndex >= 0 && activePageIndex < pages.length - 1;

        [
            [this.currentProjectName, projectName],
            [this.teacherCurrentProjectName, projectName]
        ].forEach(([node, value]) => {
            if (node) {
                node.textContent = value;
            }
        });

        [
            [this.currentProjectPageSummary, pageSummary],
            [this.teacherCurrentProjectPageSummary, pageSummary]
        ].forEach(([node, value]) => {
            if (node) {
                node.textContent = value;
            }
        });

        if (this.mainPageCurrent) {
            this.mainPageCurrent.textContent = currentPageLabel;
            this.mainPageCurrent.title = pageSummary;
            this.mainPageCurrent.setAttribute('aria-label', `${pageSummary}. Open screen controls.`);
        }

        [this.teacherPageSwitcher].forEach((container) => {
            if (!container) {
                return;
            }

            container.innerHTML = '';

            pages.forEach((page, index) => {
                if (!page || typeof page.id !== 'string') {
                    return;
                }

                const button = document.createElement('button');
                const pageName = typeof page.name === 'string' && page.name.trim()
                    ? page.name.trim()
                    : `${DEFAULT_PAGE_NAME} ${index + 1}`;
                const isActive = page.id === activePageId;

                button.type = 'button';
                button.className = 'page-switcher__button';
                button.textContent = pageName;
                button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                if (isActive) {
                    button.setAttribute('aria-current', 'page');
                } else {
                    button.removeAttribute('aria-current');
                }
                button.title = isActive ? 'Current page' : `Switch to ${pageName}`;
                button.dataset.pageId = page.id;
                button.addEventListener('click', () => this.switchToPage(page.id));

                if (isActive) {
                    button.classList.add('is-active');
                }

                container.appendChild(button);
            });
        });

        if (this.movePageLeftButton) {
            this.movePageLeftButton.disabled = !canMoveLeft;
        }

        if (this.movePageRightButton) {
            this.movePageRightButton.disabled = !canMoveRight;
        }

        if (this.mainPagePrev) {
            this.mainPagePrev.disabled = !canMoveLeft;
            this.mainPagePrev.title = canMoveLeft ? 'Previous page' : 'No previous page';
        }

        if (this.mainPageNext) {
            this.mainPageNext.disabled = !canMoveRight;
            this.mainPageNext.title = canMoveRight ? 'Next page' : 'No next page';
        }
    }

    applyPageSnapshot(snapshot = {}) {
        if (snapshot.theme) {
            this.switchTheme(snapshot.theme);
        }

        if (snapshot.background) {
            this.backgroundManager.deserialize(snapshot.background);
        } else if (this.backgroundManager && typeof this.backgroundManager.reset === 'function') {
            this.backgroundManager.reset(snapshot.theme || document.body.className || 'theme-professional');
        }

        if (snapshot.layout && Array.isArray(snapshot.layout.widgets)) {
            this.widgets = [];
            this.layoutManager.deserialize(snapshot.layout, (widgetData) => {
                const widget = createWidgetByType(widgetData.type);
                if (widget) {
                    this.widgets.push(widget);
                }
                return widget;
            });
            if (this.widgets.length === 0) {
                this.ensureWidgetPlaceholder();
            }
            this.updateProjectorVisibility();
        } else {
            this.widgets = [];
            if (this.layoutManager && Array.isArray(this.layoutManager.widgets)) {
                this.layoutManager.widgets = [];
            }
            if (this.widgetsContainer) {
                this.widgetsContainer.innerHTML = '';
            }
            this.ensureWidgetPlaceholder();
        }

        if (Array.isArray(snapshot.timerStates)) {
            this.restoreTimerStateSnapshots(snapshot.timerStates);
        }

        if (snapshot.lessonPlan !== undefined && this.lessonPlanEditor) {
            this.lessonPlanEditor.setContents(snapshot.lessonPlan || []);
        }
    }

    restoreTimerStateSnapshots(timerStates = []) {
        if (!Array.isArray(timerStates) || !timerStates.length || !Array.isArray(this.widgets)) {
            return;
        }

        timerStates.forEach((timerState) => {
            if (!timerState || typeof timerState !== 'object') {
                return;
            }

            const targetWidget = this.widgets.find((widget) => {
                if (!widget || typeof widget.applySyncedState !== 'function') {
                    return false;
                }

                if (timerState.widgetId && widget.widgetId) {
                    return widget.widgetId === timerState.widgetId;
                }

                return true;
            });

            if (targetWidget && typeof targetWidget.applySyncedState === 'function') {
                targetWidget.applySyncedState(timerState);
            }
        });
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
        this.presets = Array.isArray(storedPresets)
            ? storedPresets.map((preset) => this.normalizePresetRecord(preset)).filter(Boolean)
            : [];

        const hasLegacyFields = Array.isArray(storedPresets)
            && storedPresets.some((preset) => preset && typeof preset === 'object' && (!Number.isFinite(preset.createdAt) || !Number.isFinite(preset.updatedAt) || !Number.isFinite(preset.lastUsedAt)));
        if (hasLegacyFields) {
            this.savePresets();
        }

        this.renderPresetList();
        this.renderLayoutPresetOptions();
        this.renderClassProfileOptions();
    }

    savePresets() {
        localStorage.setItem(this.presetsKey, JSON.stringify(this.presets));
        this.renderLayoutPresetOptions();
        this.renderClassProfileOptions();
    }

    getPresetClassNames() {
        const classStats = new Map();

        this.presets
            .map((preset) => this.normalizePresetRecord(preset))
            .filter(Boolean)
            .forEach((preset) => {
                if (!preset.className) {
                    return;
                }
                const key = preset.className.trim();
                const latestStamp = Number(preset.lastUsedAt || preset.updatedAt || preset.createdAt || 0);
                const existing = classStats.get(key);

                if (!existing) {
                    classStats.set(key, {
                        name: key,
                        count: 1,
                        lastUsedAt: latestStamp
                    });
                    return;
                }

                existing.count += 1;
                existing.lastUsedAt = Math.max(existing.lastUsedAt, latestStamp);
            });

        return Array.from(classStats.values())
            .sort((a, b) => {
                if (b.lastUsedAt !== a.lastUsedAt) {
                    return b.lastUsedAt - a.lastUsedAt;
                }
                return a.name.localeCompare(b.name);
            });
    }

    renderClassProfileOptions() {
        if (!this.classProfileSelect) {
            return;
        }

        const currentValue = this.classProfileSelect.value || this.presetClassFilterInput?.value || '';
        const classProfiles = this.getPresetClassNames();

        this.classProfileSelect.innerHTML = '<option value="">Choose a class</option>';

        classProfiles.forEach(({ name, count }) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = `${name} (${count})`;
            this.classProfileSelect.appendChild(option);
        });

        if (currentValue) {
            const matchedOption = classProfiles.find(({ name }) => name === currentValue);
            this.classProfileSelect.value = matchedOption ? currentValue : '';
        }
    }

    generateSnapshotName(className = '') {
        const label = String(className || '').trim() || 'Screen';
        const now = new Date();
        const datePart = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const timePart = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${label} - ${datePart} ${timePart}`;
    }

    getUniquePresetName(baseName) {
        const root = String(baseName || '').trim() || 'Screen';
        if (!this.presets.some((preset) => preset.name === root)) {
            return root;
        }

        let index = 2;
        while (this.presets.some((preset) => preset.name === `${root} (${index})`)) {
            index += 1;
        }

        return `${root} (${index})`;
    }

    getLatestPresetForClass(className = '') {
        const target = String(className || '').trim().toLowerCase();
        if (!target) {
            return null;
        }

        const matchingPresets = this.presets
            .map((preset) => this.normalizePresetRecord(preset))
            .filter(Boolean)
            .filter((preset) => preset.className && preset.className.trim().toLowerCase() === target)
            .sort((a, b) => {
                const aStamp = Number.isFinite(a.lastUsedAt) ? a.lastUsedAt : Number.isFinite(a.updatedAt) ? a.updatedAt : a.createdAt || 0;
                const bStamp = Number.isFinite(b.lastUsedAt) ? b.lastUsedAt : Number.isFinite(b.updatedAt) ? b.updatedAt : b.createdAt || 0;
                return bStamp - aStamp;
            });

        return matchingPresets[0] || null;
    }

    syncPresetFilterFromClassProfile() {
        if (!this.classProfileSelect) {
            return;
        }

        const selectedClass = this.classProfileSelect.value || '';
        if (this.presetClassFilterInput) {
            this.presetClassFilterInput.value = selectedClass;
        }
        if (this.presetClassInput) {
            this.presetClassInput.value = selectedClass;
        }
        this.renderPresetList();
    }

    focusPresetListOnSelectedClass() {
        if (!this.classProfileSelect) {
            return;
        }

        this.syncPresetFilterFromClassProfile();
        const className = this.classProfileSelect.value || 'all classes';
        this.showNotification(className === 'all classes'
            ? 'Showing all saved class screens.'
            : `Showing screens for ${className}.`);
    }

    loadLatestPresetForSelectedClass() {
        const className = this.classProfileSelect?.value || this.presetClassFilterInput?.value || this.presetClassInput?.value || '';
        const latestPreset = this.getLatestPresetForClass(className);

        if (!latestPreset) {
            this.showNotification(className
                ? `No saved screen found for ${className}.`
                : 'Choose a class first.', 'warning');
            return;
        }

        this.loadPreset(latestPreset.name);
        if (this.classProfileSelect) {
            this.classProfileSelect.value = latestPreset.className || '';
        }
        if (this.presetClassFilterInput) {
            this.presetClassFilterInput.value = latestPreset.className || '';
        }
    }

    normalizePresetRecord(preset) {
        if (!preset || typeof preset !== 'object') {
            return null;
        }

        const name = typeof preset.name === 'string' ? preset.name.trim() : '';
        if (!name) {
            return null;
        }

        const now = Date.now();
        const createdAt = Number.isFinite(preset.createdAt)
            ? preset.createdAt
            : Number.isFinite(preset.savedAt)
                ? preset.savedAt
                : now;
        const updatedAt = Number.isFinite(preset.updatedAt) ? preset.updatedAt : createdAt;
        const lastUsedAt = Number.isFinite(preset.lastUsedAt) ? preset.lastUsedAt : updatedAt;

        return {
            ...preset,
            name,
            className: typeof preset.className === 'string' ? preset.className.trim() : '',
            period: typeof preset.period === 'string' ? preset.period.trim() : '',
            theme: typeof preset.theme === 'string' && preset.theme.trim() ? preset.theme : document.body.className,
            background: preset.background && typeof preset.background === 'object'
                ? preset.background
                : this.backgroundManager.serialize(),
            layout: preset.layout && typeof preset.layout === 'object'
                ? preset.layout
                : { widgets: [] },
            lessonPlan: preset.lessonPlan ?? null,
            createdAt,
            updatedAt,
            lastUsedAt,
            usageCount: Number.isFinite(preset.usageCount) ? preset.usageCount : 0
        };
    }

    touchPresetUsage(name) {
        const presetIndex = this.presets.findIndex((preset) => preset.name === name);
        if (presetIndex === -1) {
            return null;
        }

        const now = Date.now();
        const currentPreset = this.normalizePresetRecord(this.presets[presetIndex]);
        if (!currentPreset) {
            return null;
        }

        const nextPreset = {
            ...currentPreset,
            lastUsedAt: now,
            usageCount: (Number.isFinite(currentPreset.usageCount) ? currentPreset.usageCount : 0) + 1
        };

        this.presets[presetIndex] = nextPreset;
        this.savePresets();
        this.renderPresetList();
        return nextPreset;
    }

    clonePreset(name) {
        const originalPreset = this.presets.find((preset) => preset.name === name);
        const normalizedOriginal = this.normalizePresetRecord(originalPreset);
        if (!normalizedOriginal) {
            this.showNotification('Screen not found.', 'error');
            return;
        }

        const suggestedName = `${normalizedOriginal.name} Copy`;
        const nextName = window.prompt('Name the duplicate screen', suggestedName);
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            this.showNotification('Enter a screen name first.', 'error');
            return;
        }

        if (this.presets.some((preset) => preset.name === trimmedName)) {
            this.showNotification(`Screen "${trimmedName}" already exists.`, 'error');
            return;
        }

        const now = Date.now();
        const clone = {
            ...normalizedOriginal,
            name: trimmedName,
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0
        };

        this.presets.push(clone);
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Duplicated "${normalizedOriginal.name}" as "${trimmedName}".`);
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

    savePreset(options = {}) {
        const autoName = options.autoName === true;
        const className = this.presetClassInput ? this.presetClassInput.value.trim() : '';
        const suggestedName = this.generateSnapshotName(className);
        let name = this.presetNameInput ? this.presetNameInput.value.trim() : '';

        if (autoName || !name) {
            name = this.getUniquePresetName(suggestedName);
        }

        if (!name) {
            this.showNotification('Enter a screen name first.', 'error');
            return;
        }

        if (this.presets.some((preset) => preset.name === name)) {
            this.showNotification(`Screen "${name}" already exists. Use Overwrite.`, 'error');
            return;
        }

        const now = Date.now();
        const preset = {
            name,
            className,
            period: this.presetPeriodInput ? this.presetPeriodInput.value.trim() : '',
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null,
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0
        };

        this.presets.push(preset);
        this.savePresets();
        this.renderPresetList();
        if (this.presetNameInput) {
            this.presetNameInput.value = name;
        }
        this.showNotification(`Screen "${name}" saved.`);
    }

    loadPreset(name) {
        const preset = this.presets.find((item) => item.name === name);
        if (!preset) {
            this.showNotification('Screen not found.', 'error');
            return;
        }

        if (preset.theme) this.switchTheme(preset.theme);
        if (preset.background) this.backgroundManager.deserialize(preset.background);
        if (preset.lessonPlan && this.lessonPlanEditor) this.lessonPlanEditor.setContents(preset.lessonPlan);
        if (this.presetNameInput) this.presetNameInput.value = preset.name || '';
        if (this.presetClassInput) this.presetClassInput.value = preset.className || '';
        if (this.presetPeriodInput) this.presetPeriodInput.value = preset.period || '';
        if (this.classProfileSelect) this.classProfileSelect.value = preset.className || '';
        if (this.presetClassFilterInput) this.presetClassFilterInput.value = preset.className || '';

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
        this.touchPresetUsage(preset.name);
        this.showNotification(`Screen "${preset.name}" loaded.`);
    }

    applyLayoutPreset() {
        if (!this.layoutPresetSelect) return;

        const selectedName = this.layoutPresetSelect.value;
        if (!selectedName) {
            this.showNotification('Select a screen first.', 'error');
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
            this.showNotification('Screen not found.', 'error');
            return;
        }
        const existingPreset = this.normalizePresetRecord(this.presets[presetIndex]);
        const now = Date.now();
        this.presets[presetIndex] = {
            ...existingPreset,
            name,
            className,
            period,
            theme: document.body.className,
            background: this.backgroundManager.serialize(),
            layout: this.layoutManager.serialize(),
            lessonPlan: this.lessonPlanEditor ? this.lessonPlanEditor.getContents() : null,
            createdAt: Number.isFinite(existingPreset?.createdAt) ? existingPreset.createdAt : now,
            updatedAt: now,
            lastUsedAt: Number.isFinite(existingPreset?.lastUsedAt) ? existingPreset.lastUsedAt : now,
            usageCount: Number.isFinite(existingPreset?.usageCount) ? existingPreset.usageCount : 0
        };
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Screen "${name}" overwritten.`);
    }

    deletePreset(name) {
        const presetIndex = this.presets.findIndex(preset => preset.name === name);
        if (presetIndex === -1) {
            this.showNotification('Screen not found.', 'error');
            return;
        }
        if (!confirm(`Delete screen "${name}"?`)) {
            return;
        }
        this.presets.splice(presetIndex, 1);
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Screen "${name}" deleted.`);
    }

    getSerializableState() {
        return this.buildStateSnapshot();
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

            const state = this.normalizeProjectState(runMigrations(parsed.state, this.schemaVersion));

            const summary = `
                Ready to import:
                - ${parsed.presets.length} presets
                - ${state.layout?.widgets?.length || 0} widgets
                - Theme: ${state.theme || 'default'}
            `;
            this.importSummary.textContent = summary;
            this.importSummary.style.color = 'green';

            // Normalize imported presets
            this.presets = parsed.presets
                .map((preset) => this.normalizePresetRecord(preset))
                .filter(Boolean);
            this.savePresets();
            this.renderPresetList();

            if (state.theme) this.switchTheme(state.theme);
            if (state.background) this.backgroundManager.deserialize(state.background);
            if (state.lessonPlan && this.lessonPlanEditor) this.lessonPlanEditor.setContents(state.lessonPlan);

            this.projectState = {
                projectName: state.projectName,
                activePageId: state.activePageId,
                pages: cloneSerializableData(state.pages)
            };

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
            this.renderProjectControls();
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

        const filteredPresets = this.presets
            .map((preset) => this.normalizePresetRecord(preset))
            .filter(Boolean)
            .filter((preset) => {
                const classNameMatch = !classFilter || (preset.className && preset.className.toLowerCase().includes(classFilter));
                const periodMatch = !periodFilter || (preset.period && preset.period.toLowerCase() === periodFilter);
                return classNameMatch && periodMatch;
            })
            .sort((a, b) => {
                const aStamp = Number.isFinite(a.lastUsedAt)
                    ? a.lastUsedAt
                    : Number.isFinite(a.updatedAt)
                        ? a.updatedAt
                        : a.createdAt || 0;
                const bStamp = Number.isFinite(b.lastUsedAt)
                    ? b.lastUsedAt
                    : Number.isFinite(b.updatedAt)
                        ? b.updatedAt
                        : b.createdAt || 0;

                if (aStamp !== bStamp) {
                    return bStamp - aStamp;
                }

                return a.name.localeCompare(b.name);
            });

        this.presetListElement.innerHTML = '';
        if (filteredPresets.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.textContent = 'No class screens match your filters.';
            this.presetListElement.appendChild(emptyState);
            this.renderClassProfileOptions();
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
            subtext.textContent = `${classInfo} - ${periodInfo}`;

            const metaLine = document.createElement('span');
            metaLine.className = 'preset-meta';
            const lastUsed = Number.isFinite(preset.lastUsedAt) ? new Date(preset.lastUsedAt).toLocaleString() : 'Not opened yet';
            const usageInfo = Number.isFinite(preset.usageCount) && preset.usageCount > 0
                ? `${preset.usageCount} open${preset.usageCount === 1 ? '' : 's'}`
                : 'Saved only';
            metaLine.textContent = `Last used ${lastUsed} - ${usageInfo}`;

            const mainInfo = document.createElement('div');
            mainInfo.className = 'preset-main-info';
            mainInfo.appendChild(name);
            mainInfo.appendChild(subtext);
            mainInfo.appendChild(metaLine);

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

            const duplicateButton = document.createElement('button');
            duplicateButton.type = 'button';
            duplicateButton.className = 'control-button';
            duplicateButton.textContent = 'Duplicate';
            duplicateButton.dataset.action = 'duplicate';
            duplicateButton.dataset.name = preset.name;

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'control-button';
            deleteButton.textContent = 'Delete';
            deleteButton.dataset.action = 'delete';
            deleteButton.dataset.name = preset.name;

            item.addEventListener('click', (e) => {
                const button = e.target.closest('button');
                if (!button) return;

                const action = button.dataset.action;
                const presetName = button.dataset.name;

                if (action === 'load') this.loadPreset(presetName);
                if (action === 'overwrite') this.overwritePreset(presetName);
                if (action === 'duplicate') this.clonePreset(presetName);
                if (action === 'delete') this.deletePreset(presetName);
            });

            actions.appendChild(loadButton);
            actions.appendChild(overwriteButton);
            actions.appendChild(duplicateButton);
            actions.appendChild(deleteButton);

            item.appendChild(mainInfo);
            item.appendChild(actions);

            this.presetListElement.appendChild(item);
        });

        this.renderClassProfileOptions();
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
            state = this.normalizeProjectState(state);
            this.projectState = {
                projectName: state.projectName,
                activePageId: state.activePageId,
                pages: cloneSerializableData(state.pages)
            };

            if (!isValidLayout(state.layout)) {
                console.warn('Invalid layout detected. Resetting layout state.');
                resetAppState();
                return;
            }

            const activePage = state.pages.find((page) => page.id === state.activePageId) || state.pages[0];
            if (activePage && activePage.snapshot) {
                this.applyPageSnapshot(activePage.snapshot);
            }
            this.renderProjectControls();
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
        if (widget instanceof TimerWidget) {
            this.syncTimerControlsFromWidget();
        }
        if (this.isRevealManagerWidget(widget)) {
            this.syncPresentationControlsFromWidget();
        }
        this.saveState();
    }

    getPrimaryTimerWidget() {
        return this.widgets.find(widget => widget instanceof TimerWidget) || null;
    }

    collectTimerStateSnapshots() {
        return this.widgets
            .filter(widget => widget instanceof TimerWidget && typeof widget.getTimerStateSnapshot === 'function')
            .map(widget => widget.getTimerStateSnapshot());
    }

    syncTimerStateToProjector(timerState = {}) {
        if (!this.projectorChannel || !timerState || typeof timerState !== 'object') {
            return;
        }

        this.projectorChannel.postMessage({
            type: 'timer-sync',
            source: 'teacher',
            timerState,
            syncToken: this.projectorSyncToken
        });
    }

    formatTimerStatusDisplay(remainingSeconds = 0, currentPhase = null, isIntervalMode = false) {
        const safeSeconds = Number.isFinite(remainingSeconds) ? Math.max(0, Math.floor(remainingSeconds)) : 0;
        const minutes = Math.floor(safeSeconds / 60);
        const seconds = safeSeconds % 60;
        const label = isIntervalMode && currentPhase ? `${currentPhase}: ` : '';
        return `${label}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    renderTimerControlState({
        hasTimer = false,
        running = false,
        remainingSeconds = 0,
        display = '00:00',
        isIntervalMode = false,
        currentPhase = null,
        statusMessage = ''
    } = {}) {
        if (!this.timerStatusBadge || !this.timerStatusDisplay || !this.timerStatusMeta) {
            return;
        }

        let badgeText = 'No Timer';
        let badgeState = 'empty';
        let metaText = statusMessage || 'Add a timer widget or press Start to begin.';

        if (hasTimer) {
            if (running) {
                badgeText = 'Running';
                badgeState = 'running';
                metaText = statusMessage || (isIntervalMode && currentPhase
                    ? `${currentPhase} phase is active on the classroom screen.`
                    : 'Timer is active on the classroom screen.');
            } else if (remainingSeconds > 0) {
                badgeText = 'Stopped';
                badgeState = 'stopped';
                metaText = statusMessage || 'Timer is ready to resume or reset.';
            } else {
                badgeText = 'Ready';
                badgeState = 'idle';
                metaText = statusMessage || 'Timer widget is ready. Set a duration and press Start.';
            }
        }

        this.timerStatusBadge.textContent = badgeText;
        this.timerStatusBadge.dataset.state = badgeState;
        this.timerStatusDisplay.textContent = display || this.formatTimerStatusDisplay(remainingSeconds, currentPhase, isIntervalMode);
        this.timerStatusMeta.textContent = metaText;

        if (this.resetTimerButton) {
            this.resetTimerButton.disabled = !hasTimer;
        }
    }

    syncTimerControlsFromWidget(widget = this.getPrimaryTimerWidget()) {
        if (!widget) {
            this.renderTimerControlState();
            return;
        }

        this.renderTimerControlState({
            hasTimer: true,
            running: !!widget.running,
            remainingSeconds: widget.time,
            display: typeof widget.getDisplayText === 'function'
                ? widget.getDisplayText()
                : this.formatTimerStatusDisplay(widget.time, widget.currentPhase, widget.isIntervalMode),
            isIntervalMode: !!widget.isIntervalMode,
            currentPhase: widget.currentPhase || null,
            statusMessage: widget.latestStatusMessage || ''
        });
    }

    syncTimerControlsFromPayload(payload = {}) {
        const timerWidget = this.getPrimaryTimerWidget();
        if (!timerWidget) {
            this.renderTimerControlState();
            return;
        }

        if (payload.widgetId && timerWidget.widgetId && payload.widgetId !== timerWidget.widgetId) {
            return;
        }

        this.renderTimerControlState({
            hasTimer: true,
            running: typeof payload.running === 'boolean' ? payload.running : !!timerWidget.running,
            remainingSeconds: Number.isFinite(payload.remainingSeconds) ? payload.remainingSeconds : timerWidget.time,
            display: payload.display || (typeof timerWidget.getDisplayText === 'function'
                ? timerWidget.getDisplayText()
                : this.formatTimerStatusDisplay(timerWidget.time, timerWidget.currentPhase, timerWidget.isIntervalMode)),
            isIntervalMode: typeof payload.isIntervalMode === 'boolean' ? payload.isIntervalMode : !!timerWidget.isIntervalMode,
            currentPhase: payload.currentPhase || timerWidget.currentPhase || null,
            statusMessage: payload.statusMessage || timerWidget.latestStatusMessage || ''
        });
    }

    startTimerFromControls() {
        const timerWidget = this.ensureTimerWidget();
        if (timerWidget) {
            const hours = parseInt(document.getElementById('timer-hours').value, 10) || 0;
            const minutes = parseInt(document.getElementById('timer-minutes').value, 10) || 0;
            const seconds = parseInt(document.getElementById('timer-seconds').value, 10) || 0;
            const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
            const totalMinutes = totalSeconds / 60;
            if (totalSeconds > 0) {
                eventBus.emit('timer:start', { widgetId: timerWidget.widgetId, minutes: totalMinutes, seconds: totalSeconds });
            } else {
                this.showNotification('Please set a timer duration.', 'warning');
            }
        }
    }

    applyTimerPresetToControls(minutes) {
        const safeMinutes = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
        document.getElementById('timer-hours').value = 0;
        document.getElementById('timer-minutes').value = safeMinutes;
        document.getElementById('timer-seconds').value = 0;
        this.showNotification(`Timer set to ${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}. Press Start to begin.`, 'success');
    }

    startTimerPresetFromControls(minutes) {
        const timerWidget = this.ensureTimerWidget();
        if (!timerWidget) {
            return;
        }

        eventBus.emit('timer:start', { widgetId: timerWidget.widgetId, minutes });
    }

    stopTimerFromControls() {
        const timerWidget = this.getPrimaryTimerWidget();
        if (timerWidget) {
            eventBus.emit('timer:stop', { widgetId: timerWidget.widgetId });
        } else {
            this.showNotification('No timer widget found.', 'error');
        }
    }

    resetTimerFromControls() {
        const timerWidget = this.getPrimaryTimerWidget();
        if (timerWidget) {
            eventBus.emit('timer:reset', { widgetId: timerWidget.widgetId });
        } else {
            this.showNotification('No timer widget found.', 'error');
            this.renderTimerControlState();
        }
    }

    ensureTimerWidget() {
        let timerWidget = this.getPrimaryTimerWidget();
        if (timerWidget) {
            this.syncTimerControlsFromWidget(timerWidget);
            return timerWidget;
        }

        this.addWidget('timer');
        timerWidget = this.getPrimaryTimerWidget();

        if (!timerWidget) {
            this.showNotification('Unable to create a timer widget.', 'error');
            return null;
        }

        this.syncTimerControlsFromWidget(timerWidget);
        return timerWidget;
    }

    isRevealManagerWidget(widget) {
        if (!widget || !widget.constructor) {
            return false;
        }

        return getRegistryWidgetKey(widget.constructor.name) === 'reveal-manager';
    }

    getPrimaryRevealManagerWidget() {
        return this.widgets.find(widget => this.isRevealManagerWidget(widget)) || null;
    }

    getSavedPresentationDecks(rawDecks = null) {
        let decks = rawDecks;
        if (!Array.isArray(decks)) {
            try {
                const parsed = JSON.parse(localStorage.getItem('revealDecks') || '[]');
                decks = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                decks = [];
            }
        }

        return decks
            .filter((deck) => deck && typeof deck === 'object' && deck.id)
            .map((deck) => {
                const type = deck.type === 'google-slides' || deck.type === 'powerpoint' ? deck.type : 'html';
                const label = type === 'google-slides'
                    ? 'Google Slides'
                    : type === 'powerpoint'
                        ? 'PowerPoint'
                        : 'Reveal HTML';
                const name = typeof deck.name === 'string' && deck.name.trim()
                    ? deck.name.trim()
                    : label;

                return {
                    id: Number(deck.id),
                    type,
                    label,
                    name
                };
            })
            .filter((deck) => Number.isFinite(deck.id) && deck.id > 0);
    }

    getLastPresentationDeck() {
        try {
            const parsed = JSON.parse(localStorage.getItem('revealLastDeck') || 'null');
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    updatePresentationLastDeckAction() {
        if (!this.presentationLastButton) {
            return;
        }

        const lastDeck = this.getLastPresentationDeck();
        const sourceLabel = lastDeck?.type === 'powerpoint'
            ? 'PowerPoint'
            : lastDeck?.type === 'google-slides'
                ? 'Google Slides'
                : 'Deck';

        this.presentationLastButton.disabled = !lastDeck;
        this.presentationLastButton.textContent = lastDeck
            ? `Present Last ${sourceLabel}`
            : 'Present Last Deck';
    }

    renderPresentationSavedDeckOptions(rawDecks = null) {
        if (!this.presentationSavedSelect) {
            return;
        }

        const savedDecks = this.getSavedPresentationDecks(rawDecks);
        const selectedValue = this.presentationSavedSelect.value;
        this.presentationSavedSelect.innerHTML = '<option value="">Select saved presentation</option>';

        savedDecks.forEach((deck) => {
            const option = document.createElement('option');
            option.value = String(deck.id);
            option.textContent = `${deck.name} - ${deck.label}`;
            this.presentationSavedSelect.appendChild(option);
        });

        if (selectedValue && savedDecks.some((deck) => String(deck.id) === selectedValue)) {
            this.presentationSavedSelect.value = selectedValue;
        }

        const hasSavedDecks = savedDecks.length > 0;
        if (this.presentationSavedHint) {
            this.presentationSavedHint.textContent = hasSavedDecks
                ? 'Saved decks from Reveal Manager appear here so you can reopen them from Teacher Controls.'
                : 'Save a deck in Reveal Manager and it will appear here for quick reopening.';
        }

        this.updatePresentationSavedActions(hasSavedDecks);
    }

    updatePresentationSavedActions(hasSavedDecks = this.presentationSavedSelect?.options?.length > 1) {
        const hasSelection = !!this.presentationSavedSelect?.value;

        if (this.presentationOpenSavedButton) {
            this.presentationOpenSavedButton.disabled = !hasSavedDecks || !hasSelection;
        }

        if (this.presentationOpenSavedProjectorButton) {
            this.presentationOpenSavedProjectorButton.disabled = !hasSavedDecks || !hasSelection;
        }

        if (this.presentationRenameSavedButton) {
            this.presentationRenameSavedButton.disabled = !hasSavedDecks || !hasSelection;
        }

        if (this.presentationDeleteSavedButton) {
            this.presentationDeleteSavedButton.disabled = !hasSavedDecks || !hasSelection;
        }
    }

    detectPresentationSourceTypeFromUrl(url = '') {
        const raw = String(url || '').trim();
        if (!raw) {
            return null;
        }

        let normalizedUrl = raw;
        if (!/^https?:\/\//i.test(normalizedUrl)) {
            normalizedUrl = `https://${normalizedUrl}`;
        }

        try {
            const parsed = new URL(normalizedUrl);
            const hostname = parsed.hostname.toLowerCase();
            const pathname = parsed.pathname.toLowerCase();

            if (hostname.includes('docs.google.com') && pathname.includes('/presentation')) {
                return 'google-slides';
            }

            if (hostname.includes('slides.google.com')) {
                return 'google-slides';
            }

            if (hostname.includes('powerpoint.live.com')
                || hostname.includes('office.com')
                || hostname.includes('officeapps.live.com')
                || hostname.includes('onedrive.live.com')
                || hostname.includes('sharepoint.com')
                || pathname.includes('.ppt')
                || pathname.includes('.pptx')) {
                return 'powerpoint';
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    validatePresentationSourceUrl(sourceType = 'google-slides', url = '') {
        const normalizedSourceType = sourceType === 'powerpoint' ? 'powerpoint' : 'google-slides';
        const raw = String(url || '').trim();
        if (!raw) {
            return {
                sourceType: normalizedSourceType,
                detectedSourceType: null,
                normalizedUrl: '',
                state: 'empty',
                message: '',
                canProceed: false
            };
        }

        let normalizedUrl = raw;
        if (!/^https?:\/\//i.test(normalizedUrl)) {
            normalizedUrl = `https://${normalizedUrl}`;
        }

        let parsed;
        try {
            parsed = new URL(normalizedUrl);
        } catch (error) {
            return {
                sourceType: normalizedSourceType,
                detectedSourceType: null,
                normalizedUrl,
                state: 'error',
                message: 'Enter a full web link for Google Slides or PowerPoint.',
                canProceed: false
            };
        }

        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.toLowerCase();
        const search = parsed.search.toLowerCase();
        const hash = parsed.hash.toLowerCase();
        const queryText = `${search}${hash}`;
        const detectedSourceType = this.detectPresentationSourceTypeFromUrl(normalizedUrl);

        if (!detectedSourceType) {
            return {
                sourceType: normalizedSourceType,
                detectedSourceType: null,
                normalizedUrl,
                state: 'error',
                message: 'This link is not recognised as a Google Slides or PowerPoint presentation.',
                canProceed: false
            };
        }

        if (detectedSourceType === 'google-slides') {
            if (!(hostname.includes('docs.google.com') || hostname.includes('slides.google.com'))) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'error',
                    message: 'Use a Google Slides web link from docs.google.com or slides.google.com.',
                    canProceed: false
                };
            }

            if (hostname.includes('docs.google.com') && !pathname.includes('/presentation')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'error',
                    message: 'This Google link is not pointing to a Slides presentation.',
                    canProceed: false
                };
            }

            if (pathname.includes('/edit') || queryText.includes('action=edit') || queryText.includes('mode=edit')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This looks like an edit link. It may open the editor instead of a clean presentation view.',
                    canProceed: true
                };
            }

            if (pathname.includes('/copy')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This looks like a copy link. A Present, Preview, or Publish link is safer for class display.',
                    canProceed: true
                };
            }

            if (pathname.includes('/presentation/d/')
                && !pathname.includes('/present')
                && !pathname.includes('/preview')
                && !pathname.includes('/pub')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This share link should work, but a Present or Publish link is more reliable on the projector.',
                    canProceed: true
                };
            }
        }

        if (detectedSourceType === 'powerpoint') {
            const isMicrosoftHost = hostname.includes('powerpoint.live.com')
                || hostname.includes('office.com')
                || hostname.includes('officeapps.live.com')
                || hostname.includes('onedrive.live.com')
                || hostname.includes('1drv.ms')
                || hostname.includes('sharepoint.com');

            if (!isMicrosoftHost && !pathname.includes('.ppt') && !pathname.includes('.pptx')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'error',
                    message: 'Use a Microsoft 365, OneDrive, SharePoint, or direct PowerPoint web link.',
                    canProceed: false
                };
            }

            if (pathname.includes('/edit')
                || pathname.includes('edit.aspx')
                || queryText.includes('action=edit')
                || queryText.includes('mode=edit')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This looks like an edit link. It may open the Office editor instead of the live presentation view.',
                    canProceed: true
                };
            }

            if (pathname.includes('.ppt') || pathname.includes('.pptx')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This file link is accepted, but a browser presentation link is safer for live projection.',
                    canProceed: true
                };
            }

            if ((hostname.includes('onedrive.live.com') || hostname.includes('1drv.ms') || hostname.includes('sharepoint.com'))
                && !hostname.includes('powerpoint.live.com')
                && !pathname.includes('powerpoint')) {
                return {
                    sourceType: normalizedSourceType,
                    detectedSourceType,
                    normalizedUrl,
                    state: 'warning',
                    message: 'This share link may open a file page first. A dedicated PowerPoint presentation link is more reliable.',
                    canProceed: true
                };
            }
        }

        return {
            sourceType: normalizedSourceType,
            detectedSourceType,
            normalizedUrl,
            state: 'ok',
            message: '',
            canProceed: true
        };
    }

    renderPresentationLinkValidation(validation = null) {
        if (!this.presentationLinkValidation) {
            return validation;
        }

        if (!validation || !validation.message || validation.state === 'ok' || validation.state === 'empty') {
            this.presentationLinkValidation.hidden = true;
            this.presentationLinkValidation.textContent = '';
            delete this.presentationLinkValidation.dataset.state;
            return validation;
        }

        this.presentationLinkValidation.hidden = false;
        this.presentationLinkValidation.textContent = validation.message;
        this.presentationLinkValidation.dataset.state = validation.state;
        return validation;
    }

    syncPresentationSourceTypeFromUrl() {
        const currentUrl = this.presentationSourceUrlInput?.value || '';
        const detectedSourceType = this.detectPresentationSourceTypeFromUrl(currentUrl);
        if (!detectedSourceType || !this.presentationSourceTypeSelect) {
            this.renderPresentationLinkValidation(this.validatePresentationSourceUrl(
                this.presentationSourceTypeSelect?.value || 'google-slides',
                currentUrl
            ));
            return;
        }

        if (this.presentationSourceTypeSelect.value !== detectedSourceType) {
            this.updatePresentationLinkInputs(detectedSourceType);
            return;
        }

        this.renderPresentationLinkValidation(this.validatePresentationSourceUrl(
            this.presentationSourceTypeSelect.value,
            currentUrl
        ));
    }

    updatePresentationLinkInputs(sourceType = this.presentationSourceTypeSelect?.value || 'google-slides') {
        const normalizedSourceType = sourceType === 'powerpoint' ? 'powerpoint' : 'google-slides';
        const sourceLabel = normalizedSourceType === 'powerpoint' ? 'PowerPoint' : 'Google Slides';
        const urlPlaceholder = normalizedSourceType === 'powerpoint'
            ? 'Paste the PowerPoint web presentation URL'
            : 'Paste the Google Slides share or present URL';
        const namePlaceholder = normalizedSourceType === 'powerpoint'
            ? 'Optional PowerPoint name'
            : 'Optional Google Slides name';
        const hintText = normalizedSourceType === 'powerpoint'
            ? 'Paste a Microsoft 365 or PowerPoint embed-ready link here. Embeddable links can mirror in Teacher Screen and the projector.'
            : 'Paste a Google Slides link here. Embeddable links can mirror in Teacher Screen and the projector.';

        if (this.presentationSourceTypeSelect && this.presentationSourceTypeSelect.value !== normalizedSourceType) {
            this.presentationSourceTypeSelect.value = normalizedSourceType;
        }

        if (this.presentationSourceUrlInput) {
            this.presentationSourceUrlInput.placeholder = urlPlaceholder;
        }

        if (this.presentationSourceNameInput) {
            this.presentationSourceNameInput.placeholder = namePlaceholder;
        }

        if (this.presentationLinkHint) {
            this.presentationLinkHint.textContent = hintText;
        }

        if (this.presentationOpenLinkButton) {
            this.presentationOpenLinkButton.textContent = `Open ${sourceLabel} Link`;
        }

        if (this.presentationOpenProjectorLinkButton) {
            this.presentationOpenProjectorLinkButton.textContent = `Open ${sourceLabel} And Project`;
        }

        this.renderPresentationLinkValidation(this.validatePresentationSourceUrl(
            normalizedSourceType,
            this.presentationSourceUrlInput?.value || ''
        ));
    }

    getPresentationLinkDraft() {
        return {
            sourceType: this.presentationSourceTypeSelect?.value || 'google-slides',
            sourceUrl: this.presentationSourceUrlInput?.value?.trim() || '',
            deckName: this.presentationSourceNameInput?.value?.trim() || ''
        };
    }

    formatPresentationSourceContext(sourceType = 'html', currentIndices = {}, sourceUrl = '') {
        if (sourceType === 'html') {
            const horizontalIndex = Number.isFinite(currentIndices?.h) ? currentIndices.h + 1 : 1;
            const verticalIndex = Number.isFinite(currentIndices?.v) ? currentIndices.v : 0;
            return verticalIndex > 0
                ? `Slide ${horizontalIndex}.${verticalIndex + 1}`
                : `Slide ${horizontalIndex}`;
        }

        if (!sourceUrl) {
            return 'External source linked';
        }

        try {
            const parsed = new URL(sourceUrl);
            const trimmedPath = parsed.pathname && parsed.pathname !== '/'
                ? parsed.pathname.replace(/\/$/, '')
                : '';
            return `${parsed.hostname}${trimmedPath}`;
        } catch (error) {
            return sourceUrl;
        }
    }

    buildPresentationControlState(widget = null, payload = {}) {
        if (!widget) {
            return {
                hasWidget: false,
                hasDeck: false,
                sourceType: null,
                sourceLabel: '',
                deckName: 'Reveal Manager',
                currentIndices: { h: 0, v: 0 },
                statusMessage: '',
                sourceUrl: ''
            };
        }

        const deckFromPayload = payload.activeDeck && typeof payload.activeDeck === 'object'
            ? payload.activeDeck
            : null;
        const activeDeck = deckFromPayload || widget.activeDeck || null;
        const sourceType = activeDeck?.type || payload.sourceType || 'html';
        const sourceLabel = payload.sourceLabel
            || (typeof widget.getSourceTypeLabel === 'function' ? widget.getSourceTypeLabel(sourceType) : 'Reveal HTML');
        const currentIndices = payload.currentIndices && typeof payload.currentIndices === 'object'
            ? payload.currentIndices
            : (widget.currentIndices || { h: 0, v: 0 });

        return {
            hasWidget: true,
            hasDeck: !!activeDeck,
            sourceType,
            sourceLabel,
            deckName: activeDeck?.name || 'Reveal Manager',
            currentIndices,
            statusMessage: payload.statusMessage || widget.statusLabel?.textContent || '',
            sourceUrl: payload.sourceUrl || activeDeck?.sourceUrl || ''
        };
    }

    renderPresentationControlState({
        hasWidget = false,
        hasDeck = false,
        sourceType = null,
        sourceLabel = '',
        deckName = 'Reveal Manager',
        currentIndices = { h: 0, v: 0 },
        statusMessage = '',
        sourceUrl = ''
    } = {}) {
        if (!this.presentationStatusBadge || !this.presentationStatusDisplay || !this.presentationStatusContext || !this.presentationStatusMeta) {
            return;
        }

        let badgeText = 'No Presentation';
        let badgeState = 'empty';
        let displayText = deckName || 'Reveal Manager';
        let contextText = 'Add a Reveal Manager widget to load Reveal HTML, Google Slides, or PowerPoint.';
        let metaText = 'Teacher Controls mirrors the Reveal widget instead of creating a second slide system.';
        let manageLabel = 'Add Reveal Manager';

        if (hasWidget) {
            badgeText = 'Widget Ready';
            badgeState = 'idle';
            displayText = 'Reveal Manager';
            contextText = 'No presentation is loaded yet.';
            metaText = statusMessage || 'Open the Reveal Manager widget to load Reveal HTML or link a Google Slides / PowerPoint deck.';
            manageLabel = 'Open Presentation Controls';
        }

        if (hasWidget && hasDeck) {
            const isHtmlDeck = sourceType === 'html';
            badgeText = sourceLabel || 'Presentation';
            badgeState = isHtmlDeck ? 'live' : 'external';
            displayText = deckName || sourceLabel || 'Presentation';
            contextText = this.formatPresentationSourceContext(sourceType, currentIndices, sourceUrl);
            metaText = statusMessage || (isHtmlDeck
                ? 'Prev / Next controls stay available here and in the Reveal widget.'
                : 'This external presentation is linked in Reveal Manager. Embeddable links can mirror in Teacher Screen and the projector.');
        }

        if (hasDeck && (sourceType === 'google-slides' || sourceType === 'powerpoint')) {
            this.updatePresentationLinkInputs(sourceType);
            if (this.presentationSourceNameInput) {
                this.presentationSourceNameInput.value = deckName || '';
            }
            if (this.presentationSourceUrlInput) {
                this.presentationSourceUrlInput.value = sourceUrl || '';
            }
        } else {
            this.updatePresentationLinkInputs();
        }

        this.presentationStatusBadge.textContent = badgeText;
        this.presentationStatusBadge.dataset.state = badgeState;
        this.presentationStatusDisplay.textContent = displayText;
        this.presentationStatusContext.textContent = contextText;
        this.presentationStatusMeta.textContent = metaText;

        if (this.presentationManageButton) {
            this.presentationManageButton.textContent = manageLabel;
        }

        if (this.presentationProjectorButton) {
            this.presentationProjectorButton.disabled = !hasDeck;
        }

        const canNavigate = hasDeck && sourceType === 'html';
        if (this.presentationPrevButton) {
            this.presentationPrevButton.disabled = !canNavigate;
        }
        if (this.presentationNextButton) {
            this.presentationNextButton.disabled = !canNavigate;
        }
    }

    syncPresentationControlsFromWidget(widget = this.getPrimaryRevealManagerWidget()) {
        this.renderPresentationSavedDeckOptions();
        this.updatePresentationLastDeckAction();
        this.renderPresentationControlState(this.buildPresentationControlState(widget));
    }

    syncPresentationControlsFromPayload(payload = {}) {
        const presentationWidget = this.getPrimaryRevealManagerWidget();
        if (!presentationWidget) {
            this.updatePresentationLastDeckAction();
            this.renderPresentationControlState();
            return;
        }

        if (payload.widgetId && presentationWidget.widgetId && payload.widgetId !== presentationWidget.widgetId) {
            return;
        }

        this.renderPresentationControlState(this.buildPresentationControlState(presentationWidget, payload));
        this.updatePresentationLastDeckAction();
    }

    openPresentationControlsFromPanel() {
        let presentationWidget = this.getPrimaryRevealManagerWidget();
        if (!presentationWidget) {
            this.addWidget('reveal-manager');
            presentationWidget = this.getPrimaryRevealManagerWidget();
        }

        if (!presentationWidget) {
            this.showNotification('Unable to create a Reveal Manager widget.', 'error');
            return;
        }

        this.handleNavClick('classroom');
        this.syncPresentationControlsFromWidget(presentationWidget);
        document.dispatchEvent(new CustomEvent('openWidgetSettings', {
            detail: { widget: presentationWidget }
        }));
    }

    async ensureRevealManagerWidget() {
        let presentationWidget = this.getPrimaryRevealManagerWidget();
        if (!presentationWidget) {
            this.addWidget('reveal-manager');
            presentationWidget = this.getPrimaryRevealManagerWidget();
        }

        return presentationWidget;
    }

    async openPresentationLinkFromPanel({ openProjector = false } = {}) {
        const { sourceType, sourceUrl, deckName } = this.getPresentationLinkDraft();
        const validation = this.validatePresentationSourceUrl(sourceType, sourceUrl);
        const effectiveSourceType = validation.detectedSourceType || sourceType;
        const sourceLabel = effectiveSourceType === 'powerpoint' ? 'PowerPoint' : 'Google Slides';

        if (!sourceUrl) {
            this.showNotification(`Paste a ${sourceLabel} link first.`, 'warning');
            return;
        }

        this.renderPresentationLinkValidation(validation);
        if (!validation.canProceed) {
            this.showNotification(validation.message || `Paste a ${sourceLabel} link first.`, 'error');
            return;
        }

        const presentationWidget = await this.ensureRevealManagerWidget();

        if (!presentationWidget) {
            this.showNotification('Unable to create a Reveal Manager widget.', 'error');
            return;
        }

        if (typeof presentationWidget.loadExternalSource !== 'function') {
            this.showNotification('This Reveal Manager build does not support direct links yet.', 'error');
            return;
        }

        const loaded = await presentationWidget.loadExternalSource({
            type: effectiveSourceType,
            sourceUrl: validation.normalizedUrl || sourceUrl,
            name: deckName
        });

        if (!loaded) {
            this.showNotification(`Unable to load that ${sourceLabel} link.`, 'error');
            return;
        }

        this.handleNavClick('classroom');
        this.syncPresentationControlsFromWidget(presentationWidget);

        if (openProjector && typeof presentationWidget.openProjector === 'function') {
            const projectorOpened = presentationWidget.openProjector();
            this.syncPresentationControlsFromWidget(presentationWidget);
            if (!projectorOpened) {
                this.showNotification('Projector popup blocked or unavailable.', 'warning');
                return;
            }
            this.showNotification(`${sourceLabel} link loaded and opened on the projector.`, 'success');
            return;
        }

        this.showNotification(`${sourceLabel} link loaded in Reveal Manager.`, 'success');
    }

    async savePresentationLinkFromPanel() {
        const { sourceType, sourceUrl, deckName } = this.getPresentationLinkDraft();
        const validation = this.validatePresentationSourceUrl(sourceType, sourceUrl);
        const effectiveSourceType = validation.detectedSourceType || sourceType;
        const sourceLabel = effectiveSourceType === 'powerpoint' ? 'PowerPoint' : 'Google Slides';

        if (!sourceUrl) {
            this.showNotification(`Paste a ${sourceLabel} link first.`, 'warning');
            return;
        }

        this.renderPresentationLinkValidation(validation);
        if (!validation.canProceed) {
            this.showNotification(validation.message || `Paste a ${sourceLabel} link first.`, 'error');
            return;
        }

        const presentationWidget = await this.ensureRevealManagerWidget();
        if (!presentationWidget) {
            this.showNotification('Unable to create a Reveal Manager widget.', 'error');
            return;
        }

        if (typeof presentationWidget.saveExternalSource !== 'function') {
            this.showNotification('This Reveal Manager build does not support saving direct links yet.', 'error');
            return;
        }

        const savedDeck = presentationWidget.saveExternalSource({
            type: effectiveSourceType,
            sourceUrl: validation.normalizedUrl || sourceUrl,
            name: deckName
        });

        if (!savedDeck) {
            this.showNotification(`Unable to save that ${sourceLabel} link.`, 'error');
            return;
        }

        this.renderPresentationSavedDeckOptions();
        if (this.presentationSavedSelect) {
            this.presentationSavedSelect.value = String(savedDeck.id);
        }
        this.updatePresentationSavedActions();
        this.showNotification(`${sourceLabel} link saved for quick access.`, 'success');
    }

    async openSavedPresentationFromPanel({ openProjector = false } = {}) {
        const selectedId = Number(this.presentationSavedSelect?.value || 0);
        if (!selectedId) {
            this.showNotification('Choose a saved presentation first.', 'warning');
            return;
        }

        const presentationWidget = await this.ensureRevealManagerWidget();
        if (!presentationWidget) {
            this.showNotification('Unable to create a Reveal Manager widget.', 'error');
            return;
        }

        if (typeof presentationWidget.loadSavedDeckById !== 'function') {
            this.showNotification('This Reveal Manager build does not support saved presentation launch yet.', 'error');
            return;
        }

        const loaded = await presentationWidget.loadSavedDeckById(selectedId);
        if (!loaded) {
            this.showNotification('Unable to load that saved presentation.', 'error');
            return;
        }

        this.handleNavClick('classroom');
        this.syncPresentationControlsFromWidget(presentationWidget);

        if (openProjector && typeof presentationWidget.openProjector === 'function') {
            const projectorOpened = presentationWidget.openProjector();
            this.syncPresentationControlsFromWidget(presentationWidget);
            if (!projectorOpened) {
                this.showNotification('Projector popup blocked or unavailable.', 'warning');
                return;
            }
            this.showNotification('Saved presentation opened on the projector.', 'success');
            return;
        }

        this.showNotification('Saved presentation loaded in Reveal Manager.', 'success');
    }

    async presentLastDeckFromPanel() {
        const lastDeck = this.getLastPresentationDeck();
        if (!lastDeck) {
            this.showNotification('No last presentation is available yet.', 'warning');
            return;
        }

        const presentationWidget = await this.ensureRevealManagerWidget();
        if (!presentationWidget) {
            this.showNotification('Unable to create a Reveal Manager widget.', 'error');
            return;
        }

        if (typeof presentationWidget.loadLastDeck !== 'function') {
            this.showNotification('This Reveal Manager build does not support last deck launch yet.', 'error');
            return;
        }

        const loaded = await presentationWidget.loadLastDeck();
        if (!loaded) {
            this.showNotification('Unable to load the last presentation.', 'error');
            return;
        }

        this.handleNavClick('classroom');
        this.syncPresentationControlsFromWidget(presentationWidget);

        if (typeof presentationWidget.openProjector === 'function') {
            const projectorOpened = presentationWidget.openProjector();
            this.syncPresentationControlsFromWidget(presentationWidget);
            if (!projectorOpened) {
                this.showNotification('Projector popup blocked or unavailable.', 'warning');
                return;
            }
        }

        this.showNotification('Last presentation opened on the projector.', 'success');
    }

    async renameSavedPresentationFromPanel() {
        const selectedId = Number(this.presentationSavedSelect?.value || 0);
        if (!selectedId) {
            this.showNotification('Choose a saved presentation first.', 'warning');
            return;
        }

        const savedDeck = this.getSavedPresentationDecks().find((deck) => deck.id === selectedId);
        const nextName = window.prompt('Rename saved presentation', savedDeck?.name || 'Untitled Deck');
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            this.showNotification('Saved presentation name cannot be blank.', 'warning');
            return;
        }

        const presentationWidget = await this.ensureRevealManagerWidget();
        if (!presentationWidget) {
            this.showNotification('Unable to create a Reveal Manager widget.', 'error');
            return;
        }

        if (typeof presentationWidget.renameSavedDeckById !== 'function') {
            this.showNotification('This Reveal Manager build does not support saved presentation rename yet.', 'error');
            return;
        }

        const renamed = presentationWidget.renameSavedDeckById(selectedId, trimmedName);
        if (!renamed) {
            this.showNotification('Unable to rename that saved presentation.', 'error');
            return;
        }

        this.renderPresentationSavedDeckOptions();
        this.presentationSavedSelect.value = String(selectedId);
        this.updatePresentationSavedActions();
        this.syncPresentationControlsFromWidget(presentationWidget);
        this.showNotification('Saved presentation renamed.', 'success');
    }

    async deleteSavedPresentationFromPanel() {
        const selectedId = Number(this.presentationSavedSelect?.value || 0);
        if (!selectedId) {
            this.showNotification('Choose a saved presentation first.', 'warning');
            return;
        }

        const savedDeck = this.getSavedPresentationDecks().find((deck) => deck.id === selectedId);
        const confirmed = window.confirm(`Delete saved presentation "${savedDeck?.name || 'Untitled Deck'}"?`);
        if (!confirmed) {
            return;
        }

        const presentationWidget = await this.ensureRevealManagerWidget();
        if (!presentationWidget) {
            this.showNotification('Unable to create a Reveal Manager widget.', 'error');
            return;
        }

        if (typeof presentationWidget.deleteSavedDeckById !== 'function') {
            this.showNotification('This Reveal Manager build does not support saved presentation delete yet.', 'error');
            return;
        }

        const deleted = await presentationWidget.deleteSavedDeckById(selectedId);
        if (!deleted) {
            this.showNotification('Unable to delete that saved presentation.', 'error');
            return;
        }

        this.renderPresentationSavedDeckOptions();
        this.updatePresentationSavedActions();
        this.syncPresentationControlsFromWidget(presentationWidget);
        this.showNotification('Saved presentation deleted.', 'success');
    }

    openPresentationProjectorFromPanel() {
        const presentationWidget = this.getPrimaryRevealManagerWidget();
        if (!presentationWidget || !presentationWidget.activeDeck || typeof presentationWidget.openProjector !== 'function') {
            this.showNotification('Load a presentation in Reveal Manager before opening the projector.', 'warning');
            return;
        }

        presentationWidget.openProjector();
        this.syncPresentationControlsFromWidget(presentationWidget);
    }

    navigatePresentationFromPanel(direction) {
        const presentationWidget = this.getPrimaryRevealManagerWidget();
        if (!presentationWidget || !presentationWidget.activeDeck) {
            this.showNotification('Load a presentation in Reveal Manager first.', 'warning');
            return;
        }

        if (presentationWidget.activeDeck.type !== 'html' || typeof presentationWidget.navigate !== 'function') {
            this.showNotification('Prev / Next controls are available only for Reveal HTML decks.', 'warning');
            return;
        }

        presentationWidget.navigate(direction);
        this.syncPresentationControlsFromWidget(presentationWidget);
    }

    renderBackgroundSelector() {
        if (!this.backgroundSelector) return;
        this.backgroundSelector.innerHTML = '';
        const backgrounds = this.backgroundManager.getAvailableBackgrounds();
        const currentBackground = this.backgroundManager.serialize();

        const uploadInput = document.createElement('input');
        uploadInput.type = 'file';
        uploadInput.accept = 'image/*';
        uploadInput.hidden = true;

        uploadInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            this.handleCustomBackgroundUpload(file);
            event.target.value = '';
        });

        const uploadButton = document.createElement('button');
        uploadButton.type = 'button';
        uploadButton.className = 'background-upload-button';
        uploadButton.textContent = 'Upload';
        uploadButton.addEventListener('click', () => uploadInput.click());

        this.backgroundSelector.appendChild(uploadInput);
        this.backgroundSelector.appendChild(uploadButton);

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

                if (currentBackground?.type === type && currentBackground?.value === value) {
                    swatch.classList.add('is-selected');
                }

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

    handleCustomBackgroundUpload(file) {
        if (!file || !file.type.startsWith('image/')) {
            this.showNotification('Choose an image file for the classroom background.', 'warning');
            return;
        }

        const maxBytes = 2 * 1024 * 1024;
        if (file.size > maxBytes) {
            this.showNotification('Please choose an image under 2 MB.', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            if (!result) {
                this.showNotification('That image could not be loaded.', 'error');
                return;
            }

            this.backgroundManager.setCustomImage(result);
            this.renderBackgroundSelector();
            this.saveState();
            this.showNotification('Custom background added.', 'success');
        };
        reader.onerror = () => {
            this.showNotification('That image could not be loaded.', 'error');
        };
        reader.readAsDataURL(file);
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

    openWidgetPickerForShortcut(focusWidgetType = null) {
        this.closeSectionsMenu();
        this.handleNavClick('classroom');
        this.openWidgetPicker(focusWidgetType);
    }

    openManageScreensMenu() {
        this.closeSectionsMenu();
        this.handleNavClick('classroom');
        this.toggleTeacherPanel(false);
        this.toggleSectionsMenu(true);

        window.requestAnimationFrame(() => {
            const details = document.getElementById('manage-screens-menu-details');
            if (details) {
                details.open = true;
                details.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }

            if (this.classProfileSelect && typeof this.classProfileSelect.focus === 'function') {
                this.classProfileSelect.focus({ preventScroll: true });
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
        const rawName = widget.constructor.name.replace('Widget', '');
        const widgetTitleMap = {
            NamePicker: 'Random Name Picker',
            Notes: 'Quick Notes',
            Presentation: 'Presentation Loader',
            QRCode: 'QR Code',
            RichText: 'Rich Text Board',
            UrlViewer: 'URL Viewer',
            Wellbeing: 'Well-being'
        };
        const formattedName = widgetTitleMap[rawName]
            || rawName
                .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        modalTitle.textContent = `${formattedName} Settings`;

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
            p.className = 'widget-settings-empty';
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

        // Remove Widget Button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'control-button modal-danger-btn';
        removeBtn.textContent = 'Remove Widget';
        removeBtn.addEventListener('click', () => {
             this.layoutManager.removeWidget(widget);
             this.closeWidgetSettings();
        });

        // Toggle Projector Visibility
        const projectorToggle = document.createElement('label');
        projectorToggle.className = 'widget-settings-toggle';
        const widgetInfo = this.layoutManager.widgets.find(w => w.widget === widget);
        const isVisible = widgetInfo ? widgetInfo.visibleOnProjector !== false : true;
        projectorToggle.innerHTML = `
            <input type="checkbox" id="projectorToggle" ${isVisible ? 'checked' : ''}>
            Show on projector
        `;
        const projectorToggleInput = projectorToggle.querySelector('input');
        if (projectorToggleInput) {
            projectorToggleInput.addEventListener('change', (event) => {
                if (!widgetInfo) return;
                this.layoutManager.setWidgetProjectorVisibility(widgetInfo, event.target.checked);
            });
        }

        const rightGroup = document.createElement('div');
        rightGroup.className = 'modal-common-controls__actions';
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
