export const WIDGET_CHANGED_EVENT = 'widgetChanged';

function isProjectorMode() {
    return window.TeacherScreenAppMode?.isProjectorMode?.() === true
        || window.APP_MODE === 'projector';
}

export function notifyWidgetChanged(widget, action = 'state-change') {
    if (!widget || typeof document === 'undefined' || isProjectorMode()) {
        return false;
    }

    document.dispatchEvent(new CustomEvent(WIDGET_CHANGED_EVENT, {
        detail: { widget, action }
    }));
    return true;
}

if (typeof window !== 'undefined') {
    window.TeacherScreenWidgetState = Object.freeze({
        eventName: WIDGET_CHANGED_EVENT,
        notifyChanged: notifyWidgetChanged
    });
}
