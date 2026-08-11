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
import { renderWidgetPicker } from './utils/widget-picker-renderer.js';
import { TeachingAssistantController } from './utils/teaching-assistant-controller.js';
import {
    LocalFolderResourceProvider,
    ResourceLibraryState,
    createResourceKey
} from './services/resource-library-service.js';
import { GoogleDriveResourceProvider } from './services/google-drive-provider.js';
import {
    THEME_OPTIONS,
    applyTheme,
    renderThemeSelector as renderThemeSelectorControl,
    syncThemeSelectorSelection as syncThemeSelectorControlSelection
} from './utils/theme-manager.js';

const mainAppBus = window.TeacherScreenAppBus ? window.TeacherScreenAppBus.appBus : null;

if (mainAppBus) {
    mainAppBus.init();
}

startPresentationDiagnostics();

/**
 * Main application class for the Custom Classroom Screen.
 * This class initializes the app, manages widgets, and handles user interactions.
 */

function debounce(fn, delay = 250) {
    let timer = null;
    const debounced = function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, delay);
    };

    debounced.flush = function (...args) {
        clearTimeout(timer);
        timer = null;
        return fn.apply(this, args);
    };

    return debounced;
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
const EMPTY_WIDGET_PLACEHOLDER_HTML = '<div class="widget-placeholder" aria-hidden="true"></div>';
const PERSUASION_WEEK_2_SLIDES_URL = 'https://docs.google.com/presentation/d/1NOf1lzIqOJNSCcSIKxhKGbBgrZ3TkBZDJ8peCLPgFLo';
const PERSUASION_WEEK_3_PLACEHOLDER_URL = '';
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

function removePrivateBehaviourData(value) {
    const sanitized = cloneSerializableData(value);
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }

        const isBehaviourTracker = node.type === 'BehaviourTrackerWidget'
            || node.type === 'behaviour-tracker';
        if (isBehaviourTracker) {
            const data = node.data && typeof node.data === 'object' ? node.data : node;
            data.students = [];
            data.events = [];
            data.runningSince = null;
        }

        Object.values(node).forEach(visit);
    };

    visit(sanitized);
    return sanitized;
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
        this.lessonQuickActions = document.getElementById('lesson-quick-actions');
        this.themeSelector = document.getElementById('theme-selector');
        this.backgroundSelector = document.getElementById('background-selector');
        this.presetNameInput = document.getElementById('preset-name');
        this.presetListElement = document.getElementById('preset-list');
        this.currentProjectName = document.getElementById('current-project-name');
        this.currentProjectPageSummary = document.getElementById('current-project-page-summary');
        this.dashboardView = document.getElementById('dashboard-view');
        this.dashboardRoot = document.getElementById('dashboard-root');
        this.mainPagePrev = document.getElementById('main-page-prev');
        this.mainPageCurrent = document.getElementById('main-page-current');
        this.mainPageNext = document.getElementById('main-page-next');
        this.teacherCurrentProjectName = document.getElementById('teacher-current-project-name');
        this.teacherCurrentProjectPageSummary = document.getElementById('teacher-current-project-page-summary');
        this.projectScreenNameInput = document.getElementById('project-screen-name-input');
        this.saveProjectScreenButton = document.getElementById('save-project-screen-btn');
        this.renameProjectScreenButton = document.getElementById('rename-project-screen-btn');
        this.teacherPageSwitcher = document.getElementById('teacher-page-switcher');
        this.newProjectButton = document.getElementById('new-project-btn');
        this.newPageButton = document.getElementById('new-page-btn');
        this.movePageLeftButton = document.getElementById('move-page-left-btn');
        this.movePageRightButton = document.getElementById('move-page-right-btn');
        this.duplicatePageButton = document.getElementById('duplicate-page-btn');
        this.renamePageButton = document.getElementById('rename-page-btn');
        this.deletePageButton = document.getElementById('delete-page-btn');
        this.helpDialog = document.getElementById('help-dialog');
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
        this.presetFolderSelect = document.getElementById('preset-folder-select');
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
        this.agendaModal = document.getElementById('agenda-modal');
        this.agendaList = document.getElementById('agenda-list');
        this.agendaModalCloseBtn = this.agendaModal ? this.agendaModal.querySelector('.modal-close-btn') : null;

        // App State
        this.widgets = [];
        this.isTeacherPanelOpen = false;
        this.presetsKey = 'classroomLayoutPresets';
        this.presets = [];
        this.dismissedSeededLessonsKey = 'teacherScreenDismissedSeededLessons';
        this.foldersKey = 'classroomLayoutFolders';
        this.folders = [];
        this.dashboardNavigationMode = 'library';
        this.dashboardSelectedClassName = '';
        this.dashboardSelectedFolderId = '';
        this.dashboardSearchQuery = '';
        this.dashboardExpandedDeckId = null;
        this.resourceLibraryState = new ResourceLibraryState();
        this.localResourceProvider = new LocalFolderResourceProvider();
        this.googleDriveResourceProvider = new GoogleDriveResourceProvider();
        this.resourceLibrarySource = 'local';
        this.resourceLibraryView = 'all';
        this.resourceLibraryEntries = [];
        this.resourceLibraryPath = [];
        this.resourceLibrarySearchQuery = '';
        this.resourceLibraryLoading = false;
        this.resourceLibraryMessage = '';
        this.resourceLibraryRefreshId = 0;
        this.resourceFallbackRootIds = new Map();
        this.hasRestoredSavedState = false;
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

        this.themes = THEME_OPTIONS;

        this.defaultPresets = [
            {
                name: 'Default',
                className: '',
                period: '',
                theme: 'theme-ocean',
                background: {
                    type: 'solid',
                    value: '#0f172a'
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
        this.teachingAssistant = new TeachingAssistantController({
            getContext: () => this.buildTeachingAssistantContext(),
            addToScreen: (proposal) => this.addTeachingAssistantProposal(proposal),
            notify: (message, type) => this.showNotification(message, type)
        });
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
        const storedTheme = localStorage.getItem('selectedTheme');
        const hasMigratedThemeDefault = localStorage.getItem('teacherScreenOceanDefaultMigrated') === '1';
        const savedTheme = !storedTheme || (storedTheme === 'theme-professional' && !hasMigratedThemeDefault)
            ? 'theme-ocean'
            : storedTheme;
        localStorage.setItem('teacherScreenOceanDefaultMigrated', '1');
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
        this.renderProjectControls();
        this.teachingAssistant.init();

        this.handleNavClick('dashboard');

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
                const state = this.buildProjectorStateSnapshot(this.buildStateSnapshot());
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
            this.sectionsToggleButton.addEventListener('click', () => this.openDashboardHome());
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

        // Quick actions and modals
        const addBtn = document.getElementById('add-widget-btn');

        if (addBtn) {
            addBtn.addEventListener('click', () => this.openWidgetPicker());
        }
        this.lessonQuickActions?.querySelectorAll('[data-quick-widget]').forEach((button) => {
            button.addEventListener('click', () => {
                this.closeSectionsMenu();
                this.closeDialog(this.widgetModal);
                this.handleNavClick('classroom');
                this.addWidget(button.dataset.quickWidget);
            });
        });
        const widgetPickerTeacherControlsButton = this.widgetModal?.querySelector('#widget-picker-teacher-controls-btn');
        if (widgetPickerTeacherControlsButton) {
            widgetPickerTeacherControlsButton.addEventListener('click', () => this.openTeacherControls());
        }
        this.widgetModal.querySelector('.modal-close').addEventListener('click', () => this.closeDialog(this.widgetModal));
        this.setupDialogControls();

        // Accordion Cards
        const detailsElements = document.querySelectorAll('.control-card > details');
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

        // Screen decks
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
                this.openCurrentPageActions();
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
                } else {
                    this.createNewPage();
                }
            });
        }

        if (this.newProjectButton) {
            this.newProjectButton.addEventListener('click', () => this.createNewProject());
        }

        if (this.newPageButton) {
            this.newPageButton.addEventListener('click', () => this.createNewPage());
        }

        if (this.projectScreenNameInput) {
            this.projectScreenNameInput.addEventListener('input', () => {
                const typedName = this.projectScreenNameInput.value.trim();
                const normalizedState = this.normalizeProjectState(this.projectState);
                const resolvedName = typedName || normalizedState.projectName || DEFAULT_PROJECT_NAME;
                this.projectScreenNameInput.title = resolvedName === normalizedState.projectName
                    ? `Current deck: ${resolvedName}`
                    : `Save or rename to use: ${resolvedName}`;
            });
        }

        if (this.saveProjectScreenButton) {
            this.saveProjectScreenButton.addEventListener('click', () => this.saveCurrentProjectScreen());
        }

        if (this.renameProjectScreenButton) {
            this.renameProjectScreenButton.addEventListener('click', () => this.renameCurrentProjectScreen());
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

    handleNavClick(tab, options = {}) {
        const { openTeacherPanel = false } = options;
        eventBus.emit('scene:changed', { tab });
        document.body.classList.toggle('is-dashboard-active', tab === 'dashboard');
        document.body.classList.toggle('is-classroom-active', tab === 'classroom');

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

        if (tab === 'dashboard') {
            this.renderDashboard();
        }

        if (tab !== 'planner' && this.plannerModal?.classList.contains('visible')) {
            this.closePlannerModal();
        }

        // Teacher Panel Logic
        if (tab === 'classroom') {
            this.toggleTeacherPanel(openTeacherPanel);
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
            this.sectionsToggleButton.setAttribute('aria-label', 'Home');
            this.sectionsToggleButton.title = 'Home';
        }
    }

    toggleSectionsMenu(forceOpen = null) {
        if (!this.sectionsMenu || !this.sectionsToggleButton) {
            return;
        }

        const shouldOpen = forceOpen === null ? this.sectionsMenu.hidden : forceOpen;
        this.sectionsMenu.hidden = !shouldOpen;
        this.sectionsToggleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        document.body.classList.toggle('is-sections-menu-open', shouldOpen);
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
        document.body.classList.toggle('is-arrange-mode', this.isTeacherPanelOpen);

        if (this.isTeacherPanelOpen) {
            const panelContent = this.teacherPanel ? this.teacherPanel.querySelector('.panel-content') : null;
            if (panelContent) {
                panelContent.scrollTop = 0;
            }
            this.syncTimerControlsFromWidget();
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

    addWidget(type, options = {}) {
        let widget;
        try {
            widget = createWidgetByType(type);
            if (!widget) {
                throw new Error(`Unknown widget type: ${type}`);
            }

            if (options.initialData && typeof widget.deserialize === 'function') {
                widget.deserialize(cloneSerializableData(options.initialData));
            }

            const widgetElement = this.layoutManager.addWidget(widget);
            this.widgets.push(widget);
            eventBus.emit('widget:created', { type, widget, element: widgetElement });

            const placeholder = this.widgetsContainer.querySelector('.widget-placeholder');
            if (placeholder) placeholder.remove();
            this.recordWidgetPickerUsage(type);

            this.saveState();
            this.showNotification(options.notification || `${this.getFriendlyWidgetName(type)} Added!`);
            if (options.closePicker !== false) {
                this.closeDialog(this.widgetModal);
            }
            return widget;
        } catch (error) {
            console.error('Failed to add widget:', error);
            this.showNotification('Failed to add widget.', 'error');
            return null;
        }
    }

    buildTeachingAssistantContext() {
        const state = this.getActiveProjectState();
        const activePage = this.getActiveProjectPage(state);
        const pageIndex = this.getActiveProjectPageIndex(state);
        const cleanHtmlText = (value = '') => {
            const temp = document.createElement('div');
            temp.innerHTML = String(value || '');
            return String(temp.textContent || '').replace(/\s+/g, ' ').trim();
        };
        const widgets = this.widgets.map((widget) => {
            const type = widget?.constructor?.name || 'Widget';
            const label = this.getFriendlyWidgetName(type);
            let data = {};
            try {
                data = typeof widget?.serialize === 'function' ? widget.serialize() : {};
            } catch (error) {
                data = {};
            }

            if (type === 'RichTextWidget') {
                return {
                    type,
                    label,
                    text: cleanHtmlText(data.content).slice(0, 2500)
                };
            }
            if (type === 'QuizGameWidget') {
                return {
                    type,
                    label,
                    title: String(data.title || '').slice(0, 200),
                    questions: Array.isArray(data.questions)
                        ? data.questions.map((question) => String(question?.question || question?.prompt || '').slice(0, 500)).slice(0, 20)
                        : []
                };
            }
            if (type === 'RevealManagerWidget') {
                return {
                    type,
                    label,
                    title: String(data.deckName || data.name || '').slice(0, 200)
                };
            }

            // Private notes, student names, behaviour records, URLs, and free-form widget data are never sent.
            return { type, label };
        });
        const lessonPlanText = this.lessonPlanEditor && typeof this.lessonPlanEditor.getText === 'function'
            ? String(this.lessonPlanEditor.getText() || '').replace(/\s+/g, ' ').trim().slice(0, 3000)
            : '';

        return {
            deckName: String(state.projectName || DEFAULT_PROJECT_NAME).slice(0, 200),
            pageName: String(activePage?.name || DEFAULT_PAGE_NAME).slice(0, 200),
            pageNumber: pageIndex >= 0 ? pageIndex + 1 : 1,
            pageCount: Array.isArray(state.pages) ? state.pages.length : 1,
            theme: this.getCurrentThemeName(),
            lessonPlan: lessonPlanText,
            widgets: widgets.slice(0, 24)
        };
    }

    buildTeachingAssistantHtml(proposal = {}) {
        const blocks = Array.isArray(proposal.blocks) ? proposal.blocks : [];
        const title = escapeHtml(proposal.title || 'Teaching Assistant');
        const blockHtml = blocks.map((block) => {
            const heading = block.heading ? `<h3>${escapeHtml(block.heading)}</h3>` : '';
            const text = block.text ? `<p>${escapeHtml(block.text)}</p>` : '';
            const items = Array.isArray(block.items) ? block.items.filter(Boolean) : [];
            const listTag = block.type === 'numbered' ? 'ol' : 'ul';
            const list = items.length
                ? `<${listTag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${listTag}>`
                : '';
            const content = `${heading}${text}${list}`;
            return block.type === 'callout'
                ? `<div class="display-callout">${content}</div>`
                : content;
        }).join('');
        return `<h2>${title}</h2>${blockHtml}`;
    }

    addTeachingAssistantProposal(proposal = {}) {
        this.closeSectionsMenu();
        this.closeDialog(this.widgetModal);
        this.handleNavClick('classroom');

        if (proposal.kind === 'quiz') {
            const widget = this.addWidget('quiz-game', {
                closePicker: false,
                notification: 'Quiz Master preview added to the current page.',
                initialData: {
                    title: proposal.title,
                    teams: proposal.teams,
                    questions: proposal.questions,
                    quizFormat: proposal.quizFormat,
                    responseMode: proposal.responseMode,
                    showAnswers: proposal.showAnswers,
                    showExplanations: proposal.showExplanations,
                    questionTimerSeconds: proposal.quizFormat === 'rapid-fire' ? 15 : 30
                }
            });
            return !!widget;
        }

        if (proposal.kind === 'teaching-content') {
            const widget = this.addWidget('rich-text', {
                closePicker: false,
                notification: 'Teaching Assistant preview added to the current page.',
                initialData: {
                    content: this.buildTeachingAssistantHtml(proposal),
                    displayMode: true,
                    presentationMode: 'normal'
                }
            });
            return !!widget;
        }

        return false;
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
                favorites,
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

        const nextState = {
            ...state,
            favorites
        };
        this.saveWidgetPickerState(nextState);
        return nextState;
    }

    renderWidgetModal(focusWidgetType = null) {
        const container = this.widgetModal.querySelector('.widget-categories');
        container.innerHTML = '';
        renderWidgetPicker({
            container,
            focusWidgetType,
            quickAddWidgetKeys: this.quickAddWidgetKeys,
            widgetPickerState: this.getWidgetPickerState(),
            onAddWidget: (type) => this.addWidget(type),
            onToggleFavorite: (type) => this.toggleWidgetPickerFavorite(type)
        });
    }

    renderThemeSelector() {
        renderThemeSelectorControl(this.themeSelector, this.themes, (themeId) => {
            this.switchTheme(themeId);
            this.saveState();
        });
    }

    syncThemeSelectorSelection(themeName) {
        syncThemeSelectorControlSelection(this.themeSelector, themeName);
    }

    getCurrentThemeName() {
        const activeTheme = this.themes.find((theme) => document.body.classList.contains(theme.id));
        return activeTheme?.id || 'theme-ocean';
    }

    switchTheme(themeName) {
        applyTheme(themeName);
        const activeTheme = this.getCurrentThemeName();
        this.syncThemeSelectorSelection(activeTheme);
        if (this.backgroundManager && typeof this.backgroundManager.syncTheme === 'function') {
            this.backgroundManager.syncTheme(activeTheme);
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
        defaultOption.text = 'Select a planner template...';
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
                this.showNotification('Please select a planner template first.', 'warning');
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
            this.showNotification('Please enter a planner template name.', 'warning');
            return;
        }

        const layoutData = this.layoutManager.serialize();

        const payload = {
            name: layoutName,
            savedAt: Date.now(),
            theme: this.getCurrentThemeName(),
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
        this.showNotification('Planner template saved.');
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
            this.showNotification(`Loaded planner template "${layoutName}".`);
        } catch (error) {
            console.error('Failed to load layout', error);
            this.showNotification('Unable to load that planner template.', 'error');
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
            this.savedLayoutsList.innerHTML = '<p>No saved planner templates yet. Create one to get started.</p>';
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
            date.textContent = data?.savedAt ? `Saved ${new Date(data.savedAt).toLocaleString()}` : 'Saved planner template';
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
            currentDeckId: normalizedProjectState.currentDeckId || '',
            projectName,
            activePageId: nextActivePageId,
            pages: nextPages,
            theme: this.getCurrentThemeName(),
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
            currentDeckId: normalizedProjectState.currentDeckId || '',
            projectName,
            activePageId: nextActivePageId,
            pages: cloneSerializableData(nextPages)
        };
        return snapshot;
    }

    buildProjectorStateSnapshot(state = this.buildStateSnapshot()) {
        const projectorState = removePrivateBehaviourData(state);
        projectorState.layout = this.layoutManager.serialize({ forProjector: true });
        delete projectorState.pages;
        return projectorState;
    }

    getDefaultProjectState() {
        return {
            currentDeckId: '',
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
        const themeName = this.getCurrentThemeName();

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

        this.widgetsContainer.innerHTML = EMPTY_WIDGET_PLACEHOLDER_HTML;
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
                currentDeckId: normalizedState.currentDeckId || '',
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
            currentDeckId: normalizedState.currentDeckId || '',
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
            currentDeckId: normalizedState.currentDeckId || '',
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: movedPage.id,
            pages: cloneSerializableData(reorderedPages)
        };

        this.renderProjectControls();
        this.saveStateImmediately();
        this.showNotification(`Moved "${movedPage.name || DEFAULT_PAGE_NAME}" ${offset < 0 ? 'left' : 'right'}.`);
    }

    createNewProject(projectName = null) {
        const suggestedName = this.getUniquePresetName(DEFAULT_PROJECT_NAME);
        const requestedName = typeof projectName === 'string' && projectName.trim()
            ? projectName.trim()
            : window.prompt('Enter a project name', suggestedName);
        if (requestedName === null) {
            return false;
        }

        const resolvedProjectName = requestedName && requestedName.trim() ? requestedName.trim() : DEFAULT_PROJECT_NAME;
        if (this.presets.some((preset) => String(preset?.name || '').trim().toLowerCase() === resolvedProjectName.toLowerCase())) {
            this.showNotification(`Deck "${resolvedProjectName}" already exists.`, 'warning');
            return false;
        }

        const currentDeckId = this.createDeckId();
        const blankPage = this.createPageRecord({
            id: this.makeUniquePageId(),
            name: DEFAULT_PAGE_NAME,
            snapshot: this.createBlankPageSnapshot()
        });

        this.projectState = {
            currentDeckId,
            projectName: resolvedProjectName,
            activePageId: blankPage.id,
            pages: [blankPage]
        };

        this.applyPageSnapshot(blankPage.snapshot);
        this.renderProjectControls();
        this.saveStateImmediately();
        const now = Date.now();
        const projectState = this.buildStateSnapshot();
        this.presets.push({
            id: currentDeckId,
            name: resolvedProjectName,
            className: '',
            period: '',
            folderId: '',
            isFavorite: false,
            projectState: cloneSerializableData(projectState),
            theme: projectState.theme,
            background: cloneSerializableData(projectState.background),
            layout: cloneSerializableData(projectState.layout),
            lessonPlan: cloneSerializableData(projectState.lessonPlan),
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0
        });
        this.dashboardExpandedDeckId = currentDeckId;
        this.savePresets();
        this.renderPresetList();
        this.showNotification(`Created deck "${resolvedProjectName}".`);
        return true;
    }

    saveCurrentProjectScreen() {
        const normalizedState = this.normalizeProjectState(this.projectState);
        const requestedName = this.projectScreenNameInput?.value.trim() || normalizedState.projectName || DEFAULT_PROJECT_NAME;
        if (!requestedName) {
            this.showNotification('Enter a deck name first.', 'warning');
            return;
        }

        const currentDeckId = normalizedState.currentDeckId || '';
        const duplicate = this.presets.find((preset) => preset
            && preset.name === requestedName
            && preset.id !== currentDeckId);
        if (duplicate) {
            if (this.projectScreenNameInput) {
                this.projectScreenNameInput.value = normalizedState.projectName || DEFAULT_PROJECT_NAME;
                this.projectScreenNameInput.title = `Current deck: ${normalizedState.projectName || DEFAULT_PROJECT_NAME}`;
            }
            this.showNotification(`Deck "${requestedName}" already exists.`, 'warning');
            return;
        }

        this.projectState = {
            ...normalizedState,
            projectName: requestedName
        };

        this.saveState();

        if (this.projectScreenNameInput) {
            this.projectScreenNameInput.value = requestedName;
        }

        const existingPreset = currentDeckId
            ? this.getPresetRecord(currentDeckId)
            : this.presets.find((preset) => preset && preset.name === normalizedState.projectName);
        if (existingPreset) {
            if (existingPreset.name !== requestedName) {
                const existingIndex = this.getPresetIndex(existingPreset.id);
                this.presets[existingIndex] = {
                    ...existingPreset,
                    name: requestedName,
                    projectState: cloneSerializableData({
                        ...existingPreset.projectState,
                        currentDeckId: existingPreset.id,
                        projectName: requestedName
                    })
                };
            }
            this.overwritePreset(existingPreset.id || existingPreset.name);
        } else {
            if (this.presetNameInput) {
                this.presetNameInput.value = requestedName;
            }
            this.savePreset();
        }

        this.renderProjectControls();
        this.renderDashboard();
    }

    renameCurrentProjectScreen() {
        const normalizedState = this.normalizeProjectState(this.projectState);
        const currentName = normalizedState.projectName || DEFAULT_PROJECT_NAME;
        const nextName = window.prompt('Rename current screen', currentName);
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            this.showNotification('Deck name cannot be blank.', 'warning');
            return;
        }

        const currentDeckId = normalizedState.currentDeckId || '';
        const duplicate = this.presets.find((preset) => preset && preset.name === trimmedName);
        if (duplicate && duplicate.id !== currentDeckId) {
            this.showNotification(`Deck "${trimmedName}" already exists.`, 'warning');
            return;
        }

        const now = Date.now();
        this.projectState = {
            ...normalizedState,
            projectName: trimmedName
        };

        this.saveState();

        const presetIndex = currentDeckId ? this.getPresetIndex(currentDeckId) : this.getPresetIndex(currentName);
        if (presetIndex !== -1) {
            const preset = this.normalizePresetRecord(this.presets[presetIndex]);
            if (preset) {
                if (preset.seededLessonId) {
                    this.dismissSeededLesson(preset.seededLessonId);
                }
                const renamedPreset = {
                    ...preset,
                    name: trimmedName,
                    projectState: cloneSerializableData({
                        ...(preset.projectState || this.buildPresetProjectState(preset)),
                        currentDeckId: preset.id,
                        projectName: trimmedName
                    }),
                    updatedAt: now
                };
                delete renamedPreset.seededLessonId;
                this.presets[presetIndex] = renamedPreset;
                this.savePresets();
                this.renderPresetList();
                this.renderDashboard();
            }
        }

        if (this.projectScreenNameInput) {
            this.projectScreenNameInput.value = trimmedName;
        }

        if (this.presetNameInput && this.presetNameInput.value === currentName) {
            this.presetNameInput.value = trimmedName;
        }

        this.renderProjectControls();
        this.showNotification(`Deck renamed to "${trimmedName}".`);
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
            currentDeckId: normalizedState.currentDeckId || '',
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: page.id,
            pages: cloneSerializableData(nextPages)
        };

        this.applyPageSnapshot(page.snapshot);
        this.renderProjectControls();
        this.saveStateImmediately();
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
            currentDeckId: normalizedState.currentDeckId || '',
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: targetPage.id,
            pages: cloneSerializableData(pages)
        };

        this.applyPageSnapshot(targetPage.snapshot);
        this.renderProjectControls();
        this.saveStateImmediately();
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
            currentDeckId: normalizedState.currentDeckId || '',
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: duplicate.id,
            pages: cloneSerializableData(nextPages)
        };

        this.applyPageSnapshot(duplicate.snapshot);
        this.renderProjectControls();
        this.saveStateImmediately();
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
            currentDeckId: normalizedState.currentDeckId || '',
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
        this.saveStateImmediately();
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
            currentDeckId: normalizedState.currentDeckId || '',
            projectName: normalizedState.projectName || DEFAULT_PROJECT_NAME,
            activePageId: nextActivePage.id,
            pages: cloneSerializableData(nextPages)
        };

        this.applyPageSnapshot(nextActivePage.snapshot);
        this.renderProjectControls();
        this.saveStateImmediately();
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
                : this.getCurrentThemeName(),
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

    createDeckId() {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
            return `deck-${globalThis.crypto.randomUUID()}`;
        }

        return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    getPresetIndex(identifier) {
        const value = typeof identifier === 'string' ? identifier.trim() : '';
        if (!value) {
            return -1;
        }

        const idMatch = this.presets.findIndex((preset) => preset && preset.id === value);
        return idMatch !== -1
            ? idMatch
            : this.presets.findIndex((preset) => preset && preset.name === value);
    }

    getPresetRecord(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
        return presetIndex === -1 ? null : this.normalizePresetRecord(this.presets[presetIndex]);
    }

    getCurrentDeckId() {
        return this.normalizeProjectState(this.projectState).currentDeckId || '';
    }

    buildPresetProjectState(preset = {}) {
        const source = preset && typeof preset === 'object' ? preset : {};
        const projectName = typeof source.projectName === 'string' && source.projectName.trim()
            ? source.projectName.trim()
            : typeof source.name === 'string' && source.name.trim()
                ? source.name.trim()
                : DEFAULT_PROJECT_NAME;

        if (source.projectState && typeof source.projectState === 'object') {
            const normalized = this.normalizeProjectState(source.projectState);
            return {
                currentDeckId: typeof source.id === 'string' && source.id.trim()
                    ? source.id.trim()
                    : normalized.currentDeckId || '',
                projectName: normalized.projectName || projectName,
                activePageId: normalized.activePageId || DEFAULT_PAGE_ID,
                pages: cloneSerializableData(normalized.pages)
            };
        }

        const legacyState = this.normalizeProjectState({
            projectName,
            activePageId: DEFAULT_PAGE_ID,
            pages: [{
                id: DEFAULT_PAGE_ID,
                name: DEFAULT_PAGE_NAME,
                snapshot: {
                    theme: typeof source.theme === 'string' && source.theme.trim()
                        ? source.theme
                        : this.getCurrentThemeName(),
                    background: source.background && typeof source.background === 'object'
                        ? source.background
                        : this.backgroundManager.serialize(),
                    layout: source.layout && typeof source.layout === 'object'
                        ? source.layout
                        : { widgets: [] },
                    timerStates: Array.isArray(source.timerStates) ? source.timerStates : [],
                    lessonPlan: source.lessonPlan ?? null
                }
            }]
        });

        return {
            currentDeckId: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : '',
            projectName: legacyState.projectName || projectName,
            activePageId: legacyState.activePageId || DEFAULT_PAGE_ID,
            pages: cloneSerializableData(legacyState.pages)
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
        const currentDeckId = typeof sourceState.currentDeckId === 'string'
            ? sourceState.currentDeckId.trim()
            : '';
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
            currentDeckId,
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

        if (this.projectScreenNameInput) {
            this.projectScreenNameInput.value = projectName;
            this.projectScreenNameInput.title = `Current screen: ${projectName}`;
        }

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
            this.mainPageCurrent.title = `Manage or delete this page (${pageSummary})`;
            this.mainPageCurrent.setAttribute('aria-label', `${pageSummary}. Manage or delete this page.`);
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
            const nextActionLabel = canMoveRight ? 'Next page' : 'Add page';
            this.mainPageNext.disabled = false;
            this.mainPageNext.title = nextActionLabel;
            this.mainPageNext.setAttribute('aria-label', nextActionLabel);
        }
    }

    applyPageSnapshot(snapshot = {}) {
        if (snapshot.theme) {
            this.switchTheme(snapshot.theme);
        }

        if (snapshot.background) {
            this.backgroundManager.deserialize(snapshot.background);
        } else if (this.backgroundManager && typeof this.backgroundManager.reset === 'function') {
            this.backgroundManager.reset(snapshot.theme || this.getCurrentThemeName());
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
            if (this.layoutManager && typeof this.layoutManager.discardAllWidgets === 'function') {
                this.layoutManager.discardAllWidgets();
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
        const projectorState = this.buildProjectorStateSnapshot(state);
        saveState(state, {
            source,
            projectorChannel: this.projectorChannel,
            syncToken: this.projectorSyncToken,
            projectorState
        });
    }

    saveStateImmediately(source = 'teacher') {
        if (this.saveState && typeof this.saveState.flush === 'function') {
            this.saveState.flush(source);
            return;
        }

        this.saveState(source);
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

    buildGoogleSlidesRevealWidget({ id, name, sourceUrl, x = 20, y = 20, width = 920, height = 620 } = {}) {
        return {
            id,
            type: 'RevealManagerWidget',
            layoutType: 'grid',
            x,
            y,
            width,
            height,
            visibleOnProjector: true,
            projectorVisibilityConfigured: true,
            data: {
                type: 'RevealManagerWidget',
                activeDeck: {
                    id: Date.now(),
                    name,
                    type: 'google-slides',
                    sourceUrl,
                    content: ''
                },
                currentIndices: { h: 0, v: 0 }
            }
        };
    }

    buildUrlReferenceWidget({ id, url, x = 960, y = 20, width = 360, height = 180 } = {}) {
        return {
            id,
            type: 'UrlViewerWidget',
            layoutType: 'grid',
            x,
            y,
            width,
            height,
            visibleOnProjector: false,
            projectorVisibilityConfigured: true,
            data: {
                type: 'UrlViewerWidget',
                url,
                chromeless: false
            }
        };
    }

    buildPersuasionLessonFlowPreset() {
        const presetName = 'Year 7 English - Persuasion Weeks 2 and 3';
        const now = Date.now();
        const week2DeckName = '2.0 Persuasion Week 2 (2)';
        const week3Status = PERSUASION_WEEK_3_PLACEHOLDER_URL
            ? 'Week 3 material is linked on page 2.'
            : 'Week 3 Drive link was not found by Drive search yet. Paste the Week 3 URL into the page 2 URL viewer when confirmed.';

        const buildSnapshot = ({ pageName, widgets, lessonPlan }) => ({
            theme: 'theme-light',
            background: {
                type: 'gradient',
                value: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 50%, #fef3c7 100%)',
                source: 'custom'
            },
            layout: {
                mode: 'dashboard',
                viewport: { width: 1360, height: 760 },
                widgets
            },
            timerStates: [],
            lessonPlan: [
                { insert: `${pageName}\n`, attributes: { header: 1 } },
                ...lessonPlan
            ]
        });

        const page1Snapshot = buildSnapshot({
            pageName: 'Persuasion Week 2',
            widgets: [
                this.buildGoogleSlidesRevealWidget({
                    id: 'persuasion-week-2-reveal',
                    name: week2DeckName,
                    sourceUrl: PERSUASION_WEEK_2_SLIDES_URL,
                    width: 920,
                    height: 620
                }),
                this.buildUrlReferenceWidget({
                    id: 'persuasion-week-2-drive-link',
                    url: PERSUASION_WEEK_2_SLIDES_URL
                })
            ],
            lessonPlan: [
                { insert: 'Reusable lesson screen for the updated Week 2 persuasion deck.\n\n' },
                { insert: 'Flow\n', attributes: { header: 2 } },
                { insert: 'Hook: Where do we see persuasion?\nSmall group brainstorm: who persuades, what do they persuade, and how?\nActivity: sell a useless item.\nMini teach: categories of rhetoric.\nCard sort: mobile phone licence arguments.\nModel analysis: #BookThemOut campaign.\nDrafting: turn communications-model notes into connected sentences.\nReflection: 3,2,1 prompt.\n\n' },
                { insert: `Drive deck: ${PERSUASION_WEEK_2_SLIDES_URL}\n` }
            ]
        });

        const week3Widgets = [];
        if (PERSUASION_WEEK_3_PLACEHOLDER_URL) {
            week3Widgets.push(this.buildGoogleSlidesRevealWidget({
                id: 'persuasion-week-3-reveal',
                name: 'Persuasion Week 3',
                sourceUrl: PERSUASION_WEEK_3_PLACEHOLDER_URL,
                width: 920,
                height: 620
            }));
        }
        week3Widgets.push(
            this.buildUrlReferenceWidget({
                id: 'persuasion-week-3-drive-link',
                url: PERSUASION_WEEK_3_PLACEHOLDER_URL || 'https://drive.google.com/',
                x: 20,
                y: 20,
                width: 920,
                height: 620
            })
        );

        const page2Snapshot = buildSnapshot({
            pageName: 'Persuasion Week 3',
            widgets: week3Widgets,
            lessonPlan: [
                { insert: 'Reusable lesson screen for the Week 3 persuasion material.\n\n' },
                { insert: 'Status\n', attributes: { header: 2 } },
                { insert: `${week3Status}\n\n` },
                { insert: 'Next step once the Drive file is confirmed: paste the Week 3 URL into the URL viewer or Reveal Manager, then Save Deck / Overwrite to keep it available in saved decks and the weekly planner.\n' }
            ]
        });

        const projectState = {
            version: this.appVersion,
            schemaVersion: this.schemaVersion,
            projectName: presetName,
            activePageId: 'persuasion-week-2',
            pages: [
                {
                    id: 'persuasion-week-2',
                    name: 'Week 2',
                    snapshot: page1Snapshot
                },
                {
                    id: 'persuasion-week-3',
                    name: 'Week 3',
                    snapshot: page2Snapshot
                }
            ],
            theme: page1Snapshot.theme,
            background: cloneSerializableData(page1Snapshot.background)
        };

        return {
            name: presetName,
            className: 'Year 7 English',
            period: 'Persuasion',
            folderId: '',
            projectState,
            theme: projectState.theme,
            background: cloneSerializableData(projectState.background),
            layout: cloneSerializableData(page1Snapshot.layout),
            lessonPlan: cloneSerializableData(page1Snapshot.lessonPlan),
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0,
            seededLessonId: 'year7-persuasion-weeks-2-3-2026-05-16'
        };
    }

    buildRhetoricLessonPreset() {
        const presetName = 'Year 7 English - Rhetoric: Pathos, Logos, Ethos';
        const now = Date.now();
        const presentationUrl = 'presentations/year7-rhetoric-marine-turtles/slides.html';
        const projectState = {
            version: this.appVersion,
            schemaVersion: this.schemaVersion,
            projectName: presetName,
            activePageId: DEFAULT_PAGE_ID,
            pages: [{
                id: DEFAULT_PAGE_ID,
                name: 'Rhetoric Overview',
                snapshot: {
                    theme: 'theme-light',
                    background: {
                        type: 'gradient',
                        value: 'linear-gradient(135deg, #ecfeff 0%, #eef2ff 48%, #fff7ed 100%)',
                        source: 'custom'
                    },
                    layout: {
                        mode: 'stage',
                        viewport: { width: 820, height: 720 },
                        widgets: [
                            {
                                id: 'rhetoric-presentation',
                                type: 'UrlViewerWidget',
                                layoutType: 'stage',
                                x: 20,
                                y: 20,
                                width: 780,
                                height: 620,
                                visibleOnProjector: true,
                                projectorVisibilityConfigured: true,
                                data: {
                                    type: 'UrlViewerWidget',
                                    url: presentationUrl,
                                    chromeless: true
                                }
                            }
                        ]
                    },
                    timerStates: [],
                    lessonPlan: [
                        { insert: 'Year 7 English - Pathos, Logos, Ethos\\n', attributes: { header: 1 } },
                        { insert: 'Overview: where rhetoric comes from, what each appeal means, and how students can use one appeal in their marine turtles project.\\n\\n' },
                        { insert: 'Flow\\n', attributes: { header: 2 } },
                        { insert: 'Hook: Where do we see persuasion?\\nOrigin: Aristotle and ancient Greek rhetoric.\\nMini teach: pathos, logos, ethos.\\nApplication: choose one appeal and write 2-3 sentences on why we should protect marine turtles.\\n\\nPresentation: presentations/year7-rhetoric-marine-turtles/slides.html\\n' }
                    ]
                }
            }],
            theme: 'theme-light',
            background: {
                type: 'gradient',
                value: 'linear-gradient(135deg, #ecfeff 0%, #eef2ff 48%, #fff7ed 100%)',
                source: 'custom'
            }
        };

        return {
            name: presetName,
            className: 'Year 7 English',
            period: "Today's English",
            folderId: '',
            projectState,
            theme: projectState.theme,
            background: cloneSerializableData(projectState.background),
            layout: cloneSerializableData(projectState.pages[0].snapshot.layout),
            lessonPlan: cloneSerializableData(projectState.pages[0].snapshot.lessonPlan),
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0,
            seededLessonId: 'year7-rhetoric-marine-turtles-2026-05-15'
        };
    }

    upsertSeededLessonPreset(lessonPreset) {
        if (!lessonPreset || !lessonPreset.name) {
            return false;
        }

        const existingIndex = this.presets.findIndex((preset) => preset && preset.name === lessonPreset.name);
        if (existingIndex !== -1) {
            const existingPreset = this.presets[existingIndex];
            if (existingPreset?.seededLessonId === lessonPreset.seededLessonId) {
                this.presets[existingIndex] = {
                    ...lessonPreset,
                    id: existingPreset.id || lessonPreset.id,
                    createdAt: Number.isFinite(existingPreset.createdAt) ? existingPreset.createdAt : lessonPreset.createdAt,
                    lastUsedAt: Number.isFinite(existingPreset.lastUsedAt) ? existingPreset.lastUsedAt : lessonPreset.lastUsedAt,
                    usageCount: Number.isFinite(existingPreset.usageCount) ? existingPreset.usageCount : lessonPreset.usageCount,
                    isFavorite: existingPreset.isFavorite === true
                };
                this.savePresets();
                return true;
            }
            return false;
        }

        this.presets.push(lessonPreset);
        this.savePresets();
        return true;
    }

    getDismissedSeededLessonIds() {
        const stored = safeParseLocalStorage(this.dismissedSeededLessonsKey);
        return new Set(Array.isArray(stored)
            ? stored.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
            : []);
    }

    dismissSeededLesson(seedId) {
        const resolvedId = typeof seedId === 'string' ? seedId.trim() : '';
        if (!resolvedId) {
            return;
        }

        const dismissed = this.getDismissedSeededLessonIds();
        dismissed.add(resolvedId);
        localStorage.setItem(this.dismissedSeededLessonsKey, JSON.stringify([...dismissed]));
    }

    ensureSeededPlannerLayout(lessonPreset) {
        if (!lessonPreset || !lessonPreset.name || !lessonPreset.layout) {
            return false;
        }

        const layoutName = lessonPreset.name;
        const storageKey = this.getLayoutStorageKey(layoutName);
        const existingRaw = localStorage.getItem(storageKey);
        if (existingRaw) {
            try {
                const existing = JSON.parse(existingRaw);
                if (existing?.seededLessonId === lessonPreset.seededLessonId) {
                    const payload = {
                        ...existing,
                        name: layoutName,
                        savedAt: Number.isFinite(existing.savedAt) ? existing.savedAt : Date.now(),
                        theme: lessonPreset.theme,
                        background: cloneSerializableData(lessonPreset.background),
                        layout: cloneSerializableData(lessonPreset.layout),
                        lessonPlan: cloneSerializableData(lessonPreset.lessonPlan),
                        seededLessonId: lessonPreset.seededLessonId
                    };
                    localStorage.setItem(storageKey, JSON.stringify(payload));
                    return true;
                }
            } catch (error) {
                return false;
            }
            return false;
        }

        localStorage.setItem(storageKey, JSON.stringify({
            name: layoutName,
            savedAt: Date.now(),
            theme: lessonPreset.theme,
            background: cloneSerializableData(lessonPreset.background),
            layout: cloneSerializableData(lessonPreset.layout),
            lessonPlan: cloneSerializableData(lessonPreset.lessonPlan),
            storage: {},
            seededLessonId: lessonPreset.seededLessonId
        }));
        return true;
    }

    ensureSeededLessonPresets() {
        const lessonPresets = [
            this.buildRhetoricLessonPreset(),
            this.buildPersuasionLessonFlowPreset()
        ];
        const dismissedSeedIds = this.getDismissedSeededLessonIds();
        let changed = false;

        lessonPresets.forEach((lessonPreset) => {
            if (dismissedSeedIds.has(lessonPreset.seededLessonId)) {
                return;
            }
            changed = this.upsertSeededLessonPreset(lessonPreset) || changed;
            this.ensureSeededPlannerLayout(lessonPreset);
        });

        return changed;
    }

    setupPresetControls() {
        const storedPresets = safeParseLocalStorage(this.presetsKey);
        const hadStoredPresets = Array.isArray(storedPresets) && storedPresets.length > 0;
        const restoredState = this.normalizeProjectState(this.projectState);
        const hadLegacyProjectState = Array.isArray(storedPresets)
            && storedPresets.some((preset) => preset && typeof preset === 'object' && (!preset.projectState || typeof preset.projectState !== 'object'));
        this.presets = this.normalizePresetCollection(storedPresets, {
            preferredDeckId: this.hasRestoredSavedState ? restoredState.currentDeckId : '',
            preferredName: this.hasRestoredSavedState ? restoredState.projectName : ''
        });

        const hasLegacyFields = Array.isArray(storedPresets)
            && storedPresets.some((preset) => preset && typeof preset === 'object' && (!Number.isFinite(preset.createdAt) || !Number.isFinite(preset.updatedAt) || !Number.isFinite(preset.lastUsedAt)));
        const storedIds = Array.isArray(storedPresets)
            ? storedPresets.map((preset) => (typeof preset?.id === 'string' ? preset.id.trim() : '')).filter(Boolean)
            : [];
        const hasLegacyIdentity = !Array.isArray(storedPresets)
            || storedIds.length !== storedPresets.length
            || new Set(storedIds).size !== storedIds.length;
        if (hasLegacyFields || hadLegacyProjectState || hasLegacyIdentity) {
            this.savePresets();
        }

        this.loadFolders();
        this.ensureSeededLessonPresets();
        this.ensureCurrentProjectDeck({
            allowLegacyNameMatch: this.hasRestoredSavedState,
            preferExistingDeck: !this.hasRestoredSavedState && hadStoredPresets
        });
        this.renderPresetList();
        this.renderLayoutPresetOptions();
        this.renderClassProfileOptions();
    }

    savePresets() {
        this.presets = this.normalizePresetCollection(this.presets);
        localStorage.setItem(this.presetsKey, JSON.stringify(this.presets));
        this.renderLayoutPresetOptions();
        this.renderClassProfileOptions();
        this.renderFolderOptions();
    }

    ensureCurrentProjectDeck(options = {}) {
        const allowLegacyNameMatch = options.allowLegacyNameMatch === true;
        const preferExistingDeck = options.preferExistingDeck === true;
        const state = this.normalizeProjectState(this.projectState);
        let presetIndex = state.currentDeckId ? this.getPresetIndex(state.currentDeckId) : -1;

        if (presetIndex === -1 && allowLegacyNameMatch) {
            const matches = this.presets
                .map((preset, index) => ({ preset: this.normalizePresetRecord(preset), index }))
                .filter(({ preset }) => preset && preset.name === state.projectName);
            if (matches.length === 1) {
                presetIndex = matches[0].index;
            }
        }

        if (presetIndex !== -1) {
            const preset = this.normalizePresetRecord(this.presets[presetIndex]);
            if (!preset) {
                return null;
            }

            this.presets[presetIndex] = preset;
            this.projectState = {
                currentDeckId: preset.id,
                projectName: preset.name,
                activePageId: state.activePageId,
                pages: cloneSerializableData(state.pages)
            };
            this.savePresets();
            this.saveStateImmediately();
            return preset;
        }

        if (preferExistingDeck) {
            const existingPreset = [...this.presets]
                .map((preset) => this.normalizePresetRecord(preset))
                .filter(Boolean)
                .sort((a, b) => Number(b.lastUsedAt || b.updatedAt || b.createdAt || 0)
                    - Number(a.lastUsedAt || a.updatedAt || a.createdAt || 0))[0];
            if (existingPreset) {
                const projectState = {
                    ...this.buildPresetProjectState(existingPreset),
                    currentDeckId: existingPreset.id,
                    projectName: existingPreset.name
                };
                this.applyState(cloneSerializableData(projectState));
                this.savePresets();
                this.saveStateImmediately();
                return existingPreset;
            }
        }

        const currentDeckId = this.createDeckId();
        const projectName = this.getUniquePresetName(state.projectName || DEFAULT_PROJECT_NAME);
        this.projectState = {
            currentDeckId,
            projectName,
            activePageId: state.activePageId,
            pages: cloneSerializableData(state.pages)
        };
        const projectState = this.buildStateSnapshot();
        const now = Date.now();
        const preset = this.normalizePresetRecord({
            id: currentDeckId,
            name: projectName,
            className: '',
            period: '',
            folderId: '',
            isFavorite: false,
            projectState: cloneSerializableData(projectState),
            theme: projectState.theme,
            background: cloneSerializableData(projectState.background),
            layout: cloneSerializableData(projectState.layout),
            lessonPlan: cloneSerializableData(projectState.lessonPlan),
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0
        });

        this.presets.push(preset);
        this.savePresets();
        this.saveStateImmediately();
        return preset;
    }

    normalizeFolderRecord(folder) {
        if (!folder || typeof folder !== 'object') {
            return null;
        }

        const name = typeof folder.name === 'string' ? folder.name.trim() : '';
        const id = typeof folder.id === 'string' ? folder.id.trim() : '';
        if (!name || !id) {
            return null;
        }

        const now = Date.now();
        const createdAt = Number.isFinite(folder.createdAt) ? folder.createdAt : now;
        const updatedAt = Number.isFinite(folder.updatedAt) ? folder.updatedAt : createdAt;

        return {
            ...folder,
            id,
            name,
            createdAt,
            updatedAt
        };
    }

    loadFolders() {
        const storedFolders = safeParseLocalStorage(this.foldersKey);
        this.folders = Array.isArray(storedFolders)
            ? storedFolders.map((folder) => this.normalizeFolderRecord(folder)).filter(Boolean)
            : [];

        const hasLegacyFields = Array.isArray(storedFolders)
            && storedFolders.some((folder) => folder && typeof folder === 'object' && (!Number.isFinite(folder.createdAt) || !Number.isFinite(folder.updatedAt)));
        if (hasLegacyFields) {
            this.saveFolders();
        }

        this.renderFolderOptions();
    }

    saveFolders() {
        localStorage.setItem(this.foldersKey, JSON.stringify(this.folders));
        this.renderFolderOptions();
    }

    getFolderById(folderId = '') {
        const target = String(folderId || '').trim();
        if (!target) {
            return null;
        }

        return this.folders.find((folder) => folder.id === target) || null;
    }

    getFolderByName(folderName = '') {
        const target = String(folderName || '').trim().toLowerCase();
        if (!target) {
            return null;
        }

        return this.folders.find((folder) => folder.name.toLowerCase() === target) || null;
    }

    getFolderLabel(folderId = '') {
        const folder = this.getFolderById(folderId);
        return folder ? folder.name : '';
    }

    getFolderStats() {
        const folderStats = new Map();

        this.folders
            .map((folder) => this.normalizeFolderRecord(folder))
            .filter(Boolean)
            .forEach((folder) => {
                folderStats.set(folder.id, {
                    ...folder,
                    count: 0,
                    lastUsedAt: 0
                });
            });

        this.presets
            .map((preset) => this.normalizePresetRecord(preset))
            .filter(Boolean)
            .forEach((preset) => {
                if (!preset.folderId) {
                    return;
                }

                const folder = folderStats.get(preset.folderId);
                if (!folder) {
                    return;
                }

                folder.count += 1;
                folder.lastUsedAt = Math.max(folder.lastUsedAt, Number.isFinite(preset.lastUsedAt) ? preset.lastUsedAt : preset.updatedAt || preset.createdAt || 0);
            });

        return Array.from(folderStats.values())
            .sort((a, b) => {
                if (b.lastUsedAt !== a.lastUsedAt) {
                    return b.lastUsedAt - a.lastUsedAt;
                }
                return a.name.localeCompare(b.name);
            });
    }

    renderFolderOptions() {
        if (!this.presetFolderSelect) {
            return;
        }

        const currentValue = this.presetFolderSelect.value || '';
        const folderStats = this.getFolderStats();

        this.presetFolderSelect.innerHTML = '<option value="">No folder</option>';

        folderStats.forEach((folder) => {
            const option = document.createElement('option');
            option.value = folder.id;
            option.textContent = `${folder.name}${folder.count ? ` (${folder.count})` : ''}`;
            this.presetFolderSelect.appendChild(option);
        });

        if (currentValue) {
            const matched = folderStats.find((folder) => folder.id === currentValue);
            this.presetFolderSelect.value = matched ? currentValue : '';
        }
    }

    createFolder(folderName = '', { selectAfterCreate = false, showNotice = true } = {}) {
        const trimmedName = String(folderName || '').trim();
        if (!trimmedName) {
            this.showNotification('Enter a folder name first.', 'error');
            return null;
        }

        const existing = this.getFolderByName(trimmedName);
        if (existing) {
            if (selectAfterCreate) {
                this.dashboardSelectedFolderId = existing.id;
                this.renderDashboard();
            }
            return existing;
        }

        const now = Date.now();
        const folder = {
            id: `folder-${now}-${Math.random().toString(36).slice(2, 8)}`,
            name: trimmedName,
            createdAt: now,
            updatedAt: now
        };

        this.folders.push(folder);
        this.saveFolders();
        this.renderDashboard();
        if (showNotice) {
            this.showNotification(`Folder "${trimmedName}" created.`);
        }

        if (selectAfterCreate) {
            this.dashboardSelectedFolderId = folder.id;
            this.renderDashboard();
        }

        return folder;
    }

    createBlankScreenInFolder(folderId = '') {
        const folder = this.getFolderById(folderId);
        if (!folder) {
            this.showNotification('Folder not found.', 'error');
            return;
        }

        const baseName = this.getUniquePresetName(`${folder.name} - Deck`);
        const nextName = window.prompt(`Name the new deck for "${folder.name}"`, baseName);
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            this.showNotification('Enter a deck name first.', 'error');
            return;
        }

        const screenName = this.getUniquePresetName(trimmedName);
        const now = Date.now();
        const id = this.createDeckId();
        const blankPage = this.createPageRecord({
            id: DEFAULT_PAGE_ID,
            name: DEFAULT_PAGE_NAME,
            snapshot: this.createBlankPageSnapshot()
        });
        const preset = {
            id,
            name: screenName,
            className: '',
            period: '',
            folderId: folder.id,
            projectState: {
                currentDeckId: id,
                projectName: screenName,
                activePageId: blankPage.id,
                pages: [blankPage]
            },
            theme: this.getCurrentThemeName(),
            background: this.backgroundManager && typeof this.backgroundManager.getThemeDefaultBackground === 'function'
                ? this.backgroundManager.getThemeDefaultBackground(this.getCurrentThemeName())
                : null,
            layout: {
                widgets: []
            },
            lessonPlan: null,
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0
        };

        this.presets.push(preset);
        this.savePresets();
        this.renderPresetList();
        this.renderDashboard();
        this.handleNavClick('classroom');
        this.loadPreset(id);
        this.showNotification(`Created "${screenName}" in "${folder.name}".`);
    }

    renameFolder(folderId = '') {
        const folder = this.getFolderById(folderId);
        if (!folder) {
            this.showNotification('Folder not found.', 'error');
            return;
        }

        const nextName = window.prompt('Rename folder', folder.name || '');
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            this.showNotification('Folder name cannot be blank.', 'error');
            return;
        }

        const duplicate = this.getFolderByName(trimmedName);
        if (duplicate && duplicate.id !== folder.id) {
            this.showNotification(`Folder "${trimmedName}" already exists.`, 'error');
            return;
        }

        const now = Date.now();
        this.folders = this.folders.map((item) => item.id === folder.id
            ? { ...item, name: trimmedName, updatedAt: now }
            : item);
        this.saveFolders();
        this.renderDashboard();
        this.showNotification(`Folder renamed to "${trimmedName}".`);
    }

    deleteFolder(folderId = '') {
        const folder = this.getFolderById(folderId);
        if (!folder) {
            this.showNotification('Folder not found.', 'error');
            return;
        }

        const confirmed = window.confirm(`Delete folder "${folder.name}"? Decks inside it will stay saved and just move back to All decks.`);
        if (!confirmed) {
            return;
        }

        this.folders = this.folders.filter((item) => item.id !== folder.id);
        this.presets = this.presets.map((preset) => {
            const normalizedPreset = this.normalizePresetRecord(preset);
            if (!normalizedPreset || normalizedPreset.folderId !== folder.id) {
                return normalizedPreset || preset;
            }

            return {
                ...normalizedPreset,
                folderId: ''
            };
        });

        if (this.dashboardSelectedFolderId === folder.id) {
            this.dashboardSelectedFolderId = '';
        }
        if (this.presetFolderSelect && this.presetFolderSelect.value === folder.id) {
            this.presetFolderSelect.value = '';
        }

        this.saveFolders();
        this.savePresets();
        this.renderPresetList();
        this.renderDashboard();
        this.showNotification(`Folder "${folder.name}" deleted.`);
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
        const root = String(baseName || '').trim() || 'Deck';
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

    getLatestPresetForFolder(folderId = '') {
        const target = String(folderId || '').trim();
        if (!target) {
            return null;
        }

        const matchingPresets = this.presets
            .map((preset) => this.normalizePresetRecord(preset))
            .filter(Boolean)
            .filter((preset) => String(preset.folderId || '').trim() === target)
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
            ? 'Showing all saved decks.'
            : `Showing screens for ${className}.`);
    }

    loadLatestPresetForSelectedClass() {
        const className = this.classProfileSelect?.value || this.presetClassFilterInput?.value || this.presetClassInput?.value || '';
        const latestPreset = this.getLatestPresetForClass(className);

        if (!latestPreset) {
            this.showNotification(className
                ? `No saved deck found for ${className}.`
                : 'Choose a class first.', 'warning');
            return;
        }

        this.loadPreset(latestPreset.id);
        if (this.classProfileSelect) {
            this.classProfileSelect.value = latestPreset.className || '';
        }
        if (this.presetClassFilterInput) {
            this.presetClassFilterInput.value = latestPreset.className || '';
        }
    }

    loadLatestPresetForSelectedFolder(folderId = '') {
        const latestPreset = this.getLatestPresetForFolder(folderId);

        if (!latestPreset) {
            this.showNotification(folderId
                ? `No saved deck found in ${this.getFolderLabel(folderId) || 'that folder'}.`
                : 'Choose a folder first.', 'warning');
            return;
        }

        this.loadPreset(latestPreset.id);
        if (this.presetFolderSelect) {
            this.presetFolderSelect.value = latestPreset.folderId || '';
        }
        if (this.presetClassFilterInput) {
            this.presetClassFilterInput.value = latestPreset.className || '';
        }
        if (this.presetClassInput) {
            this.presetClassInput.value = latestPreset.className || '';
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
        const seededDeckId = typeof preset.seededLessonId === 'string' && preset.seededLessonId.trim()
            ? `deck-${preset.seededLessonId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
            : '';
        const id = typeof preset.id === 'string' && preset.id.trim()
            ? preset.id.trim()
            : seededDeckId || this.createDeckId();
        const projectState = {
            ...this.buildPresetProjectState({ ...preset, id }),
            currentDeckId: id,
            projectName: name
        };

        return {
            ...preset,
            id,
            name,
            className: typeof preset.className === 'string' ? preset.className.trim() : '',
            period: typeof preset.period === 'string' ? preset.period.trim() : '',
            folderId: typeof preset.folderId === 'string' ? preset.folderId.trim() : '',
            isFavorite: preset.isFavorite === true,
            projectState,
            theme: typeof preset.theme === 'string' && preset.theme.trim() ? preset.theme : this.getCurrentThemeName(),
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

    normalizePresetCollection(presets = this.presets, options = {}) {
        const preferredDeckId = typeof options.preferredDeckId === 'string' ? options.preferredDeckId.trim() : '';
        const preferredName = typeof options.preferredName === 'string' ? options.preferredName.trim() : '';
        const normalizedPresets = (Array.isArray(presets) ? presets : [])
            .map((preset) => this.normalizePresetRecord(preset))
            .filter(Boolean);
        const preferredIndex = preferredDeckId && preferredName
            ? normalizedPresets.findIndex((preset) => preset.id === preferredDeckId && preset.name === preferredName)
            : -1;
        const ownerById = new Map();

        normalizedPresets.forEach((preset, index) => {
            const ownerIndex = ownerById.get(preset.id);
            if (ownerIndex === undefined) {
                ownerById.set(preset.id, index);
                return;
            }

            if (index === preferredIndex) {
                const displacedPreset = normalizedPresets[ownerIndex];
                const replacementId = this.createDeckId();
                normalizedPresets[ownerIndex] = {
                    ...displacedPreset,
                    id: replacementId,
                    projectState: cloneSerializableData({
                        ...displacedPreset.projectState,
                        currentDeckId: replacementId,
                        projectName: displacedPreset.name
                    })
                };
                ownerById.set(preset.id, index);
                return;
            }

            const replacementId = this.createDeckId();
            normalizedPresets[index] = {
                ...preset,
                id: replacementId,
                projectState: cloneSerializableData({
                    ...preset.projectState,
                    currentDeckId: replacementId,
                    projectName: preset.name
                })
            };
        });

        return normalizedPresets.map((preset) => ({
            ...preset,
            projectState: cloneSerializableData({
                ...preset.projectState,
                currentDeckId: preset.id,
                projectName: preset.name
            })
        }));
    }

    touchPresetUsage(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
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

    clonePreset(identifier) {
        const originalPreset = this.getPresetRecord(identifier);
        const normalizedOriginal = this.normalizePresetRecord(originalPreset);
        if (!normalizedOriginal) {
            this.showNotification('Deck not found.', 'error');
            return;
        }

        const suggestedName = `${normalizedOriginal.name} Copy`;
        const nextName = window.prompt('Name the duplicate screen', suggestedName);
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            this.showNotification('Enter a deck name first.', 'error');
            return;
        }

        if (this.presets.some((preset) => preset.name === trimmedName)) {
            this.showNotification(`Deck "${trimmedName}" already exists.`, 'error');
            return;
        }

        const now = Date.now();
        const id = this.createDeckId();
        const clone = {
            ...normalizedOriginal,
            id,
            name: trimmedName,
            isFavorite: false,
            projectState: cloneSerializableData({
                ...normalizedOriginal.projectState,
                currentDeckId: id,
                projectName: trimmedName
            }),
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0
        };
        delete clone.seededLessonId;

        this.presets.push(clone);
        this.savePresets();
        this.renderPresetList();
        this.dashboardExpandedDeckId = id;
        this.renderDashboard();
        this.focusDashboardDeckControl(id, '.dashboard-deck-toggle');
        this.showNotification(`Duplicated "${normalizedOriginal.name}" as "${trimmedName}".`);
    }

    renamePreset(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
        if (presetIndex === -1) {
            this.showNotification('Deck not found.', 'error');
            return;
        }

        const currentPreset = this.normalizePresetRecord(this.presets[presetIndex]);
        if (!currentPreset) {
            this.showNotification('Deck not found.', 'error');
            return;
        }

        const nextName = window.prompt('Rename deck', currentPreset.name || 'Untitled Deck');
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            this.showNotification('Deck name cannot be blank.', 'error');
            return;
        }

        const duplicate = this.presets.find((preset) => preset.name === trimmedName);
        if (duplicate && duplicate.id !== currentPreset.id) {
            this.showNotification(`Deck "${trimmedName}" already exists.`, 'error');
            return;
        }

        const now = Date.now();
        if (currentPreset.seededLessonId) {
            this.dismissSeededLesson(currentPreset.seededLessonId);
        }
        const renamedPreset = {
            ...currentPreset,
            name: trimmedName,
            projectState: cloneSerializableData({
                ...currentPreset.projectState,
                currentDeckId: currentPreset.id,
                projectName: trimmedName
            }),
            updatedAt: now
        };
        delete renamedPreset.seededLessonId;
        this.presets[presetIndex] = renamedPreset;

        if (this.getCurrentDeckId() === currentPreset.id) {
            const state = this.normalizeProjectState(this.projectState);
            this.projectState = {
                currentDeckId: currentPreset.id,
                projectName: trimmedName,
                activePageId: state.activePageId,
                pages: cloneSerializableData(state.pages)
            };
            this.saveStateImmediately();
            this.renderProjectControls();
        }

        if (this.presetNameInput && this.presetNameInput.value === currentPreset.name) {
            this.presetNameInput.value = trimmedName;
        }

        this.savePresets();
        this.renderPresetList();
        this.renderDashboard();
        this.focusDashboardDeckControl(currentPreset.id, '.dashboard-deck-toggle');
        this.showNotification(`Deck renamed to "${trimmedName}".`);
    }

    togglePresetFavorite(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
        if (presetIndex === -1) {
            this.showNotification('Deck not found.', 'error');
            return;
        }

        const currentPreset = this.normalizePresetRecord(this.presets[presetIndex]);
        if (!currentPreset) {
            this.showNotification('Deck not found.', 'error');
            return;
        }

        const isFavorite = !currentPreset.isFavorite;
        this.presets[presetIndex] = {
            ...currentPreset,
            isFavorite
        };
        this.savePresets();
        this.renderPresetList();
        this.renderDashboard();
        this.focusDashboardDeckControl(currentPreset.id, '.dashboard-favorite-btn');
        this.showNotification(isFavorite
            ? `Added "${currentPreset.name}" to Favourites.`
            : `Removed "${currentPreset.name}" from Favourites.`);
    }

    renderLayoutPresetOptions() {
        if (!this.layoutPresetSelect) return;

        this.layoutPresetSelect.innerHTML = '<option value="">Select deck</option>';

        this.presets.forEach((preset) => {
            const option = document.createElement('option');
            option.value = preset.id;
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
            this.showNotification('Enter a deck name first.', 'error');
            return;
        }

        if (this.presets.some((preset) => preset.name === name)) {
            this.showNotification(`Deck "${name}" already exists. Use Overwrite.`, 'error');
            return;
        }

        const now = Date.now();
        const id = this.createDeckId();
        const folderId = this.presetFolderSelect ? this.presetFolderSelect.value.trim() : '';
        const currentState = this.normalizeProjectState(this.projectState);
        this.projectState = {
            currentDeckId: id,
            projectName: name,
            activePageId: currentState.activePageId,
            pages: cloneSerializableData(currentState.pages)
        };
        const projectState = this.buildStateSnapshot();
        const preset = {
            id,
            name,
            className,
            period: this.presetPeriodInput ? this.presetPeriodInput.value.trim() : '',
            folderId,
            projectState: cloneSerializableData(projectState),
            theme: projectState.theme,
            background: cloneSerializableData(projectState.background),
            layout: cloneSerializableData(projectState.layout),
            lessonPlan: cloneSerializableData(projectState.lessonPlan),
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            usageCount: 0
        };

        this.presets.push(preset);
        this.dashboardExpandedDeckId = id;
        this.savePresets();
        this.saveStateImmediately();
        this.renderPresetList();
        this.renderDashboard();
        if (this.presetNameInput) {
            this.presetNameInput.value = name;
        }
        this.showNotification(`Deck "${name}" saved.`);
    }

    loadPreset(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
        const preset = presetIndex === -1 ? null : this.normalizePresetRecord(this.presets[presetIndex]);
        if (!preset) {
            this.showNotification('Deck not found.', 'error');
            return false;
        }

        const projectState = {
            ...(preset.projectState && typeof preset.projectState === 'object'
                ? this.normalizeProjectState(preset.projectState)
                : this.buildPresetProjectState(preset)),
            currentDeckId: preset.id,
            projectName: preset.name
        };

        this.presets[presetIndex] = {
            ...preset,
            projectState: cloneSerializableData(projectState),
            theme: projectState.theme,
            background: cloneSerializableData(projectState.background),
            layout: cloneSerializableData(projectState.layout),
            lessonPlan: cloneSerializableData(projectState.lessonPlan)
        };
        this.savePresets();
        this.applyState(cloneSerializableData(projectState));
        if (this.presetNameInput) this.presetNameInput.value = preset.name || '';
        if (this.presetClassInput) this.presetClassInput.value = preset.className || '';
        if (this.presetPeriodInput) this.presetPeriodInput.value = preset.period || '';
        if (this.presetFolderSelect) this.presetFolderSelect.value = preset.folderId || '';
        if (this.classProfileSelect) this.classProfileSelect.value = preset.className || '';
        if (this.presetClassFilterInput) this.presetClassFilterInput.value = preset.className || '';

        this.updateProjectorVisibility();
        this.saveState();
        this.dashboardExpandedDeckId = preset.id;
        this.touchPresetUsage(preset.id);
        this.showNotification(`Deck "${preset.name}" loaded.`);
        return true;
    }

    loadPresetFromDashboard(identifier) {
        const preset = this.getPresetRecord(identifier);
        const isCurrent = preset && preset.id === this.getCurrentDeckId();
        const loaded = isCurrent ? Boolean(this.touchPresetUsage(preset.id)) : this.loadPreset(identifier);
        if (loaded) {
            this.handleNavClick('classroom');
        }
    }

    arrangePresetFromDashboard(identifier) {
        const preset = this.getPresetRecord(identifier);
        const isCurrent = preset && preset.id === this.getCurrentDeckId();
        const loaded = isCurrent ? Boolean(this.touchPresetUsage(preset.id)) : this.loadPreset(identifier);
        if (loaded) {
            this.handleNavClick('classroom', { openTeacherPanel: true });
        }
    }

    presentPresetFromDashboard(identifier) {
        const preset = this.getPresetRecord(identifier);
        const isCurrent = preset && preset.id === this.getCurrentDeckId();
        const loaded = isCurrent ? Boolean(this.touchPresetUsage(preset.id)) : this.loadPreset(identifier);
        if (!loaded) {
            return;
        }

        this.saveStateImmediately();
        const projectorUrl = new URL('projector.html', window.location.href).toString();
        const projectorWindow = window.open(projectorUrl, '_blank');
        if (projectorWindow) {
            projectorWindow.opener = null;
        } else {
            this.showNotification('Allow pop-ups to open the projector window.', 'warning');
        }
    }

    focusDashboardDeckControl(deckId, selector = '.dashboard-deck-toggle') {
        if (!deckId) {
            return;
        }

        window.requestAnimationFrame(() => {
            const card = Array.from(this.dashboardRoot?.querySelectorAll('.dashboard-screen-card[data-deck-id]') || [])
                .find((item) => item.dataset.deckId === deckId);
            const target = card?.querySelector(selector)
                || this.dashboardRoot?.querySelector('.dashboard-screen-card:not([hidden]) .dashboard-deck-toggle')
                || this.dashboardRoot?.querySelector('#dashboard-search-input')
                || this.dashboardRoot?.querySelector('#dashboard-create-btn');
            target?.focus({ preventScroll: true });
        });
    }

    applyLayoutPreset() {
        if (!this.layoutPresetSelect) return;

        const selectedDeckId = this.layoutPresetSelect.value;
        if (!selectedDeckId) {
            this.showNotification('Select a screen first.', 'error');
            return;
        }

        this.loadPreset(selectedDeckId);
    }

    overwritePreset(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
        const existingPreset = presetIndex === -1 ? null : this.normalizePresetRecord(this.presets[presetIndex]);
        const name = existingPreset?.name || '';
        if (this.presetNameInput) this.presetNameInput.value = name;

        const className = this.presetClassInput ? this.presetClassInput.value.trim() : '';
        const period = this.presetPeriodInput ? this.presetPeriodInput.value.trim() : '';

        if (!existingPreset) {
            this.showNotification('Deck not found.', 'error');
            return;
        }
        const folderId = this.presetFolderSelect ? this.presetFolderSelect.value.trim() : (existingPreset?.folderId || '');
        const now = Date.now();
        const currentState = this.normalizeProjectState(this.projectState);
        this.projectState = {
            currentDeckId: existingPreset.id,
            projectName: name,
            activePageId: currentState.activePageId,
            pages: cloneSerializableData(currentState.pages)
        };
        const projectState = this.buildStateSnapshot();
        if (existingPreset.seededLessonId) {
            this.dismissSeededLesson(existingPreset.seededLessonId);
        }
        const overwrittenPreset = {
            ...existingPreset,
            id: existingPreset.id,
            name,
            className,
            period,
            folderId: folderId || existingPreset?.folderId || '',
            projectState: cloneSerializableData(projectState),
            theme: projectState.theme,
            background: cloneSerializableData(projectState.background),
            layout: cloneSerializableData(projectState.layout),
            lessonPlan: cloneSerializableData(projectState.lessonPlan),
            createdAt: Number.isFinite(existingPreset?.createdAt) ? existingPreset.createdAt : now,
            updatedAt: now,
            lastUsedAt: Number.isFinite(existingPreset?.lastUsedAt) ? existingPreset.lastUsedAt : now,
            usageCount: Number.isFinite(existingPreset?.usageCount) ? existingPreset.usageCount : 0
        };
        delete overwrittenPreset.seededLessonId;
        this.presets[presetIndex] = overwrittenPreset;
        this.savePresets();
        this.saveStateImmediately();
        this.renderPresetList();
        this.dashboardExpandedDeckId = existingPreset.id;
        this.renderDashboard();
        this.focusDashboardDeckControl(existingPreset.id, '.dashboard-deck-toggle');
        this.showNotification(`Deck "${name}" overwritten.`);
    }

    deletePreset(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
        const preset = presetIndex === -1 ? null : this.normalizePresetRecord(this.presets[presetIndex]);
        if (!preset) {
            this.showNotification('Deck not found.', 'error');
            return false;
        }
        const isCurrent = preset.id === this.getCurrentDeckId();
        if (isCurrent && this.presets.length <= 1) {
            this.showNotification('Create another deck before deleting your current deck.', 'warning');
            return false;
        }
        if (!confirm(`Delete deck "${preset.name}"?`)) {
            return false;
        }
        if (preset.seededLessonId) {
            this.dismissSeededLesson(preset.seededLessonId);
        }
        this.presets.splice(presetIndex, 1);
        this.savePresets();
        this.renderPresetList();
        if (isCurrent) {
            const nextPreset = [...this.presets]
                .map((item) => this.normalizePresetRecord(item))
                .filter(Boolean)
                .sort((a, b) => Number(b.lastUsedAt || b.updatedAt || 0) - Number(a.lastUsedAt || a.updatedAt || 0))[0];
            if (nextPreset) {
                this.loadPreset(nextPreset.id);
                this.dashboardExpandedDeckId = nextPreset.id;
            }
        } else if (this.dashboardExpandedDeckId === preset.id) {
            this.dashboardExpandedDeckId = null;
        }
        this.renderDashboard();
        const nextFocusId = this.dashboardExpandedDeckId || this.getCurrentDeckId();
        if (nextFocusId) {
            this.focusDashboardDeckControl(nextFocusId, '.dashboard-deck-toggle');
        } else {
            window.requestAnimationFrame(() => this.dashboardRoot?.querySelector('#dashboard-create-btn')?.focus({ preventScroll: true }));
        }
        this.showNotification(`Deck "${preset.name}" deleted.`);
        return true;
    }

    movePresetToFolder(identifier) {
        const presetIndex = this.getPresetIndex(identifier);
        if (presetIndex === -1) {
            this.showNotification('Deck not found.', 'error');
            return;
        }

        const currentPreset = this.normalizePresetRecord(this.presets[presetIndex]);
        if (!currentPreset) {
            this.showNotification('Deck not found.', 'error');
            return;
        }

        const existingFolders = this.getFolderStats().map((folder) => folder.name);
        const promptMessage = existingFolders.length
            ? `Move "${currentPreset.name}" to which folder?\n\nType a folder name, or leave blank for No folder.\nExisting folders: ${existingFolders.join(', ')}`
            : `Move "${currentPreset.name}" to which folder?\n\nType a folder name, or leave blank for No folder.`;
        const nextFolderName = window.prompt(promptMessage, this.getFolderLabel(currentPreset.folderId) || '');
        if (nextFolderName === null) {
            return;
        }

        const trimmedFolderName = nextFolderName.trim();
        let folderId = '';

        if (trimmedFolderName) {
            const folder = this.getFolderByName(trimmedFolderName) || this.createFolder(trimmedFolderName, { showNotice: false });
            folderId = folder ? folder.id : '';
        }

        this.presets[presetIndex] = {
            ...currentPreset,
            folderId,
            updatedAt: Date.now()
        };
        if (this.presetFolderSelect) {
            this.presetFolderSelect.value = folderId || '';
        }
        this.savePresets();
        this.renderPresetList();
        this.renderDashboard();
        this.showNotification(folderId
            ? `Moved "${currentPreset.name}" to "${this.getFolderLabel(folderId)}".`
            : `Removed "${currentPreset.name}" from its folder.`);
    }

    getSerializableState() {
        return this.buildStateSnapshot();
    }

    handleExportLayout() {
        const exportPayload = {
            schemaVersion: this.schemaVersion,
            appVersion: this.appVersion,
            state: removePrivateBehaviourData(this.getSerializableState()),
            presets: removePrivateBehaviourData(this.presets || []),
            folders: this.folders || []
        };

        const jsonString = JSON.stringify(exportPayload, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'classroom-screen-decks.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('Screen decks exported. Private student names and behaviour notes were not included.');
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
                - ${parsed.presets.length} decks
                - ${state.layout?.widgets?.length || 0} widgets
                - Theme: ${state.theme || 'default'}
            `;
            this.importSummary.textContent = summary;
            this.importSummary.style.color = 'green';

            // Normalize imported presets
            this.presets = this.normalizePresetCollection(parsed.presets, {
                preferredDeckId: state.currentDeckId,
                preferredName: state.projectName
            });
            if (Array.isArray(parsed.folders)) {
                this.folders = parsed.folders
                    .map((folder) => this.normalizeFolderRecord(folder))
                    .filter(Boolean);
                this.saveFolders();
            }
            this.savePresets();
            this.renderPresetList();

            if (state.theme) this.switchTheme(state.theme);
            if (state.background) this.backgroundManager.deserialize(state.background);
            if (state.lessonPlan && this.lessonPlanEditor) this.lessonPlanEditor.setContents(state.lessonPlan);

            this.projectState = {
                currentDeckId: state.currentDeckId || '',
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

            this.ensureCurrentProjectDeck({ allowLegacyNameMatch: true });
            this.updateProjectorVisibility();
            this.saveState();
            this.renderProjectControls();
            this.closeDialog(this.importDialog);
            this.showNotification('Screen decks imported successfully.');

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
            emptyState.textContent = 'No screen decks match your filters.';
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
            loadButton.dataset.id = preset.id;

            const overwriteButton = document.createElement('button');
            overwriteButton.type = 'button';
            overwriteButton.className = 'control-button';
            overwriteButton.textContent = 'Overwrite';
            overwriteButton.dataset.action = 'overwrite';
            overwriteButton.dataset.id = preset.id;

            const duplicateButton = document.createElement('button');
            duplicateButton.type = 'button';
            duplicateButton.className = 'control-button';
            duplicateButton.textContent = 'Duplicate';
            duplicateButton.dataset.action = 'duplicate';
            duplicateButton.dataset.id = preset.id;

            const renameButton = document.createElement('button');
            renameButton.type = 'button';
            renameButton.className = 'control-button';
            renameButton.textContent = 'Rename Deck';
            renameButton.dataset.action = 'rename';
            renameButton.dataset.id = preset.id;

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'control-button';
            deleteButton.textContent = 'Delete';
            deleteButton.dataset.action = 'delete';
            deleteButton.dataset.id = preset.id;

            item.addEventListener('click', (e) => {
                const button = e.target.closest('button');
                if (!button) return;

                const action = button.dataset.action;
                const presetId = button.dataset.id;

                if (action === 'load') this.loadPreset(presetId);
                if (action === 'overwrite') this.overwritePreset(presetId);
                if (action === 'rename') this.renamePreset(presetId);
                if (action === 'duplicate') this.clonePreset(presetId);
                if (action === 'delete') this.deletePreset(presetId);
            });

            actions.appendChild(loadButton);
            actions.appendChild(overwriteButton);
            actions.appendChild(renameButton);
            actions.appendChild(duplicateButton);
            actions.appendChild(deleteButton);

            item.appendChild(mainInfo);
            item.appendChild(actions);

            this.presetListElement.appendChild(item);
        });

        this.renderClassProfileOptions();
    }

    loadSavedState() {
        let restored = false;
        loadSavedState({
            applyState: (state) => {
                restored = this.applyState(state) === true;
            },
            resetAppState,
            showNotification: (message) => this.showNotification(message),
            schemaVersion: this.schemaVersion
        });
        this.hasRestoredSavedState = restored;
    }

    applyState(state) {
        try {
            // Run migration pipeline
            state = runMigrations(state, this.schemaVersion);
            state = this.normalizeProjectState(state);
            this.projectState = {
                currentDeckId: state.currentDeckId || '',
                projectName: state.projectName,
                activePageId: state.activePageId,
                pages: cloneSerializableData(state.pages)
            };

            if (!isValidLayout(state.layout)) {
                console.warn('Invalid layout detected. Resetting layout state.');
                resetAppState();
                return false;
            }

            const activePage = state.pages.find((page) => page.id === state.activePageId) || state.pages[0];
            if (activePage && activePage.snapshot) {
                this.applyPageSnapshot(activePage.snapshot);
            }
            this.renderProjectControls();
            return true;
        } catch (err) {
            console.error('State load failed; resetting.', err);
            localStorage.removeItem('classroomScreenState');
            this.showNotification("Your previous screen state was corrupted; reset to defaults.", "warning");
            return false;
        }
    }

    resetLayout() {
        if (confirm('Clear the current page? This will remove all widgets from this page.')) {
            this.widgets = [];
            if (this.layoutManager && typeof this.layoutManager.discardAllWidgets === 'function') {
                this.layoutManager.discardAllWidgets();
            }
            this.widgetsContainer.innerHTML = EMPTY_WIDGET_PLACEHOLDER_HTML;
            this.backgroundManager.reset();
            if (this.lessonPlanEditor) {
                this.lessonPlanEditor.setContents([]);
            }
            this.saveState();
            this.showNotification('Current page cleared.');
        }
    }

    handleWidgetRemoved(widget) {
        if (!widget) return;
        this.widgets = this.widgets.filter(existing => existing !== widget);
        if (this.layoutManager && Array.isArray(this.layoutManager.widgets)) {
            this.layoutManager.widgets = this.layoutManager.widgets.filter(info => info.widget !== widget);
        }
        if (this.widgets.length === 0 && !this.widgetsContainer.querySelector('.widget-placeholder')) {
            this.widgetsContainer.innerHTML = EMPTY_WIDGET_PLACEHOLDER_HTML;
        }
        if (widget instanceof TimerWidget) {
            this.syncTimerControlsFromWidget();
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
            ? `Resume Last ${sourceLabel}`
            : 'Resume Last Deck';
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
                deckName: 'Slides',
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
            deckName: activeDeck?.name || 'Slides',
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
        deckName = 'Slides',
        currentIndices = { h: 0, v: 0 },
        statusMessage = '',
        sourceUrl = ''
    } = {}) {
        if (!this.presentationStatusBadge || !this.presentationStatusDisplay || !this.presentationStatusContext || !this.presentationStatusMeta) {
            return;
        }

        let badgeText = 'No Slides';
        let badgeState = 'empty';
        let displayText = deckName || 'Slides';
        let contextText = 'Open Slides Controls to load a deck.';
        let metaText = 'Slides stay in sync with the projector.';
        let manageLabel = 'Open Slides Controls';

        if (hasWidget) {
            badgeText = 'Slides Ready';
            badgeState = 'idle';
            displayText = 'Slides';
            contextText = 'No slide deck is loaded yet.';
            metaText = statusMessage || 'Open Slides Controls to load HTML or a linked deck.';
            manageLabel = 'Open Slides Controls';
        }

        if (hasWidget && hasDeck) {
            const isHtmlDeck = sourceType === 'html';
            badgeText = sourceLabel || 'Slides';
            badgeState = isHtmlDeck ? 'live' : 'external';
            displayText = deckName || sourceLabel || 'Slides';
            contextText = this.formatPresentationSourceContext(sourceType, currentIndices, sourceUrl);
            metaText = statusMessage || (isHtmlDeck
                ? 'Previous and Next are available here and in Slides Controls.'
                : 'Linked in Slides Controls.');
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
            this.showNotification('No last slide deck is available yet.', 'warning');
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
            this.showNotification('Unable to load the last slide deck.', 'error');
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

        this.showNotification('Last slide deck opened on the projector.', 'success');
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
            this.showNotification('Load a slide deck before opening the projector.', 'warning');
            return;
        }

        presentationWidget.openProjector();
        this.syncPresentationControlsFromWidget(presentationWidget);
    }

    navigatePresentationFromPanel(direction) {
        const presentationWidget = this.getPrimaryRevealManagerWidget();
        if (!presentationWidget || !presentationWidget.activeDeck) {
            this.showNotification('Load a slide deck first.', 'warning');
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

    formatDashboardDate(value) {
        if (!value) {
            return 'Recently saved';
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return 'Recently saved';
        }

        return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }

    getResourceProvider(source = this.resourceLibrarySource) {
        return source === 'google-drive'
            ? this.googleDriveResourceProvider
            : this.localResourceProvider;
    }

    getResourceProviderStatus(source = this.resourceLibrarySource) {
        const provider = this.getResourceProvider(source);
        if (!provider || typeof provider.getStatus !== 'function') {
            return {
                state: 'unavailable',
                label: 'Unavailable',
                detail: 'This resource location is unavailable.',
                connected: false,
                configured: false
            };
        }

        try {
            return provider.getStatus() || {};
        } catch (error) {
            return {
                state: 'error',
                label: 'Needs attention',
                detail: error?.message || 'This resource location could not be checked.',
                connected: false,
                configured: source !== 'google-drive'
            };
        }
    }

    getResourceKey(resource = {}) {
        if (resource?.key) {
            return String(resource.key);
        }

        try {
            return createResourceKey(resource);
        } catch (error) {
            const provider = resource?.provider || this.resourceLibrarySource;
            const path = Array.isArray(resource?.pathSegments) ? resource.pathSegments.join('/') : '';
            return `${provider}:${resource?.id || path || resource?.name || 'resource'}`;
        }
    }

    getResourceTypeMeta(resource = {}) {
        const type = resource.type || (resource.kind === 'folder' ? 'folder' : 'other');
        const isLegacyPowerPoint = type === 'presentation'
            && /\.ppt$/i.test(resource.name || '')
            && !/\.pptx$/i.test(resource.name || '');
        const options = {
            folder: { label: 'Folder', icon: 'fa-folder', supported: true },
            pdf: { label: 'PDF', icon: 'fa-file-pdf', supported: true },
            presentation: { label: 'PowerPoint', icon: 'fa-file-powerpoint', supported: true },
            'google-slides': { label: 'Google Slides', icon: 'fa-file-powerpoint', supported: true },
            image: { label: 'Image', icon: 'fa-file-image', supported: true },
            other: { label: 'File', icon: 'fa-file', supported: false }
        };
        if (isLegacyPowerPoint) {
            return { label: 'Legacy PowerPoint', icon: 'fa-file-powerpoint', supported: false };
        }
        return options[type] || options.other;
    }

    formatResourceSize(value) {
        const bytes = Number(value) || 0;
        if (bytes <= 0) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    }

    isResourceFavorite(resource = {}) {
        if (!this.resourceLibraryState || typeof this.resourceLibraryState.isFavorite !== 'function') {
            return false;
        }
        return this.resourceLibraryState.isFavorite(resource);
    }

    getStoredResourceCollection(methodName) {
        const method = this.resourceLibraryState?.[methodName];
        if (typeof method !== 'function') return [];
        const result = method.call(this.resourceLibraryState);
        return Array.isArray(result) ? result : [];
    }

    getVisibleResourceEntries() {
        const currentSource = this.resourceLibrarySource;
        let entries = Array.isArray(this.resourceLibraryEntries) ? this.resourceLibraryEntries : [];

        if (this.resourceLibraryView === 'favorites') {
            const storedFavorites = this.getStoredResourceCollection('getFavorites')
                .filter((resource) => resource && resource.provider === currentSource);
            entries = storedFavorites.length > 0
                ? storedFavorites
                : entries.filter((resource) => this.isResourceFavorite(resource));
        } else if (this.resourceLibraryView === 'recent') {
            entries = this.getStoredResourceCollection('getRecents')
                .filter((resource) => resource && resource.provider === currentSource);
        }

        const query = String(this.resourceLibrarySearchQuery || '').trim().toLowerCase();
        if (query) {
            entries = entries.filter((resource) => {
                const meta = this.getResourceTypeMeta(resource);
                return `${resource?.name || ''} ${meta.label}`.toLowerCase().includes(query);
            });
        }

        const seen = new Set();
        return entries.filter((resource) => {
            if (!resource) return false;
            const key = this.getResourceKey(resource);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    renderResourceLibraryMarkup() {
        const status = this.getResourceProviderStatus();
        const entries = this.getVisibleResourceEntries();
        const isLocal = this.resourceLibrarySource === 'local';
        const isConfigured = status.configured !== false;
        const isConnected = status.connected === true;
        const statusLabel = this.resourceLibraryLoading
            ? 'Loading'
            : (status.label || (isConnected ? 'Connected' : 'Not connected'));
        const statusDetail = this.resourceLibraryMessage
            || status.detail
            || (isLocal
                ? 'Choose the teaching-resources folder you want Teacher Screen to use.'
                : 'Connect Google Drive to open teaching resources without downloading them first.');
        const connectionActionLabel = isConnected
            ? (isLocal ? 'Change folder' : 'Reconnect')
            : (isLocal ? 'Choose folder' : (isConfigured ? 'Connect Google Drive' : 'Google setup required'));
        const statusClass = isConnected ? 'is-connected' : (status.state === 'error' ? 'is-error' : '');
        const statusState = this.resourceLibraryLoading ? 'loading' : (status.state || (isConnected ? 'connected' : 'disconnected'));
        const sourceRootLabel = isLocal
            ? (status.folderName || 'Computer folder')
            : (status.folderName || 'Google Drive');

        const breadcrumbMarkup = [
            `<button class="resource-breadcrumb" type="button" data-resource-breadcrumb="-1">${escapeHtml(sourceRootLabel)}</button>`,
            ...this.resourceLibraryPath.map((resource, index) => (
                `<button class="resource-breadcrumb" type="button" data-resource-breadcrumb="${index}">${escapeHtml(resource.name || 'Folder')}</button>`
            ))
        ].join('<span aria-hidden="true">/</span>');

        const cardsMarkup = entries.length > 0
            ? entries.map((resource) => {
                const key = this.getResourceKey(resource);
                const meta = this.getResourceTypeMeta(resource);
                const isFolder = resource.kind === 'folder' || resource.type === 'folder';
                const isFavorite = this.isResourceFavorite(resource);
                const sizeLabel = this.formatResourceSize(resource.size);
                const dateValue = resource.lastModified || resource.modifiedTime;
                const dateLabel = dateValue ? this.formatDashboardDate(dateValue) : '';
                const detailParts = [meta.label, sizeLabel, dateLabel].filter(Boolean);
                const canAdd = !isFolder && meta.supported;
                const canPresentPdf = resource.type === 'pdf';

                return `
                    <article class="resource-card${isFolder ? ' is-folder' : ''}" data-resource-key="${escapeHtml(key)}">
                        <div class="resource-card__icon" aria-hidden="true"><i class="fa-solid ${meta.icon}"></i></div>
                        <div class="resource-card__body">
                            <div class="resource-card__heading">
                                <h3>${escapeHtml(resource.name || 'Untitled resource')}</h3>
                                <button class="resource-favorite-btn${isFavorite ? ' is-active' : ''}" type="button" data-resource-action="favorite" aria-label="${isFavorite ? 'Remove from resource favourites' : 'Add to resource favourites'}" aria-pressed="${isFavorite ? 'true' : 'false'}" title="${isFavorite ? 'Remove from favourites' : 'Add to favourites'}">
                                    <i class="${isFavorite ? 'fa-solid' : 'fa-regular'} fa-star" aria-hidden="true"></i>
                                </button>
                            </div>
                            <p class="resource-card__meta">${escapeHtml(detailParts.join(' · ') || meta.label)}</p>
                        </div>
                        <div class="resource-card__actions">
                            ${isFolder
                                ? '<button class="control-button control-button--primary" type="button" data-resource-action="folder">Open folder</button>'
                                : '<button class="control-button" type="button" data-resource-action="open">Open</button>'}
                            ${canAdd
                                ? '<button class="control-button control-button--primary" type="button" data-resource-action="add">Add to current deck</button>'
                                : ''}
                            ${canPresentPdf
                                ? '<button class="control-button" type="button" data-resource-action="present">Present as slides</button>'
                                : ''}
                        </div>
                    </article>
                `;
            }).join('')
            : `<div class="resource-empty">
                <i class="fa-solid ${this.resourceLibraryLoading ? 'fa-spinner fa-spin' : 'fa-folder-open'}" aria-hidden="true"></i>
                <strong>${this.resourceLibraryLoading ? 'Loading resources…' : (isConnected ? 'No resources found' : 'Connect a resource folder')}</strong>
                <p>${escapeHtml(isConnected
                    ? (this.resourceLibraryView === 'all'
                        ? 'This folder has no teaching files matching the current search.'
                        : `No ${this.resourceLibraryView} resources are available in this location yet.`)
                    : statusDetail)}</p>
            </div>`;

        return `
            <section class="dashboard-resources-panel" aria-label="Teaching resources">
                <div class="resource-library__header">
                    <div>
                        <p class="dashboard-toolbar__label">Resource Library</p>
                        <h2>Teaching resources</h2>
                        <p>Open lesson files from your computer folder or Google Drive, then add supported material to the current deck.</p>
                    </div>
                    <div class="resource-source-tabs" role="group" aria-label="Resource locations">
                        <button class="resource-source-tab${isLocal ? ' is-active' : ''}" type="button" data-resource-source="local" aria-pressed="${isLocal ? 'true' : 'false'}">
                            <i class="fa-solid fa-folder" aria-hidden="true"></i> Computer Folder
                        </button>
                        <button class="resource-source-tab${!isLocal ? ' is-active' : ''}" type="button" data-resource-source="google-drive" aria-pressed="${!isLocal ? 'true' : 'false'}">
                            <i class="fa-brands fa-google-drive" aria-hidden="true"></i> Google Drive
                        </button>
                    </div>
                </div>

                <div class="resource-connection-card">
                    <div class="resource-connection-card__copy">
                        <span class="resource-status-badge ${statusClass}" data-state="${escapeHtml(statusState)}">${escapeHtml(statusLabel)}</span>
                        <strong>${escapeHtml(sourceRootLabel)}</strong>
                        <p>${escapeHtml(statusDetail)}</p>
                    </div>
                    <div class="resource-card__actions">
                        <button id="resource-connect-btn" class="control-button control-button--primary" type="button"${!isConfigured && !isLocal ? ' disabled' : ''}>${escapeHtml(connectionActionLabel)}</button>
                        ${!isLocal && status.pickerConfigured
                            ? '<button id="resource-drive-picker-btn" class="control-button" type="button">Choose from Drive</button>'
                            : ''}
                        ${isConnected ? '<button id="resource-refresh-btn" class="control-button" type="button">Refresh</button>' : ''}
                    </div>
                </div>

                <div class="resource-toolbar">
                    <div class="resource-breadcrumbs" aria-label="Current resource folder">${breadcrumbMarkup}</div>
                    <input id="resource-search-input" class="resource-search" type="search" aria-label="Search teaching resources" placeholder="Search this resource view" value="${escapeHtml(this.resourceLibrarySearchQuery)}">
                </div>
                <input id="resource-folder-fallback-input" type="file" multiple webkitdirectory directory hidden aria-label="Choose a teaching resources folder">
                <div class="resource-grid" aria-live="polite">${cardsMarkup}</div>
            </section>
        `;
    }

    openResourceLibrary(source = this.resourceLibrarySource) {
        this.resourceLibrarySource = source === 'google-drive' ? 'google-drive' : 'local';
        this.dashboardNavigationMode = 'resources';
        this.dashboardSelectedClassName = '';
        this.dashboardSearchQuery = '';
        this.renderDashboard();
        void this.refreshResourceLibrary({ restore: true });
    }

    async refreshResourceLibrary({ restore = false } = {}) {
        const provider = this.getResourceProvider();
        const refreshId = ++this.resourceLibraryRefreshId;
        this.resourceLibraryLoading = true;
        this.resourceLibraryMessage = '';
        if (this.dashboardNavigationMode === 'resources') {
            this.renderDashboard();
        }

        try {
            if (restore && this.resourceLibrarySource === 'local' && typeof provider?.restore === 'function') {
                await provider.restore();
            }

            const status = this.getResourceProviderStatus();
            if (!status.connected) {
                if (refreshId !== this.resourceLibraryRefreshId) return;
                this.resourceLibraryEntries = [];
                this.resourceLibraryMessage = status.detail || '';
                return;
            }

            const locator = this.resourceLibrarySource === 'local'
                ? this.resourceLibraryPath.map((resource) => resource.name)
                : (this.resourceLibraryPath[this.resourceLibraryPath.length - 1] || null);
            const entries = await provider.list(locator);
            if (refreshId !== this.resourceLibraryRefreshId) return;
            const listedEntries = Array.isArray(entries) ? entries : [];
            if (this.resourceLibrarySource === 'google-drive' && this.resourceLibraryPath.length === 0) {
                const storedDriveResources = [
                    ...this.getStoredResourceCollection('getFavorites'),
                    ...this.getStoredResourceCollection('getRecents')
                ].filter((resource) => resource?.provider === 'google-drive');
                const seen = new Set();
                this.resourceLibraryEntries = [...listedEntries, ...storedDriveResources]
                    .filter((resource) => {
                        const key = this.getResourceKey(resource);
                        if (!key || seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
            } else {
                this.resourceLibraryEntries = listedEntries;
            }
        } catch (error) {
            if (refreshId !== this.resourceLibraryRefreshId) return;
            console.warn('Unable to refresh teaching resources:', error);
            this.resourceLibraryEntries = [];
            this.resourceLibraryMessage = error?.message || 'Teaching resources could not be loaded.';
        } finally {
            if (refreshId === this.resourceLibraryRefreshId) {
                this.resourceLibraryLoading = false;
                if (this.dashboardNavigationMode === 'resources') {
                    this.renderDashboard();
                }
            }
        }
    }

    async connectResourceProvider() {
        const provider = this.getResourceProvider();
        try {
            const status = this.getResourceProviderStatus();
            if (this.resourceLibrarySource === 'local' && !provider?.isSupported?.()) {
                this.dashboardRoot?.querySelector('#resource-folder-fallback-input')?.click();
                return;
            }

            if (status.connected && this.resourceLibrarySource === 'local') {
                await provider.connect();
            } else if (status.connected && typeof provider?.reconnect === 'function') {
                await provider.reconnect();
            } else {
                await provider.connect();
            }
            this.resourceLibraryPath = [];
            await this.refreshResourceLibrary();
            window.requestAnimationFrame(() => {
                (this.dashboardRoot?.querySelector('#resource-refresh-btn')
                    || this.dashboardRoot?.querySelector('#resource-connect-btn'))
                    ?.focus({ preventScroll: true });
            });
        } catch (error) {
            console.warn('Unable to connect resource provider:', error);
            this.resourceLibraryMessage = error?.message || 'This resource location could not be connected.';
            this.resourceLibraryLoading = false;
            this.renderDashboard();
            window.requestAnimationFrame(() => {
                this.dashboardRoot?.querySelector('#resource-connect-btn')?.focus({ preventScroll: true });
            });
        }
    }

    async chooseGoogleDriveResource() {
        const provider = this.googleDriveResourceProvider;
        if (!provider || typeof provider.chooseResource !== 'function') {
            this.showNotification('Google Drive Picker is unavailable.', 'error');
            return;
        }

        try {
            this.resourceLibraryLoading = true;
            this.resourceLibraryMessage = 'Choose a teaching file from Google Drive.';
            this.renderDashboard();
            const resource = await provider.chooseResource();
            if (!resource) {
                this.resourceLibraryLoading = false;
                this.resourceLibraryMessage = 'No Google Drive file was selected.';
                this.renderDashboard();
                return;
            }

            const key = this.getResourceKey(resource);
            this.recordResourceRecent(resource);
            this.resourceLibraryEntries = [
                resource,
                ...this.resourceLibraryEntries.filter((entry) => this.getResourceKey(entry) !== key)
            ];
            this.resourceLibraryView = 'all';
            this.resourceLibraryLoading = false;
            this.resourceLibraryMessage = `Selected "${resource.name}" from Google Drive.`;
            this.renderDashboard();
        } catch (error) {
            console.warn('Unable to choose a Google Drive resource:', error);
            this.resourceLibraryLoading = false;
            this.resourceLibraryMessage = error?.message || 'Google Drive Picker could not open.';
            this.renderDashboard();
        }
    }

    setResourceSource(source) {
        const nextSource = source === 'google-drive' ? 'google-drive' : 'local';
        if (this.resourceLibrarySource === nextSource) return;
        this.resourceLibrarySource = nextSource;
        this.resourceLibraryPath = [];
        this.resourceLibraryEntries = [];
        this.resourceLibraryMessage = '';
        this.resourceLibrarySearchQuery = '';
        this.renderDashboard();
        void this.refreshResourceLibrary({ restore: nextSource === 'local' }).finally(() => {
            window.requestAnimationFrame(() => {
                this.dashboardRoot
                    ?.querySelector(`[data-resource-source="${nextSource}"]`)
                    ?.focus({ preventScroll: true });
            });
        });
    }

    findResourceByKey(key = '') {
        const candidates = [
            ...(Array.isArray(this.resourceLibraryEntries) ? this.resourceLibraryEntries : []),
            ...this.getStoredResourceCollection('getFavorites'),
            ...this.getStoredResourceCollection('getRecents')
        ];
        return candidates.find((resource) => this.getResourceKey(resource) === key) || null;
    }

    recordResourceRecent(resource) {
        if (resource && typeof this.resourceLibraryState?.recordRecent === 'function') {
            this.resourceLibraryState.recordRecent(resource);
        }
    }

    toggleResourceFavorite(resource) {
        if (!resource || typeof this.resourceLibraryState?.toggleFavorite !== 'function') return;
        const key = this.getResourceKey(resource);
        const isFavorite = this.resourceLibraryState.toggleFavorite(resource);
        this.showNotification(isFavorite
            ? `Added "${resource.name}" to resource favourites.`
            : `Removed "${resource.name}" from resource favourites.`);
        this.renderDashboard();
        window.requestAnimationFrame(() => {
            const cards = Array.from(this.dashboardRoot?.querySelectorAll('[data-resource-key]') || []);
            const matchingCard = cards.find((card) => card.dataset.resourceKey === key);
            const fallbackView = this.dashboardRoot?.querySelector(`[data-resource-view="${this.resourceLibraryView}"]`);
            (matchingCard?.querySelector('[data-resource-action="favorite"]') || fallbackView)
                ?.focus({ preventScroll: true });
        });
    }

    async getResourceFile(resource) {
        const fallbackFile = this.resourceFallbackFiles?.get(this.getResourceKey(resource));
        if (fallbackFile) return fallbackFile;
        const provider = this.getResourceProvider(resource?.provider || this.resourceLibrarySource);
        if (!provider || typeof provider.getFile !== 'function') {
            throw new Error('This resource cannot be opened from its current location.');
        }
        return provider.getFile(resource);
    }

    getSafeGoogleSlidesUrl(value = '') {
        try {
            const parsed = new URL(String(value || '').trim());
            const hostname = parsed.hostname.toLowerCase();
            const isGoogleSlidesHost = hostname === 'docs.google.com' || hostname === 'slides.google.com';
            const isPresentationPath = parsed.pathname.toLowerCase().includes('/presentation/');
            return parsed.protocol === 'https:' && isGoogleSlidesHost && isPresentationPath
                ? parsed.href
                : '';
        } catch (error) {
            return '';
        }
    }

    async resolveGoogleSlidesResourceUrl(resource) {
        const existingUrl = resource?.sourceUrl || resource?.webUrl || resource?.webViewLink || resource?.url || '';
        const safeExistingUrl = this.getSafeGoogleSlidesUrl(existingUrl);
        if (safeExistingUrl) return safeExistingUrl;

        const file = await this.getResourceFile(resource);
        if (!file || typeof file.text !== 'function') return '';
        try {
            const shortcut = JSON.parse(await file.text());
            if (typeof shortcut?.url === 'string' && shortcut.url.trim()) {
                return this.getSafeGoogleSlidesUrl(shortcut.url);
            }
            const documentId = typeof shortcut?.doc_id === 'string' ? shortcut.doc_id.trim() : '';
            return documentId
                ? this.getSafeGoogleSlidesUrl(`https://docs.google.com/presentation/d/${encodeURIComponent(documentId)}/edit`)
                : '';
        } catch (error) {
            return '';
        }
    }

    async openResourceFile(resource) {
        if (resource?.type === 'google-slides') {
            const sourceUrl = await this.resolveGoogleSlidesResourceUrl(resource);
            if (!sourceUrl) {
                throw new Error('That Google Slides shortcut does not contain a usable presentation link.');
            }
            window.open(sourceUrl, '_blank', 'noopener,noreferrer');
            this.recordResourceRecent(resource);
            this.renderDashboard();
            return;
        }

        const isNativeGoogleFile = resource?.provider === 'google-drive'
            && /^application\/vnd\.google-apps\./i.test(resource?.mimeType || '');
        const nativeGoogleUrl = resource?.sourceUrl || resource?.webUrl || resource?.webViewLink || '';
        if (isNativeGoogleFile && nativeGoogleUrl) {
            window.open(nativeGoogleUrl, '_blank', 'noopener,noreferrer');
            this.recordResourceRecent(resource);
            this.renderDashboard();
            return;
        }

        const file = await this.getResourceFile(resource);
        if (!file) throw new Error('That resource file could not be read.');
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.download = resource.type === 'presentation' || resource.type === 'other' ? (file.name || resource.name || '') : '';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        this.recordResourceRecent(resource);
        this.renderDashboard();
    }

    async addResourceToCurrentDeck(resource, { presentPdf = false } = {}) {
        if (!resource || resource.kind === 'folder') return;
        const type = resource.type || 'other';
        const declaredSize = Number(resource.size) || 0;
        if ((type === 'pdf' || type === 'presentation') && declaredSize > 50 * 1024 * 1024) {
            throw new Error('Choose a PDF or PowerPoint file under 50 MB.');
        }
        if (type === 'image' && declaredSize > 2 * 1024 * 1024) {
            throw new Error('Choose an image under 2 MB for the current deck background.');
        }
        let file = null;
        if (type !== 'google-slides') {
            file = await this.getResourceFile(resource);
            if (!file) throw new Error('That resource file could not be read.');
        }
        const googleSlidesUrl = type === 'google-slides'
            ? await this.resolveGoogleSlidesResourceUrl(resource)
            : '';
        if (type === 'google-slides' && !googleSlidesUrl) {
            throw new Error('That Google Slides shortcut does not contain a usable presentation link.');
        }

        const fileSize = Number(file?.size) || 0;
        if ((type === 'pdf' || type === 'presentation') && fileSize > 50 * 1024 * 1024) {
            throw new Error('Choose a PDF or PowerPoint file under 50 MB.');
        }
        if (type === 'image' && fileSize > 2 * 1024 * 1024) {
            throw new Error('Choose an image under 2 MB for the current deck background.');
        }

        this.handleNavClick('classroom');
        let added = false;
        let createdWidget = null;
        try {
            if (type === 'pdf' && !presentPdf) {
                const widget = this.addWidget('document-viewer', {
                    notification: `Adding ${resource.name} to Document Viewer…`
                });
                createdWidget = widget;
                if (!widget || typeof widget.renderPdf !== 'function') {
                    throw new Error('Document Viewer is unavailable.');
                }
                added = (await widget.renderPdf(file)) === true;
            } else if (type === 'presentation' || (type === 'pdf' && presentPdf)) {
                const widget = this.addWidget('reveal-manager', {
                    notification: `Adding ${resource.name} to Presentation…`
                });
                createdWidget = widget;
                if (!widget || typeof widget.importDeckFile !== 'function') {
                    throw new Error('Presentation is unavailable.');
                }
                added = !!(await widget.importDeckFile(file));
            } else if (type === 'google-slides') {
                const widget = this.addWidget('reveal-manager', {
                    notification: `Adding ${resource.name} to Presentation…`
                });
                createdWidget = widget;
                if (!widget || typeof widget.loadExternalSource !== 'function') {
                    throw new Error('Presentation is unavailable.');
                }
                added = await widget.loadExternalSource({
                    type: 'google-slides',
                    sourceUrl: googleSlidesUrl,
                    name: resource.name || 'Google Slides'
                });
            } else if (type === 'image') {
                added = await this.handleCustomBackgroundUpload(file);
            }

            if (!added) {
                throw new Error('That resource could not be added to the current deck.');
            }
        } catch (error) {
            if (createdWidget && this.layoutManager?.removeWidget) {
                this.layoutManager.removeWidget(createdWidget);
            }
            this.openResourceLibrary(resource.provider === 'google-drive' ? 'google-drive' : 'local');
            throw error;
        }

        this.recordResourceRecent(resource);
        if (this.saveState?.flush) {
            this.saveState.flush();
        } else {
            this.saveState();
        }
        this.showNotification(`Added "${resource.name}" to the current deck.`, 'success');
    }

    async handleResourceAction(action, resource) {
        if (!resource) return;
        try {
            if (action === 'favorite') {
                this.toggleResourceFavorite(resource);
                return;
            }
            if (action === 'folder') {
                const providerStatus = this.getResourceProviderStatus(resource.provider);
                const connectedRootName = providerStatus.folderName || '';
                const connectedRootId = providerStatus.rootId || '';
                if (resource.provider === 'local'
                    && ((resource.rootId && connectedRootId && resource.rootId !== connectedRootId)
                        || (!resource.rootId
                            && resource.rootName
                            && connectedRootName
                            && resource.rootName !== connectedRootName))) {
                    throw new Error(`Reconnect the "${resource.rootName}" folder to open this saved resource.`);
                }
                if (resource.provider === 'local' && Array.isArray(resource.pathSegments)) {
                    this.resourceLibraryPath = resource.pathSegments.map((name, index) => ({
                        provider: 'local',
                        kind: 'directory',
                        type: 'folder',
                        name,
                        rootName: resource.rootName || connectedRootName,
                        rootId: resource.rootId || connectedRootId,
                        pathSegments: resource.pathSegments.slice(0, index + 1),
                        key: createResourceKey('local', [
                            resource.rootId || connectedRootId || resource.rootName || connectedRootName,
                            ...resource.pathSegments.slice(0, index + 1)
                        ])
                    }));
                } else {
                    const expectedParentPath = (resource.pathSegments || []).slice(0, -1).join('/');
                    const currentPath = this.resourceLibraryPath.map((item) => item.name).join('/');
                    this.resourceLibraryPath = expectedParentPath === currentPath
                        ? [...this.resourceLibraryPath, resource]
                        : [resource];
                }
                this.resourceLibraryView = 'all';
                this.resourceLibrarySearchQuery = '';
                await this.refreshResourceLibrary();
                window.requestAnimationFrame(() => {
                    const breadcrumbs = this.dashboardRoot?.querySelectorAll('.resource-breadcrumb') || [];
                    breadcrumbs[breadcrumbs.length - 1]?.focus({ preventScroll: true });
                });
                return;
            }
            if (action === 'open') {
                await this.openResourceFile(resource);
                return;
            }
            if (action === 'add') {
                await this.addResourceToCurrentDeck(resource);
                return;
            }
            if (action === 'present') {
                await this.addResourceToCurrentDeck(resource, { presentPdf: true });
            }
        } catch (error) {
            console.warn('Teaching resource action failed:', error);
            this.showNotification(error?.message || 'That teaching resource could not be opened.', 'error');
        }
    }

    handleFallbackResourceFiles(fileList) {
        const files = Array.from(fileList || []);
        const firstRelativePath = files[0]?.webkitRelativePath || '';
        const selectedRootName = firstRelativePath.split('/').filter(Boolean)[0] || 'Selected folder';
        const fallbackStorageKey = `teacherScreenFallbackResourceRoot:${selectedRootName}`;
        let fallbackRootId = this.resourceFallbackRootIds.get(selectedRootName) || '';
        try {
            fallbackRootId = fallbackRootId || sessionStorage.getItem(fallbackStorageKey) || '';
        } catch (error) {
            // Session storage is optional; the in-memory mapping still works.
        }
        if (!fallbackRootId) {
            fallbackRootId = `local-session:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        }
        this.resourceFallbackRootIds.set(selectedRootName, fallbackRootId);
        try {
            sessionStorage.setItem(fallbackStorageKey, fallbackRootId);
        } catch (error) {
            // Keep the fallback connection usable even when storage is blocked.
        }
        this.resourceFallbackFiles = new Map();
        this.resourceLibraryEntries = files.map((file) => {
            const relativePath = file.webkitRelativePath || file.name;
            const parts = relativePath.split('/').filter(Boolean);
            const resource = {
                provider: 'local',
                kind: 'file',
                name: file.name,
                rootName: parts.length > 1 ? parts[0] : selectedRootName,
                rootId: fallbackRootId,
                pathSegments: parts,
                mimeType: file.type || '',
                size: file.size,
                lastModified: file.lastModified,
                type: /\.pdf$/i.test(file.name)
                    ? 'pdf'
                    : /\.(ppt|pptx)$/i.test(file.name)
                        ? 'presentation'
                        : (/^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name))
                            ? 'image'
                            : 'other'
            };
            resource.key = createResourceKey('local', [
                fallbackRootId,
                ...(parts.length > 0 ? parts : [file.name])
            ]);
            this.resourceFallbackFiles.set(resource.key, file);
            return resource;
        });
        this.resourceLibraryMessage = files.length > 0
            ? `${files.length} resource ${files.length === 1 ? 'file is' : 'files are'} available for this session.`
            : 'No resource files were selected.';
        this.resourceLibraryLoading = false;
        this.renderDashboard();
    }

    bindResourceLibraryEvents() {
        this.dashboardRoot.querySelectorAll('[data-resource-source]').forEach((button) => {
            button.addEventListener('click', () => this.setResourceSource(button.dataset.resourceSource));
        });

        this.dashboardRoot.querySelectorAll('[data-resource-view]').forEach((button) => {
            button.addEventListener('click', () => {
                const nextView = button.dataset.resourceView || 'all';
                this.resourceLibraryView = nextView;
                this.resourceLibrarySearchQuery = '';
                this.renderDashboard();
                window.requestAnimationFrame(() => {
                    this.dashboardRoot
                        ?.querySelector(`[data-resource-view="${nextView}"]`)
                        ?.focus({ preventScroll: true });
                });
            });
        });

        const connectButton = this.dashboardRoot.querySelector('#resource-connect-btn');
        connectButton?.addEventListener('click', () => void this.connectResourceProvider());
        this.dashboardRoot.querySelector('#resource-drive-picker-btn')?.addEventListener('click', () => void this.chooseGoogleDriveResource());
        this.dashboardRoot.querySelector('#resource-refresh-btn')?.addEventListener('click', () => {
            void this.refreshResourceLibrary().finally(() => {
                window.requestAnimationFrame(() => {
                    this.dashboardRoot?.querySelector('#resource-refresh-btn')?.focus({ preventScroll: true });
                });
            });
        });

        this.dashboardRoot.querySelectorAll('[data-resource-breadcrumb]').forEach((button) => {
            button.addEventListener('click', async () => {
                const index = Number(button.dataset.resourceBreadcrumb);
                this.resourceLibraryPath = Number.isInteger(index) && index >= 0
                    ? this.resourceLibraryPath.slice(0, index + 1)
                    : [];
                this.resourceLibrarySearchQuery = '';
                await this.refreshResourceLibrary();
                window.requestAnimationFrame(() => {
                    const breadcrumbs = this.dashboardRoot?.querySelectorAll('.resource-breadcrumb') || [];
                    const focusIndex = Number.isInteger(index) && index >= 0 ? index + 1 : 0;
                    breadcrumbs[focusIndex]?.focus({ preventScroll: true });
                });
            });
        });

        const searchInput = this.dashboardRoot.querySelector('#resource-search-input');
        searchInput?.addEventListener('input', (event) => {
            const input = event.currentTarget;
            const start = input.selectionStart;
            const end = input.selectionEnd;
            this.resourceLibrarySearchQuery = input.value || '';
            this.renderDashboard();
            const replacement = this.dashboardRoot.querySelector('#resource-search-input');
            replacement?.focus({ preventScroll: true });
            if (replacement && Number.isInteger(start) && Number.isInteger(end)) {
                replacement.setSelectionRange(start, end);
            }
        });

        this.dashboardRoot.querySelector('#resource-folder-fallback-input')?.addEventListener('change', (event) => {
            this.handleFallbackResourceFiles(event.currentTarget.files);
        });

        this.dashboardRoot.querySelectorAll('[data-resource-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const card = button.closest('[data-resource-key]');
                const resource = this.findResourceByKey(card?.dataset.resourceKey || '');
                void this.handleResourceAction(button.dataset.resourceAction, resource);
            });
        });
    }

    renderDashboard() {
        if (!this.dashboardRoot) {
            return;
        }

        const activeElement = document.activeElement;
        const shouldRestoreResourceSearch = activeElement?.id === 'resource-search-input';
        const resourceSearchSelectionStart = shouldRestoreResourceSearch ? activeElement.selectionStart : null;
        const resourceSearchSelectionEnd = shouldRestoreResourceSearch ? activeElement.selectionEnd : null;

        const projectState = this.normalizeProjectState(this.projectState);
        const currentDeckId = projectState.currentDeckId || '';
        const projectName = projectState.projectName || DEFAULT_PROJECT_NAME;
        const pages = Array.isArray(projectState.pages) ? projectState.pages : [];
        const activePage = this.getActiveProjectPage(projectState);
        const activePageIndex = this.getActiveProjectPageIndex(projectState);
        const pageSummary = pages.length > 0
            ? `Page ${activePageIndex >= 0 ? activePageIndex + 1 : 1} of ${pages.length}`
            : 'Page 1 of 1';
        const activePageName = String(activePage?.name || '').trim();
        const defaultPageName = `Page ${activePageIndex >= 0 ? activePageIndex + 1 : 1}`;
        const dashboardSubtitle = activePageName && activePageName.toLowerCase() !== defaultPageName.toLowerCase()
            ? `${activePageName} • ${pageSummary}`
            : pageSummary;
        const navigationModes = new Set(['library', 'resources', 'favorites', 'recent']);
        const requestedNavigationMode = this.dashboardNavigationMode === 'dashboard'
            ? 'library'
            : this.dashboardNavigationMode;
        const navigationMode = navigationModes.has(requestedNavigationMode)
            ? requestedNavigationMode
            : 'library';
        this.dashboardNavigationMode = navigationMode;
        const isResourceLibrary = navigationMode === 'resources';

        const selectedClassName = String(this.dashboardSelectedClassName || '').trim();
        const searchQuery = String(this.dashboardSearchQuery || '').trim().toLowerCase();
        const classProfiles = this.getPresetClassNames();
        const sortedPresets = this.presets
            .map((preset) => this.normalizePresetRecord(preset))
            .filter(Boolean)
            .sort((a, b) => {
                if (a.id === currentDeckId && b.id !== currentDeckId) return -1;
                if (b.id === currentDeckId && a.id !== currentDeckId) return 1;
                const aStamp = Number.isFinite(a.lastUsedAt) ? a.lastUsedAt : Number.isFinite(a.updatedAt) ? a.updatedAt : a.createdAt || 0;
                const bStamp = Number.isFinite(b.lastUsedAt) ? b.lastUsedAt : Number.isFinite(b.updatedAt) ? b.updatedAt : b.createdAt || 0;
                return bStamp - aStamp;
            });

        let navigationPresets = sortedPresets;
        if (navigationMode === 'library' && selectedClassName) {
            const targetClass = selectedClassName.toLowerCase();
            navigationPresets = sortedPresets.filter((preset) => String(preset.className || '').trim().toLowerCase() === targetClass);
        } else if (navigationMode === 'favorites') {
            navigationPresets = sortedPresets.filter((preset) => preset.isFavorite);
        } else if (navigationMode === 'recent') {
            navigationPresets = sortedPresets.filter((preset) => Number(preset.usageCount || 0) > 0);
        }

        const visiblePresets = navigationPresets.filter((preset) => {
            const presetClass = String(preset.className || '').trim();
            const searchText = `${preset.name || ''} ${presetClass} ${preset.period || ''}`.toLowerCase();
            return !searchQuery || searchText.includes(searchQuery);
        });

        const shownPresets = visiblePresets;
        const currentLabel = navigationMode === 'library'
            ? (selectedClassName || 'All lesson decks')
            : navigationMode === 'favorites'
                    ? 'Pinned lesson decks'
                    : navigationMode === 'recent'
                        ? 'Recently opened'
                        : 'All lesson decks';

        if (this.dashboardExpandedDeckId === null) {
            this.dashboardExpandedDeckId = shownPresets.find((preset) => preset.id === currentDeckId)?.id || '';
        }
        const expandedDeckId = shownPresets.some((preset) => preset.id === this.dashboardExpandedDeckId)
            ? this.dashboardExpandedDeckId
            : '';

        const navigationItems = [
            { mode: 'library', label: 'Deck Library', icon: 'fa-book-open' },
            { mode: 'resources', label: 'Resources', icon: 'fa-folder-open' },
            { mode: 'favorites', label: 'Favourites', icon: 'fa-star' },
            { mode: 'recent', label: 'Recent', icon: 'fa-clock-rotate-left' }
        ];
        const classItems = classProfiles.map((item) => ({ label: item.name, count: item.count, className: item.name }));
        this.dashboardRoot.innerHTML = `
            <div class="dashboard-layout">
                <aside class="dashboard-sidebar">
                    <div class="dashboard-brand">
                        <div class="dashboard-brand__mark" aria-hidden="true">T</div>
                        <h2>Teacher Screen</h2>
                    </div>
                    <nav class="dashboard-primary-nav" aria-label="Teacher navigation">
                        <div class="dashboard-primary-nav__list">
                            ${navigationItems.map((item) => `
                                <button class="dashboard-nav-item${navigationMode === item.mode ? ' is-active' : ''}" type="button" data-dashboard-mode="${item.mode}"${navigationMode === item.mode ? ' aria-current="page"' : ''}>
                                    <span class="dashboard-nav-item__icon" aria-hidden="true"><i class="fa-solid ${item.icon}"></i></span>
                                    <span>${item.label}</span>
                                </button>
                            `).join('')}
                        </div>
                        <details id="dashboard-utility-menu" class="dashboard-utility-menu">
                            <summary class="dashboard-nav-item dashboard-utility-menu__trigger" aria-label="More teacher options" title="More teacher options">
                                <span class="dashboard-nav-item__icon" aria-hidden="true"><i class="fa-solid fa-ellipsis"></i></span>
                                <span>More</span>
                            </summary>
                            <div class="dashboard-utility-menu__popover" role="menu" aria-label="Teacher options">
                                <button id="dashboard-sections-btn" type="button" role="menuitem">
                                    <i class="fa-solid fa-compass" aria-hidden="true"></i>
                                    <span>Sections</span>
                                </button>
                                <button id="dashboard-settings-btn" type="button" role="menuitem">
                                    <i class="fa-solid fa-sliders" aria-hidden="true"></i>
                                    <span>Settings</span>
                                </button>
                                <button id="dashboard-updates-btn" type="button" role="menuitem">
                                    <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                                    <span>Updates</span>
                                </button>
                                <button id="dashboard-help-btn" type="button" role="menuitem">
                                    <i class="fa-solid fa-circle-question" aria-hidden="true"></i>
                                    <span>Help</span>
                                </button>
                            </div>
                        </details>
                    </nav>
                    <div class="dashboard-sidebar__section">
                        <div class="dashboard-sidebar__section-header">
                            <h3>${isResourceLibrary ? 'Resource Views' : 'Your Classes'}</h3>
                        </div>
                        ${isResourceLibrary
                            ? `<div class="dashboard-class-list" id="dashboard-resource-view-list" aria-label="Filter teaching resources">
                                ${[
                                    { view: 'all', label: 'All Resources', icon: 'fa-folder-open' },
                                    { view: 'favorites', label: 'Favourites', icon: 'fa-star' },
                                    { view: 'recent', label: 'Recent', icon: 'fa-clock-rotate-left' }
                                ].map((item) => `
                                    <button class="dashboard-filter${this.resourceLibraryView === item.view ? ' is-active' : ''}" type="button" data-resource-view="${item.view}" aria-pressed="${this.resourceLibraryView === item.view ? 'true' : 'false'}">
                                        <span class="dashboard-filter__label"><i class="fa-solid ${item.icon}" aria-hidden="true"></i> ${item.label}</span>
                                    </button>
                                `).join('')}
                            </div>`
                            : '<div class="dashboard-class-list" id="dashboard-class-list" aria-label="Filter decks by class"></div>'}
                    </div>
                </aside>
                <main class="dashboard-main">
                    ${isResourceLibrary ? this.renderResourceLibraryMarkup() : `<section class="dashboard-library-panel" aria-label="Deck library">
                        <div class="dashboard-toolbar">
                            <div class="dashboard-toolbar__heading">
                                <p class="dashboard-toolbar__label">Deck Library</p>
                                <h1>${escapeHtml(currentLabel)}</h1>
                                <p>Choose a deck to reveal its classroom, arranging, presenting, and management options.</p>
                            </div>
                            <div class="dashboard-toolbar__side">
                                <button id="dashboard-create-btn" class="dashboard-new-deck-btn" type="button">
                                    <i class="fa-solid fa-plus" aria-hidden="true"></i>
                                    <span>New Deck</span>
                                </button>
                                <div class="dashboard-toolbar__meta" aria-label="Deck library summary">
                                    <span class="dashboard-chip">${shownPresets.length} ${shownPresets.length === 1 ? 'deck' : 'decks'}</span>
                                    <span class="dashboard-chip">${classProfiles.length} ${classProfiles.length === 1 ? 'class' : 'classes'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="dashboard-search-row">
                            <input id="dashboard-search-input" class="dashboard-search" type="search" aria-label="Search saved decks" placeholder="Search decks or classes" value="${escapeHtml(this.dashboardSearchQuery)}">
                        </div>
                        <div id="dashboard-screen-grid" class="dashboard-screen-grid"></div>
                    </section>`}
                </main>
            </div>
        `;

        const classList = this.dashboardRoot.querySelector('#dashboard-class-list');
        if (classList) {
            if (classItems.length === 0) {
                classList.innerHTML = '<p class="dashboard-class-list__empty">Classes appear when a saved deck has a class name.</p>';
            }

            classItems.forEach((item) => {
                const button = document.createElement('button');
                button.type = 'button';
                const isSelectedClass = navigationMode === 'library' && item.className === selectedClassName;
                const deckCountLabel = `${item.count} ${item.count === 1 ? 'deck' : 'decks'}`;
                button.className = `dashboard-filter${isSelectedClass ? ' is-active' : ''}`;
                button.dataset.className = item.className;
                button.setAttribute('aria-label', `${item.label}, ${deckCountLabel}`);
                button.setAttribute('aria-pressed', isSelectedClass ? 'true' : 'false');
                button.title = `Show ${deckCountLabel} for ${item.label}`;
                button.innerHTML = `<span class="dashboard-filter__label">${escapeHtml(item.label)}</span><span class="dashboard-folder__count" aria-hidden="true">${item.count}</span>`;
                button.addEventListener('click', () => {
                    this.dashboardNavigationMode = 'library';
                    this.dashboardSelectedClassName = item.className;
                    this.dashboardSelectedFolderId = '';
                    this.dashboardSearchQuery = '';
                    this.dashboardExpandedDeckId = null;
                    this.renderDashboard();
                    window.requestAnimationFrame(() => {
                        Array.from(this.dashboardRoot?.querySelectorAll('.dashboard-filter[data-class-name]') || [])
                            .find((filter) => filter.dataset.className === item.className)
                            ?.focus({ preventScroll: true });
                    });
                });
                classList.appendChild(button);
            });
        }

        const screenGrid = this.dashboardRoot.querySelector('#dashboard-screen-grid');
        if (screenGrid) {
            if (shownPresets.length === 0) {
                const emptyMessage = navigationMode === 'favorites'
                    ? 'No favourites yet. Use the star on a lesson deck to pin it here.'
                    : navigationMode === 'recent'
                        ? 'No recently opened decks yet. Open a lesson deck and it will appear here.'
                        : selectedClassName
                            ? `No saved decks found for ${selectedClassName}.`
                            : 'No saved decks match this view.';
                screenGrid.innerHTML = `<div class="dashboard-empty">${escapeHtml(emptyMessage)}</div>`;
            } else {
                shownPresets.forEach((preset, index) => {
                    const isCurrentPreset = preset.id === currentDeckId;
                    const isExpanded = preset.id === expandedDeckId;
                    const card = document.createElement('article');
                    const panelId = `dashboard-deck-details-${index}`;
                    const toggleId = `dashboard-deck-toggle-${index}`;
                    const pageCount = Array.isArray(preset.projectState?.pages) && preset.projectState.pages.length
                        ? preset.projectState.pages.length
                        : 1;
                    const savedLabel = this.formatDashboardDate(preset.updatedAt || preset.createdAt);
                    const classLabel = preset.className || 'No class';
                    card.className = `dashboard-screen-card${isCurrentPreset ? ' is-current' : ''}${isExpanded ? ' is-expanded' : ''}`;
                    card.dataset.deckId = preset.id;
                    card.setAttribute('aria-label', `${preset.name || 'Untitled Deck'}${isCurrentPreset ? ', current deck' : ''}`);
                    card.innerHTML = `
                        <div class="dashboard-deck-row">
                            <h2 class="dashboard-deck-heading">
                                <button id="${toggleId}" class="dashboard-deck-toggle" type="button" data-deck-action="toggle" data-deck-id="${escapeHtml(preset.id)}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="${panelId}">
                                <span class="dashboard-deck-toggle__icon" aria-hidden="true"><i class="fa-solid fa-layer-group"></i></span>
                                <span class="dashboard-deck-toggle__copy">
                                    <span class="dashboard-screen-card__heading">
                                        <span class="dashboard-deck-title">${escapeHtml(preset.name || 'Untitled Deck')}</span>
                                        ${isCurrentPreset ? '<span class="dashboard-current-badge">Current</span>' : ''}
                                    </span>
                                    <span class="dashboard-deck-subtitle">${escapeHtml(classLabel)}${preset.period ? ` &middot; ${escapeHtml(preset.period)}` : ''}</span>
                                </span>
                                <span class="dashboard-deck-summary">${pageCount} ${pageCount === 1 ? 'page' : 'pages'}<small>Saved ${escapeHtml(savedLabel)}</small></span>
                                <span class="dashboard-deck-chevron" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>
                                </button>
                            </h2>
                            <button class="dashboard-favorite-btn${preset.isFavorite ? ' is-active' : ''}" type="button" data-deck-action="favorite" data-deck-id="${escapeHtml(preset.id)}" aria-label="${preset.isFavorite ? 'Remove' : 'Add'} ${escapeHtml(preset.name || 'Untitled Deck')} ${preset.isFavorite ? 'from' : 'to'} Favourites" aria-pressed="${preset.isFavorite ? 'true' : 'false'}" title="${preset.isFavorite ? 'Remove from Favourites' : 'Add to Favourites'}">
                                <i class="${preset.isFavorite ? 'fa-solid' : 'fa-regular'} fa-star" aria-hidden="true"></i>
                            </button>
                        </div>
                        <div id="${panelId}" class="dashboard-screen-card__details" role="region" aria-labelledby="${toggleId}"${isExpanded ? '' : ' hidden'}>
                            <div class="dashboard-deck-details__context">
                                <span><i class="fa-regular fa-file-lines" aria-hidden="true"></i> ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}</span>
                                <span><i class="fa-regular fa-clock" aria-hidden="true"></i> Saved ${escapeHtml(savedLabel)}</span>
                            </div>
                            <div class="dashboard-screen-card__actions" role="group" aria-label="Actions for ${escapeHtml(preset.name || 'Untitled Deck')}">
                                <button ${isCurrentPreset ? 'id="dashboard-open-classroom-btn"' : ''} class="control-button control-button--primary" type="button" data-deck-action="open" data-deck-id="${escapeHtml(preset.id)}">
                                    <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                                    <span>${isCurrentPreset ? 'Continue Classroom' : 'Open Classroom'}</span>
                                </button>
                                <button ${isCurrentPreset ? 'id="dashboard-teacher-controls-btn"' : ''} class="control-button" type="button" data-deck-action="arrange" data-deck-id="${escapeHtml(preset.id)}">
                                    <i class="fa-solid fa-sliders" aria-hidden="true"></i>
                                    <span>Arrange</span>
                                </button>
                                <button ${isCurrentPreset ? 'id="dashboard-open-projector-btn"' : ''} class="control-button" type="button" data-deck-action="present" data-deck-id="${escapeHtml(preset.id)}">
                                    <i class="fa-solid fa-display" aria-hidden="true"></i>
                                    <span>Present</span>
                                </button>
                                <details class="dashboard-deck-more">
                                    <summary>More</summary>
                                    <div class="dashboard-deck-more__actions">
                                        <button class="control-button" type="button" data-deck-action="rename" data-deck-id="${escapeHtml(preset.id)}">Rename</button>
                                        <button class="control-button" type="button" data-deck-action="duplicate" data-deck-id="${escapeHtml(preset.id)}">Duplicate</button>
                                        <button class="control-button dashboard-deck-delete" type="button" data-deck-action="delete" data-deck-id="${escapeHtml(preset.id)}">Delete</button>
                                    </div>
                                </details>
                            </div>
                        </div>
                    `;
                    screenGrid.appendChild(card);
                });
            }
        }

        this.dashboardRoot.querySelectorAll('[data-deck-action]').forEach((control) => {
            control.addEventListener('click', () => {
                const deckId = control.dataset.deckId || '';
                const action = control.dataset.deckAction || '';
                if (!deckId) {
                    return;
                }

                if (action === 'toggle') {
                    const shouldExpand = control.getAttribute('aria-expanded') !== 'true';
                    this.dashboardExpandedDeckId = shouldExpand ? deckId : '';
                    this.dashboardRoot.querySelectorAll('.dashboard-screen-card[data-deck-id]').forEach((card) => {
                        const isExpanded = shouldExpand && card.dataset.deckId === deckId;
                        card.classList.toggle('is-expanded', isExpanded);
                        const toggle = card.querySelector('.dashboard-deck-toggle');
                        const panel = card.querySelector('.dashboard-screen-card__details');
                        toggle?.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                        if (panel) {
                            panel.hidden = !isExpanded;
                        }
                        card.querySelectorAll('.dashboard-deck-more[open]').forEach((details) => {
                            details.open = false;
                        });
                    });
                }
                if (action === 'favorite') this.togglePresetFavorite(deckId);
                if (action === 'open') this.loadPresetFromDashboard(deckId);
                if (action === 'arrange') this.arrangePresetFromDashboard(deckId);
                if (action === 'present') this.presentPresetFromDashboard(deckId);
                if (action === 'rename') this.renamePreset(deckId);
                if (action === 'duplicate') this.clonePreset(deckId);
                if (action === 'delete') this.deletePreset(deckId);
            });
        });

        this.dashboardRoot.querySelectorAll('.dashboard-deck-more').forEach((details) => {
            details.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || !details.open) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                details.open = false;
                details.querySelector('summary')?.focus();
            });
        });

        this.dashboardRoot.querySelectorAll('[data-dashboard-mode]').forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.dashboardMode || 'library';
                this.dashboardNavigationMode = navigationModes.has(mode) ? mode : 'library';
                this.dashboardSelectedClassName = '';
                this.dashboardSelectedFolderId = '';
                this.dashboardSearchQuery = '';
                this.dashboardExpandedDeckId = null;
                this.renderDashboard();
                const focusNavigationButton = () => {
                    this.dashboardRoot?.querySelector(`[data-dashboard-mode="${mode}"]`)?.focus({ preventScroll: true });
                };
                if (this.dashboardNavigationMode === 'resources') {
                    void this.refreshResourceLibrary({ restore: true }).finally(() => window.requestAnimationFrame(focusNavigationButton));
                } else {
                    window.requestAnimationFrame(focusNavigationButton);
                }
            });
        });

        const sectionsButton = this.dashboardRoot.querySelector('#dashboard-sections-btn');
        if (sectionsButton) {
            sectionsButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const teacherOptions = this.dashboardRoot.querySelector('#dashboard-utility-menu');
                if (teacherOptions) {
                    teacherOptions.open = false;
                }
                this.toggleSectionsMenu(true);
            });
        }

        const utilityMenu = this.dashboardRoot.querySelector('#dashboard-utility-menu');
        const closeUtilityMenu = () => {
            if (utilityMenu) {
                utilityMenu.open = false;
            }
        };

        const settingsButton = this.dashboardRoot.querySelector('#dashboard-settings-btn');
        if (settingsButton) {
            settingsButton.addEventListener('click', () => {
                closeUtilityMenu();
                this.openTeacherControls();
            });
        }

        const updatesButton = this.dashboardRoot.querySelector('#dashboard-updates-btn');
        if (updatesButton) {
            updatesButton.addEventListener('click', () => {
                closeUtilityMenu();
                this.showNotification('Teacher Screen updates are applied automatically when the page refreshes.', 'info');
            });
        }

        const helpButton = this.dashboardRoot.querySelector('#dashboard-help-btn');
        if (helpButton) {
            helpButton.addEventListener('click', () => {
                closeUtilityMenu();
                this.openDialog(this.helpDialog);
            });
        }

        if (utilityMenu) {
            utilityMenu.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') {
                    return;
                }

                closeUtilityMenu();
                utilityMenu.querySelector('summary')?.focus();
            });
        }

        const createButton = this.dashboardRoot.querySelector('#dashboard-create-btn');
        if (createButton) {
            createButton.addEventListener('click', () => {
                if (this.createNewProject()) {
                    this.handleNavClick('classroom');
                }
            });
        }

        const searchInput = this.dashboardRoot.querySelector('#dashboard-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                const activeSearchInput = event.currentTarget;
                const shouldRestoreFocus = document.activeElement === activeSearchInput;
                const selectionStart = activeSearchInput.selectionStart;
                const selectionEnd = activeSearchInput.selectionEnd;
                this.dashboardSearchQuery = activeSearchInput.value || '';
                this.renderDashboard();

                if (shouldRestoreFocus) {
                    const replacementSearchInput = this.dashboardRoot.querySelector('#dashboard-search-input');
                    replacementSearchInput?.focus({ preventScroll: true });
                    if (replacementSearchInput
                        && Number.isInteger(selectionStart)
                        && Number.isInteger(selectionEnd)) {
                        replacementSearchInput.setSelectionRange(selectionStart, selectionEnd);
                    }
                }
            });
        }

        if (isResourceLibrary) {
            this.bindResourceLibraryEvents();
        }

        if (shouldRestoreResourceSearch) {
            const replacementSearchInput = this.dashboardRoot.querySelector('#resource-search-input');
            replacementSearchInput?.focus({ preventScroll: true });
            if (replacementSearchInput
                && Number.isInteger(resourceSearchSelectionStart)
                && Number.isInteger(resourceSearchSelectionEnd)) {
                replacementSearchInput.setSelectionRange(resourceSearchSelectionStart, resourceSearchSelectionEnd);
            }
        }
    }

    async handleCustomBackgroundUpload(file) {
        if (!file || !file.type.startsWith('image/')) {
            this.showNotification('Choose an image file for the classroom background.', 'warning');
            return false;
        }

        const maxBytes = 2 * 1024 * 1024;
        if (file.size > maxBytes) {
            this.showNotification('Please choose an image under 2 MB.', 'warning');
            return false;
        }

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = typeof reader.result === 'string' ? reader.result : '';
                if (!result) {
                    this.showNotification('That image could not be loaded.', 'error');
                    resolve(false);
                    return;
                }

                this.backgroundManager.setCustomImage(result);
                this.renderBackgroundSelector();
                this.saveState();
                this.showNotification('Custom background added.', 'success');
                resolve(true);
            };
            reader.onerror = () => {
                this.showNotification('That image could not be loaded.', 'error');
                resolve(false);
            };
            reader.readAsDataURL(file);
        });
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

    openDashboardHome() {
        this.closeSectionsMenu();
        this.handleNavClick('dashboard');
    }

    openTeacherControls() {
        this.closeDialog(this.widgetModal);
        this.closeSectionsMenu();
        this.handleNavClick('classroom', { openTeacherPanel: true });
    }

    openCurrentPageActions() {
        this.openTeacherControls();

        window.requestAnimationFrame(() => {
            const pageActions = this.teacherPanel?.querySelector('.project-page-advanced');
            if (pageActions) {
                pageActions.open = true;
            }

            if (this.deletePageButton) {
                this.deletePageButton.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    createFolderFromDashboard() {
        const nextName = window.prompt('Name the new folder', '');
        if (typeof nextName !== 'string') {
            return;
        }

        this.createFolder(nextName);
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
        [this.helpDialog, this.widgetModal].forEach((dialog) => {
            if (dialog && dialog.open) {
                dialog.close();
            }
        });
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
            QRCode: 'QR Code',
            RevealManager: 'Presentation',
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

        // Keep the shared destructive action available in every widget settings panel.
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

        commonControls.appendChild(removeBtn);

        modalBody.appendChild(commonControls);

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
                info.element.style.removeProperty('display');
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
