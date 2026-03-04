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

const bootstrapTeacherDependencies = async () => {
    await loadClassicScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
    await loadClassicScript('https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js');
    await loadClassicScript('https://cdn.quilljs.com/1.3.6/quill.min.js');
    await loadClassicScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js');
    await loadClassicScript('./utils/layout-manager.js');
    await loadClassicScript('./utils/background-manager.js');
    await loadClassicScript('./utils/reveal-sync.js');
    await loadClassicScript('../assets/sounds/sound-data.js');
    await loadClassicScript('./widgets/timer.js');
    await loadClassicScript('./widgets/noise-meter.js');
    await loadClassicScript('./widgets/noise-meter-widget.js');
    await loadClassicScript('./widgets/name-picker.js');
    await loadClassicScript('./widgets/qr-code-widget.js');
    await loadClassicScript('./widgets/drawing-tool.js');
    await loadClassicScript('./widgets/document-viewer.js');
    await loadClassicScript('./widgets/url-viewer.js');
    await loadClassicScript('./widgets/reveal-manager-widget.js');
    await loadClassicScript('./widgets/mask-widget.js');
    await loadClassicScript('./widgets/notes-widget.js');
    await loadClassicScript('./widgets/wellbeing-widget.js');
    await loadClassicScript('./widgets/rich-text-widget.js');
};

const init = async () => {
    await bootstrapTeacherDependencies();
    await import('./script.js');
    await import('./main.js');
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
