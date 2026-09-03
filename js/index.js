import './utils/app-mode.js';
import './utils/app-bus.js';
import './core/event-bus.js';
import './utils/widget-change-notifier.js';

const LOCAL_ASSET_VERSION = '60';
const EXTERNAL_OPTIONAL_DEPENDENCY_TIMEOUT_MS = 2500;
const LOCAL_DEPENDENCY_TIMEOUT_MS = 10000;

const configureLessonActionPlacement = () => {
    const reminderLauncher = document.getElementById('classroom-reminder-launcher');
    const teacherControlsQuickButton = document.getElementById('teacher-controls-quick-btn');
    const widgetPickerFooter = document.querySelector('#widget-modal .widget-picker-footer');
    const widgetPickerTeacherControlsButton = document.getElementById('widget-picker-teacher-controls-btn');

    // Keep the bottom bar focused on frequently used classroom actions.
    teacherControlsQuickButton?.remove();

    if (!reminderLauncher || !widgetPickerFooter) {
        return;
    }

    reminderLauncher.classList.remove('lesson-quick-action', 'lesson-quick-action--reminders');
    reminderLauncher.classList.add('control-button', 'control-button--compact');
    reminderLauncher.querySelector('.lesson-quick-action__icon')
        ?.classList.remove('lesson-quick-action__icon');
    reminderLauncher.querySelector('.lesson-quick-action__label')
        ?.classList.remove('lesson-quick-action__label');
    reminderLauncher.setAttribute('data-close', '');

    let footerActions = widgetPickerFooter.querySelector('.widget-picker-footer__actions');
    if (!footerActions) {
        footerActions = document.createElement('div');
        footerActions.className = 'widget-picker-footer__actions button-group';
        footerActions.setAttribute('role', 'group');
        footerActions.setAttribute('aria-label', 'Widget menu actions');
        widgetPickerFooter.appendChild(footerActions);
    }

    footerActions.appendChild(reminderLauncher);
    if (widgetPickerTeacherControlsButton) {
        footerActions.appendChild(widgetPickerTeacherControlsButton);
    }

    // The menu command should always open reminders rather than toggle an already-open dock closed.
    reminderLauncher.addEventListener('click', () => {
        reminderLauncher.setAttribute('aria-expanded', 'false');
    }, { capture: true });
};

const withLocalAssetVersion = (src) => {
    if (!src.startsWith('./')) {
        return src;
    }

    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}v=${LOCAL_ASSET_VERSION}`;
};

const isExternalDependency = (src) => /^https?:\/\//i.test(src);

const getDependencyTimeoutMs = (dependency) => {
    if (Number.isFinite(dependency.timeoutMs)) {
        return dependency.timeoutMs;
    }

    return !dependency.required && isExternalDependency(dependency.src)
        ? EXTERNAL_OPTIONAL_DEPENDENCY_TIMEOUT_MS
        : LOCAL_DEPENDENCY_TIMEOUT_MS;
};

const loadClassicScript = (src, timeoutMs = LOCAL_DEPENDENCY_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;

    const settle = (callback) => {
        if (settled) {
            return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        callback();
    };

    const timeoutId = window.setTimeout(() => {
        settle(() => {
            script.remove();
            reject(new Error(`Timed out loading script: ${src}`));
        });
    }, timeoutMs);

    script.src = withLocalAssetVersion(src);
    script.defer = true;
    script.onload = () => settle(resolve);
    script.onerror = () => settle(() => reject(new Error(`Failed to load script: ${src}`)));
    document.head.appendChild(script);
});

const loadDependency = async (dependency) => {
    try {
        await loadClassicScript(dependency.src, getDependencyTimeoutMs(dependency));
        return null;
    } catch (error) {
        const failure = {
            src: dependency.src,
            required: dependency.required,
            error: error.message
        };

        const logMethod = dependency.required ? 'error' : 'warn';
        console[logMethod](`[bootstrap] dependency load failed: ${dependency.src}`, error);

        if (dependency.required) {
            throw Object.assign(new Error(`Critical teacher dependency failed: ${dependency.src}`), {
                cause: error,
                failures: [failure]
            });
        }

        return failure;
    }
};

const TEACHER_DEPENDENCIES = [
    { src: './js/config/google-drive-config.js', required: false, timeoutMs: 1500 },
    { src: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.js', required: false },
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/mammoth@1.12.2/mammoth.browser.min.js', required: false },
    { src: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', required: false },
    { src: './js/utils/local-document-store.js', required: true },
    { src: './js/utils/layout-manager.js', required: true },
    { src: './js/utils/widget-minimize-dock.js', required: true },
    { src: './js/utils/background-manager.js', required: true },
    { src: './js/widgets/noise-meter.js', required: false },
    { src: './js/widgets/noise-meter-widget.js', required: false },
    { src: './js/widgets/behaviour-tracker-widget.js', required: true },
    { src: './js/widgets/name-picker.js', required: false },
    { src: './js/widgets/qr-code-widget.js', required: false },
    { src: './js/widgets/drawing-tool.js', required: false },
    { src: './js/widgets/document-viewer.js', required: false },
    { src: './js/widgets/url-viewer.js', required: false },
    { src: './js/widgets/reveal-manager-widget.js', required: false },
    { src: './js/widgets/quiz-game-widget.js', required: false },
    { src: './js/widgets/mask-widget.js', required: false },
    { src: './js/widgets/notes-widget.js', required: false },
    { src: './js/widgets/wellbeing-widget.js', required: false },
    { src: './js/widgets/rich-text-widget.js', required: false }
];

const bootstrapTeacherDependencies = async () => {
    const richTextDependency = TEACHER_DEPENDENCIES.find((dependency) => dependency.src === './js/widgets/rich-text-widget.js');
    const quillDependency = TEACHER_DEPENDENCIES.find((dependency) => dependency.src.includes('/quill@'));
    const parallelDependencies = TEACHER_DEPENDENCIES.filter((dependency) => dependency !== richTextDependency);
    const dependencyPromises = new Map(
        parallelDependencies.map((dependency) => [dependency, loadDependency(dependency)])
    );
    const richTextPromise = richTextDependency
        ? Promise.resolve(quillDependency ? dependencyPromises.get(quillDependency) : null)
            .then(() => loadDependency(richTextDependency))
        : null;
    const failures = (await Promise.all([
        ...dependencyPromises.values(),
        ...(richTextPromise ? [richTextPromise] : [])
    ])).filter(Boolean);

    window.__TeacherDependencyFailures = failures;
    return failures;
};

const teacherDependencyResultPromise = bootstrapTeacherDependencies()
    .then((failures) => ({ failures, error: null }))
    .catch((error) => ({ failures: [], error }));

const init = async () => {
    configureLessonActionPlacement();

    const { failures, error: dependencyError } = await teacherDependencyResultPromise;
    if (dependencyError) {
        const error = dependencyError;
        console.error(`[bootstrap] Required dependency failed: ${error?.message || 'Unknown error'}`);
        throw error;
    }
    if (failures.length > 0) {
        console.warn('[bootstrap] continuing with optional dependency failures', failures);
    }

    try {
        await import(withLocalAssetVersion('./main.js'));
    } catch (error) {
        console.error('[bootstrap] Failed to load main application scripts:', error);
        throw error;
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
