export const WidgetRegistry = {
    timer: {
        key: 'timer',
        className: 'TimerWidget',
        label: 'Timer',
        icon: '⏱️',
        category: 'Primary',
        create: () => new TimerWidget()
    },
    'noise-meter': {
        key: 'noise-meter',
        className: 'NoiseMeterWidget',
        label: 'Noise Meter',
        icon: '🔊',
        category: 'Primary',
        create: () => new NoiseMeterWidget()
    },
    'name-picker': {
        key: 'name-picker',
        className: 'NamePickerWidget',
        label: 'Random Name Picker',
        icon: '🎲',
        category: 'Primary',
        create: () => new NamePickerWidget()
    },
    'qr-code': {
        key: 'qr-code',
        className: 'QRCodeWidget',
        label: 'QR Code',
        icon: '🔳',
        category: 'Secondary',
        create: () => new QRCodeWidget()
    },
    'drawing-tool': {
        key: 'drawing-tool',
        className: 'DrawingToolWidget',
        label: 'Drawing Tool',
        icon: '✏️',
        category: 'Secondary',
        create: () => new DrawingToolWidget()
    },
    'document-viewer': {
        key: 'document-viewer',
        className: 'DocumentViewerWidget',
        label: 'Document Viewer',
        icon: '📄',
        category: 'Secondary',
        create: () => new DocumentViewerWidget()
    },
    'url-viewer': {
        key: 'url-viewer',
        className: 'UrlViewerWidget',
        label: 'URL Viewer',
        icon: '🔗',
        category: 'Secondary',
        create: () => new UrlViewerWidget()
    },
    'reveal-manager': {
        key: 'reveal-manager',
        className: 'RevealManagerWidget',
        label: 'Reveal Manager',
        icon: '🖥️',
        category: 'Secondary',
        create: () => new RevealManagerWidget()
    },
    presentation: {
        key: 'presentation',
        className: 'PresentationWidget',
        label: 'Presentation Loader',
        icon: '📽️',
        category: 'Secondary',
        create: () => new PresentationWidget()
    },
    mask: {
        key: 'mask',
        className: 'MaskWidget',
        label: 'Mask',
        icon: '🎭',
        category: 'Secondary',
        create: () => new MaskWidget()
    },
    notes: {
        key: 'notes',
        className: 'NotesWidget',
        label: 'Quick Notes',
        icon: '📝',
        category: 'Secondary',
        create: () => new NotesWidget()
    },
    wellbeing: {
        key: 'wellbeing',
        className: 'WellbeingWidget',
        label: 'Well-being Check-in',
        icon: '💚',
        category: 'Secondary',
        create: () => new WellbeingWidget()
    },
    'rich-text': {
        key: 'rich-text',
        className: 'RichTextWidget',
        label: 'Rich Text Board',
        icon: '✒️',
        category: 'Secondary',
        create: () => new RichTextWidget()
    }
};

const widgetTypeAliases = {
    TimerWidget: 'timer',
    NoiseMeterWidget: 'noise-meter',
    NamePickerWidget: 'name-picker',
    QRCodeWidget: 'qr-code',
    DrawingToolWidget: 'drawing-tool',
    DocumentViewerWidget: 'document-viewer',
    UrlViewerWidget: 'url-viewer',
    RevealManagerWidget: 'reveal-manager',
    PresentationWidget: 'presentation',
    MaskWidget: 'mask',
    NotesWidget: 'notes',
    WellbeingWidget: 'wellbeing',
    RichTextWidget: 'rich-text',
    timer: 'timer',
    'noise-meter': 'noise-meter',
    'name-picker': 'name-picker',
    'qr-code': 'qr-code',
    'drawing-tool': 'drawing-tool',
    'document-viewer': 'document-viewer',
    'url-viewer': 'url-viewer',
    'reveal-manager': 'reveal-manager',
    presentation: 'presentation',
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
        category: definition.category
    };
}

export function listAvailableWidgets() {
    return Object.values(WidgetRegistry);
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
