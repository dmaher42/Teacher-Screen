const PATH_PROJECTOR = '/projector';

const isProjector = () => {
    try {
        const searchParams = new URLSearchParams(window.location.search);
        const modeParam = (searchParams.get('mode') || '').toLowerCase();
        if (modeParam === 'projector') {
            return true;
        }

        return window.location.pathname.includes(PATH_PROJECTOR);
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

