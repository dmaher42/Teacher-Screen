const PATH_PROJECTOR = '/projector';
const PROJECTOR_FILENAMES = new Set(['/projector', '/projector/']);
const MODE_PARAM = 'mode';
const MODE_PROJECTOR = 'projector';

const isProjector = () => {
    try {
        const normalizedPath = window.location.pathname.toLowerCase();
        const searchParams = new URLSearchParams(window.location.search);
        const modeParam = (searchParams.get(MODE_PARAM) || '').toLowerCase();
        if (modeParam === MODE_PROJECTOR) {
            return true;
        }

        // Legacy compatibility for existing deep links.
        if (searchParams.get('projector') === 'true') {
            return true;
        }

        if (PROJECTOR_FILENAMES.has(normalizedPath)) {
            return true;
        }

        return normalizedPath.endsWith('/projector.html') || normalizedPath.endsWith(`${PATH_PROJECTOR}/index.html`);
    } catch (e) {
        return false;
    }
};

const APP_MODE = isProjector() ? 'projector' : 'teacher';

const isTeacherMode = () => APP_MODE === 'teacher';
const isProjectorMode = () => APP_MODE === 'projector';

const applyAppModeToWidget = (widgetInstance) => {
    if (!widgetInstance || typeof widgetInstance !== 'object') {
        return widgetInstance;
    }

    widgetInstance.appMode = APP_MODE;
    widgetInstance.isTeacherMode = isTeacherMode;
    widgetInstance.isProjectorMode = isProjectorMode;
    return widgetInstance;
};

if (typeof window !== 'undefined') {
    window.TeacherScreenAppMode = {
        APP_MODE,
        isTeacherMode,
        isProjectorMode,
        applyAppModeToWidget
    };
}

export { APP_MODE, isTeacherMode, isProjectorMode, applyAppModeToWidget };
