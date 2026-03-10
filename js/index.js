import './utils/app-mode.js';
import './utils/app-bus.js';

const loadClassicScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
});

const loadOptionalClassicScript = async (src, label = src) => {
    try {
        await loadClassicScript(src);
    } catch (error) {
        console.warn(`[bootstrap] Optional script failed: ${label} (${src})`);
        console.warn(error);
    }
};

const bootstrapTeacherDependencies = async () => {
    await loadClassicScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
    await loadClassicScript('https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js');
    await loadClassicScript('https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.min.js');
    await loadClassicScript('https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.js');
    await loadClassicScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js');
    await loadClassicScript('./js/utils/layout-manager.js');
    await loadClassicScript('./js/utils/background-manager.js');
    await loadOptionalClassicScript('./assets/sounds/sound-data.js', 'sound-data');
    await loadOptionalClassicScript('./js/widgets/timer.js', 'timer');
    await loadOptionalClassicScript('./js/widgets/noise-meter.js', 'noise-meter');
    await loadOptionalClassicScript('./js/widgets/noise-meter-widget.js', 'noise-meter-widget');
    await loadOptionalClassicScript('./js/widgets/name-picker.js', 'name-picker');
    await loadOptionalClassicScript('./js/widgets/qr-code-widget.js', 'qr-code-widget');
    await loadOptionalClassicScript('./js/widgets/drawing-tool.js', 'drawing-tool');
    await loadOptionalClassicScript('./js/widgets/document-viewer.js', 'document-viewer');
    await loadOptionalClassicScript('./js/widgets/url-viewer.js', 'url-viewer');
    await loadOptionalClassicScript('./js/widgets/reveal-manager-widget.js', 'reveal-manager-widget');
    await loadOptionalClassicScript('./js/widgets/presentation-widget.js', 'presentation-widget');
    await loadOptionalClassicScript('./js/widgets/mask-widget.js', 'mask-widget');
    await loadOptionalClassicScript('./js/widgets/notes-widget.js', 'notes-widget');
    await loadOptionalClassicScript('./js/widgets/wellbeing-widget.js', 'wellbeing-widget');
    await loadOptionalClassicScript('./js/widgets/rich-text-widget.js', 'rich-text-widget');
};

const init = async () => {
    console.log('[bootstrap] Starting app initialization');

    try {
        await bootstrapTeacherDependencies();
    } catch (error) {
        console.error(`[bootstrap] Required dependency failed: ${error?.message || 'Unknown error'}`);
        throw error;
    }

    try {
        await import('./script.js');
        await import('./main.js');
    } catch (error) {
        console.error('[bootstrap] Failed to load main application scripts:', error);
        throw error;
    }

    console.log('[bootstrap] App initialized successfully');
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
