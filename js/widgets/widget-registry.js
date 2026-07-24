export const WidgetRegistry = {
    timer: {
        key: 'timer',
        className: 'PomodoroWidget',
        label: 'Pomodoro',
        icon: '⏱️',
        description: 'Keep activities on time',
        category: 'Primary',
        create: () => new PomodoroWidget()
    },
    'behaviour-tracker': {
        key: 'behaviour-tracker',
        className: 'BehaviourTrackerWidget',
        label: 'Learning-Time Tracker',
        icon: '✓',
        description: 'Track interruptions privately',
        category: 'Primary',
        create: () => new BehaviourTrackerWidget()
    },
    'noise-meter': {
        key: 'noise-meter',
        className: 'NoiseMeterWidget',
        label: 'Noise Meter',
        icon: '🔊',
        description: 'Show the room noise level',
        category: 'Primary',
        create: () => new NoiseMeterWidget()
    },
    'name-picker': {
        key: 'name-picker',
        className: 'NamePickerWidget',
        label: 'Random Name Picker',
        icon: '🎲',
        description: 'Choose students at random',
        category: 'Primary',
        create: () => new NamePickerWidget()
    },
    'qr-code': {
        key: 'qr-code',
        className: 'QRCodeWidget',
        label: 'QR Code',
        icon: '🔳',
        description: 'Share a link students can scan',
        category: 'Secondary',
        create: () => new QRCodeWidget()
    },
    'drawing-tool': {
        key: 'drawing-tool',
        className: 'DrawingToolWidget',
        label: 'Drawing Tool',
        icon: '✏️',
        description: 'Sketch and annotate live',
        category: 'Secondary',
        create: () => new DrawingToolWidget()
    },
    'quiz-game': {
        key: 'quiz-game',
        className: 'QuizGameWidget',
        label: 'Quiz Game',
        icon: 'Q',
        description: 'Run a quick class quiz',
        category: 'Secondary',
        create: () => new QuizGameWidget()
    },
    'document-viewer': {
        key: 'document-viewer',
        className: 'DocumentViewerWidget',
        label: 'Document Viewer',
        icon: '📄',
        description: 'Put a document on screen',
        category: 'Secondary',
        create: () => new DocumentViewerWidget()
    },
    'url-viewer': {
        key: 'url-viewer',
        className: 'UrlViewerWidget',
        label: 'URL Viewer',
        icon: '🔗',
        description: 'Embed a web page',
        category: 'Secondary',
        create: () => new UrlViewerWidget()
    },
    'reveal-manager': {
        key: 'reveal-manager',
        className: 'RevealManagerWidget',
        label: 'Slides',
        icon: '🖥️',
        description: 'Present a slide deck',
        category: 'Secondary',
        create: () => new RevealManagerWidget()
    },
    mask: {
        key: 'mask',
        className: 'MaskWidget',
        label: 'Mask',
        icon: '🎭',
        description: 'Reveal content step by step',
        category: 'Secondary',
        create: () => new MaskWidget()
    },
    notes: {
        key: 'notes',
        className: 'NotesWidget',
        label: 'Quick Notes',
        icon: '📝',
        description: 'Capture notes during a lesson',
        category: 'Secondary',
        create: () => new NotesWidget()
    },
    wellbeing: {
        key: 'wellbeing',
        className: 'WellbeingWidget',
        label: 'Well-being Check-in',
        icon: '💚',
        description: 'Check how the class is feeling',
        category: 'Secondary',
        create: () => new WellbeingWidget()
    },
    'rich-text': {
        key: 'rich-text',
        className: 'RichTextWidget',
        label: 'Rich Text Board',
        icon: '✒️',
        description: 'Display instructions and prompts',
        category: 'Secondary',
        create: () => new RichTextWidget()
    }
};

const widgetTypeAliases = {
    TimerWidget: 'timer',
    PomodoroWidget: 'timer',
    BehaviourTrackerWidget: 'behaviour-tracker',
    NoiseMeterWidget: 'noise-meter',
    NamePickerWidget: 'name-picker',
    QRCodeWidget: 'qr-code',
    DrawingToolWidget: 'drawing-tool',
    QuizGameWidget: 'quiz-game',
    DocumentViewerWidget: 'document-viewer',
    UrlViewerWidget: 'url-viewer',
    RevealManagerWidget: 'reveal-manager',
    MaskWidget: 'mask',
    NotesWidget: 'notes',
    WellbeingWidget: 'wellbeing',
    RichTextWidget: 'rich-text',
    timer: 'timer',
    'behaviour-tracker': 'behaviour-tracker',
    'noise-meter': 'noise-meter',
    'name-picker': 'name-picker',
    'qr-code': 'qr-code',
    'drawing-tool': 'drawing-tool',
    'quiz-game': 'quiz-game',
    'document-viewer': 'document-viewer',
    'url-viewer': 'url-viewer',
    'reveal-manager': 'reveal-manager',
    mask: 'mask',
    notes: 'notes',
    wellbeing: 'wellbeing',
    'rich-text': 'rich-text'
};

export function getRegistryWidgetKey(type) {
    return widgetTypeAliases[type] || null;
}

export function getWidgetDefinition(type) {
    const key = getRegistryWidgetKey(type);
    if (!key) {
        return null;
    }
    return WidgetRegistry[key] || null;
}

export function getWidgetMeta(type) {
    const definition = getWidgetDefinition(type);
    if (!definition) {
        return null;
    }

    return {
        key: definition.key,
        className: definition.className,
        label: definition.label,
        icon: definition.icon,
        description: definition.description,
        category: definition.category,
        hiddenFromPicker: definition.hiddenFromPicker === true
    };
}

export function listAvailableWidgets({ includeHidden = false } = {}) {
    return Object.values(WidgetRegistry)
        .filter((definition) => includeHidden || definition.hiddenFromPicker !== true);
}

export function createWidgetInstance(type) {
    const config = getWidgetDefinition(type);
    if (!config || typeof config.create !== 'function') {
        console.warn(`Unknown widget type: ${type}`);
        return null;
    }

    try {
        return config.create();
    } catch (error) {
        console.warn(`Unable to create widget type: ${type}`, error);
        return null;
    }
}

export const createWidgetByType = createWidgetInstance;

if (typeof window !== 'undefined') {
    window.WidgetRegistry = WidgetRegistry;
    window.createWidgetByType = createWidgetByType;
    window.getRegistryWidgetKey = getRegistryWidgetKey;
    window.getWidgetDefinition = getWidgetDefinition;
    window.getWidgetMeta = getWidgetMeta;
    window.listAvailableWidgets = listAvailableWidgets;
}
