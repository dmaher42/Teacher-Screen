export const DUE_REMINDER_STICKY_DISMISSAL_KEY = 'teacherScreenDueReminderStickyDismissals';

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDueTimestamp(reminder = {}) {
    const dueDate = typeof reminder.dueDate === 'string' ? reminder.dueDate.trim() : '';
    if (!dueDate) return Number.POSITIVE_INFINITY;

    if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        const parsed = new Date(`${dueDate}T00:00:00`);
        return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Number.POSITIVE_INFINITY;
    }

    const parsed = new Date(dueDate);
    return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Number.POSITIVE_INFINITY;
}

export function getDueReminderPresentation(reminder, now = new Date()) {
    if (!reminder || reminder.completed || !reminder.dueDate) return null;

    const dueDate = String(reminder.dueDate).trim();
    const todayKey = getLocalDateKey(now);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        if (dueDate > todayKey) return null;
        return {
            label: dueDate < todayKey ? 'Overdue' : 'Due today',
            sortTime: getDueTimestamp(reminder)
        };
    }

    const dueTime = getDueTimestamp(reminder);
    if (!Number.isFinite(dueTime) || dueTime > now.getTime()) return null;

    const dueLocalDate = getLocalDateKey(new Date(dueTime));
    return {
        label: dueLocalDate < todayKey ? 'Overdue' : 'Due now',
        sortTime: dueTime
    };
}

export function getDueReminders(reminders = [], now = new Date()) {
    return reminders
        .map((reminder) => ({
            reminder,
            presentation: getDueReminderPresentation(reminder, now)
        }))
        .filter((entry) => entry.presentation)
        .sort((left, right) => (
            left.presentation.sortTime - right.presentation.sortTime
            || Number(left.reminder.orderIndex || 0) - Number(right.reminder.orderIndex || 0)
            || String(left.reminder.id || '').localeCompare(String(right.reminder.id || ''))
        ));
}

function readDismissals(storage, todayKey) {
    if (!storage?.getItem) return new Set();

    try {
        const stored = JSON.parse(storage.getItem(DUE_REMINDER_STICKY_DISMISSAL_KEY) || 'null');
        if (stored?.date !== todayKey || !Array.isArray(stored.ids)) return new Set();
        return new Set(stored.ids.map((id) => String(id || '')).filter(Boolean));
    } catch (error) {
        return new Set();
    }
}

function writeDismissals(storage, todayKey, ids) {
    if (!storage?.setItem) return;

    try {
        storage.setItem(DUE_REMINDER_STICKY_DISMISSAL_KEY, JSON.stringify({
            date: todayKey,
            ids: [...ids]
        }));
    } catch (error) {
        // The reminder remains usable for this session when storage is unavailable.
    }
}

export class DueReminderStickyController {
    constructor(options = {}) {
        this.service = options.service;
        this.document = options.document || globalThis.document;
        this.window = options.window || globalThis.window;
        this.storage = options.storage === undefined ? globalThis.localStorage : options.storage;
        this.now = typeof options.now === 'function' ? options.now : () => new Date();
        this.refreshIntervalMs = Number.isFinite(options.refreshIntervalMs)
            ? options.refreshIntervalMs
            : DEFAULT_REFRESH_INTERVAL_MS;
        this.unsubscribe = null;
        this.intervalId = null;
        this.visibleReminderIds = [];
        this.handleFocus = () => this.refresh();
        this.handleVisibilityChange = () => {
            if (this.document?.visibilityState !== 'hidden') this.refresh();
        };
    }

    init() {
        if (!this.service?.list || !this.document?.body) return false;

        this.unsubscribe = this.service.subscribe?.(() => this.refresh()) || null;
        this.window?.addEventListener?.('focus', this.handleFocus);
        this.document.addEventListener?.('visibilitychange', this.handleVisibilityChange);
        this.intervalId = this.window?.setInterval?.(() => this.refresh(), this.refreshIntervalMs) || null;
        this.refresh();
        return true;
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.window?.removeEventListener?.('focus', this.handleFocus);
        this.document?.removeEventListener?.('visibilitychange', this.handleVisibilityChange);
        if (this.intervalId !== null) this.window?.clearInterval?.(this.intervalId);
        this.intervalId = null;
        this.removeSticky();
    }

    removeSticky() {
        this.document?.querySelector?.('.due-reminder-sticky')?.remove();
        this.visibleReminderIds = [];
    }

    dismissVisible() {
        const todayKey = getLocalDateKey(this.now());
        const dismissed = readDismissals(this.storage, todayKey);
        this.visibleReminderIds.forEach((id) => dismissed.add(id));
        writeDismissals(this.storage, todayKey, dismissed);
        this.removeSticky();
    }

    refresh() {
        const now = this.now();
        const todayKey = getLocalDateKey(now);
        const dismissed = readDismissals(this.storage, todayKey);
        const dueEntries = getDueReminders(this.service?.list?.() || [], now)
            .filter(({ reminder }) => reminder.id && !dismissed.has(String(reminder.id)));

        if (dueEntries.length === 0) {
            this.removeSticky();
            return;
        }

        this.render(dueEntries);
    }

    render(dueEntries) {
        this.removeSticky();
        this.visibleReminderIds = dueEntries.map(({ reminder }) => String(reminder.id));

        const sticky = this.document.createElement('aside');
        sticky.className = 'due-reminder-sticky';
        sticky.setAttribute('role', 'region');
        sticky.setAttribute('aria-labelledby', 'due-reminder-sticky-title');

        const header = this.document.createElement('header');
        header.className = 'due-reminder-sticky__header';
        const headingGroup = this.document.createElement('div');
        const eyebrow = this.document.createElement('p');
        eyebrow.className = 'due-reminder-sticky__eyebrow';
        eyebrow.textContent = 'Teacher only';
        const title = this.document.createElement('h2');
        title.id = 'due-reminder-sticky-title';
        title.textContent = dueEntries.length === 1 ? 'Reminder due' : 'Today’s reminders';
        headingGroup.append(eyebrow, title);

        const closeButton = this.document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'due-reminder-sticky__close';
        closeButton.setAttribute('aria-label', 'Close today’s reminder note');
        closeButton.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        closeButton.addEventListener('click', () => this.dismissVisible());
        header.append(headingGroup, closeButton);

        const list = this.document.createElement('div');
        list.className = 'due-reminder-sticky__list';
        dueEntries.forEach(({ reminder, presentation }) => {
            const label = this.document.createElement('label');
            label.className = 'due-reminder-sticky__item';
            const checkbox = this.document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('aria-label', `Mark complete: ${reminder.text}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) this.service.toggle?.(reminder.id, true);
            });
            const content = this.document.createElement('span');
            content.className = 'due-reminder-sticky__item-content';
            const text = this.document.createElement('strong');
            text.textContent = reminder.text;
            const status = this.document.createElement('span');
            status.className = `due-reminder-sticky__status${presentation.label === 'Overdue' ? ' is-overdue' : ''}`;
            status.textContent = presentation.label;
            content.append(text, status);
            label.append(checkbox, content);
            list.appendChild(label);
        });

        const hint = this.document.createElement('p');
        hint.className = 'due-reminder-sticky__hint';
        hint.textContent = 'This note stays here until you close it.';
        sticky.append(header, list, hint);
        this.document.body.appendChild(sticky);
    }
}
