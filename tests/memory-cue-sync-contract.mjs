import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SERVICE_PATH = new URL('../js/services/memory-cue-reminder-sync.js', import.meta.url);
const CLASS_REMINDER_SERVICE_PATH = new URL('../js/services/class-reminder-service.js', import.meta.url);

async function loadSyncModule() {
    const source = await readFile(SERVICE_PATH, 'utf8');
    const isolatedSource = source.replace(
        /^import\s+\{\s*MEMORY_CUE_FIREBASE_CONFIG\s*\}\s+from\s+['"]\.\.\/config\/memory-cue-config\.js['"];?\s*/,
        'const MEMORY_CUE_FIREBASE_CONFIG = Object.freeze({});\n'
    );

    assert.notEqual(
        isolatedSource,
        source,
        'The test loader must replace the Firebase config import before evaluating the service.'
    );

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(isolatedSource).toString('base64')}`;
    return import(moduleUrl);
}

const syncModule = await loadSyncModule();
const classReminderSource = await readFile(CLASS_REMINDER_SERVICE_PATH, 'utf8');
const classReminderModule = await import(
    `data:text/javascript;base64,${Buffer.from(classReminderSource).toString('base64')}`
);
const {
    MEMORY_CUE_SYNC_STATES,
    MemoryCueReminderSync,
    buildMemoryCueReminderCreateDefaults,
    buildMemoryCueReminderPayload,
    getMemoryCueRemoteReminderId,
    parseMemoryCueReminderDocument
} = syncModule;
const {
    CLASS_REMINDER_STORAGE_KEY,
    CLASS_REMINDER_STORE_VERSION,
    ClassReminderService
} = classReminderModule;

const USER_A = Object.freeze({ uid: 'teacher-account-a', email: 'teacher.a@example.test' });
const USER_B = Object.freeze({ uid: 'teacher-account-b', email: 'teacher.b@example.test' });

const clone = (value) => JSON.parse(JSON.stringify(value));

class MemoryStorage {
    constructor(seed = {}) {
        this.values = new Map(Object.entries(seed));
    }

    get length() {
        return this.values.size;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    getItem(key) {
        return this.values.has(String(key)) ? this.values.get(String(key)) : null;
    }

    setItem(key, value) {
        this.values.set(String(key), String(value));
    }

    removeItem(key) {
        this.values.delete(String(key));
    }

    clear() {
        this.values.clear();
    }

    entries() {
        return [...this.values.entries()];
    }
}

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type, event = { type }) {
        this.listeners.get(type)?.forEach((listener) => listener(event));
    }

    dispatchEvent(event) {
        this.dispatch(event?.type, event);
        return true;
    }
}

class FakeAuthAdapter {
    constructor({ currentUser = null, nextUser = USER_A } = {}) {
        this.currentUser = currentUser ? clone(currentUser) : null;
        this.nextUser = nextUser ? clone(nextUser) : null;
        this.listeners = new Set();
        this.signInCount = 0;
        this.signOutCount = 0;
    }

    async start(listener) {
        this.listeners.add(listener);
        listener(this.currentUser ? clone(this.currentUser) : null);
        return () => this.listeners.delete(listener);
    }

    async signIn() {
        this.signInCount += 1;
        this.currentUser = this.nextUser ? clone(this.nextUser) : null;
        this.emit(this.currentUser);
        return this.currentUser ? clone(this.currentUser) : null;
    }

    async signOut() {
        this.signOutCount += 1;
        this.currentUser = null;
        this.emit(null);
    }

    setNextUser(user) {
        this.nextUser = user ? clone(user) : null;
    }

    emit(user) {
        this.currentUser = user ? clone(user) : null;
        this.listeners.forEach((listener) => listener(this.currentUser ? clone(this.currentUser) : null));
    }
}

class FakeRemoteAdapter {
    constructor() {
        this.operations = [];
        this.documents = new Map();
        this.offline = false;
        this.nextUpsertDelay = null;
        this.subscribers = new Map();
    }

    accountDocuments(uid) {
        if (!this.documents.has(uid)) this.documents.set(uid, new Map());
        return this.documents.get(uid);
    }

    failIfOffline() {
        if (!this.offline) return;
        const error = new Error('Fake cloud is offline');
        error.code = 'unavailable';
        throw error;
    }

    delayNextUpsert() {
        let markStarted;
        let release;
        const delay = {
            started: new Promise((resolve) => {
                markStarted = resolve;
            }),
            released: new Promise((resolve) => {
                release = resolve;
            }),
            markStarted,
            release
        };
        this.nextUpsertDelay = delay;
        return delay;
    }

    mergeDocument(base, update) {
        const nextDocument = {
            ...(base || {}),
            ...(update || {})
        };
        if (base?.metadata || update?.metadata) {
            nextDocument.metadata = {
                ...(base?.metadata || {}),
                ...(update?.metadata || {})
            };
        }
        return nextDocument;
    }

    async upsert(uid, remoteId, payload, options = {}) {
        this.failIfOffline();
        const delay = this.nextUpsertDelay;
        this.nextUpsertDelay = null;
        if (delay) {
            delay.markStarted();
            await delay.released;
        }

        const copiedPayload = clone(payload);
        const documents = this.accountDocuments(uid);
        const existing = documents.get(remoteId) || null;
        const createDefaults = options.createDefaults ? clone(options.createDefaults) : null;
        const writePayload = !existing && createDefaults
            ? this.mergeDocument(createDefaults, copiedPayload)
            : copiedPayload;
        const nextDocument = this.mergeDocument(existing, writePayload);
        documents.set(remoteId, clone(nextDocument));
        this.operations.push({
            type: 'upsert',
            uid,
            remoteId,
            payload: copiedPayload,
            createDefaults,
            appliedCreateDefaults: Boolean(!existing && createDefaults),
            document: clone(nextDocument)
        });
    }

    async remove(uid, remoteId) {
        this.failIfOffline();
        this.accountDocuments(uid).delete(remoteId);
        this.operations.push({ type: 'delete', uid, remoteId });
    }

    async subscribe(uid, onSnapshot, onError) {
        const subscriber = { onSnapshot, onError };
        const subscribers = this.subscribers.get(uid) || new Set();
        subscribers.add(subscriber);
        this.subscribers.set(uid, subscribers);
        onSnapshot({
            documents: [...this.accountDocuments(uid).values()].map(clone),
            removedDocuments: [],
            initial: true
        });
        return () => subscribers.delete(subscriber);
    }

    emitSnapshot(uid, { removedDocuments = [] } = {}) {
        this.subscribers.get(uid)?.forEach(({ onSnapshot }) => onSnapshot({
            documents: [...this.accountDocuments(uid).values()].map(clone),
            removedDocuments: removedDocuments.map(clone),
            initial: false
        }));
    }
}

function makeReminder(overrides = {}) {
    return {
        id: 'reminder-1',
        text: 'Bring assessment folder',
        scope: 'class',
        classId: 'class-7-english',
        deckId: '',
        dueDate: '',
        completed: false,
        showOnClassroom: false,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        ...overrides
    };
}

function createHarness(options = {}) {
    let reminders = options.reminders ? clone(options.reminders) : [];
    const storage = options.storage || new MemoryStorage();
    const auth = options.auth || new FakeAuthAdapter({
        currentUser: options.currentUser || null,
        nextUser: options.nextUser || USER_A
    });
    const remote = options.remote || new FakeRemoteAdapter();
    const confirmations = [];
    let confirmationResult = options.confirmationResult ?? true;
    let now = options.now || 1_800_000_000_000;

    const sync = new MemoryCueReminderSync({
        authAdapter: auth,
        remoteAdapter: remote,
        storage,
        eventTarget: options.eventTarget || new FakeEventTarget(),
        getLocalReminders: options.getLocalReminders || (() => clone(reminders)),
        applyRemoteReminders: options.applyRemoteReminders,
        resolveContext: (reminder) => ({
            className: reminder.classId ? 'Year 7 English' : '',
            deckName: reminder.deckId ? 'Persuasion Weeks 2 and 3' : ''
        }),
        confirmConnection: (details) => {
            confirmations.push(clone(details));
            return confirmationResult;
        },
        now: () => now
    });

    return {
        sync,
        storage,
        auth,
        remote,
        confirmations,
        getReminders: () => clone(reminders),
        setReminders: (nextReminders) => {
            reminders = clone(nextReminders);
        },
        setConfirmationResult: (value) => {
            confirmationResult = value;
        },
        advanceTime: (milliseconds) => {
            now += milliseconds;
        }
    };
}

const queueEntries = (storage) => storage.entries()
    .filter(([key]) => key.includes(':queue:'))
    .map(([key, value]) => [key, JSON.parse(value)]);

const manifestEntries = (storage) => storage.entries()
    .filter(([key]) => key.includes(':manifest:'))
    .map(([key, value]) => [key, JSON.parse(value)]);

const readBinding = (storage) => {
    const entry = storage.entries().find(([key]) => key.endsWith(':binding'));
    return entry ? JSON.parse(entry[1]) : null;
};

async function settleUntil(predicate, message, attempts = 100) {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.fail(message);
}

test('hostile reminder IDs and text map deterministically without leaking classroom visibility', () => {
    const hostileId = 'deck/../../reminder?=1 \u0000 你好';
    const remoteId = getMemoryCueRemoteReminderId(hostileId);
    const secondRemoteId = getMemoryCueRemoteReminderId(hostileId);

    assert.equal(remoteId, secondRemoteId);
    assert.match(remoteId, /^teacher-screen--[A-Za-z0-9_-]+$/);
    assert.equal(remoteId.includes('/'), false);
    assert.throws(() => getMemoryCueRemoteReminderId('\u0000\n\t'), /ID is required/);

    const payload = buildMemoryCueReminderPayload(
        makeReminder({
            id: hostileId,
            text: '<script>alert(1)</script>\u0000\nRemember & review',
            deckId: 'deck/one',
            classId: '',
            scope: 'deck',
            dueDate: '2026-08-17',
            showOnClassroom: true
        }),
        { deckName: 'Rhetoric <Unit>', className: '' },
        USER_A.uid
    );

    assert.equal(payload.id, remoteId);
    assert.equal(payload.text.includes('\u0000'), false);
    assert.equal(payload.text.includes('<script>'), true, 'Text remains inert data; it is not interpreted as markup here.');
    assert.equal(payload.userId, USER_A.uid);
    assert.equal(payload.metadata.integration, 'teacher-screen');
    assert.equal(payload.metadata.type, 'teacher-deck-reminder');
    assert.equal(payload.metadata.isAllDay, true);
    assert.equal(payload.metadata.teacherScreen.reminderId, hostileId.replace(/[\u0000-\u001f\u007f]/g, '').trim());
    assert.equal(payload.metadata.teacherScreen.deckName, 'Rhetoric <Unit>');
    assert.equal(Object.hasOwn(payload, 'showOnClassroom'), false);
    assert.equal(Object.hasOwn(payload.metadata, 'showOnClassroom'), false);
    assert.equal(JSON.stringify(payload).includes('showOnClassroom'), false);

    const memoryOwnedFields = [
        'notes',
        'category',
        'priority',
        'recurrence',
        'notifyAt',
        'notifyMinutesBefore',
        'orderIndex',
        'keywords',
        'embedding',
        'semanticEmbedding'
    ];
    memoryOwnedFields.forEach((field) => {
        assert.equal(Object.hasOwn(payload, field), false, `Teacher updates must omit Memory Cue-owned field: ${field}`);
    });
    assert.equal(Object.hasOwn(payload.metadata, 'suppressNotification'), false);
    assert.equal(JSON.stringify(payload).includes('suppressNotification'), false);

    const createDefaults = buildMemoryCueReminderCreateDefaults(makeReminder());
    assert.equal(createDefaults.category, 'School');
    assert.equal(createDefaults.priority, 'Medium');
    assert.equal(createDefaults.notes, '');
    assert.equal(createDefaults.source, 'manual');
    assert.equal(createDefaults.recurrence, null);
    assert.equal(createDefaults.snoozedUntil, null);
    assert.equal(createDefaults.notifyAt, null);
    assert.equal(createDefaults.notifyMinutesBefore, 0);
    assert.equal(createDefaults.pendingSync, false);
    assert.equal(createDefaults.orderIndex, null);
    assert.equal(createDefaults.plannerLessonId, null);
    assert.equal(createDefaults.pinToToday, false);
    assert.deepEqual(createDefaults.keywords, []);
    assert.equal(createDefaults.semanticEmbedding, null);
    assert.equal(createDefaults.metadata.suppressNotification, true);
    assert.equal(Number.isFinite(payload.dueAt), true);
    const due = new Date(payload.dueAt);
    assert.deepEqual(
        [due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours()],
        [2026, 8, 17, 12]
    );
});

test('only integration-owned Memory Cue documents map back to Teacher Screen', () => {
    const source = makeReminder({
        dueDate: '2026-09-04',
        completed: true,
        updatedAt: 1_800_000_000_000
    });
    const document = {
        ...buildMemoryCueReminderCreateDefaults(source),
        ...buildMemoryCueReminderPayload(source, { className: 'Year 7 English' }, USER_A.uid)
    };

    const parsed = parseMemoryCueReminderDocument(document);
    assert.equal(parsed.id, source.id);
    assert.equal(parsed.scope, 'class');
    assert.equal(parsed.classId, source.classId);
    assert.equal(parsed.deckId, '');
    assert.equal(parsed.text, source.text);
    assert.equal(parsed.completed, true);
    assert.equal(parsed.dueDate, '2026-09-04');
    assert.equal(parseMemoryCueReminderDocument({
        id: 'personal-reminder',
        title: 'Buy milk',
        metadata: { source: 'memory-cue' }
    }), null);
});

test('connecting restores Teacher Screen reminders and follows Memory Cue edits and deletes', async (t) => {
    const remote = new FakeRemoteAdapter();
    const storage = new MemoryStorage();
    const classReminders = new ClassReminderService({
        storage,
        eventTarget: null,
        now: () => 1_900_000_000_000
    });
    const source = makeReminder({ text: 'Restored from Memory Cue' });
    const remoteId = getMemoryCueRemoteReminderId(source.id);
    const remoteDocument = {
        ...buildMemoryCueReminderCreateDefaults(source),
        ...buildMemoryCueReminderPayload(source, { className: 'Year 7 English' }, USER_A.uid)
    };
    remote.accountDocuments(USER_A.uid).set(remoteId, clone(remoteDocument));
    remote.accountDocuments(USER_A.uid).set('personal-reminder', {
        id: 'personal-reminder',
        title: 'Personal reminder with no classroom destination',
        metadata: { source: 'memory-cue' }
    });

    const harness = createHarness({
        remote,
        storage,
        getLocalReminders: () => classReminders.list(),
        applyRemoteReminders: (snapshot) => classReminders.syncFromMemoryCue(snapshot)
    });
    t.after(() => {
        harness.sync.dispose();
        classReminders.dispose();
    });

    assert.equal(await harness.sync.connect(), true);
    assert.deepEqual(classReminders.list().map((reminder) => reminder.text), ['Restored from Memory Cue']);
    assert.equal(remote.operations.length, 0, 'Restoring an unchanged cloud reminder must not echo a write.');

    const editedDocument = remote.accountDocuments(USER_A.uid).get(remoteId);
    editedDocument.text = 'Edited inside Memory Cue';
    editedDocument.title = editedDocument.text;
    editedDocument.updatedAt += 10;
    remote.emitSnapshot(USER_A.uid);
    assert.equal(classReminders.get(source.id).text, 'Edited inside Memory Cue');
    assert.equal(remote.operations.length, 0);

    remote.accountDocuments(USER_A.uid).delete(remoteId);
    remote.emitSnapshot(USER_A.uid, { removedDocuments: [editedDocument] });
    assert.equal(classReminders.get(source.id), null);
    assert.equal(remote.operations.length, 0);
});

test('ordinary Memory Cue reminders feed the teacher-only due note and can be completed', async (t) => {
    const remote = new FakeRemoteAdapter();
    remote.accountDocuments(USER_A.uid).set('personal-school-reminder', {
        id: 'personal-school-reminder',
        text: 'Email the year level leader',
        due: '2026-09-03T08:30:00.000Z',
        completed: false,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        category: 'School',
        metadata: { source: 'memory-cue' }
    });
    const harness = createHarness({ remote, now: 1_800_000_000_000 });
    t.after(() => harness.sync.dispose());

    const feedUpdates = [];
    const unsubscribe = harness.sync.subscribeRemoteReminders((reminders) => {
        feedUpdates.push(reminders);
    });
    t.after(unsubscribe);

    assert.equal(await harness.sync.connect(), true);
    assert.deepEqual(harness.sync.listRemoteReminders().map((reminder) => ({
        id: reminder.id,
        text: reminder.text,
        dueDate: reminder.dueDate,
        completed: reminder.completed
    })), [{
        id: 'memory-cue:personal-school-reminder',
        text: 'Email the year level leader',
        dueDate: '2026-09-03T08:30:00.000Z',
        completed: false
    }]);
    assert.ok(feedUpdates.length > 0);

    assert.equal(await harness.sync.setRemoteReminderCompleted('memory-cue:personal-school-reminder', true), true);
    assert.equal(remote.operations.at(-1).remoteId, 'personal-school-reminder');
    assert.deepEqual(remote.operations.at(-1).payload, {
        completed: true,
        done: true,
        status: 'done',
        completedAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000
    });
    assert.equal(harness.sync.listRemoteReminders()[0].completed, true);
});

test('local-only mode performs zero cloud writes', async (t) => {
    const harness = createHarness({ reminders: [makeReminder()] });
    t.after(() => harness.sync.dispose());

    await harness.sync.init();
    assert.equal(harness.sync.getState().status, MEMORY_CUE_SYNC_STATES.LOCAL_ONLY);
    assert.equal(await harness.sync.reconcile({ flush: true }), false);
    assert.deepEqual(harness.remote.operations, []);
    assert.deepEqual(queueEntries(harness.storage), []);
    assert.equal(harness.confirmations.length, 0);
});

test('first sync merges into a pre-existing Memory Cue document without applying Teacher defaults', async (t) => {
    const reminder = makeReminder();
    const remoteId = getMemoryCueRemoteReminderId(reminder.id);
    const remote = new FakeRemoteAdapter();
    remote.accountDocuments(USER_A.uid).set(remoteId, {
        id: remoteId,
        text: 'Older synced text',
        notes: 'Written inside Memory Cue',
        category: 'Personal choice',
        priority: 'Low',
        recurrence: { frequency: 'monthly' },
        notifyAt: '2026-08-25T07:30:00.000Z',
        notifyMinutesBefore: 45,
        orderIndex: 7,
        keywords: ['keep', 'these'],
        embedding: [0.5],
        metadata: {
            suppressNotification: false,
            memoryCueLabel: 'Existing document'
        }
    });
    const harness = createHarness({ reminders: [reminder], remote });
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    assert.equal(remote.operations.length, 1);
    assert.equal(remote.operations[0].createDefaults.category, 'School');
    assert.equal(remote.operations[0].appliedCreateDefaults, false, 'Defaults apply only when the cloud document is absent.');

    const document = remote.accountDocuments(USER_A.uid).get(remoteId);
    assert.equal(document.text, reminder.text);
    assert.equal(document.notes, 'Written inside Memory Cue');
    assert.equal(document.category, 'Personal choice');
    assert.equal(document.priority, 'Low');
    assert.deepEqual(document.recurrence, { frequency: 'monthly' });
    assert.equal(document.notifyAt, '2026-08-25T07:30:00.000Z');
    assert.equal(document.notifyMinutesBefore, 45);
    assert.equal(document.orderIndex, 7);
    assert.deepEqual(document.keywords, ['keep', 'these']);
    assert.deepEqual(document.embedding, [0.5]);
    assert.equal(document.metadata.suppressNotification, false);
    assert.equal(document.metadata.memoryCueLabel, 'Existing document');
});

test('an edited Teacher reminder recreates a remotely deleted document with creation defaults', async (t) => {
    const reminder = makeReminder({ text: 'Original synced reminder' });
    const harness = createHarness({ reminders: [reminder] });
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    const remoteId = getMemoryCueRemoteReminderId(reminder.id);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), true);

    harness.remote.accountDocuments(USER_A.uid).delete(remoteId);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), false);

    harness.setReminders([makeReminder({
        text: 'Edited after remote deletion',
        updatedAt: reminder.updatedAt + 1
    })]);
    await harness.sync.reconcile({ flush: true });

    assert.equal(harness.remote.operations.length, 2);
    assert.equal(harness.remote.operations[1].remoteId, remoteId);
    assert.equal(harness.remote.operations[1].createDefaults.category, 'School');
    assert.equal(harness.remote.operations[1].appliedCreateDefaults, true, 'The remote snapshot is absent, so defaults must be applied again.');

    const recreated = harness.remote.accountDocuments(USER_A.uid).get(remoteId);
    assert.equal(recreated.text, 'Edited after remote deletion');
    assert.equal(recreated.category, 'School');
    assert.equal(recreated.priority, 'Medium');
    assert.equal(recreated.source, 'manual');
    assert.equal(recreated.metadata.suppressNotification, true);
});

test('add, update, completion, date, and explicit delete reuse one remote ID while preserving Memory Cue fields', async (t) => {
    const harness = createHarness();
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    assert.equal(harness.confirmations.length, 1);
    assert.equal(harness.confirmations[0].reminderCount, 0);
    assert.deepEqual(harness.remote.operations, []);

    const base = makeReminder();
    harness.setReminders([base]);
    await harness.sync.reconcile({ flush: true });
    assert.equal(harness.remote.operations.length, 1);
    const remoteId = harness.remote.operations[0].remoteId;
    assert.equal(remoteId, getMemoryCueRemoteReminderId(base.id));
    assert.equal(harness.remote.operations[0].appliedCreateDefaults, true);
    assert.equal(harness.remote.operations[0].document.category, 'School');
    assert.equal(harness.remote.operations[0].document.priority, 'Medium');
    assert.equal(harness.remote.operations[0].document.metadata.suppressNotification, true);

    const memoryEditedDocument = harness.remote.accountDocuments(USER_A.uid).get(remoteId);
    Object.assign(memoryEditedDocument, {
        notes: 'Keep this Memory Cue note',
        category: 'Teaching',
        priority: 'High',
        recurrence: { frequency: 'weekly' },
        notifyAt: '2026-08-21T08:00:00.000Z',
        notifyMinutesBefore: 30,
        orderIndex: 42,
        keywords: ['assessment', 'folder'],
        embedding: [0.1, 0.2],
        semanticEmbedding: [0.3, 0.4]
    });
    memoryEditedDocument.metadata = {
        ...memoryEditedDocument.metadata,
        suppressNotification: false,
        memoryCueLabel: 'Owned by Memory Cue'
    };

    await harness.sync.reconcile({ flush: true });
    assert.equal(harness.remote.operations.length, 1, 'Unchanged reminders must not be written again.');

    harness.setReminders([makeReminder({ text: 'Bring the revised assessment folder', updatedAt: base.updatedAt + 1 })]);
    await harness.sync.reconcile({ flush: true });

    harness.setReminders([makeReminder({
        text: 'Bring the revised assessment folder',
        completed: true,
        updatedAt: base.updatedAt + 2
    })]);
    await harness.sync.reconcile({ flush: true });

    harness.setReminders([makeReminder({
        text: 'Bring the revised assessment folder',
        completed: true,
        dueDate: '2026-08-21',
        updatedAt: base.updatedAt + 3
    })]);
    await harness.sync.reconcile({ flush: true });

    harness.setReminders([]);
    await harness.sync.reconcile({ flush: true });

    assert.equal(harness.remote.operations.length, 4, 'A missing local snapshot is not proof of an intentional deletion.');
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), true);

    await harness.sync.reconcile({
        change: { reason: 'remove', itemId: base.id },
        flush: true
    });

    assert.deepEqual(
        harness.remote.operations.map((operation) => operation.type),
        ['upsert', 'upsert', 'upsert', 'upsert', 'delete']
    );
    assert.deepEqual(
        [...new Set(harness.remote.operations.map((operation) => operation.remoteId))],
        [remoteId]
    );
    assert.equal(harness.remote.operations[1].payload.text, 'Bring the revised assessment folder');
    assert.equal(harness.remote.operations[2].payload.completed, true);
    assert.equal(harness.remote.operations[2].payload.status, 'done');
    assert.equal(harness.remote.operations[3].payload.metadata.isAllDay, true);
    assert.equal(
        harness.remote.operations.slice(1, 4).every((operation) => operation.createDefaults?.category === 'School'),
        true,
        'Every upsert offers creation defaults so the remote adapter can recover a missing document.'
    );
    assert.equal(
        harness.remote.operations.slice(1, 4).every((operation) => operation.appliedCreateDefaults === false),
        true,
        'When the remote document exists, its snapshot prevents defaults from overwriting Memory Cue-owned fields.'
    );

    const documentBeforeDelete = harness.remote.operations[3].document;
    assert.equal(documentBeforeDelete.notes, 'Keep this Memory Cue note');
    assert.equal(documentBeforeDelete.category, 'Teaching');
    assert.equal(documentBeforeDelete.priority, 'High');
    assert.deepEqual(documentBeforeDelete.recurrence, { frequency: 'weekly' });
    assert.equal(documentBeforeDelete.notifyAt, '2026-08-21T08:00:00.000Z');
    assert.equal(documentBeforeDelete.notifyMinutesBefore, 30);
    assert.equal(documentBeforeDelete.orderIndex, 42);
    assert.deepEqual(documentBeforeDelete.keywords, ['assessment', 'folder']);
    assert.deepEqual(documentBeforeDelete.embedding, [0.1, 0.2]);
    assert.deepEqual(documentBeforeDelete.semanticEmbedding, [0.3, 0.4]);
    assert.equal(documentBeforeDelete.metadata.suppressNotification, false);
    assert.equal(documentBeforeDelete.metadata.memoryCueLabel, 'Owned by Memory Cue');
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), false);

    await harness.sync.reconcile({ flush: true });
    assert.equal(harness.remote.operations.length, 5, 'A recent deletion tombstone must suppress duplicate deletes.');
});

test('a cross-tab storage diff deletes only when it names the removed reminder', async (t) => {
    const reminder = makeReminder({ text: 'Remove from another Teacher Screen tab' });
    const harness = createHarness({ reminders: [reminder] });
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    const remoteId = getMemoryCueRemoteReminderId(reminder.id);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), true);

    harness.setReminders([]);
    await harness.sync.reconcile({
        change: { reason: 'storage', removedItemIds: [] },
        flush: true
    });

    assert.deepEqual(harness.remote.operations.map((operation) => operation.type), ['upsert']);
    assert.equal(
        harness.remote.accountDocuments(USER_A.uid).has(remoteId),
        true,
        'Snapshot absence plus an empty storage diff must not infer deletion.'
    );

    await harness.sync.reconcile({
        change: { reason: 'storage', removedItemIds: [reminder.id] },
        flush: true
    });

    assert.deepEqual(harness.remote.operations.map((operation) => operation.type), ['upsert', 'delete']);
    assert.equal(harness.remote.operations[1].remoteId, remoteId);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), false);
    assert.equal(harness.sync.getState().status, MEMORY_CUE_SYNC_STATES.CONNECTED);
    assert.equal(harness.sync.getState().queuedCount, 0);
});

test('an explicit remove queues under the bound account while authentication is restoring', async (t) => {
    const reminder = makeReminder({ text: 'Delete while sign-in restores' });
    const harness = createHarness({ reminders: [reminder] });
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    const remoteId = getMemoryCueRemoteReminderId(reminder.id);
    assert.equal(manifestEntries(harness.storage)[0][1].items[reminder.id].remoteId, remoteId);

    harness.auth.emit(null);
    await settleUntil(
        () => harness.sync.getState().status === MEMORY_CUE_SYNC_STATES.RECONNECT,
        'The coordinator should wait for authentication to restore while retaining its active binding.'
    );
    assert.equal(readBinding(harness.storage).active, true);

    harness.setReminders([]);
    assert.equal(await harness.sync.reconcile({
        change: { reason: 'remove', itemId: reminder.id },
        flush: true
    }), false);

    const accountQueue = queueEntries(harness.storage)[0][1].operations;
    assert.equal(accountQueue[reminder.id].type, 'delete');
    assert.equal(accountQueue[reminder.id].remoteId, remoteId);
    assert.equal(harness.remote.operations.length, 1, 'No remote call is allowed until the matching account is restored.');

    harness.auth.emit(USER_B);
    await settleUntil(
        () => harness.sync.getState().status === MEMORY_CUE_SYNC_STATES.ACCOUNT_MISMATCH,
        'The wrong restored account should be blocked.'
    );
    assert.equal(harness.remote.operations.length, 1);
    assert.equal(harness.remote.operations.some((operation) => operation.uid === USER_B.uid), false);
    assert.equal(queueEntries(harness.storage)[0][1].operations[reminder.id].type, 'delete');

    harness.auth.emit(USER_A);
    await settleUntil(
        () => harness.sync.getState().status === MEMORY_CUE_SYNC_STATES.CONNECTED
            && harness.sync.getState().queuedCount === 0,
        'The queued delete should flush after the matching account is observed.'
    );

    assert.deepEqual(harness.remote.operations.map((operation) => operation.type), ['upsert', 'delete']);
    assert.equal(harness.remote.operations[1].uid, USER_A.uid);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), false);
    assert.equal(harness.remote.operations.some((operation) => operation.uid === USER_B.uid), false);
});

test('ClassReminderService storage events disclose exact removals but not ambiguous site-storage clearing', (t) => {
    const first = makeReminder({ id: 'storage-reminder-one', text: 'Keep this reminder' });
    const second = makeReminder({ id: 'storage-reminder-two', text: 'Remove this reminder' });
    const initialState = JSON.stringify({
        version: CLASS_REMINDER_STORE_VERSION,
        reminders: [first, second]
    });
    const validNextState = JSON.stringify({
        version: CLASS_REMINDER_STORE_VERSION,
        reminders: [first]
    });

    const storage = new MemoryStorage({ [CLASS_REMINDER_STORAGE_KEY]: initialState });
    const eventTarget = new FakeEventTarget();
    const service = new ClassReminderService({ storage, eventTarget, now: () => 1_800_000_000_000 });
    t.after(() => service.dispose());
    const changes = [];
    service.subscribe((change) => changes.push(change));

    eventTarget.dispatch('storage', {
        type: 'storage',
        key: CLASS_REMINDER_STORAGE_KEY,
        storageArea: storage,
        newValue: validNextState
    });

    assert.equal(changes.at(-1).reason, 'storage');
    assert.deepEqual(changes.at(-1).removedItemIds, [second.id]);

    const clearedStorage = new MemoryStorage({ [CLASS_REMINDER_STORAGE_KEY]: initialState });
    const clearedEventTarget = new FakeEventTarget();
    const clearedService = new ClassReminderService({
        storage: clearedStorage,
        eventTarget: clearedEventTarget,
        now: () => 1_800_000_000_000
    });
    t.after(() => clearedService.dispose());
    const clearedChanges = [];
    clearedService.subscribe((change) => clearedChanges.push(change));

    clearedEventTarget.dispatch('storage', {
        type: 'storage',
        key: CLASS_REMINDER_STORAGE_KEY,
        storageArea: clearedStorage,
        newValue: null
    });

    assert.equal(clearedChanges.at(-1).reason, 'storage');
    assert.deepEqual(
        clearedChanges.at(-1).removedItemIds,
        [],
        'A missing storage key may mean all site storage was cleared, so it is not explicit delete intent.'
    );
});

test('offline operations persist, coalesce to the latest reminder, and retry after a restart', async (t) => {
    const storage = new MemoryStorage();
    const remote = new FakeRemoteAdapter();
    const auth = new FakeAuthAdapter({ nextUser: USER_A });
    const first = createHarness({ storage, remote, auth });
    t.after(() => first.sync.dispose());

    assert.equal(await first.sync.connect(), true);
    remote.offline = true;
    first.setReminders([makeReminder({ text: 'Offline draft one' })]);
    await first.sync.reconcile({ flush: true });
    assert.equal(first.sync.getState().status, MEMORY_CUE_SYNC_STATES.OFFLINE);

    first.setReminders([makeReminder({ text: 'Offline draft two', updatedAt: 1_700_000_000_010 })]);
    await first.sync.reconcile({ flush: true });

    const persistedQueues = queueEntries(storage);
    assert.equal(persistedQueues.length, 1);
    assert.equal(Object.keys(persistedQueues[0][1].operations).length, 1, 'Repeated offline edits must coalesce by local ID.');
    assert.equal(remote.operations.length, 0);

    first.sync.dispose();
    const restartedAuth = new FakeAuthAdapter({ currentUser: USER_A, nextUser: USER_A });
    const restarted = createHarness({
        storage,
        remote,
        auth: restartedAuth,
        reminders: [makeReminder({ text: 'Offline draft two', updatedAt: 1_700_000_000_010 })]
    });
    t.after(() => restarted.sync.dispose());

    await restarted.sync.init();
    await settleUntil(
        () => restarted.sync.getState().status === MEMORY_CUE_SYNC_STATES.OFFLINE,
        'The restarted sync should recover the persisted queue and report offline.'
    );

    remote.offline = false;
    assert.equal(await restarted.sync.retry(), true);
    assert.equal(restarted.sync.getState().queuedCount, 0);
    assert.equal(remote.operations.length, 1);
    assert.equal(remote.operations[0].type, 'upsert');
    assert.equal(remote.operations[0].payload.text, 'Offline draft two');
    assert.equal(Object.keys(queueEntries(storage)[0][1].operations).length, 0);
});

test('restoring an identical reminder replaces an offline queued delete before retry', async (t) => {
    const reminder = makeReminder({ text: 'Reminder restored by import' });
    const harness = createHarness({ reminders: [reminder] });
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    const remoteId = getMemoryCueRemoteReminderId(reminder.id);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), true);

    harness.remote.offline = true;
    harness.setReminders([]);
    await harness.sync.reconcile({
        change: { reason: 'remove', itemId: reminder.id },
        flush: true
    });

    const queuedWhileOffline = queueEntries(harness.storage)[0][1].operations[reminder.id];
    assert.equal(harness.sync.getState().status, MEMORY_CUE_SYNC_STATES.OFFLINE);
    assert.equal(queuedWhileOffline.type, 'delete');
    assert.equal(queuedWhileOffline.remoteId, remoteId);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(remoteId), true, 'The offline delete has not reached Memory Cue.');

    harness.setReminders([clone(reminder)]);
    harness.remote.offline = false;
    assert.equal(await harness.sync.retry(), true);

    const operations = harness.remote.operations;
    assert.deepEqual(operations.map((operation) => operation.type), ['upsert', 'upsert']);
    assert.deepEqual([...new Set(operations.map((operation) => operation.remoteId))], [remoteId]);
    assert.equal(operations.some((operation) => operation.type === 'delete'), false);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).get(remoteId).text, reminder.text);
    assert.equal(harness.sync.getState().status, MEMORY_CUE_SYNC_STATES.CONNECTED);
    assert.equal(harness.sync.getState().queuedCount, 0);
    assert.equal(Object.keys(queueEntries(harness.storage)[0][1].operations).length, 0);
});

test('disconnect invalidates a delayed upsert without stale queue, manifest, or connected-state mutations', async (t) => {
    const harness = createHarness();
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    const stateAfterDisconnectStarted = [];
    const unsubscribe = harness.sync.subscribe((state) => {
        stateAfterDisconnectStarted.push(state);
    });
    t.after(unsubscribe);

    const delay = harness.remote.delayNextUpsert();
    harness.setReminders([makeReminder({ text: 'Delayed cloud write' })]);
    const reconcilePromise = harness.sync.reconcile({ flush: true });
    await delay.started;

    stateAfterDisconnectStarted.length = 0;
    const disconnectPromise = harness.sync.disconnect();
    const bindingWhileRequestIsPending = readBinding(harness.storage);
    const queueWhileRequestIsPending = clone(queueEntries(harness.storage));
    const manifestWhileRequestIsPending = clone(manifestEntries(harness.storage));

    assert.equal(bindingWhileRequestIsPending.active, false, 'Disconnect must invalidate the binding before waiting on the cloud request.');
    assert.equal(Object.keys(queueWhileRequestIsPending[0][1].operations).length, 1);
    assert.deepEqual(manifestWhileRequestIsPending[0][1].items, {});

    delay.release();
    await Promise.all([reconcilePromise, disconnectPromise]);

    assert.equal(harness.remote.operations.length, 1, 'A request already accepted by the fake cloud may finish.');
    assert.equal(readBinding(harness.storage).active, false);
    assert.deepEqual(queueEntries(harness.storage), queueWhileRequestIsPending, 'A stale response must not clear the queue.');
    assert.deepEqual(manifestEntries(harness.storage), manifestWhileRequestIsPending, 'A stale response must not mark the reminder synced.');
    assert.equal(harness.sync.getState().status, MEMORY_CUE_SYNC_STATES.LOCAL_ONLY);
    assert.equal(harness.sync.getState().connected, false);
    assert.equal(
        stateAfterDisconnectStarted.some((state) => state.connected || state.status === MEMORY_CUE_SYNC_STATES.CONNECTED),
        false,
        'No stale connected state may be emitted after disconnect invalidates the session.'
    );
});

test('account changes require confirmation and queues cannot cross account boundaries', async (t) => {
    const localReminder = makeReminder();
    const harness = createHarness({ reminders: [localReminder], nextUser: USER_A });
    t.after(() => harness.sync.dispose());

    assert.equal(await harness.sync.connect(), true);
    assert.equal(harness.confirmations.length, 1);
    assert.equal(harness.confirmations[0].user.uid, USER_A.uid);
    assert.equal(harness.remote.operations.filter((operation) => operation.uid === USER_A.uid).length, 1);

    await harness.sync.disconnect();
    harness.auth.setNextUser(USER_B);
    harness.setConfirmationResult(false);
    assert.equal(await harness.sync.connect(), false);
    assert.equal(harness.confirmations.length, 2);
    assert.equal(harness.confirmations[1].user.uid, USER_B.uid);
    assert.equal(harness.confirmations[1].previousBinding.uid, USER_A.uid);
    assert.deepEqual(
        Object.keys(harness.confirmations[1]).sort(),
        ['previousBinding', 'reminderCount', 'user'],
        'The account-switch disclosure should contain account identity and a count, not reminder contents.'
    );
    assert.equal(harness.confirmations[1].reminderCount, 1);
    assert.equal(JSON.stringify(harness.confirmations[1]).includes(localReminder.text), false);
    assert.equal(JSON.stringify(harness.confirmations[1]).includes(localReminder.id), false);
    assert.equal(harness.remote.operations.some((operation) => operation.uid === USER_B.uid), false);

    harness.setConfirmationResult(true);
    assert.equal(await harness.sync.connect(), true);
    assert.equal(harness.confirmations.length, 3);
    assert.equal(harness.remote.operations.filter((operation) => operation.uid === USER_B.uid).length, 1);
    assert.equal(harness.remote.operations.filter((operation) => operation.uid === USER_A.uid).length, 1);
    assert.equal(harness.remote.accountDocuments(USER_A.uid).has(getMemoryCueRemoteReminderId(localReminder.id)), true);
    assert.equal(harness.remote.accountDocuments(USER_B.uid).has(getMemoryCueRemoteReminderId(localReminder.id)), true);

    const writesBeforeMismatch = harness.remote.operations.length;
    harness.auth.emit(USER_A);
    await settleUntil(
        () => harness.sync.getState().status === MEMORY_CUE_SYNC_STATES.ACCOUNT_MISMATCH,
        'An observed account that differs from the active binding should be blocked.'
    );
    harness.setReminders([makeReminder({ text: 'Must not cross accounts', updatedAt: 1_700_000_000_020 })]);
    assert.equal(await harness.sync.reconcile({ flush: true }), false);
    assert.equal(harness.remote.operations.length, writesBeforeMismatch);

    const accountQueueKeys = queueEntries(harness.storage).map(([key]) => key);
    assert.equal(accountQueueKeys.length, 2, 'Each confirmed account must have its own queue key.');
    assert.notEqual(accountQueueKeys[0], accountQueueKeys[1]);
});
