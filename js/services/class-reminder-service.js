export const CLASS_REMINDER_STORAGE_KEY = 'teacherScreenClassReminders';
export const CLASS_REMINDER_STORE_VERSION = 1;
export const CLASS_REMINDER_CHANGE_EVENT = 'teacher-screen:class-reminders-changed';

export const REMINDER_SCOPES = Object.freeze({
    DECK: 'deck',
    CLASS: 'class'
});

const MAX_TEXT_LENGTH = 2000;
const MAX_IDENTIFIER_LENGTH = 240;

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizePlainText(value, maxLength = MAX_TEXT_LENGTH) {
    if (typeof value !== 'string') return '';

    return value
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, maxLength)
        .trim();
}

function normalizeIdentifier(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return normalizePlainText(String(value), MAX_IDENTIFIER_LENGTH).replace(/\s+/g, ' ');
}

function normalizeScope(value) {
    const scope = normalizeIdentifier(value).toLowerCase();
    return scope === REMINDER_SCOPES.DECK || scope === REMINDER_SCOPES.CLASS
        ? scope
        : '';
}

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return value === true || value === 1;
}

function normalizeOrderIndex(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function normalizeTimestamp(value, fallback) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();

    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue >= 0) return Math.floor(numericValue);

    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value.trim());
        if (Number.isFinite(parsed)) return parsed;
    }

    return fallback;
}

function normalizeDueDate(value) {
    if (value === undefined || value === null || value === '') return null;

    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString();
    }

    const dueDate = normalizePlainText(String(value), 64);
    if (!dueDate) return null;

    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
        if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dueDate) {
            return dueDate;
        }
        return null;
    }

    const parsed = Date.parse(dueDate);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function defaultIdFactory() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    const randomPart = Math.random().toString(36).slice(2, 10);
    return `reminder-${Date.now().toString(36)}-${randomPart}`;
}

function resolveStorage(storage) {
    if (storage !== undefined) return storage;

    try {
        return globalThis.localStorage || null;
    } catch (error) {
        return null;
    }
}

function resolveEventTarget(eventTarget) {
    if (eventTarget !== undefined) return eventTarget;
    return typeof globalThis.addEventListener === 'function'
        && typeof globalThis.dispatchEvent === 'function'
        ? globalThis
        : null;
}

function getOwnerId(reminder) {
    return reminder.scope === REMINDER_SCOPES.DECK
        ? reminder.deckId
        : reminder.classId;
}

function compareReminders(left, right) {
    if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.id.localeCompare(right.id);
}

function createEmptyState() {
    return {
        version: CLASS_REMINDER_STORE_VERSION,
        reminders: []
    };
}

function normalizeReminderRecord(input, options = {}) {
    if (!input || typeof input !== 'object') return null;

    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const scope = normalizeScope(input.scope);
    const deckId = scope === REMINDER_SCOPES.DECK
        ? normalizeIdentifier(input.deckId || input.ownerId)
        : '';
    const classId = scope === REMINDER_SCOPES.CLASS
        ? normalizeIdentifier(input.classId || input.ownerId)
        : '';
    const text = normalizePlainText(input.text);

    if (!scope || !getOwnerId({ scope, deckId, classId }) || !text) return null;

    const createdAt = normalizeTimestamp(input.createdAt, now);
    const updatedAt = Math.max(createdAt, normalizeTimestamp(input.updatedAt, createdAt));
    const suppliedId = normalizeIdentifier(input.id);
    const id = suppliedId || (typeof options.idFactory === 'function' ? options.idFactory() : defaultIdFactory());

    return {
        id: normalizeIdentifier(id),
        scope,
        deckId,
        classId,
        text,
        dueDate: normalizeDueDate(input.dueDate),
        orderIndex: normalizeOrderIndex(input.orderIndex, 0),
        completed: normalizeBoolean(input.completed, false),
        showOnClassroom: normalizeBoolean(input.showOnClassroom, false),
        createdAt,
        updatedAt
    };
}

function parseStorePayload(payload, options = {}) {
    let parsed = payload;
    if (typeof payload === 'string') {
        parsed = payload.trim() ? JSON.parse(payload) : createEmptyState();
    }

    const legacyArray = Array.isArray(parsed);
    const source = legacyArray ? parsed : parsed?.reminders || parsed?.items;
    const suppliedVersion = legacyArray ? 0 : Number(parsed?.version ?? CLASS_REMINDER_STORE_VERSION);

    if (!Array.isArray(source)) {
        throw new TypeError('Reminder data must contain a reminders array.');
    }
    if (!Number.isFinite(suppliedVersion) || suppliedVersion < 0) {
        throw new TypeError('Reminder data has an invalid version.');
    }
    if (suppliedVersion > CLASS_REMINDER_STORE_VERSION) {
        throw new RangeError(`Reminder data version ${suppliedVersion} is newer than this app supports.`);
    }

    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;
    const remindersById = new Map();

    source.forEach((item) => {
        const reminder = normalizeReminderRecord(item, { now, idFactory });
        if (!reminder || !reminder.id) return;
        remindersById.set(reminder.id, reminder);
    });

    return {
        version: CLASS_REMINDER_STORE_VERSION,
        reminders: Array.from(remindersById.values()).sort(compareReminders)
    };
}

export class ClassReminderService {
    constructor(options = {}) {
        this.storageKey = normalizeIdentifier(options.storageKey) || CLASS_REMINDER_STORAGE_KEY;
        this.storage = resolveStorage(options.storage);
        this.eventTarget = resolveEventTarget(options.eventTarget);
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;
        this.listeners = new Set();
        this.state = this.loadStoredState();

        this.handleStorageEvent = (event) => {
            if (!event || event.key !== this.storageKey || event.storageArea !== this.storage) return;

            try {
                this.state = parseStorePayload(event.newValue || JSON.stringify(createEmptyState()), {
                    now: this.now(),
                    idFactory: this.idFactory
                });
                this.emitChange('storage');
            } catch (error) {
                console.warn('Unable to load reminder changes from another tab.', error);
            }
        };

        this.eventTarget?.addEventListener?.('storage', this.handleStorageEvent);
    }

    loadStoredState() {
        if (!this.storage || typeof this.storage.getItem !== 'function') return createEmptyState();

        try {
            const stored = this.storage.getItem(this.storageKey);
            return stored
                ? parseStorePayload(stored, { now: this.now(), idFactory: this.idFactory })
                : createEmptyState();
        } catch (error) {
            console.warn('Unable to load saved class reminders.', error);
            return createEmptyState();
        }
    }

    reconcileStoredState() {
        if (!this.storage || typeof this.storage.getItem !== 'function') return this.state;

        try {
            const stored = this.storage.getItem(this.storageKey);
            this.state = stored
                ? parseStorePayload(stored, { now: this.now(), idFactory: this.idFactory })
                : createEmptyState();
        } catch (error) {
            console.warn('Unable to reconcile saved class reminders before writing.', error);
            throw error;
        }

        return this.state;
    }

    persist(nextState) {
        if (this.storage && typeof this.storage.setItem === 'function') {
            this.storage.setItem(this.storageKey, JSON.stringify(nextState));
        }
    }

    commit(nextReminders, reason, detail = {}) {
        const nextState = {
            version: CLASS_REMINDER_STORE_VERSION,
            reminders: nextReminders.map((reminder) => ({ ...reminder })).sort(compareReminders)
        };

        this.persist(nextState);
        this.state = nextState;
        this.emitChange(reason, detail);
    }

    createUniqueId(existingIds = new Set(this.state.reminders.map((reminder) => reminder.id))) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const candidate = normalizeIdentifier(this.idFactory());
            if (candidate && !existingIds.has(candidate)) return candidate;
        }

        return `reminder-${this.now()}-${existingIds.size + 1}`;
    }

    getNextOrderIndex(scope, deckId, classId) {
        const ownerId = scope === REMINDER_SCOPES.DECK ? deckId : classId;
        const matching = this.state.reminders.filter((reminder) => (
            reminder.scope === scope && getOwnerId(reminder) === ownerId
        ));

        return matching.length > 0
            ? Math.max(...matching.map((reminder) => reminder.orderIndex)) + 1
            : 0;
    }

    add(input = {}) {
        const scope = normalizeScope(input.scope);
        if (!scope) throw new TypeError('A reminder scope of "deck" or "class" is required.');

        const deckId = scope === REMINDER_SCOPES.DECK
            ? normalizeIdentifier(input.deckId || input.ownerId)
            : '';
        const classId = scope === REMINDER_SCOPES.CLASS
            ? normalizeIdentifier(input.classId || input.ownerId)
            : '';
        if (!(deckId || classId)) throw new TypeError(`A ${scope} ID is required.`);

        const text = normalizePlainText(input.text);
        if (!text) throw new TypeError('Reminder text is required.');

        this.reconcileStoredState();
        const now = this.now();
        const hasOrderIndex = input.orderIndex !== undefined && input.orderIndex !== null && input.orderIndex !== '';
        const reminder = normalizeReminderRecord({
            ...input,
            id: this.createUniqueId(),
            scope,
            deckId,
            classId,
            text,
            orderIndex: hasOrderIndex
                ? input.orderIndex
                : this.getNextOrderIndex(scope, deckId, classId),
            createdAt: now,
            updatedAt: now
        }, { now, idFactory: this.idFactory });

        this.commit([...this.state.reminders, reminder], 'add', {
            itemId: reminder.id,
            deckId: reminder.deckId,
            classId: reminder.classId
        });
        return cloneValue(reminder);
    }

    get(id) {
        const normalizedId = normalizeIdentifier(id);
        const reminder = this.state.reminders.find((item) => item.id === normalizedId);
        return reminder ? cloneValue(reminder) : null;
    }

    update(id, changes = {}) {
        const normalizedId = normalizeIdentifier(id);
        this.reconcileStoredState();
        return this.updateCurrentReminder(normalizedId, changes);
    }

    updateCurrentReminder(normalizedId, changes = {}) {
        const reminderIndex = this.state.reminders.findIndex((item) => item.id === normalizedId);
        if (reminderIndex === -1) return null;

        const current = this.state.reminders[reminderIndex];
        const scope = changes.scope === undefined ? current.scope : normalizeScope(changes.scope);
        if (!scope) throw new TypeError('A reminder scope of "deck" or "class" is required.');

        const deckId = scope === REMINDER_SCOPES.DECK
            ? normalizeIdentifier(changes.deckId ?? changes.ownerId ?? (current.scope === scope ? current.deckId : ''))
            : '';
        const classId = scope === REMINDER_SCOPES.CLASS
            ? normalizeIdentifier(changes.classId ?? changes.ownerId ?? (current.scope === scope ? current.classId : ''))
            : '';
        if (!(deckId || classId)) throw new TypeError(`A ${scope} ID is required.`);

        const text = changes.text === undefined ? current.text : normalizePlainText(changes.text);
        if (!text) throw new TypeError('Reminder text is required.');

        const updated = normalizeReminderRecord({
            ...current,
            scope,
            deckId,
            classId,
            text,
            dueDate: changes.dueDate === undefined ? current.dueDate : changes.dueDate,
            orderIndex: changes.orderIndex === undefined ? current.orderIndex : changes.orderIndex,
            completed: changes.completed === undefined ? current.completed : changes.completed,
            showOnClassroom: changes.showOnClassroom === undefined
                ? current.showOnClassroom
                : changes.showOnClassroom,
            createdAt: current.createdAt,
            updatedAt: this.now()
        }, { now: this.now(), idFactory: this.idFactory });

        const nextReminders = this.state.reminders.slice();
        nextReminders[reminderIndex] = updated;
        this.commit(nextReminders, 'update', {
            itemId: updated.id,
            deckId: updated.deckId,
            classId: updated.classId
        });
        return cloneValue(updated);
    }

    toggle(id, completed) {
        const normalizedId = normalizeIdentifier(id);
        this.reconcileStoredState();
        const reminder = this.state.reminders.find((item) => item.id === normalizedId);
        if (!reminder) return null;

        return this.updateCurrentReminder(normalizedId, {
            completed: typeof completed === 'boolean' ? completed : !reminder.completed
        });
    }

    remove(id) {
        const normalizedId = normalizeIdentifier(id);
        this.reconcileStoredState();
        const reminder = this.state.reminders.find((item) => item.id === normalizedId);
        if (!reminder) return null;

        this.commit(
            this.state.reminders.filter((item) => item.id !== normalizedId),
            'remove',
            { itemId: reminder.id, deckId: reminder.deckId, classId: reminder.classId }
        );
        return cloneValue(reminder);
    }

    removeDeckItems(deckId) {
        const normalizedDeckId = normalizeIdentifier(deckId);
        if (!normalizedDeckId) return 0;

        this.reconcileStoredState();
        const nextReminders = this.state.reminders.filter((reminder) => (
            reminder.scope !== REMINDER_SCOPES.DECK || reminder.deckId !== normalizedDeckId
        ));
        const removedCount = this.state.reminders.length - nextReminders.length;
        if (removedCount > 0) {
            this.commit(nextReminders, 'remove-deck-items', { deckId: normalizedDeckId, removedCount });
        }
        return removedCount;
    }

    list(selector = {}) {
        const deckId = normalizeIdentifier(selector.deckId);
        const classId = normalizeIdentifier(selector.classId);
        const scope = selector.scope === undefined ? '' : normalizeScope(selector.scope);
        const hasOwnerFilter = Boolean(deckId || classId);
        const hasCompletedFilter = selector.completed !== undefined;
        const completed = normalizeBoolean(selector.completed, false);
        const classroomOnly = normalizeBoolean(selector.classroomOnly, false);

        return this.state.reminders
            .filter((reminder) => {
                if (scope && reminder.scope !== scope) return false;
                if (classroomOnly && !reminder.showOnClassroom) return false;
                if (hasCompletedFilter && reminder.completed !== completed) return false;
                if (!hasOwnerFilter) return true;

                return (deckId && reminder.scope === REMINDER_SCOPES.DECK && reminder.deckId === deckId)
                    || (classId && reminder.scope === REMINDER_SCOPES.CLASS && reminder.classId === classId);
            })
            .sort(compareReminders)
            .map((reminder) => cloneValue(reminder));
    }

    count(selector = {}) {
        return this.list(selector).length;
    }

    exportData() {
        return cloneValue({
            version: CLASS_REMINDER_STORE_VERSION,
            reminders: this.state.reminders.slice().sort(compareReminders)
        });
    }

    importData(payload, options = {}) {
        const mode = options.mode === 'merge' ? 'merge' : 'replace';
        const importedState = parseStorePayload(payload, {
            now: this.now(),
            idFactory: this.idFactory
        });

        this.reconcileStoredState();
        let reminders = importedState.reminders;
        if (mode === 'merge') {
            const remindersById = new Map(this.state.reminders.map((reminder) => [reminder.id, reminder]));
            reminders.forEach((reminder) => remindersById.set(reminder.id, reminder));
            reminders = Array.from(remindersById.values());
        }

        this.commit(reminders, 'import', { importedCount: importedState.reminders.length, mode });
        return {
            importedCount: importedState.reminders.length,
            totalCount: this.state.reminders.length,
            mode
        };
    }

    getPublicSnapshot(selector = {}) {
        const reminders = this.list({
            ...selector,
            classroomOnly: true
        }).map((reminder) => ({
            id: reminder.id,
            scope: reminder.scope,
            text: reminder.text,
            dueDate: reminder.dueDate,
            orderIndex: reminder.orderIndex,
            completed: reminder.completed
        }));

        return {
            version: CLASS_REMINDER_STORE_VERSION,
            reminders
        };
    }

    subscribe(listener, options = {}) {
        if (typeof listener !== 'function') {
            throw new TypeError('A reminder change listener must be a function.');
        }

        this.listeners.add(listener);
        if (options.emitCurrent === true) {
            listener(this.createChangeDetail('snapshot'));
        }

        return () => this.listeners.delete(listener);
    }

    createChangeDetail(reason, detail = {}) {
        return Object.freeze({
            reason,
            version: CLASS_REMINDER_STORE_VERSION,
            totalCount: this.state.reminders.length,
            ...detail
        });
    }

    emitChange(reason, detail = {}) {
        const change = this.createChangeDetail(reason, detail);
        this.listeners.forEach((listener) => {
            try {
                listener(change);
            } catch (error) {
                console.error('Class reminder change listener failed.', error);
            }
        });

        if (this.eventTarget && typeof globalThis.CustomEvent === 'function') {
            this.eventTarget.dispatchEvent(new CustomEvent(CLASS_REMINDER_CHANGE_EVENT, {
                detail: change
            }));
        }
    }

    dispose() {
        this.eventTarget?.removeEventListener?.('storage', this.handleStorageEvent);
        this.listeners.clear();
    }
}

export const classReminderService = new ClassReminderService();
