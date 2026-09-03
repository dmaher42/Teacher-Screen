const RESOURCE_LIBRARY_STORAGE_KEY = 'teacherScreenResourceLibraryState';
const RESOURCE_LIBRARY_STATE_VERSION = 1;
const DEFAULT_MAX_RECENTS = 20;

const HANDLE_DATABASE_NAME = 'teacher-screen-resource-library';
const HANDLE_DATABASE_VERSION = 1;
const HANDLE_STORE_NAME = 'directory-handles';
const LOCAL_FOLDER_HANDLE_KEY = 'resources-folder';

const GOOGLE_SLIDES_MIME_TYPE = 'application/vnd.google-apps.presentation';
const FOLDER_MIME_TYPES = new Set([
    'application/vnd.google-apps.folder',
    'inode/directory'
]);
const PDF_MIME_TYPE = 'application/pdf';
const POWERPOINT_MIME_TYPES = new Set([
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);
const IMAGE_EXTENSIONS = new Set([
    'avif',
    'bmp',
    'gif',
    'heic',
    'heif',
    'jpeg',
    'jpg',
    'png',
    'svg',
    'tif',
    'tiff',
    'webp'
]);

export const RESOURCE_TYPES = Object.freeze({
    FOLDER: 'folder',
    PDF: 'pdf',
    PRESENTATION: 'presentation',
    GOOGLE_SLIDES: 'google-slides',
    IMAGE: 'image',
    OTHER: 'other'
});

export class ResourceLibraryError extends Error {
    constructor(message, code = 'resource-library-error', options = {}) {
        super(message);
        this.name = 'ResourceLibraryError';
        this.code = code;
        if (options.cause !== undefined) {
            this.cause = options.cause;
        }
    }
}

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function getExtension(name = '') {
    const cleanName = asTrimmedString(name).split(/[?#]/, 1)[0];
    const lastDot = cleanName.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === cleanName.length - 1) return '';
    return cleanName.slice(lastDot + 1).toLowerCase();
}

function getResourceUrl(resource) {
    if (!resource || typeof resource !== 'object') return '';
    const metadata = resource.metadata && typeof resource.metadata === 'object'
        ? resource.metadata
        : {};
    return asTrimmedString(
        resource.url
        || resource.webViewLink
        || resource.sourceUrl
        || resource.link
        || metadata.url
        || metadata.webViewLink
        || metadata.sourceUrl
    );
}

function isGoogleSlidesUrl(value) {
    const url = asTrimmedString(value);
    if (!url) return false;

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        return (hostname === 'docs.google.com' || hostname === 'slides.google.com')
            && parsed.pathname.toLowerCase().includes('/presentation/');
    } catch (error) {
        return /^(?:https?:\/\/)?(?:docs|slides)\.google\.com\/presentation\//i.test(url);
    }
}

/**
 * Classify a file, folder, or cloud/link metadata record into a resource type.
 * This function only uses the supplied metadata; it never opens or scans files.
 */
export function classifyResource(resource = {}) {
    const input = typeof resource === 'string'
        ? { name: resource, url: resource }
        : (resource || {});
    const declaredType = asTrimmedString(input.resourceType || input.type).toLowerCase();
    const kind = asTrimmedString(input.kind || input.handleKind).toLowerCase();
    const name = asTrimmedString(input.name || input.fileName || input.title);
    const mimeType = asTrimmedString(
        input.mimeType
        || input.mediaType
        || (declaredType.includes('/') ? declaredType : '')
    ).toLowerCase();
    const extension = getExtension(name);
    const url = getResourceUrl(input);

    if (declaredType === RESOURCE_TYPES.FOLDER
        || kind === 'directory'
        || kind === 'folder'
        || FOLDER_MIME_TYPES.has(mimeType)) {
        return RESOURCE_TYPES.FOLDER;
    }

    if (declaredType === RESOURCE_TYPES.GOOGLE_SLIDES
        || mimeType === GOOGLE_SLIDES_MIME_TYPE
        || extension === 'gslides'
        || isGoogleSlidesUrl(url)) {
        return RESOURCE_TYPES.GOOGLE_SLIDES;
    }

    if (declaredType === RESOURCE_TYPES.PDF || mimeType === PDF_MIME_TYPE || extension === 'pdf') {
        return RESOURCE_TYPES.PDF;
    }

    if (declaredType === RESOURCE_TYPES.PRESENTATION
        || POWERPOINT_MIME_TYPES.has(mimeType)
        || extension === 'ppt'
        || extension === 'pptx') {
        return RESOURCE_TYPES.PRESENTATION;
    }

    if (declaredType === RESOURCE_TYPES.IMAGE
        || mimeType.startsWith('image/')
        || IMAGE_EXTENSIONS.has(extension)) {
        return RESOURCE_TYPES.IMAGE;
    }

    return RESOURCE_TYPES.OTHER;
}

export const classifyResourceType = classifyResource;

function normalizeIdentitySegments(value) {
    if (Array.isArray(value)) {
        return value
            .map((segment) => String(segment ?? ''))
            .filter((segment) => segment.trim());
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return [trimmed];
        return trimmed.split(/[\\/]/).filter((segment) => segment.trim());
    }

    if (value === null || value === undefined) return [];
    return [String(value)];
}

/**
 * Produce an opaque, stable key from a provider and its path/id metadata.
 * Each segment is encoded separately so similarly named nested paths cannot collide.
 */
export function createResourceKey(providerOrResource, pathOrIdentity) {
    let provider = providerOrResource;
    let identity = pathOrIdentity;

    if (providerOrResource && typeof providerOrResource === 'object') {
        if (asTrimmedString(providerOrResource.key)) {
            return providerOrResource.key.trim();
        }
        provider = providerOrResource.provider || providerOrResource.providerId || 'unknown';
        const resourcePath = Array.isArray(providerOrResource.pathSegments)
            && providerOrResource.pathSegments.length > 0
            ? providerOrResource.pathSegments
            : providerOrResource.path;
        identity = resourcePath
            || providerOrResource.id
            || providerOrResource.fileId
            || getResourceUrl(providerOrResource)
            || providerOrResource.name;
    }

    const normalizedProvider = asTrimmedString(String(provider ?? 'unknown')) || 'unknown';
    const segments = normalizeIdentitySegments(identity);
    const encodedProvider = encodeURIComponent(normalizedProvider);
    const encodedIdentity = segments.length
        ? segments.map((segment) => encodeURIComponent(segment)).join('/')
        : '/';
    return `${encodedProvider}:${encodedIdentity}`;
}

export const getResourceKey = createResourceKey;

function clonePathSegments(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((segment) => typeof segment === 'string' && segment.trim())
        .map((segment) => segment);
}

function normalizeFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeLastModified(value) {
    const numericValue = normalizeFiniteNumber(value);
    if (numericValue !== null) return numericValue;
    return asTrimmedString(value) || null;
}

function toStoredResource(resource) {
    if (!resource || typeof resource !== 'object') return null;

    const provider = asTrimmedString(resource.provider || resource.providerId) || 'unknown';
    const pathSegments = clonePathSegments(resource.pathSegments);
    const name = asTrimmedString(resource.name || resource.title)
        || pathSegments[pathSegments.length - 1]
        || 'Untitled resource';
    const type = classifyResource(resource);
    const suppliedKind = asTrimmedString(resource.kind).toLowerCase();
    const kind = type === RESOURCE_TYPES.FOLDER
        ? (suppliedKind === 'directory' ? 'directory' : 'folder')
        : (suppliedKind || 'file');
    const key = asTrimmedString(resource.key) || createResourceKey({
        ...resource,
        provider,
        pathSegments,
        name
    });

    const stored = {
        provider,
        kind,
        type,
        key,
        name,
        pathSegments,
        mimeType: asTrimmedString(resource.mimeType || resource.mediaType),
        size: normalizeFiniteNumber(resource.size),
        lastModified: normalizeLastModified(resource.lastModified || resource.modifiedTime)
    };

    // Preserve only non-sensitive primitives that cloud/link providers need to reopen an item.
    const optionalStringFields = [
        'rootName',
        'rootId',
        'id',
        'fileId',
        'parentId',
        'url',
        'webViewLink',
        'webUrl',
        'sourceUrl',
        'thumbnailUrl',
        'iconUrl',
        'fileExtension',
        'modifiedTime'
    ];
    optionalStringFields.forEach((field) => {
        const value = asTrimmedString(resource[field]);
        if (value) stored[field] = value;
    });

    return stored;
}

function cloneStoredResource(resource) {
    return resource
        ? { ...resource, pathSegments: [...(resource.pathSegments || [])] }
        : null;
}

function getResourceLookupKey(resourceOrKey) {
    if (typeof resourceOrKey === 'string') return resourceOrKey.trim();
    if (!resourceOrKey || typeof resourceOrKey !== 'object') return '';
    return asTrimmedString(resourceOrKey.key) || createResourceKey(resourceOrKey);
}

function resolveStorage(explicitStorage) {
    if (explicitStorage !== undefined) return explicitStorage;
    try {
        return typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
    } catch (error) {
        return null;
    }
}

export class ResourceLibraryState {
    constructor(options = {}) {
        this.storageKey = asTrimmedString(options.storageKey) || RESOURCE_LIBRARY_STORAGE_KEY;
        this.maxRecents = Math.min(
            100,
            Math.max(1, Math.floor(Number(options.maxRecents) || DEFAULT_MAX_RECENTS))
        );
        this.storage = resolveStorage(options.storage);
        this.lastError = null;
        this.persistenceAvailable = !!this.storage;
        this._favorites = [];
        this._recents = [];
        this._load();
    }

    _load() {
        if (!this.storage || typeof this.storage.getItem !== 'function') return;

        try {
            const raw = this.storage.getItem(this.storageKey);
            if (!raw) return;
            const saved = JSON.parse(raw);
            const favorites = Array.isArray(saved?.favorites)
                ? saved.favorites.map(toStoredResource).filter(Boolean)
                : [];
            const recents = Array.isArray(saved?.recents)
                ? saved.recents.map(toStoredResource).filter(Boolean)
                : [];

            this._favorites = this._deduplicate(favorites);
            this._recents = this._deduplicate(recents).slice(0, this.maxRecents);
        } catch (error) {
            this.lastError = new ResourceLibraryError(
                'Saved resource-library preferences could not be read. New changes will remain available for this session.',
                'state-read-failed',
                { cause: error }
            );
        }
    }

    _deduplicate(resources) {
        const seen = new Set();
        return resources.filter((resource) => {
            if (!resource?.key || seen.has(resource.key)) return false;
            seen.add(resource.key);
            return true;
        });
    }

    _persist() {
        if (!this.storage || typeof this.storage.setItem !== 'function') {
            this.persistenceAvailable = false;
            return false;
        }

        try {
            this.storage.setItem(this.storageKey, JSON.stringify({
                version: RESOURCE_LIBRARY_STATE_VERSION,
                favorites: this._favorites,
                recents: this._recents
            }));
            this.persistenceAvailable = true;
            this.lastError = null;
            return true;
        } catch (error) {
            this.persistenceAvailable = false;
            this.lastError = new ResourceLibraryError(
                'Resource-library preferences could not be saved. They will remain available for this session.',
                'state-write-failed',
                { cause: error }
            );
            return false;
        }
    }

    isFavorite(resourceOrKey) {
        const key = getResourceLookupKey(resourceOrKey);
        return !!key && this._favorites.some((resource) => resource.key === key);
    }

    toggleFavorite(resource) {
        const stored = toStoredResource(resource);
        if (!stored) return false;

        const existingIndex = this._favorites.findIndex((item) => item.key === stored.key);
        if (existingIndex >= 0) {
            this._favorites.splice(existingIndex, 1);
            this._persist();
            return false;
        }

        this._favorites.unshift(stored);
        this._persist();
        return true;
    }

    getFavorites() {
        return this._favorites.map(cloneStoredResource);
    }

    recordRecent(resource) {
        const stored = toStoredResource(resource);
        if (!stored || stored.type === RESOURCE_TYPES.FOLDER) return this.getRecents();

        this._recents = [
            stored,
            ...this._recents.filter((item) => item.key !== stored.key)
        ].slice(0, this.maxRecents);
        this._persist();
        return this.getRecents();
    }

    getRecents() {
        return this._recents.map(cloneStoredResource);
    }

    clearRecent() {
        this._recents = [];
        this._persist();
    }

    getStatus() {
        return {
            persistenceAvailable: this.persistenceAvailable,
            favoriteCount: this._favorites.length,
            recentCount: this._recents.length,
            error: this.lastError
                ? { code: this.lastError.code, message: this.lastError.message }
                : null
        };
    }

    // British-spelling aliases keep this service friendly to existing project copy.
    isFavourite(resourceOrKey) {
        return this.isFavorite(resourceOrKey);
    }

    toggleFavourite(resource) {
        return this.toggleFavorite(resource);
    }

    getFavourites() {
        return this.getFavorites();
    }

    addRecent(resource) {
        return this.recordRecent(resource);
    }

    clearRecents() {
        this.clearRecent();
    }
}

let handleDatabasePromise = null;

function getIndexedDb() {
    try {
        return typeof globalThis !== 'undefined' ? globalThis.indexedDB : null;
    } catch (error) {
        return null;
    }
}

function waitForRequest(request, message, code) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(new ResourceLibraryError(
            message,
            code,
            { cause: request.error }
        ));
    });
}

function waitForTransaction(transaction, message, code) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new ResourceLibraryError(
            message,
            code,
            { cause: transaction.error }
        ));
        transaction.onabort = () => reject(new ResourceLibraryError(
            message,
            code,
            { cause: transaction.error }
        ));
    });
}

function openHandleDatabase() {
    if (handleDatabasePromise) return handleDatabasePromise;
    const indexedDb = getIndexedDb();
    if (!indexedDb || typeof indexedDb.open !== 'function') {
        return Promise.reject(new ResourceLibraryError(
            'This browser cannot remember the selected resources folder.',
            'handle-storage-unavailable'
        ));
    }

    handleDatabasePromise = new Promise((resolve, reject) => {
        const request = indexedDb.open(HANDLE_DATABASE_NAME, HANDLE_DATABASE_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(HANDLE_STORE_NAME)) {
                request.result.createObjectStore(HANDLE_STORE_NAME);
            }
        };
        request.onerror = () => reject(new ResourceLibraryError(
            'Teacher Screen could not open its saved folder connection.',
            'handle-database-open-failed',
            { cause: request.error }
        ));
        request.onblocked = () => reject(new ResourceLibraryError(
            'The saved folder connection is blocked by another open Teacher Screen tab.',
            'handle-database-blocked'
        ));
        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => {
                database.close();
                handleDatabasePromise = null;
            };
            resolve(database);
        };
    }).catch((error) => {
        handleDatabasePromise = null;
        throw error;
    });

    return handleDatabasePromise;
}

function createLocalRootId() {
    try {
        if (typeof globalThis?.crypto?.randomUUID === 'function') {
            return `local-root:${globalThis.crypto.randomUUID()}`;
        }
    } catch (error) {
        // The timestamp/random fallback below is sufficient for local namespacing.
    }
    return `local-root:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function saveDirectoryHandle(handle, rootId, connectionKey = LOCAL_FOLDER_HANDLE_KEY) {
    const database = await openHandleDatabase();
    const transaction = database.transaction(HANDLE_STORE_NAME, 'readwrite');
    transaction.objectStore(HANDLE_STORE_NAME).put({
        handle,
        rootId: asTrimmedString(rootId) || createLocalRootId()
    }, asTrimmedString(connectionKey) || LOCAL_FOLDER_HANDLE_KEY);
    await waitForTransaction(
        transaction,
        'Teacher Screen could not remember the selected resources folder.',
        'handle-save-failed'
    );
}

async function loadDirectoryHandle(connectionKey = LOCAL_FOLDER_HANDLE_KEY) {
    const database = await openHandleDatabase();
    const transaction = database.transaction(HANDLE_STORE_NAME, 'readonly');
    return waitForRequest(
        transaction.objectStore(HANDLE_STORE_NAME).get(asTrimmedString(connectionKey) || LOCAL_FOLDER_HANDLE_KEY),
        'Teacher Screen could not restore the selected resources folder.',
        'handle-restore-failed'
    );
}

function getDirectoryPicker() {
    try {
        return typeof globalThis !== 'undefined' && typeof globalThis.showDirectoryPicker === 'function'
            ? globalThis.showDirectoryPicker.bind(globalThis)
            : null;
    } catch (error) {
        return null;
    }
}

function normalizePathSegments(pathOrResource, options = {}) {
    let value = pathOrResource;
    if (pathOrResource && typeof pathOrResource === 'object' && !Array.isArray(pathOrResource)) {
        value = pathOrResource.pathSegments;
    }

    let segments;
    if (Array.isArray(value)) {
        segments = value;
    } else if (typeof value === 'string') {
        segments = value.split('/');
    } else if (value === undefined || value === null) {
        segments = [];
    } else {
        throw new ResourceLibraryError('The resource path is invalid.', 'invalid-path');
    }

    const normalized = segments.map((segment) => String(segment ?? ''));
    const hasInvalidSegment = normalized.some((segment) => (
        !segment.trim()
        || segment === '.'
        || segment === '..'
        || segment.includes('/')
        || segment.includes('\\')
        || segment.includes('\0')
    ));

    if (hasInvalidSegment || (options.requireFile && normalized.length === 0)) {
        throw new ResourceLibraryError('The resource path is invalid.', 'invalid-path');
    }
    return normalized;
}

function mapFileSystemError(error, fallbackMessage) {
    if (error instanceof ResourceLibraryError) return error;
    const name = asTrimmedString(error?.name);
    if (name === 'NotFoundError') {
        return new ResourceLibraryError(
            'That resource is no longer in the selected folder.',
            'resource-not-found',
            { cause: error }
        );
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return new ResourceLibraryError(
            'Teacher Screen needs permission to reopen the selected resources folder.',
            'permission-required',
            { cause: error }
        );
    }
    if (name === 'TypeMismatchError') {
        return new ResourceLibraryError(
            'The selected resource is not the expected file or folder type.',
            'resource-type-mismatch',
            { cause: error }
        );
    }
    return new ResourceLibraryError(
        fallbackMessage,
        'file-system-error',
        { cause: error }
    );
}

export class LocalFolderResourceProvider {
    constructor(options = {}) {
        this.provider = 'local';
        this.pickerId = asTrimmedString(options.pickerId) || 'teacher-screen-resources';
        this.connectionKey = asTrimmedString(options.connectionKey) || LOCAL_FOLDER_HANDLE_KEY;
        this.startIn = asTrimmedString(options.startIn) || 'documents';
        this.directoryHandle = null;
        this.rootId = '';
        this.permission = 'unknown';
        this.lastError = null;
        this.persistenceWarning = null;
        this._state = this.isSupported() ? 'idle' : 'unsupported';
        this._detail = this.isSupported()
            ? 'Choose the folder where your teaching resources are stored.'
            : 'Local folder access requires a current version of Chrome or Edge.';
    }

    isSupported() {
        return !!getDirectoryPicker();
    }

    clearError() {
        this.lastError = null;
        if (this.directoryHandle && this.permission === 'granted') {
            this._setStatus('connected', `Connected to ${this.directoryHandle.name}.`);
        } else if (this.directoryHandle) {
            this._setStatus('permission-required', `Reconnect ${this.directoryHandle.name} to view its resources.`);
        } else if (this.isSupported()) {
            this._setStatus('idle', 'Choose the folder where your teaching resources are stored.');
        } else {
            this._setStatus('unsupported', 'Local folder access requires a current version of Chrome or Edge.');
        }
    }

    getLastError() {
        return this.lastError
            ? { code: this.lastError.code, message: this.lastError.message }
            : null;
    }

    getStatus() {
        const supported = this.isSupported();
        const connected = !!this.directoryHandle && this.permission === 'granted';
        const labels = {
            unsupported: 'Local folder unavailable',
            idle: 'No folder linked',
            restoring: 'Checking saved folder',
            connecting: 'Choosing folder',
            connected: 'Local folder connected',
            'permission-required': 'Reconnect folder',
            'permission-denied': 'Folder permission denied',
            error: 'Local folder error'
        };

        return {
            state: this._state,
            label: labels[this._state] || labels.error,
            detail: this._detail,
            connected,
            configured: supported,
            supported,
            permission: this.permission,
            folderName: this.directoryHandle?.name || '',
            rootId: this.rootId,
            canReconnect: supported && !!this.directoryHandle,
            persistenceWarning: this.persistenceWarning
                ? this.persistenceWarning.message
                : '',
            error: this.getLastError()
        };
    }

    _setStatus(state, detail) {
        this._state = state;
        this._detail = detail;
    }

    _setError(error, detail = error?.message) {
        this.lastError = error instanceof ResourceLibraryError
            ? error
            : new ResourceLibraryError(detail || 'The local resources folder could not be opened.', 'local-folder-error', { cause: error });
        this._setStatus('error', detail || this.lastError.message);
        return this.lastError;
    }

    async queryPermission(handle = this.directoryHandle) {
        if (!handle) return 'unknown';
        if (typeof handle.queryPermission !== 'function') {
            this.permission = 'granted';
            return this.permission;
        }

        try {
            this.permission = await handle.queryPermission({ mode: 'read' });
            return this.permission;
        } catch (error) {
            this.permission = 'unknown';
            return this.permission;
        }
    }

    async requestPermission(handle = this.directoryHandle) {
        if (!handle) return 'unknown';
        if (typeof handle.requestPermission !== 'function') {
            this.permission = 'granted';
            return this.permission;
        }

        try {
            this.permission = await handle.requestPermission({ mode: 'read' });
            return this.permission;
        } catch (error) {
            this.permission = 'denied';
            return this.permission;
        }
    }

    async restore() {
        if (!this.isSupported()) {
            this._setStatus('unsupported', 'Local folder access requires a current version of Chrome or Edge.');
            return this.getStatus();
        }

        this.lastError = null;

        // Keep a live connection when the teacher switches between resource
        // tabs. This also protects browsers that can use a folder for the
        // current session but cannot persist its handle in IndexedDB.
        if (this.directoryHandle?.kind === 'directory') {
            if (!this.rootId) this.rootId = createLocalRootId();
            const permission = await this.queryPermission(this.directoryHandle);
            if (permission === 'granted') {
                this._setStatus('connected', `Connected to ${this.directoryHandle.name}.`);
            } else {
                this._setStatus('permission-required', `Reconnect ${this.directoryHandle.name} to view its resources.`);
            }
            return this.getStatus();
        }

        this._setStatus('restoring', 'Checking for your saved resources folder.');
        try {
            const storedConnection = await loadDirectoryHandle(this.connectionKey);
            const handle = storedConnection?.handle?.kind === 'directory'
                ? storedConnection.handle
                : storedConnection;
            if (!handle || handle.kind !== 'directory') {
                this.directoryHandle = null;
                this.rootId = '';
                this.permission = 'unknown';
                this._setStatus('idle', 'Choose the folder where your teaching resources are stored.');
                return this.getStatus();
            }

            this.directoryHandle = handle;
            this.rootId = asTrimmedString(storedConnection?.rootId) || createLocalRootId();
            if (!storedConnection?.rootId) {
                try {
                    await saveDirectoryHandle(handle, this.rootId, this.connectionKey);
                } catch (error) {
                    this.persistenceWarning = error;
                }
            }
            const permission = await this.queryPermission(handle);
            if (permission === 'granted') {
                this._setStatus('connected', `Connected to ${handle.name}.`);
            } else {
                this._setStatus('permission-required', `Reconnect ${handle.name} to view its resources.`);
            }
            return this.getStatus();
        } catch (error) {
            if (error?.code === 'handle-storage-unavailable') {
                this._setStatus('idle', 'Choose the folder where your teaching resources are stored.');
                this.persistenceWarning = error;
                return this.getStatus();
            }
            this._setError(error, 'Teacher Screen could not restore the saved resources folder.');
            return this.getStatus();
        }
    }

    async connect() {
        const picker = getDirectoryPicker();
        if (!picker) {
            const error = new ResourceLibraryError(
                'Local folder access requires a current version of Chrome or Edge.',
                'folder-picker-unavailable'
            );
            this._setError(error);
            throw error;
        }

        // A restored handle can be re-authorised without making the teacher
        // find and choose the same folder again. A currently connected handle
        // still opens the picker so the dashboard's "Change folder" action works.
        if (this.directoryHandle && this.permission !== 'granted') {
            return this.reconnect();
        }

        const previousHandle = this.directoryHandle;
        const previousRootId = this.rootId;
        const previousPermission = this.permission;
        this.lastError = null;
        this.persistenceWarning = null;
        this._setStatus('connecting', 'Choose the folder where your teaching resources are stored.');

        let handle;
        try {
            handle = await picker({
                id: this.pickerId,
                mode: 'read',
                startIn: this.startIn
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.directoryHandle = previousHandle;
                this.rootId = previousRootId;
                this.permission = previousPermission;
                if (previousHandle && previousPermission === 'granted') {
                    this._setStatus('connected', `Connected to ${previousHandle.name}.`);
                } else if (previousHandle) {
                    this._setStatus('permission-required', `Reconnect ${previousHandle.name} to view its resources.`);
                } else {
                    this._setStatus('idle', 'Folder selection was cancelled.');
                }
                return this.getStatus();
            }
            const mapped = mapFileSystemError(error, 'The resources folder could not be selected.');
            this._setError(mapped);
            throw mapped;
        }

        if (!handle || handle.kind !== 'directory') {
            const error = new ResourceLibraryError('Please choose a folder for your teaching resources.', 'invalid-directory-handle');
            this._setError(error);
            throw error;
        }

        this.directoryHandle = handle;
        let isSameRoot = false;
        if (previousHandle && typeof handle.isSameEntry === 'function') {
            try {
                isSameRoot = await handle.isSameEntry(previousHandle);
            } catch (error) {
                isSameRoot = false;
            }
        }
        this.rootId = isSameRoot && previousRootId
            ? previousRootId
            : createLocalRootId();
        let permission = await this.queryPermission(handle);
        if (permission !== 'granted') {
            permission = await this.requestPermission(handle);
        }

        try {
            await saveDirectoryHandle(handle, this.rootId, this.connectionKey);
        } catch (error) {
            // The live folder remains usable even when the browser cannot persist the handle.
            this.persistenceWarning = error;
        }

        if (permission !== 'granted') {
            this._setStatus('permission-denied', `Permission to open ${handle.name} was not granted.`);
            return this.getStatus();
        }

        this._setStatus('connected', `Connected to ${handle.name}.`);
        return this.getStatus();
    }

    async reconnect() {
        if (!this.isSupported()) return this.restore();
        if (!this.directoryHandle) {
            await this.restore();
        }
        if (!this.directoryHandle) {
            return this.connect();
        }

        this.lastError = null;
        const permission = await this.requestPermission(this.directoryHandle);
        if (permission !== 'granted') {
            this._setStatus('permission-denied', `Permission to open ${this.directoryHandle.name} was not granted.`);
            return this.getStatus();
        }

        this._setStatus('connected', `Connected to ${this.directoryHandle.name}.`);
        return this.getStatus();
    }

    async _getConnectedHandle() {
        if (!this.directoryHandle) {
            await this.restore();
        }

        if (!this.directoryHandle) {
            throw new ResourceLibraryError(
                'Choose a local resources folder first.',
                'folder-not-connected'
            );
        }

        const permission = await this.queryPermission(this.directoryHandle);
        if (permission !== 'granted') {
            this._setStatus('permission-required', `Reconnect ${this.directoryHandle.name} to view its resources.`);
            throw new ResourceLibraryError(
                'Reconnect the selected resources folder to continue.',
                'permission-required'
            );
        }

        if (!this.rootId) this.rootId = createLocalRootId();
        this._setStatus('connected', `Connected to ${this.directoryHandle.name}.`);
        return this.directoryHandle;
    }

    async _resolveDirectory(rootHandle, pathSegments) {
        let current = rootHandle;
        for (const segment of pathSegments) {
            current = await current.getDirectoryHandle(segment, { create: false });
        }
        return current;
    }

    async createFolder(name, pathSegments = []) {
        const folderName = asTrimmedString(name);
        normalizePathSegments([folderName]);
        const normalizedPath = normalizePathSegments(pathSegments);

        if (!this.directoryHandle || this.permission !== 'granted') {
            throw new ResourceLibraryError(
                'Reconnect the selected resources folder before creating a folder.',
                'permission-required'
            );
        }

        let writePermission = typeof this.directoryHandle.queryPermission === 'function'
            ? 'prompt'
            : (typeof this.directoryHandle.requestPermission === 'function' ? 'prompt' : 'granted');
        if (typeof this.directoryHandle.queryPermission === 'function') {
            try {
                writePermission = await this.directoryHandle.queryPermission({ mode: 'readwrite' });
            } catch (error) {
                writePermission = 'prompt';
            }
        }
        if (writePermission !== 'granted' && typeof this.directoryHandle.requestPermission === 'function') {
            try {
                writePermission = await this.directoryHandle.requestPermission({ mode: 'readwrite' });
            } catch (error) {
                writePermission = 'denied';
            }
        }
        if (writePermission !== 'granted') {
            throw new ResourceLibraryError(
                'Allow editing for the selected resources folder to create a new folder.',
                'write-permission-required'
            );
        }

        try {
            const directory = await this._resolveDirectory(this.directoryHandle, normalizedPath);
            if (typeof directory.getDirectoryHandle !== 'function') {
                throw new ResourceLibraryError(
                    'This browser cannot create folders in the selected location.',
                    'folder-creation-unavailable'
                );
            }

            try {
                await directory.getDirectoryHandle(folderName, { create: false });
                throw new ResourceLibraryError(
                    `A folder named "${folderName}" already exists here.`,
                    'folder-already-exists'
                );
            } catch (error) {
                if (error instanceof ResourceLibraryError) throw error;
                if (error?.name !== 'NotFoundError') throw error;
            }

            await directory.getDirectoryHandle(folderName, { create: true });
            this.lastError = null;
            return folderName;
        } catch (error) {
            const mapped = mapFileSystemError(error, 'The new resource folder could not be created.');
            this.lastError = mapped;
            throw mapped;
        }
    }

    async list(pathSegments = []) {
        const normalizedPath = normalizePathSegments(pathSegments);
        const rootHandle = await this._getConnectedHandle();

        try {
            const directory = await this._resolveDirectory(rootHandle, normalizedPath);
            if (typeof directory.entries !== 'function') {
                throw new ResourceLibraryError(
                    'This browser cannot list files in the selected folder.',
                    'folder-listing-unavailable'
                );
            }

            const resources = [];
            for await (const [entryName, entryHandle] of directory.entries()) {
                const entryPath = [...normalizedPath, entryName];
                if (entryHandle.kind === 'directory') {
                    resources.push({
                        provider: this.provider,
                        kind: 'directory',
                        type: RESOURCE_TYPES.FOLDER,
                        key: createResourceKey(this.provider, [this.rootId, ...entryPath]),
                        name: entryName,
                        rootName: rootHandle.name,
                        rootId: this.rootId,
                        pathSegments: entryPath,
                        mimeType: '',
                        size: null,
                        lastModified: null
                    });
                    continue;
                }

                let file = null;
                try {
                    file = await entryHandle.getFile();
                } catch (error) {
                    // Keep the entry visible if it changed while the folder was being listed.
                }
                const metadata = {
                    provider: this.provider,
                    kind: 'file',
                    name: entryName,
                    rootName: rootHandle.name,
                    rootId: this.rootId,
                    pathSegments: entryPath,
                    mimeType: asTrimmedString(file?.type),
                    size: normalizeFiniteNumber(file?.size),
                    lastModified: normalizeFiniteNumber(file?.lastModified)
                };
                resources.push({
                    ...metadata,
                    type: classifyResource(metadata),
                    key: createResourceKey(this.provider, [this.rootId, ...entryPath])
                });
            }

            resources.sort((left, right) => {
                const folderOrder = Number(right.type === RESOURCE_TYPES.FOLDER)
                    - Number(left.type === RESOURCE_TYPES.FOLDER);
                return folderOrder || left.name.localeCompare(right.name, undefined, {
                    numeric: true,
                    sensitivity: 'base'
                });
            });
            this.lastError = null;
            return resources;
        } catch (error) {
            const mapped = mapFileSystemError(error, 'The selected resources folder could not be read.');
            this.lastError = mapped;
            throw mapped;
        }
    }

    async getFile(resourceOrPath) {
        if (resourceOrPath && typeof resourceOrPath === 'object' && !Array.isArray(resourceOrPath)) {
            if (resourceOrPath.provider && resourceOrPath.provider !== this.provider) {
                throw new ResourceLibraryError('That resource belongs to a different storage provider.', 'provider-mismatch');
            }
            if (resourceOrPath.type === RESOURCE_TYPES.FOLDER || resourceOrPath.kind === 'directory') {
                throw new ResourceLibraryError('Choose a file rather than a folder.', 'resource-is-folder');
            }
        }

        const pathSegments = normalizePathSegments(resourceOrPath, { requireFile: true });
        const rootHandle = await this._getConnectedHandle();
        const expectedRootId = resourceOrPath && typeof resourceOrPath === 'object'
            ? asTrimmedString(resourceOrPath.rootId)
            : '';
        const expectedRootName = resourceOrPath && typeof resourceOrPath === 'object'
            ? asTrimmedString(resourceOrPath.rootName)
            : '';
        if ((expectedRootId && expectedRootId !== this.rootId)
            || (!expectedRootId && expectedRootName && expectedRootName !== rootHandle.name)) {
            throw new ResourceLibraryError(
                expectedRootName
                    ? `This resource belongs to the "${expectedRootName}" folder. Reconnect that folder to open it.`
                    : 'This resource belongs to a different linked folder. Reconnect that folder to open it.',
                'resource-root-mismatch'
            );
        }
        const parentPath = pathSegments.slice(0, -1);
        const fileName = pathSegments[pathSegments.length - 1];

        try {
            const directory = await this._resolveDirectory(rootHandle, parentPath);
            const fileHandle = await directory.getFileHandle(fileName, { create: false });
            return await fileHandle.getFile();
        } catch (error) {
            const mapped = mapFileSystemError(error, 'The selected resource file could not be opened.');
            this.lastError = mapped;
            throw mapped;
        }
    }
}
