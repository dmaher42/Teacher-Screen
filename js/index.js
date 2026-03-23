import './utils/app-mode.js';
import './utils/app-bus.js';
import './core/event-bus.js';

const loadClassicScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
});

const TEACHER_DEPENDENCIES = [
    { src: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.js', required: false },
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js', required: false },
    { src: './js/utils/layout-manager.js', required: true },
    { src: './js/utils/background-manager.js', required: true },
    { src: './assets/sounds/sound-data.js', required: false },
    { src: './js/widgets/timer.js', required: false },
    { src: './js/widgets/noise-meter.js', required: false },
    { src: './js/widgets/noise-meter-widget.js', required: false },
    { src: './js/widgets/name-picker.js', required: false },
    { src: './js/widgets/qr-code-widget.js', required: false },
    { src: './js/widgets/drawing-tool.js', required: false },
    { src: './js/widgets/document-viewer.js', required: false },
    { src: './js/widgets/url-viewer.js', required: false },
    { src: './js/widgets/reveal-manager-widget.js', required: false },
    { src: './js/widgets/presentation-widget.js', required: false },
    { src: './js/widgets/mask-widget.js', required: false },
    { src: './js/widgets/notes-widget.js', required: false },
    { src: './js/widgets/wellbeing-widget.js', required: false },
    { src: './js/widgets/rich-text-widget.js', required: false }
];

const bootstrapTeacherDependencies = async () => {
    const failures = [];

    for (const dependency of TEACHER_DEPENDENCIES) {
        try {
            await loadClassicScript(dependency.src);
        } catch (error) {
            failures.push({
                src: dependency.src,
                required: dependency.required,
                error: error.message
            });

            const logMethod = dependency.required ? 'error' : 'warn';
            console[logMethod](`[bootstrap] dependency load failed: ${dependency.src}`, error);

            if (dependency.required) {
                throw Object.assign(new Error(`Critical teacher dependency failed: ${dependency.src}`), {
                    cause: error,
                    failures
                });
            }
        }
    }

    window.__TeacherDependencyFailures = failures;
    return failures;
};

const init = async () => {
    console.log('[bootstrap] Starting app initialization');

    try {
        const failures = await bootstrapTeacherDependencies();
        if (failures.length > 0) {
            console.warn('[bootstrap] continuing with optional dependency failures', failures);
        }
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
