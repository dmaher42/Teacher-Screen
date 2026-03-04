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
    await loadClassicScript('https://cdn.quilljs.com/1.3.6/quill.min.js');
    await loadClassicScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js');
    await loadClassicScript('./js/utils/layout-manager.js');
    await loadClassicScript('./js/utils/background-manager.js');
    await loadClassicScript('./js/utils/reveal-sync.js');
    await loadOptionalClassicScript('./assets/sounds/sound-data.js', 'sound-data');
    await loadClassicScript('./js/widgets/timer.js');
    await loadClassicScript('./js/widgets/noise-meter.js');
    await loadClassicScript('./js/widgets/noise-meter-widget.js');
    await loadClassicScript('./js/widgets/name-picker.js');
    await loadClassicScript('./js/widgets/qr-code-widget.js');
    await loadClassicScript('./js/widgets/drawing-tool.js');
    await loadClassicScript('./js/widgets/document-viewer.js');
    await loadClassicScript('./js/widgets/url-viewer.js');
    await loadClassicScript('./js/widgets/reveal-manager-widget.js');
    await loadClassicScript('./js/widgets/mask-widget.js');
    await loadClassicScript('./js/widgets/notes-widget.js');
    await loadClassicScript('./js/widgets/wellbeing-widget.js');
    await loadClassicScript('./js/widgets/rich-text-widget.js');
};

const init = async () => {
    try {
        await bootstrapTeacherDependencies();
    } catch (error) {
        console.error(`[bootstrap] Required dependency failed: ${error?.message || 'Unknown error'}`);
        throw error;
    }

    await import('./script.js');
    await import('./main.js');
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
