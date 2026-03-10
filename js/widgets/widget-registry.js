const widgetFactories = {
    timer: () => new TimerWidget(),
    'noise-meter': () => new NoiseMeterWidget(),
    'name-picker': () => new NamePickerWidget(),
    'qr-code': () => new QRCodeWidget(),
    'drawing-tool': () => new DrawingToolWidget(),
    'document-viewer': () => new DocumentViewerWidget(),
    'url-viewer': () => new UrlViewerWidget(),
    'reveal-manager': () => new RevealManagerWidget(),
    presentation: () => new PresentationWidget(),
    mask: () => new MaskWidget(),
    notes: () => new NotesWidget(),
    wellbeing: () => new WellbeingWidget(),
    'rich-text': () => new RichTextWidget()
};

export const WidgetRegistry = {
    timer: { name: 'Timer', icon: '⏱️', create: widgetFactories.timer },
    'noise-meter': { name: 'Noise Meter', icon: '🔊', create: widgetFactories['noise-meter'] },
    'name-picker': { name: 'Random Name Picker', icon: '🎲', create: widgetFactories['name-picker'] },
    'qr-code': { name: 'QR Code', icon: '🔳', create: widgetFactories['qr-code'] },
    'drawing-tool': { name: 'Drawing Tool', icon: '✏️', create: widgetFactories['drawing-tool'] },
    'document-viewer': { name: 'Document Viewer', icon: '📄', create: widgetFactories['document-viewer'] },
    'url-viewer': { name: 'URL Viewer', icon: '🔗', create: widgetFactories['url-viewer'] },
    'reveal-manager': { name: 'Reveal Manager', icon: '🖥️', create: widgetFactories['reveal-manager'] },
    presentation: { name: 'Presentation Loader', icon: '📽️', create: widgetFactories.presentation },
    mask: { name: 'Mask', icon: '🎭', create: widgetFactories.mask },
    notes: { name: 'Notes', icon: '📝', create: widgetFactories.notes },
    wellbeing: { name: 'Well-being Check-in', icon: '💚', create: widgetFactories.wellbeing },
    'rich-text': { name: 'Rich Text Board', icon: '✒️', create: widgetFactories['rich-text'] }
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
    RichTextWidget: 'rich-text'
};

export function getRegistryWidgetKey(type) {
    return widgetTypeAliases[type] || type;
}

export function createWidgetByType(type) {
    const key = getRegistryWidgetKey(type);
    const config = WidgetRegistry[key];
    if (!config || typeof config.create !== 'function') {
        console.warn(`Unknown widget type: ${type}`);
        return null;
    }
    return config.create();
}

if (typeof window !== 'undefined') {
    window.WidgetRegistry = WidgetRegistry;
    window.createWidgetByType = createWidgetByType;
    window.getRegistryWidgetKey = getRegistryWidgetKey;
}
