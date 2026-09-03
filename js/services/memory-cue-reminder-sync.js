import { MEMORY_CUE_FIREBASE_CONFIG } from '../config/memory-cue-config.js';

const FIREBASE_MODULE_BASE = 'https://www.gstatic.com/firebasejs/10.14.1';
const FIREBASE_APP_NAME = 'teacher-screen-memory-cue';
const SYNC_VERSION = 1;
const BINDING_KEY = 'teacherScreenMemoryCueSync:v1:binding';
const QUEUE_KEY_PREFIX = 'teacherScreenMemoryCueSync:v1:queue:';
const MANIFEST_KEY_PREFIX = 'teacherScreenMemoryCueSync:v1:manifest:';
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export const MEMORY_CUE_SYNC_STATES = Object.freeze({
    LOCAL_ONLY: 'local-only',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    SYNCING: 'syncing',
    OFFLINE: 'offline',
    ERROR: 'error',
    RECONNECT: 'reconnect',
    ACCOUNT_MISMATCH: 'account-mismatch'
});

const cloneValue = (value) => JSON.parse(JSON.stringify(value));

const normalizeText = (value, maxLength = 240) => (
    typeof value === 'string'
        ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength).trim()
        : ''
);

const safeParse = (value, fallback) => {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_error) {
        return fallback;
    }
};

const toBase64Url = (value) => {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const getAccountStorageKey = (prefix, uid) => `${prefix}${toBase64Url(uid)}`;

export const getMemoryCueRemoteReminderId = (localReminderId) => {
    const encoded = toBase64Url(normalizeText(localReminderId, 1000));
    if (!encoded) {
        throw new TypeError('A local reminder ID is required for Memory Cue sync.');
    }
    return `teacher-screen--${encoded}`;
};

const normalizeTimestamp = (value, fallback = Date.now()) => {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : fallback;
};

const normalizeDueDate = (value) => {
    const raw = normalizeText(value, 64);
    if (!raw) {
        return { dueAt: null, due: null, isAllDay: false };
    }

    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    let date;
    if (dateOnly) {
        const [, year, month, day] = dateOnly;
        date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
        if (
            date.getFullYear() !== Number(year)
            || date.getMonth() !== Number(month) - 1
            || date.getDate() !== Number(day)
        ) {
            return { dueAt: null, due: null, isAllDay: false };
        }
    } else {
        date = new Date(raw);
    }

    const dueAt = date.getTime();
    if (!Number.isFinite(dueAt)) {
        return { dueAt: null, due: null, isAllDay: false };
    }

    return {
        dueAt,
        due: date.toISOString(),
        isAllDay: Boolean(dateOnly)
    };
};

export function buildMemoryCueReminderPayload(reminder = {}, context = {}, uid = '') {
    const localId = normalizeText(reminder.id, 1000);
    const text = normalizeText(reminder.text, 2000);
    if (!localId || !text) {
        throw new TypeError('A valid local reminder is required for Memory Cue sync.');
    }

    const remoteId = getMemoryCueRemoteReminderId(localId);
    const createdAt = normalizeTimestamp(reminder.createdAt);
    const updatedAt = Math.max(createdAt, normalizeTimestamp(reminder.updatedAt, createdAt));
    const completed = reminder.completed === true;
    const due = normalizeDueDate(reminder.dueDate);
    const scope = reminder.scope === 'class' ? 'class' : 'deck';

    // Only include fields Teacher Screen owns. Firestore merge writes preserve
    // notes, notifications, recurrence, priority and other Memory Cue edits.
    return {
        id: remoteId,
        text,
        title: text,
        dueAt: due.dueAt,
        due: due.due,
        dueDate: due.due,
        updatedAt,
        completed,
        completedAt: completed ? updatedAt : null,
        done: completed,
        status: completed ? 'done' : 'open',
        userId: normalizeText(uid, 240) || null,
            metadata: {
                integration: 'teacher-screen',
                schemaVersion: SYNC_VERSION,
                source: 'teacher-screen',
                type: scope === 'class' ? 'teacher-class-reminder' : 'teacher-deck-reminder',
                isAllDay: due.isAllDay,
                teacherScreen: {
                reminderId: localId,
                scope,
                deckId: normalizeText(reminder.deckId, 240),
                classId: normalizeText(reminder.classId, 240),
                deckName: normalizeText(context.deckName, 240),
                className: normalizeText(context.className, 240)
            }
        }
    };
}

export function buildMemoryCueReminderCreateDefaults(reminder = {}) {
    // These values are applied only when the integration document does not
    // already exist, so reconnecting cannot reset choices made in Memory Cue.
    return {
        createdAt: normalizeTimestamp(reminder.createdAt),
        notes: '',
        category: 'School',
        priority: 'Medium',
        source: 'manual',
        recurrence: null,
        snoozedUntil: null,
        notifyAt: null,
        notifyMinutesBefore: 0,
        pendingSync: false,
        orderIndex: null,
        plannerLessonId: null,
        pinToToday: false,
        keywords: [],
        semanticEmbedding: null,
        metadata: {
            suppressNotification: true
        }
    };
}

export function parseMemoryCueReminderDocument(document = {}) {
    const metadata = document?.metadata;
    const teacherScreen = metadata?.teacherScreen;
    if (
        metadata?.integration !== 'teacher-screen'
        || !teacherScreen
        || typeof teacherScreen !== 'object'
    ) {
        return null;
    }

    const id = normalizeText(teacherScreen.reminderId, 1000);
    const scope = teacherScreen.scope === 'class' ? 'class' : (teacherScreen.scope === 'deck' ? 'deck' : '');
    const classId = scope === 'class' ? normalizeText(teacherScreen.classId, 240) : '';
    const deckId = scope === 'deck' ? normalizeText(teacherScreen.deckId, 240) : '';
    const text = normalizeText(document.text || document.title, 2000);
    if (!id || !scope || !(classId || deckId) || !text) return null;

    const dueValue = document.dueDate || document.due || document.dueAt;
    const due = Number.isFinite(Number(dueValue)) && Number(dueValue) > 0
        ? { due: new Date(Number(dueValue)).toISOString() }
        : (dueValue ? normalizeDueDate(dueValue) : { due: null });
    let dueDate = due.due;
    if (dueDate && metadata.isAllDay === true) {
        const localDate = new Date(dueDate);
        const year = localDate.getFullYear();
        const month = String(localDate.getMonth() + 1).padStart(2, '0');
        const day = String(localDate.getDate()).padStart(2, '0');
        dueDate = `${year}-${month}-${day}`;
    }
    const completed = document.completed === true || document.done === true || document.status === 'done';
    const createdAt = normalizeTimestamp(document.createdAt);
    const updatedAt = Math.max(createdAt, normalizeTimestamp(document.updatedAt, createdAt));

    return {
        id,
        scope,
        classId,
        deckId,
        text,
        dueDate,
        completed,
        createdAt,
        updatedAt
    };
}

function parseMemoryCueReminderFeedDocument(document = {}) {
    const integratedReminder = parseMemoryCueReminderDocument(document);
    const remoteId = normalizeText(document.id, 1000);
    const text = normalizeText(document.text || document.title, 2000);
    if (!remoteId || !text) return null;

    const dueValue = document.dueDate || document.due || document.dueAt;
    const due = Number.isFinite(Number(dueValue)) && Number(dueValue) > 0
        ? { due: new Date(Number(dueValue)).toISOString() }
        : (dueValue ? normalizeDueDate(dueValue) : { due: null });
    const completed = document.completed === true || document.done === true || document.status === 'done';

    return {
        id: integratedReminder?.id || `memory-cue:${remoteId}`,
        memoryCueRemoteId: remoteId,
        text,
        dueDate: integratedReminder?.dueDate || due.due,
        completed,
        orderIndex: Number.isFinite(Number(document.orderIndex)) ? Number(document.orderIndex) : 0,
        createdAt: normalizeTimestamp(document.createdAt),
        updatedAt: normalizeTimestamp(document.updatedAt)
    };
}

const getPayloadFingerprint = (payload) => JSON.stringify(payload);

const getExplicitRemovedIds = (change = {}) => {
    const removedIds = new Set();
    if (change.reason === 'remove' && change.itemId) {
        const normalizedId = normalizeText(change.itemId, 1000);
        if (normalizedId) removedIds.add(normalizedId);
    }
    if (Array.isArray(change.removedItemIds)) {
        change.removedItemIds.forEach((itemId) => {
            const normalizedId = normalizeText(itemId, 1000);
            if (normalizedId) removedIds.add(normalizedId);
        });
    }
    return removedIds;
};

const createDictionary = (value) => Object.assign(
    Object.create(null),
    value && typeof value === 'object' ? value : {}
);

const createEmptyQueue = () => ({ version: SYNC_VERSION, operations: Object.create(null) });
const createEmptyManifest = () => ({ version: SYNC_VERSION, items: Object.create(null) });

const resolveStorage = (storage) => {
    if (storage !== undefined) return storage;
    try {
        return globalThis.localStorage || null;
    } catch (_error) {
        return null;
    }
};

const normalizeUser = (user) => {
    const uid = normalizeText(user?.uid || user?.id, 240);
    if (!uid) return null;
    return {
        uid,
        email: normalizeText(user?.email, 320)
    };
};

const isOfflineError = (error) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const code = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
    return /offline|network|unavailable|failed-precondition/.test(code);
};

function createFirebaseAdapters(config = MEMORY_CUE_FIREBASE_CONFIG) {
    let firebasePromise = null;

    const getFirebase = async () => {
        if (!firebasePromise) {
            firebasePromise = (async () => {
                const [appModule, authModule, firestoreModule] = await Promise.all([
                    import(`${FIREBASE_MODULE_BASE}/firebase-app.js`),
                    import(`${FIREBASE_MODULE_BASE}/firebase-auth.js`),
                    import(`${FIREBASE_MODULE_BASE}/firebase-firestore.js`)
                ]);
                const app = appModule.getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME)
                    || appModule.initializeApp(config, FIREBASE_APP_NAME);
                const auth = authModule.getAuth(app);
                await authModule.setPersistence(auth, authModule.browserLocalPersistence).catch((error) => {
                    console.warn('Memory Cue sign-in persistence is unavailable; continuing for this browser session.', error);
                });
                let db;
                try {
                    db = firestoreModule.initializeFirestore(app, {
                        experimentalAutoDetectLongPolling: true,
                        experimentalLongPollingOptions: { timeoutSeconds: 25 }
                    });
                } catch (_error) {
                    // Reuse an already-initialized instance if another module won the race.
                    db = firestoreModule.getFirestore(app);
                }
                return { app, auth, authModule, db, firestoreModule };
            })().catch((error) => {
                firebasePromise = null;
                throw error;
            });
        }
        return firebasePromise;
    };

    return {
        authAdapter: {
            async start(onUser) {
                const firebase = await getFirebase();
                return firebase.authModule.onAuthStateChanged(firebase.auth, (user) => {
                    onUser(normalizeUser(user));
                });
            },
            async signIn() {
                const firebase = await getFirebase();
                // Installed PWAs can complete Google authentication even when the
                // popup reports that it was closed. Reuse that authenticated
                // Firebase session and let Teacher Screen's own confirmation
                // show the exact account before any reminder data is synced.
                const currentUser = normalizeUser(firebase.auth.currentUser);
                if (currentUser) return currentUser;
                const provider = new firebase.authModule.GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                try {
                    const result = await firebase.authModule.signInWithPopup(firebase.auth, provider);
                    return normalizeUser(result?.user);
                } catch (error) {
                    const authenticatedUser = normalizeUser(firebase.auth.currentUser);
                    if (
                        authenticatedUser
                        && /popup-closed|popup-cancelled|cancelled-popup|user-cancel/i.test(`${error?.code || ''} ${error?.message || ''}`)
                    ) {
                        return authenticatedUser;
                    }
                    throw error;
                }
            },
            async signOut() {
                const firebase = await getFirebase();
                await firebase.authModule.signOut(firebase.auth);
            }
        },
        remoteAdapter: {
            async upsert(uid, remoteId, payload, options = {}) {
                const firebase = await getFirebase();
                const target = firebase.firestoreModule.doc(firebase.db, 'users', uid, 'reminders', remoteId);
                if (options.createDefaults) {
                    await firebase.firestoreModule.runTransaction(firebase.db, async (transaction) => {
                        const snapshot = await transaction.get(target);
                        const writePayload = snapshot.exists()
                            ? payload
                            : {
                                ...options.createDefaults,
                                ...payload,
                                metadata: {
                                    ...(options.createDefaults.metadata || {}),
                                    ...(payload.metadata || {})
                                }
                            };
                        transaction.set(target, writePayload, { merge: true });
                    });
                    return;
                }
                await firebase.firestoreModule.setDoc(target, payload, { merge: true });
            },
            async remove(uid, remoteId) {
                const firebase = await getFirebase();
                const target = firebase.firestoreModule.doc(firebase.db, 'users', uid, 'reminders', remoteId);
                await firebase.firestoreModule.deleteDoc(target);
            },
            async subscribe(uid, onSnapshot, onError) {
                const firebase = await getFirebase();
                const target = firebase.firestoreModule.collection(firebase.db, 'users', uid, 'reminders');
                let initial = true;
                return firebase.firestoreModule.onSnapshot(target, (snapshot) => {
                    const documents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
                    const removedDocuments = initial
                        ? []
                        : snapshot.docChanges()
                            .filter((change) => change.type === 'removed')
                            .map((change) => ({ id: change.doc.id, ...change.doc.data() }));
                    onSnapshot({ documents, removedDocuments, initial });
                    initial = false;
                }, onError);
            }
        }
    };
}

export class MemoryCueReminderSync {
    constructor(options = {}) {
        const testAdapters = globalThis.__TeacherScreenMemoryCueSyncTestAdapters;
        const suppliedAuthAdapter = options.authAdapter || testAdapters?.authAdapter;
        const suppliedRemoteAdapter = options.remoteAdapter || testAdapters?.remoteAdapter;
        const firebaseAdapters = suppliedAuthAdapter && suppliedRemoteAdapter
            ? null
            : createFirebaseAdapters(options.firebaseConfig || MEMORY_CUE_FIREBASE_CONFIG);
        this.authAdapter = suppliedAuthAdapter || firebaseAdapters.authAdapter;
        this.remoteAdapter = suppliedRemoteAdapter || firebaseAdapters.remoteAdapter;
        this.storage = resolveStorage(options.storage);
        this.eventTarget = options.eventTarget || globalThis;
        this.getLocalReminders = typeof options.getLocalReminders === 'function'
            ? options.getLocalReminders
            : () => [];
        this.resolveContext = typeof options.resolveContext === 'function'
            ? options.resolveContext
            : () => ({});
        this.confirmConnection = typeof options.confirmConnection === 'function'
            ? options.confirmConnection
            : () => true;
        this.applyRemoteReminders = typeof options.applyRemoteReminders === 'function'
            ? options.applyRemoteReminders
            : () => ({ changed: false });
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.listeners = new Set();
        this.remoteReminderListeners = new Set();
        this.remoteReminders = [];
        this.authUnsubscribe = null;
        this.remoteUnsubscribe = null;
        this.authStartPromise = null;
        this.flushPromise = null;
        this.currentUser = null;
        this.sessionGeneration = 0;
        this.connectionAttempt = 0;
        this.connecting = false;
        this.disposed = false;
        this.state = {
            status: MEMORY_CUE_SYNC_STATES.LOCAL_ONLY,
            connected: false,
            email: '',
            queuedCount: 0,
            error: ''
        };
        this.handleOnline = () => {
            if (this.currentUser) {
                void this.reconcile({ flush: true });
            }
        };
    }

    readBinding() {
        const binding = safeParse(this.storage?.getItem?.(BINDING_KEY), {});
        const uid = normalizeText(binding.uid, 240);
        return {
            version: SYNC_VERSION,
            uid,
            email: normalizeText(binding.email, 320),
            active: binding.active === true,
            connectedAt: normalizeTimestamp(binding.connectedAt, 0)
        };
    }

    writeBinding(binding = {}) {
        const nextBinding = {
            version: SYNC_VERSION,
            uid: normalizeText(binding.uid, 240),
            email: normalizeText(binding.email, 320),
            active: binding.active === true,
            connectedAt: normalizeTimestamp(binding.connectedAt, this.now())
        };
        this.storage?.setItem?.(BINDING_KEY, JSON.stringify(nextBinding));
        return nextBinding;
    }

    readQueue(uid) {
        const queue = safeParse(this.storage?.getItem?.(getAccountStorageKey(QUEUE_KEY_PREFIX, uid)), createEmptyQueue());
        return {
            version: SYNC_VERSION,
            operations: createDictionary(queue.operations)
        };
    }

    writeQueue(uid, queue) {
        this.storage?.setItem?.(getAccountStorageKey(QUEUE_KEY_PREFIX, uid), JSON.stringify({
            version: SYNC_VERSION,
            operations: queue.operations || {}
        }));
    }

    readManifest(uid) {
        const manifest = safeParse(this.storage?.getItem?.(getAccountStorageKey(MANIFEST_KEY_PREFIX, uid)), createEmptyManifest());
        return {
            version: SYNC_VERSION,
            items: createDictionary(manifest.items)
        };
    }

    writeManifest(uid, manifest) {
        this.storage?.setItem?.(getAccountStorageKey(MANIFEST_KEY_PREFIX, uid), JSON.stringify({
            version: SYNC_VERSION,
            items: manifest.items || {}
        }));
    }

    setState(changes = {}) {
        this.state = { ...this.state, ...changes };
        const snapshot = this.getState();
        this.listeners.forEach((listener) => listener(snapshot));
    }

    getState() {
        return cloneValue(this.state);
    }

    subscribe(listener, options = {}) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        if (options.emitCurrent === true) listener(this.getState());
        return () => this.listeners.delete(listener);
    }

    listRemoteReminders() {
        return cloneValue(this.remoteReminders);
    }

    subscribeRemoteReminders(listener, options = {}) {
        if (typeof listener !== 'function') return () => {};
        this.remoteReminderListeners.add(listener);
        if (options.emitCurrent === true) listener(this.listRemoteReminders());
        return () => this.remoteReminderListeners.delete(listener);
    }

    setRemoteReminders(reminders = []) {
        this.remoteReminders = Array.isArray(reminders) ? cloneValue(reminders) : [];
        const snapshot = this.listRemoteReminders();
        this.remoteReminderListeners.forEach((listener) => listener(snapshot));
    }

    async init() {
        this.eventTarget?.addEventListener?.('online', this.handleOnline);
        const binding = this.readBinding();
        if (!binding.active || !binding.uid) {
            this.setState({ status: MEMORY_CUE_SYNC_STATES.LOCAL_ONLY, connected: false, email: binding.email });
            return;
        }

        this.setState({ status: MEMORY_CUE_SYNC_STATES.CONNECTING, connected: false, email: binding.email });
        try {
            await this.ensureAuthObserver();
        } catch (error) {
            this.setState({
                status: isOfflineError(error) ? MEMORY_CUE_SYNC_STATES.OFFLINE : MEMORY_CUE_SYNC_STATES.ERROR,
                connected: false,
                error: normalizeText(error?.message, 300)
            });
        }
    }

    async ensureAuthObserver() {
        if (this.authUnsubscribe) return this.authUnsubscribe;
        if (!this.authStartPromise) {
            this.authStartPromise = Promise.resolve(this.authAdapter.start((user) => {
                void this.handleObservedUser(user);
            })).then((unsubscribe) => {
                this.authUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {};
                return this.authUnsubscribe;
            }).finally(() => {
                this.authStartPromise = null;
            });
        }
        return this.authStartPromise;
    }

    async handleObservedUser(user) {
        const normalizedUser = normalizeUser(user);
        if (!normalizedUser) {
            if (this.currentUser) this.sessionGeneration += 1;
            this.currentUser = null;
            this.remoteUnsubscribe?.();
            this.remoteUnsubscribe = null;
            this.setRemoteReminders([]);
            if (this.connecting) return;
            const binding = this.readBinding();
            this.setState({
                status: binding.active ? MEMORY_CUE_SYNC_STATES.RECONNECT : MEMORY_CUE_SYNC_STATES.LOCAL_ONLY,
                connected: false,
                email: binding.email,
                queuedCount: binding.uid ? Object.keys(this.readQueue(binding.uid).operations).length : 0
            });
            return;
        }

        const binding = this.readBinding();
        if (!binding.active) return;
        if (binding.uid !== normalizedUser.uid) {
            this.sessionGeneration += 1;
            this.currentUser = null;
            this.remoteUnsubscribe?.();
            this.remoteUnsubscribe = null;
            this.setRemoteReminders([]);
            this.setState({
                status: MEMORY_CUE_SYNC_STATES.ACCOUNT_MISMATCH,
                connected: false,
                email: normalizedUser.email,
                error: 'The signed-in Memory Cue account does not match this connection.'
            });
            return;
        }

        await this.activateBoundUser(normalizedUser);
    }

    async connect() {
        if (this.connecting) return false;
        const previousBinding = this.readBinding();
        const connectionAttempt = ++this.connectionAttempt;
        this.connecting = true;
        this.setState({ status: MEMORY_CUE_SYNC_STATES.CONNECTING, connected: false, error: '' });
        try {
            await this.ensureAuthObserver();
            const user = normalizeUser(await this.authAdapter.signIn());
            if (connectionAttempt !== this.connectionAttempt) {
                await Promise.resolve(this.authAdapter.signOut()).catch(() => {});
                return false;
            }
            if (!user) throw new Error('Memory Cue sign-in did not return an account.');

            const isPreviouslyConfirmedAccount = previousBinding.uid === user.uid;
            if (!isPreviouslyConfirmedAccount) {
                const reminders = this.getLocalReminders();
                const approved = await Promise.resolve(this.confirmConnection({
                    user,
                    previousBinding,
                    reminderCount: Array.isArray(reminders) ? reminders.length : 0
                }));
                if (connectionAttempt !== this.connectionAttempt) {
                    await Promise.resolve(this.authAdapter.signOut()).catch(() => {});
                    return false;
                }
                if (!approved) {
                    await this.authAdapter.signOut();
                    this.setState({
                        status: previousBinding.active
                            ? MEMORY_CUE_SYNC_STATES.RECONNECT
                            : MEMORY_CUE_SYNC_STATES.LOCAL_ONLY,
                        connected: false,
                        email: previousBinding.email,
                        error: ''
                    });
                    return false;
                }
            }

            if (previousBinding.uid && previousBinding.uid !== user.uid) {
                this.sessionGeneration += 1;
                this.currentUser = null;
                await this.flushPromise;
                if (connectionAttempt !== this.connectionAttempt) return false;
            }

            this.writeBinding({
                uid: user.uid,
                email: user.email,
                active: true,
                connectedAt: this.now()
            });
            const activated = await this.activateBoundUser(user);
            return activated && connectionAttempt === this.connectionAttempt;
        } catch (error) {
            this.currentUser = null;
            const reconnectRequired = previousBinding.active
                && previousBinding.uid
                && /popup-closed|popup-cancelled|cancelled-popup|user-cancel/i.test(`${error?.code || ''} ${error?.message || ''}`);
            this.setState({
                status: reconnectRequired
                    ? MEMORY_CUE_SYNC_STATES.RECONNECT
                    : (isOfflineError(error) ? MEMORY_CUE_SYNC_STATES.OFFLINE : MEMORY_CUE_SYNC_STATES.ERROR),
                connected: false,
                email: previousBinding.email,
                error: normalizeText(error?.message || 'Memory Cue could not be connected.', 300)
            });
            return false;
        } finally {
            this.connecting = false;
        }
    }

    async activateBoundUser(user) {
        const normalizedUser = normalizeUser(user);
        const binding = this.readBinding();
        if (!normalizedUser || !binding.active || binding.uid !== normalizedUser.uid) return false;
        if (this.currentUser?.uid !== normalizedUser.uid) {
            this.sessionGeneration += 1;
        }
        this.currentUser = normalizedUser;
        const sessionGeneration = this.sessionGeneration;
        const queue = this.readQueue(normalizedUser.uid);
        this.setState({
            status: MEMORY_CUE_SYNC_STATES.CONNECTED,
            connected: true,
            email: normalizedUser.email || binding.email,
            queuedCount: Object.keys(queue.operations).length,
            error: ''
        });
        await this.startRemoteSubscription(normalizedUser, sessionGeneration);
        await this.reconcile({ flush: true });
        return this.isSessionCurrent(normalizedUser, sessionGeneration);
    }

    async startRemoteSubscription(user, generation) {
        this.remoteUnsubscribe?.();
        this.remoteUnsubscribe = null;
        if (typeof this.remoteAdapter.subscribe !== 'function') return true;

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                callback(value);
            };

            Promise.resolve(this.remoteAdapter.subscribe(
                user.uid,
                (snapshot) => {
                    if (!this.isSessionCurrent(user, generation)) return;
                    try {
                        this.applyRemoteSnapshot(user, snapshot);
                        finish(resolve, true);
                    } catch (error) {
                        finish(reject, error);
                    }
                },
                (error) => {
                    if (!settled) {
                        finish(reject, error);
                        return;
                    }
                    if (!this.isSessionCurrent(user, generation)) return;
                    this.setState({
                        status: isOfflineError(error) ? MEMORY_CUE_SYNC_STATES.OFFLINE : MEMORY_CUE_SYNC_STATES.ERROR,
                        connected: true,
                        error: normalizeText(error?.message || 'Memory Cue could not load reminders.', 300)
                    });
                }
            )).then((unsubscribe) => {
                if (!this.isSessionCurrent(user, generation)) {
                    unsubscribe?.();
                    finish(resolve, false);
                    return;
                }
                this.remoteUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {};
            }).catch((error) => finish(reject, error));
        });
    }

    applyRemoteSnapshot(user, snapshot = {}) {
        this.setRemoteReminders(
            (Array.isArray(snapshot.documents) ? snapshot.documents : [])
                .map(parseMemoryCueReminderFeedDocument)
                .filter(Boolean)
        );
        const reminders = (Array.isArray(snapshot.documents) ? snapshot.documents : [])
            .map(parseMemoryCueReminderDocument)
            .filter(Boolean);
        const removedIds = (Array.isArray(snapshot.removedDocuments) ? snapshot.removedDocuments : [])
            .map(parseMemoryCueReminderDocument)
            .filter(Boolean)
            .map((reminder) => reminder.id);

        this.applyRemoteReminders({
            reminders,
            removedIds,
            initial: snapshot.initial === true
        });

        const manifest = this.readManifest(user.uid);
        const localById = new Map(this.getLocalReminders().map((reminder) => [reminder.id, reminder]));
        reminders.forEach((remoteReminder) => {
            const local = localById.get(remoteReminder.id);
            if (!local) return;
            const payload = this.createPayload(local, user.uid);
            manifest.items[local.id] = {
                remoteId: payload.id,
                fingerprint: getPayloadFingerprint(payload),
                syncedAt: this.now(),
                deletedAt: null,
                lastAssertedAt: null
            };
        });
        removedIds.forEach((localId) => {
            manifest.items[localId] = {
                remoteId: getMemoryCueRemoteReminderId(localId),
                fingerprint: '',
                deletedAt: this.now(),
                lastAssertedAt: this.now()
            };
        });
        this.writeManifest(user.uid, manifest);
    }

    async setRemoteReminderCompleted(id, completed = true) {
        const user = this.currentUser;
        const binding = this.readBinding();
        const reminder = this.remoteReminders.find((item) => item.id === id);
        if (!user || !binding.active || binding.uid !== user.uid || !reminder?.memoryCueRemoteId) return false;

        const updatedAt = this.now();
        const isCompleted = completed === true;
        try {
            await this.remoteAdapter.upsert(user.uid, reminder.memoryCueRemoteId, {
                completed: isCompleted,
                done: isCompleted,
                status: isCompleted ? 'done' : 'open',
                completedAt: isCompleted ? updatedAt : null,
                updatedAt
            });
            this.setRemoteReminders(this.remoteReminders.map((item) => (
                item.id === id
                    ? { ...item, completed: isCompleted, updatedAt }
                    : item
            )));
            return true;
        } catch (error) {
            this.setState({
                status: isOfflineError(error) ? MEMORY_CUE_SYNC_STATES.OFFLINE : MEMORY_CUE_SYNC_STATES.ERROR,
                connected: true,
                error: normalizeText(error?.message || 'Memory Cue reminder could not be updated.', 300)
            });
            return false;
        }
    }

    async disconnect() {
        const binding = this.readBinding();
        this.connectionAttempt += 1;
        this.writeBinding({ ...binding, active: false });
        this.sessionGeneration += 1;
        this.currentUser = null;
        this.remoteUnsubscribe?.();
        this.remoteUnsubscribe = null;
        this.setRemoteReminders([]);
        await this.flushPromise;
        try {
            await this.authAdapter.signOut();
        } catch (_error) {
            // Local disconnect still succeeds if the remote SDK is unavailable.
        }
        this.setState({
            status: MEMORY_CUE_SYNC_STATES.LOCAL_ONLY,
            connected: false,
            email: binding.email,
            queuedCount: binding.uid ? Object.keys(this.readQueue(binding.uid).operations).length : 0,
            error: ''
        });
    }

    getCurrentLocalReminder(localId) {
        const reminders = this.getLocalReminders();
        return Array.isArray(reminders)
            ? reminders.find((reminder) => reminder?.id === localId) || null
            : null;
    }

    createPayload(reminder, uid) {
        return buildMemoryCueReminderPayload(reminder, this.resolveContext(reminder) || {}, uid);
    }

    isSessionCurrent(user, generation) {
        const binding = this.readBinding();
        return !this.disposed
            && generation === this.sessionGeneration
            && Boolean(user?.uid)
            && this.currentUser?.uid === user.uid
            && binding.active
            && binding.uid === user.uid;
    }

    async reconcile(options = {}) {
        const user = this.currentUser;
        const binding = this.readBinding();
        const now = this.now();
        const change = options.change && typeof options.change === 'object' ? options.change : {};
        const explicitlyRemovedIds = getExplicitRemovedIds(change);
        let queue = binding.uid ? this.readQueue(binding.uid) : createEmptyQueue();
        let manifest = binding.uid ? this.readManifest(binding.uid) : createEmptyManifest();

        explicitlyRemovedIds.forEach((localId) => {
            const manifestItem = manifest.items[localId];
            const queuedOperation = queue.operations[localId];
            if ((manifestItem && !manifestItem.deletedAt) || queuedOperation?.type === 'upsert') {
                queue.operations[localId] = {
                    type: 'delete',
                    remoteId: manifestItem?.remoteId || queuedOperation?.remoteId || getMemoryCueRemoteReminderId(localId),
                    queuedAt: now,
                    attempts: 0
                };
            }
        });

        if (binding.uid && explicitlyRemovedIds.size > 0) {
            this.writeQueue(binding.uid, queue);
        }

        if (!user || !binding.active || binding.uid !== user.uid) {
            if (binding.uid && explicitlyRemovedIds.size > 0) {
                this.setState({ queuedCount: Object.keys(queue.operations).length });
            }
            return false;
        }

        const localReminders = this.getLocalReminders();
        const reminders = Array.isArray(localReminders) ? localReminders : [];
        const localById = new Map(reminders.filter((item) => item?.id).map((item) => [item.id, item]));

        Object.entries(manifest.items).forEach(([localId, item]) => {
            if (item?.deletedAt && now - item.deletedAt > TOMBSTONE_RETENTION_MS) {
                delete manifest.items[localId];
            }
        });

        localById.forEach((reminder, localId) => {
            const payload = this.createPayload(reminder, user.uid);
            const fingerprint = getPayloadFingerprint(payload);
            const manifestItem = manifest.items[localId];
            const queuedOperation = queue.operations[localId];
            if (
                queuedOperation?.type === 'delete'
                || manifestItem?.deletedAt
                || manifestItem?.fingerprint !== fingerprint
            ) {
                if (queuedOperation?.type !== 'upsert' || queuedOperation.fingerprint !== fingerprint) {
                    queue.operations[localId] = {
                        type: 'upsert',
                        remoteId: payload.id,
                        fingerprint,
                        queuedAt: now,
                        attempts: 0
                    };
                }
            }
        });

        Object.entries(queue.operations).forEach(([localId, operation]) => {
            if (operation?.type !== 'upsert' || localById.has(localId)) return;
            delete queue.operations[localId];
        });

        this.writeManifest(user.uid, manifest);
        this.writeQueue(user.uid, queue);
        const queuedCount = Object.keys(queue.operations).length;
        this.setState({
            status: queuedCount ? MEMORY_CUE_SYNC_STATES.SYNCING : MEMORY_CUE_SYNC_STATES.CONNECTED,
            connected: true,
            queuedCount,
            error: ''
        });

        if (options.flush !== false) {
            await this.flush();
        }
        return true;
    }

    async flush() {
        if (this.flushPromise) return this.flushPromise;
        const user = this.currentUser;
        const binding = this.readBinding();
        if (!user || !binding.active || binding.uid !== user.uid) return false;
        const sessionGeneration = this.sessionGeneration;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            const queue = this.readQueue(user.uid);
            this.setState({
                status: MEMORY_CUE_SYNC_STATES.OFFLINE,
                connected: true,
                queuedCount: Object.keys(queue.operations).length
            });
            return false;
        }

        this.flushPromise = (async () => {
            while (this.isSessionCurrent(user, sessionGeneration)) {
                const queue = this.readQueue(user.uid);
                const nextEntry = Object.entries(queue.operations)[0];
                if (!nextEntry) break;
                const [localId, operation] = nextEntry;
                const manifest = this.readManifest(user.uid);

                try {
                    if (!this.isSessionCurrent(user, sessionGeneration)) return false;
                    if (operation.type === 'delete') {
                        await this.remoteAdapter.remove(user.uid, operation.remoteId);
                        if (!this.isSessionCurrent(user, sessionGeneration)) return false;
                        const currentQueue = this.readQueue(user.uid);
                        if (currentQueue.operations[localId]?.type === 'delete') {
                            delete currentQueue.operations[localId];
                            this.writeQueue(user.uid, currentQueue);
                        }
                        const currentManifest = this.readManifest(user.uid);
                        currentManifest.items[localId] = {
                            remoteId: operation.remoteId,
                            fingerprint: '',
                            deletedAt: this.now(),
                            lastAssertedAt: this.now()
                        };
                        this.writeManifest(user.uid, currentManifest);
                    } else {
                        const reminder = this.getCurrentLocalReminder(localId);
                        if (!reminder) {
                            const currentQueue = this.readQueue(user.uid);
                            if (currentQueue.operations[localId]?.type === 'upsert') {
                                delete currentQueue.operations[localId];
                                this.writeQueue(user.uid, currentQueue);
                            }
                            continue;
                        }
                        const payload = this.createPayload(reminder, user.uid);
                        const fingerprint = getPayloadFingerprint(payload);
                        await this.remoteAdapter.upsert(user.uid, payload.id, payload, {
                            createDefaults: buildMemoryCueReminderCreateDefaults(reminder)
                        });
                        if (!this.isSessionCurrent(user, sessionGeneration)) return false;
                        const currentQueue = this.readQueue(user.uid);
                        if (
                            currentQueue.operations[localId]?.type === 'upsert'
                            && currentQueue.operations[localId]?.fingerprint === fingerprint
                        ) {
                            delete currentQueue.operations[localId];
                            this.writeQueue(user.uid, currentQueue);
                        }
                        const currentManifest = this.readManifest(user.uid);
                        currentManifest.items[localId] = {
                            remoteId: payload.id,
                            fingerprint,
                            syncedAt: this.now(),
                            deletedAt: null,
                            lastAssertedAt: null
                        };
                        this.writeManifest(user.uid, currentManifest);
                    }
                } catch (error) {
                    if (!this.isSessionCurrent(user, sessionGeneration)) return false;
                    const failedQueue = this.readQueue(user.uid);
                    const failedOperation = failedQueue.operations[localId];
                    if (failedOperation) {
                        failedQueue.operations[localId] = {
                            ...failedOperation,
                            attempts: Number(failedOperation.attempts || 0) + 1,
                            lastError: normalizeText(error?.message || 'Sync failed', 300)
                        };
                        this.writeQueue(user.uid, failedQueue);
                    }
                    this.setState({
                        status: isOfflineError(error) ? MEMORY_CUE_SYNC_STATES.OFFLINE : MEMORY_CUE_SYNC_STATES.ERROR,
                        connected: true,
                        queuedCount: Object.keys(failedQueue.operations).length,
                        error: normalizeText(error?.message || 'Memory Cue sync failed.', 300)
                    });
                    return false;
                }
            }

            if (!this.isSessionCurrent(user, sessionGeneration)) return false;
            const remainingQueue = this.readQueue(user.uid);
            this.setState({
                status: MEMORY_CUE_SYNC_STATES.CONNECTED,
                connected: true,
                email: user.email || binding.email,
                queuedCount: Object.keys(remainingQueue.operations).length,
                error: ''
            });
            return true;
        })().finally(() => {
            this.flushPromise = null;
        });

        return this.flushPromise;
    }

    async retry() {
        if (!this.currentUser) return this.connect();
        await this.reconcile({ flush: true });
        return this.state.status === MEMORY_CUE_SYNC_STATES.CONNECTED;
    }

    dispose() {
        this.disposed = true;
        this.eventTarget?.removeEventListener?.('online', this.handleOnline);
        this.authUnsubscribe?.();
        this.authUnsubscribe = null;
        this.remoteUnsubscribe?.();
        this.remoteUnsubscribe = null;
        this.listeners.clear();
        this.remoteReminderListeners.clear();
    }
}

export function createMemoryCueReminderSync(options = {}) {
    return new MemoryCueReminderSync(options);
}
