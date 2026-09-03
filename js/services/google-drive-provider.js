const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GOOGLE_API_SCRIPT_URL = 'https://apis.google.com/js/api.js';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_SLIDES_MIME_TYPE = 'application/vnd.google-apps.presentation';
const GOOGLE_DOCS_MIME_TYPE = 'application/vnd.google-apps.document';
const GOOGLE_NATIVE_MIME_PREFIX = 'application/vnd.google-apps.';
const DEFAULT_FOLDER_NAME = 'Teacher Screen Resources';
const ROOT_FOLDER_TAG_KEY = 'teacherScreenResourceRoot';
const ROOT_FOLDER_TAG_VALUE = 'true';
const PROVIDER_TAG_KEY = 'teacherScreenProvider';
const PROVIDER_TAG_VALUE = 'google-drive';
const REQUEST_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const AUTH_TIMEOUT_MS = 120000;
const SCRIPT_TIMEOUT_MS = 20000;

const FILE_FIELDS = [
    'id',
    'name',
    'mimeType',
    'size',
    'modifiedTime',
    'createdTime',
    'parents',
    'webViewLink',
    'webContentLink',
    'iconLink',
    'thumbnailLink',
    'fileExtension',
    'appProperties',
    'capabilities(canDownload)'
].join(',');

const PICKER_MIME_TYPES = [
    'application/pdf',
    GOOGLE_SLIDES_MIME_TYPE,
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp'
];

let identityLibraryPromise = null;
let pickerLibraryPromise = null;

function cleanText(value, maxLength = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function getBrowserWindow() {
    return typeof window === 'undefined' ? null : window;
}

function getPublicConfiguration() {
    const browserWindow = getBrowserWindow();
    const source = browserWindow?.TEACHER_SCREEN_GOOGLE_DRIVE;
    const config = source && typeof source === 'object' ? source : {};

    return Object.freeze({
        clientId: cleanText(config.clientId, 500),
        apiKey: cleanText(config.apiKey, 500),
        appId: cleanText(config.appId, 200),
        folderName: cleanText(config.folderName, 200) || DEFAULT_FOLDER_NAME
    });
}

function isBrowserOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function escapeDriveQueryValue(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

function parsePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isFolderMimeType(mimeType) {
    return mimeType === FOLDER_MIME_TYPE;
}

function isGoogleNativeMimeType(mimeType) {
    return String(mimeType || '').startsWith(GOOGLE_NATIVE_MIME_PREFIX);
}

function getResourceType(mimeType, name = '') {
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    const normalizedName = String(name || '').toLowerCase();

    if (isFolderMimeType(normalizedMimeType)) {
        return 'folder';
    }
    if (normalizedMimeType === GOOGLE_SLIDES_MIME_TYPE) {
        return 'google-slides';
    }
    if (normalizedMimeType === 'application/pdf' || normalizedName.endsWith('.pdf')) {
        return 'pdf';
    }
    if (
        normalizedMimeType === 'application/vnd.ms-powerpoint'
        || normalizedMimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        || normalizedName.endsWith('.ppt')
        || normalizedName.endsWith('.pptx')
    ) {
        return 'presentation';
    }
    if (
        normalizedMimeType === GOOGLE_DOCS_MIME_TYPE
        || normalizedMimeType === 'application/msword'
        || normalizedMimeType === 'application/rtf'
        || normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || normalizedName.endsWith('.doc')
        || normalizedName.endsWith('.docx')
        || normalizedName.endsWith('.rtf')
    ) {
        return 'document';
    }
    if (normalizedMimeType.startsWith('image/')) {
        return 'image';
    }
    return 'other';
}

function getGoogleSlidesUrl(fileId) {
    return fileId
        ? `https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/edit`
        : '';
}

function normalizePathSegments(value) {
    if (Array.isArray(value)) {
        return value.map((segment) => cleanText(segment, 250)).filter(Boolean);
    }

    return String(value || '')
        .split('/')
        .map((segment) => cleanText(segment, 250))
        .filter(Boolean);
}

function normalizeDriveResource(file, pathSegments = []) {
    const source = file && typeof file === 'object' ? file : {};
    const id = cleanText(source.id, 500);
    const name = cleanText(source.name, 500) || 'Untitled resource';
    const mimeType = cleanText(source.mimeType, 250) || 'application/octet-stream';
    const kind = isFolderMimeType(mimeType) ? 'folder' : 'file';
    const type = getResourceType(mimeType, name);
    const webUrl = cleanText(
        source.webViewLink
            || source.webUrl
            || source.url
            || (type === 'google-slides' ? getGoogleSlidesUrl(id) : ''),
        2000
    );
    const rawModifiedTime = source.modifiedTime ?? source.lastModified;
    const numericModifiedTime = typeof rawModifiedTime === 'number'
        || /^\d+$/.test(String(rawModifiedTime || ''))
        ? Number(rawModifiedTime)
        : Number.NaN;
    const modifiedTimestamp = Number.isFinite(numericModifiedTime)
        ? numericModifiedTime
        : Date.parse(String(rawModifiedTime || ''));
    const modifiedTime = cleanText(source.modifiedTime, 100)
        || (Number.isFinite(modifiedTimestamp) ? new Date(modifiedTimestamp).toISOString() : '');
    const parentPath = normalizePathSegments(pathSegments);

    return {
        provider: 'google-drive',
        kind,
        type,
        key: `google-drive:${id}`,
        id,
        name,
        mimeType,
        size: parsePositiveInteger(source.size),
        lastModified: Number.isFinite(modifiedTimestamp) ? modifiedTimestamp : null,
        modifiedTime,
        pathSegments: [...parentPath, name],
        sourceUrl: webUrl,
        webUrl,
        parents: Array.isArray(source.parents) ? [...source.parents] : [],
        fileExtension: cleanText(source.fileExtension, 100),
        iconUrl: cleanText(source.iconLink, 2000),
        thumbnailUrl: cleanText(source.thumbnailLink, 2000),
        canDownload: source.capabilities?.canDownload !== false,
        appProperties: source.appProperties && typeof source.appProperties === 'object'
            ? { ...source.appProperties }
            : {}
    };
}

function getApiErrorMessage(status, fallbackMessage = '') {
    if (status === 401) {
        return 'Your Google Drive connection has expired. Reconnect Google Drive and try again.';
    }
    if (status === 403) {
        return 'Google Drive did not allow that action. Check that Drive access is enabled for this app, then reconnect.';
    }
    if (status === 404) {
        return 'That Google Drive resource is no longer available. It may have been moved or deleted.';
    }
    if (status === 429) {
        return 'Google Drive is busy right now. Wait a moment and try again.';
    }
    if (status >= 500) {
        return 'Google Drive is temporarily unavailable. Please try again shortly.';
    }
    return cleanText(fallbackMessage, 500) || `Google Drive could not complete the request (error ${status}).`;
}

function createScriptLoadError(name, cause = null) {
    return new GoogleDriveProviderError(
        `${name} could not be loaded. Check the internet connection and any browser content blockers, then try again.`,
        'script_load_failed',
        { cause }
    );
}

function loadExternalScript(src, isReady, label) {
    if (isReady()) {
        return Promise.resolve();
    }

    const browserWindow = getBrowserWindow();
    if (!browserWindow?.document) {
        return Promise.reject(new GoogleDriveProviderError(
            `${label} is only available in a web browser.`,
            'browser_required'
        ));
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        let script = Array.from(browserWindow.document.scripts || [])
            .find((candidate) => candidate.src === src);

        const finish = (error = null) => {
            if (settled) {
                return;
            }
            settled = true;
            browserWindow.clearTimeout(timeoutId);
            script?.removeEventListener('load', handleLoad);
            script?.removeEventListener('error', handleError);
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        const handleLoad = () => {
            if (isReady()) {
                finish();
            } else {
                finish(createScriptLoadError(label));
            }
        };
        const handleError = (event) => finish(createScriptLoadError(label, event));
        const timeoutId = browserWindow.setTimeout(
            () => finish(createScriptLoadError(label)),
            SCRIPT_TIMEOUT_MS
        );

        if (!script) {
            script = browserWindow.document.createElement('script');
            script.src = src;
            script.async = true;
            script.defer = true;
            script.dataset.teacherScreenGoogleLibrary = label;
            browserWindow.document.head.appendChild(script);
        }

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });

        // Another part of the page may have loaded the same script just before
        // the event listeners above were attached.
        if (isReady()) {
            finish();
        }
    });
}

async function loadIdentityLibrary() {
    const browserWindow = getBrowserWindow();
    if (browserWindow?.google?.accounts?.oauth2) {
        return browserWindow.google.accounts.oauth2;
    }

    if (!identityLibraryPromise) {
        identityLibraryPromise = loadExternalScript(
            GOOGLE_IDENTITY_SCRIPT_URL,
            () => Boolean(getBrowserWindow()?.google?.accounts?.oauth2),
            'Google sign-in'
        ).then(() => getBrowserWindow().google.accounts.oauth2)
            .catch((error) => {
                identityLibraryPromise = null;
                throw error;
            });
    }

    return identityLibraryPromise;
}

async function loadPickerLibrary() {
    const browserWindow = getBrowserWindow();
    if (browserWindow?.google?.picker) {
        return browserWindow.google.picker;
    }

    if (!pickerLibraryPromise) {
        pickerLibraryPromise = (async () => {
            await loadExternalScript(
                GOOGLE_API_SCRIPT_URL,
                () => Boolean(getBrowserWindow()?.gapi?.load),
                'Google Picker'
            );

            const currentWindow = getBrowserWindow();
            await new Promise((resolve, reject) => {
                let settled = false;
                const finish = (error = null) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    currentWindow.clearTimeout(timeoutId);
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                };
                const timeoutId = currentWindow.setTimeout(
                    () => finish(createScriptLoadError('Google Picker')),
                    SCRIPT_TIMEOUT_MS
                );

                try {
                    currentWindow.gapi.load('picker', {
                        callback: () => finish(),
                        onerror: () => finish(createScriptLoadError('Google Picker')),
                        timeout: SCRIPT_TIMEOUT_MS,
                        ontimeout: () => finish(createScriptLoadError('Google Picker'))
                    });
                } catch (error) {
                    finish(createScriptLoadError('Google Picker', error));
                }
            });

            if (!currentWindow.google?.picker) {
                throw createScriptLoadError('Google Picker');
            }
            return currentWindow.google.picker;
        })().catch((error) => {
            pickerLibraryPromise = null;
            throw error;
        });
    }

    return pickerLibraryPromise;
}

export class GoogleDriveProviderError extends Error {
    constructor(message, code = 'google_drive_error', options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = 'GoogleDriveProviderError';
        this.code = code;
        this.status = options.status || null;
        this.retryable = options.retryable === true;
    }
}

export class GoogleDriveResourceProvider {
    constructor() {
        this.config = getPublicConfiguration();
        this.accessToken = '';
        this.accessTokenExpiresAt = 0;
        this.tokenClient = null;
        this.connectPromise = null;
        this.rootFolderId = '';
        this.rootFolderResource = null;
        this.statusState = this.config.clientId ? 'disconnected' : 'unconfigured';
        this.statusDetail = this.config.clientId
            ? 'Connect Google Drive to browse teaching resources.'
            : 'Google Drive has not been configured for this Teacher Screen deployment.';
    }

    getConfigurationStatus() {
        const missing = [];
        if (!this.config.clientId) {
            missing.push('clientId');
        }
        if (!this.config.apiKey) {
            missing.push('apiKey');
        }
        if (!this.config.appId) {
            missing.push('appId');
        }

        const configured = Boolean(this.config.clientId);
        const pickerConfigured = Boolean(this.config.clientId && this.config.apiKey && this.config.appId);
        let detail = 'Google Drive is ready to connect.';
        if (!configured) {
            detail = 'Add a Google OAuth client ID to enable Google Drive.';
        } else if (!pickerConfigured) {
            detail = 'Folder browsing is available after connection. Add an API key and app ID to enable the Google file picker.';
        }

        return {
            state: configured ? 'ready' : 'unconfigured',
            label: 'Google Drive',
            detail,
            configured,
            pickerConfigured,
            missing,
            folderName: this.config.folderName,
            scope: DRIVE_FILE_SCOPE
        };
    }

    getStatus() {
        const configuration = this.getConfigurationStatus();
        const tokenIsValid = this.hasValidAccessToken();

        if (!configuration.configured) {
            this.statusState = 'unconfigured';
            this.statusDetail = 'Google Drive has not been configured for this Teacher Screen deployment.';
        } else if (!isBrowserOnline()) {
            this.statusState = 'offline';
            this.statusDetail = 'You appear to be offline. Reconnect to the internet to use Google Drive.';
        } else if (this.statusState === 'offline') {
            this.statusState = tokenIsValid ? 'connected' : 'disconnected';
            this.statusDetail = tokenIsValid
                ? 'Connected to Google Drive.'
                : 'Connect Google Drive to browse teaching resources.';
        } else if (this.statusState === 'connected' && !tokenIsValid) {
            this.statusState = 'disconnected';
            this.statusDetail = 'Your Google Drive session ended. Reconnect to continue.';
        }

        const labels = {
            unconfigured: 'Google Drive setup required',
            disconnected: 'Google Drive not connected',
            connecting: 'Connecting Google Drive',
            connected: 'Google Drive connected',
            offline: 'Google Drive offline',
            error: 'Google Drive error'
        };

        return {
            state: this.statusState,
            label: labels[this.statusState] || labels.error,
            detail: this.statusDetail,
            connected: tokenIsValid,
            configured: configuration.configured,
            pickerConfigured: configuration.pickerConfigured,
            folderName: configuration.folderName,
            rootFolderId: this.rootFolderId || null
        };
    }

    async connect() {
        this.assertConfigured();
        this.assertOnline();

        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = this.connectInternal();
        try {
            return await this.connectPromise;
        } finally {
            this.connectPromise = null;
        }
    }

    async connectInternal() {
        if (!this.hasValidAccessToken()) {
            this.statusState = 'connecting';
            this.statusDetail = 'Waiting for Google sign-in...';

            let oauth2;
            try {
                oauth2 = await loadIdentityLibrary();
            } catch (error) {
                this.setErrorStatus(error);
                throw error;
            }

            const tokenResponse = await new Promise((resolve, reject) => {
                const browserWindow = getBrowserWindow();
                let settled = false;
                const finish = (error = null, response = null) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    browserWindow.clearTimeout(timeoutId);
                    if (error) {
                        reject(error);
                    } else {
                        resolve(response);
                    }
                };
                const timeoutId = browserWindow.setTimeout(() => finish(new GoogleDriveProviderError(
                    'Google sign-in did not finish. Close any old sign-in window and try again.',
                    'authentication_timeout',
                    { retryable: true }
                )), AUTH_TIMEOUT_MS);

                try {
                    this.tokenClient = oauth2.initTokenClient({
                        client_id: this.config.clientId,
                        scope: DRIVE_FILE_SCOPE,
                        include_granted_scopes: true,
                        callback: (response) => {
                            if (response?.error) {
                                finish(new GoogleDriveProviderError(
                                    response.error === 'access_denied'
                                        ? 'Google Drive access was not granted. You can try connecting again.'
                                        : 'Google sign-in could not be completed. Please try again.',
                                    response.error === 'access_denied' ? 'access_denied' : 'authentication_failed'
                                ));
                                return;
                            }
                            if (!response?.access_token) {
                                finish(new GoogleDriveProviderError(
                                    'Google sign-in completed without a usable Drive connection. Please try again.',
                                    'missing_access_token'
                                ));
                                return;
                            }
                            finish(null, response);
                        },
                        error_callback: (error) => {
                            const wasClosed = error?.type === 'popup_closed';
                            finish(new GoogleDriveProviderError(
                                wasClosed
                                    ? 'Google sign-in was closed before it finished.'
                                    : 'Google sign-in could not open. Allow pop-ups for Teacher Screen and try again.',
                                wasClosed ? 'popup_closed' : 'popup_failed',
                                { cause: error, retryable: true }
                            ));
                        }
                    });
                    this.tokenClient.requestAccessToken();
                } catch (error) {
                    finish(new GoogleDriveProviderError(
                        'Google sign-in could not start. Check the app configuration and try again.',
                        'authentication_failed',
                        { cause: error }
                    ));
                }
            }).catch((error) => {
                this.setErrorStatus(error);
                throw error;
            });

            const scopeGranted = typeof oauth2.hasGrantedAllScopes === 'function'
                ? oauth2.hasGrantedAllScopes(tokenResponse, DRIVE_FILE_SCOPE)
                : String(tokenResponse.scope || '').split(/\s+/).includes(DRIVE_FILE_SCOPE);
            if (!scopeGranted) {
                this.clearSession();
                const error = new GoogleDriveProviderError(
                    'Teacher Screen needs permission to use the files you choose in Google Drive.',
                    'scope_not_granted'
                );
                this.setErrorStatus(error);
                throw error;
            }

            this.accessToken = tokenResponse.access_token;
            const expiresInSeconds = parsePositiveInteger(tokenResponse.expires_in) || 3600;
            this.accessTokenExpiresAt = Date.now() + (expiresInSeconds * 1000);
        }

        this.statusState = 'connected';
        this.statusDetail = 'Connected to Google Drive.';

        try {
            const rootFolder = await this.ensureAppFolder();
            return {
                ...this.getStatus(),
                rootFolder
            };
        } catch (error) {
            this.setErrorStatus(error);
            throw error;
        }
    }

    async disconnect({ revoke = false } = {}) {
        const token = this.accessToken;
        this.clearSession();
        this.statusState = this.config.clientId ? 'disconnected' : 'unconfigured';
        this.statusDetail = this.config.clientId
            ? 'Google Drive is disconnected.'
            : 'Google Drive has not been configured for this Teacher Screen deployment.';

        if (revoke && token) {
            try {
                const oauth2 = await loadIdentityLibrary();
                if (typeof oauth2.revoke === 'function') {
                    await new Promise((resolve) => oauth2.revoke(token, () => resolve()));
                }
            } catch (error) {
                // The in-memory session is already cleared. A failed optional
                // revocation should not make the local disconnect fail.
            }
        }

        return this.getStatus();
    }

    async reconnect() {
        this.clearSession();
        this.statusState = 'disconnected';
        this.statusDetail = 'Reconnect Google Drive to continue.';
        return this.connect();
    }

    async ensureAppFolder() {
        this.assertReadyForDriveRequest();

        if (this.rootFolderId && this.rootFolderResource) {
            return this.rootFolderResource;
        }

        const query = [
            `mimeType = '${FOLDER_MIME_TYPE}'`,
            'trashed = false',
            `appProperties has { key='${ROOT_FOLDER_TAG_KEY}' and value='${ROOT_FOLDER_TAG_VALUE}' }`
        ].join(' and ');
        const params = new URLSearchParams({
            q: query,
            spaces: 'drive',
            orderBy: 'modifiedTime desc',
            pageSize: '100',
            fields: `files(${FILE_FIELDS})`
        });
        const result = await this.requestJson(`/files?${params.toString()}`);
        const matchingFolders = Array.isArray(result.files) ? result.files : [];
        let folder = matchingFolders.find((candidate) => candidate.name === this.config.folderName)
            || matchingFolders[0]
            || null;

        if (!folder) {
            const createParams = new URLSearchParams({ fields: FILE_FIELDS });
            folder = await this.requestJson(`/files?${createParams.toString()}`, {
                method: 'POST',
                body: {
                    name: this.config.folderName,
                    mimeType: FOLDER_MIME_TYPE,
                    appProperties: {
                        [ROOT_FOLDER_TAG_KEY]: ROOT_FOLDER_TAG_VALUE,
                        [PROVIDER_TAG_KEY]: PROVIDER_TAG_VALUE
                    }
                }
            });
        }

        const normalized = normalizeDriveResource(folder, []);
        normalized.pathSegments = [];
        this.rootFolderId = normalized.id;
        this.rootFolderResource = normalized;
        return normalized;
    }

    async list(folder = null) {
        this.assertReadyForDriveRequest();
        const folderContext = await this.resolveFolderReference(folder);
        const query = `'${escapeDriveQueryValue(folderContext.id)}' in parents and trashed = false`;
        const resources = [];
        let pageToken = '';

        do {
            const params = new URLSearchParams({
                q: query,
                spaces: 'drive',
                orderBy: 'folder,name_natural',
                pageSize: '1000',
                fields: `nextPageToken,files(${FILE_FIELDS})`
            });
            if (pageToken) {
                params.set('pageToken', pageToken);
            }

            const result = await this.requestJson(`/files?${params.toString()}`);
            const pageFiles = Array.isArray(result.files) ? result.files : [];
            resources.push(...pageFiles.map((file) => normalizeDriveResource(file, folderContext.pathSegments)));
            pageToken = cleanText(result.nextPageToken, 1000);
        } while (pageToken);

        return resources.sort((left, right) => {
            if (left.kind !== right.kind) {
                return left.kind === 'folder' ? -1 : 1;
            }
            return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    async getFile(resource) {
        this.assertReadyForDriveRequest();
        const supplied = resource && typeof resource === 'object' ? resource : { id: resource };
        const id = cleanText(supplied.id, 500);
        if (!id) {
            throw new GoogleDriveProviderError('Choose a Google Drive file first.', 'resource_required');
        }
        if (supplied.kind === 'folder' || isFolderMimeType(supplied.mimeType)) {
            throw new GoogleDriveProviderError('Folders can be opened, but they cannot be added as a file.', 'folder_not_file');
        }

        let metadata = supplied;
        if (!supplied.name || !supplied.mimeType || (!supplied.webUrl && !supplied.webViewLink && !supplied.sourceUrl)) {
            metadata = await this.getFileMetadata(id);
        }
        const normalized = normalizeDriveResource(metadata, supplied.pathSegments?.slice(0, -1) || []);

        if (normalized.mimeType === GOOGLE_SLIDES_MIME_TYPE) {
            const webUrl = normalized.webUrl || getGoogleSlidesUrl(id);
            return {
                ...normalized,
                type: 'google-slides',
                sourceUrl: webUrl,
                webUrl,
                nativeGoogleFile: true,
                downloadable: false
            };
        }

        if (isGoogleNativeMimeType(normalized.mimeType)) {
            throw new GoogleDriveProviderError(
                'This Google file opens in Drive and cannot be downloaded in its native format by Teacher Screen.',
                'native_google_file'
            );
        }

        const blob = await this.requestBlob(`/files/${encodeURIComponent(id)}?alt=media`);
        const mimeType = blob.type || normalized.mimeType || 'application/octet-stream';
        const modifiedTimestamp = Date.parse(normalized.modifiedTime || '');
        const fileOptions = {
            type: mimeType,
            lastModified: Number.isFinite(modifiedTimestamp) ? modifiedTimestamp : Date.now()
        };

        if (typeof File === 'function') {
            return new File([blob], normalized.name, fileOptions);
        }
        return blob;
    }

    async chooseResource(options = {}) {
        this.assertConfigured({ picker: true });
        this.assertOnline();
        if (!this.hasValidAccessToken()) {
            await this.connect();
        }

        let pickerApi;
        try {
            pickerApi = await loadPickerLibrary();
        } catch (error) {
            this.setErrorStatus(error);
            throw error;
        }

        const mimeTypes = Array.isArray(options.mimeTypes) && options.mimeTypes.length
            ? options.mimeTypes.map((value) => cleanText(value, 250)).filter(Boolean)
            : PICKER_MIME_TYPES;

        return new Promise((resolve, reject) => {
            const browserWindow = getBrowserWindow();
            try {
                const docsView = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
                if (typeof docsView.setIncludeFolders === 'function') {
                    docsView.setIncludeFolders(true);
                }
                if (typeof docsView.setSelectFolderEnabled === 'function') {
                    docsView.setSelectFolderEnabled(false);
                }
                if (mimeTypes.length && typeof docsView.setMimeTypes === 'function') {
                    docsView.setMimeTypes(mimeTypes.join(','));
                }
                if (pickerApi.DocsViewMode?.LIST && typeof docsView.setMode === 'function') {
                    docsView.setMode(pickerApi.DocsViewMode.LIST);
                }

                let picker = null;
                const callback = async (data) => {
                    const actionKey = pickerApi.Response?.ACTION || 'action';
                    const action = data?.[actionKey] || data?.action;
                    if (action === pickerApi.Action?.CANCEL || action === 'cancel') {
                        resolve(null);
                        return;
                    }
                    if (action === pickerApi.Action?.ERROR || action === 'error') {
                        reject(new GoogleDriveProviderError(
                            'Google Picker could not complete the selection. Please try again.',
                            'picker_failed',
                            { retryable: true }
                        ));
                        return;
                    }
                    if (action !== pickerApi.Action?.PICKED && action !== 'picked') {
                        return;
                    }

                    const documentsKey = pickerApi.Response?.DOCUMENTS || 'docs';
                    const documents = data?.[documentsKey] || data?.docs || [];
                    const selected = documents[0];
                    if (!selected) {
                        resolve(null);
                        return;
                    }

                    const id = cleanText(selected[pickerApi.Document?.ID || 'id'] || selected.id, 500);
                    const partialResource = normalizeDriveResource({
                        id,
                        name: selected[pickerApi.Document?.NAME || 'name'] || selected.name,
                        mimeType: selected[pickerApi.Document?.MIME_TYPE || 'mimeType'] || selected.mimeType,
                        webViewLink: selected[pickerApi.Document?.URL || 'url'] || selected.url,
                        modifiedTime: selected[pickerApi.Document?.LAST_EDITED_UTC || 'lastEditedUtc']
                            || selected.lastEditedUtc
                    });

                    try {
                        const fullMetadata = await this.getFileMetadata(id);
                        resolve(normalizeDriveResource(fullMetadata));
                    } catch (error) {
                        if (partialResource.id && partialResource.name) {
                            resolve(partialResource);
                        } else {
                            reject(error);
                        }
                    } finally {
                        picker?.dispose?.();
                    }
                };

                let builder = new pickerApi.PickerBuilder()
                    .addView(docsView)
                    .setOAuthToken(this.accessToken)
                    .setDeveloperKey(this.config.apiKey)
                    .setAppId(this.config.appId)
                    .setCallback(callback)
                    .setTitle(cleanText(options.title, 200) || 'Choose a teaching resource');

                if (browserWindow.location?.origin && typeof builder.setOrigin === 'function') {
                    builder = builder.setOrigin(browserWindow.location.origin);
                }
                if (pickerApi.Feature?.SUPPORT_DRIVES && typeof builder.enableFeature === 'function') {
                    builder = builder.enableFeature(pickerApi.Feature.SUPPORT_DRIVES);
                }

                picker = builder.build();
                picker.setVisible(true);
            } catch (error) {
                const providerError = error instanceof GoogleDriveProviderError
                    ? error
                    : new GoogleDriveProviderError(
                        'Google Picker could not open. Check the Drive configuration and try again.',
                        'picker_failed',
                        { cause: error, retryable: true }
                    );
                this.setErrorStatus(providerError);
                reject(providerError);
            }
        });
    }

    async resolveFolderReference(folder) {
        const rootFolder = await this.ensureAppFolder();
        if (!folder || folder === '/' || folder === 'root') {
            return { id: rootFolder.id, pathSegments: [] };
        }

        if (Array.isArray(folder)) {
            return this.resolveFolderPath(folder, rootFolder);
        }

        if (typeof folder === 'string') {
            const trimmed = folder.trim();
            if (trimmed.includes('/')) {
                return this.resolveFolderPath(normalizePathSegments(trimmed), rootFolder);
            }
            return { id: trimmed, pathSegments: [] };
        }

        if (folder && typeof folder === 'object') {
            if (folder.id) {
                const pathSegments = normalizePathSegments(folder.pathSegments);
                return {
                    id: cleanText(folder.id, 500),
                    pathSegments: folder.id === rootFolder.id ? [] : pathSegments
                };
            }
            if (folder.pathSegments || folder.path) {
                return this.resolveFolderPath(folder.pathSegments || folder.path, rootFolder);
            }
        }

        throw new GoogleDriveProviderError('Choose a valid Google Drive folder.', 'invalid_folder');
    }

    async resolveFolderPath(path, rootFolder = null) {
        const root = rootFolder || await this.ensureAppFolder();
        const requestedSegments = normalizePathSegments(path);
        if (requestedSegments[0] === root.name || requestedSegments[0] === this.config.folderName) {
            requestedSegments.shift();
        }

        let currentId = root.id;
        const resolvedSegments = [];
        for (const segment of requestedSegments) {
            const query = [
                `'${escapeDriveQueryValue(currentId)}' in parents`,
                `name = '${escapeDriveQueryValue(segment)}'`,
                `mimeType = '${FOLDER_MIME_TYPE}'`,
                'trashed = false'
            ].join(' and ');
            const params = new URLSearchParams({
                q: query,
                spaces: 'drive',
                orderBy: 'modifiedTime desc',
                pageSize: '10',
                fields: 'files(id,name,mimeType,modifiedTime,parents,webViewLink)'
            });
            const result = await this.requestJson(`/files?${params.toString()}`);
            const nextFolder = Array.isArray(result.files) ? result.files[0] : null;
            if (!nextFolder) {
                throw new GoogleDriveProviderError(
                    `The Google Drive folder "${segment}" could not be found.`,
                    'folder_not_found'
                );
            }
            currentId = nextFolder.id;
            resolvedSegments.push(nextFolder.name);
        }

        return { id: currentId, pathSegments: resolvedSegments };
    }

    async getFileMetadata(fileId) {
        const id = cleanText(fileId, 500);
        if (!id) {
            throw new GoogleDriveProviderError('Choose a Google Drive file first.', 'resource_required');
        }
        const params = new URLSearchParams({ fields: FILE_FIELDS });
        return this.requestJson(`/files/${encodeURIComponent(id)}?${params.toString()}`);
    }

    async requestJson(path, { method = 'GET', body = null } = {}) {
        const response = await this.request(path, {
            method,
            body,
            accept: 'application/json'
        });
        if (response.status === 204) {
            return {};
        }

        try {
            return await response.json();
        } catch (error) {
            const providerError = new GoogleDriveProviderError(
                'Google Drive returned an unreadable response. Please try again.',
                'invalid_api_response',
                { cause: error, retryable: true }
            );
            this.setErrorStatus(providerError);
            throw providerError;
        }
    }

    async requestBlob(path) {
        const response = await this.request(path, { accept: '*/*', timeoutMs: DOWNLOAD_TIMEOUT_MS });
        try {
            return await response.blob();
        } catch (error) {
            const providerError = new GoogleDriveProviderError(
                'Google Drive could not download that file. Please try again.',
                'download_failed',
                { cause: error, retryable: true }
            );
            this.setErrorStatus(providerError);
            throw providerError;
        }
    }

    async request(path, {
        method = 'GET',
        body = null,
        accept = 'application/json',
        timeoutMs = REQUEST_TIMEOUT_MS
    } = {}) {
        this.assertReadyForDriveRequest();
        const browserWindow = getBrowserWindow();
        const controller = new AbortController();
        const timeoutId = browserWindow.setTimeout(
            () => controller.abort(new Error('Google Drive request timed out.')),
            timeoutMs
        );
        const url = path.startsWith('http') ? path : `${DRIVE_API_BASE_URL}${path}`;
        const headers = {
            Accept: accept,
            Authorization: `Bearer ${this.accessToken}`
        };
        if (body !== null) {
            headers['Content-Type'] = 'application/json';
        }

        try {
            const response = await fetch(url, {
                method,
                credentials: 'omit',
                cache: 'no-store',
                headers,
                body: body === null ? undefined : JSON.stringify(body),
                signal: controller.signal
            });

            if (!response.ok) {
                let apiMessage = '';
                try {
                    const payload = await response.clone().json();
                    apiMessage = payload?.error?.message || payload?.message || '';
                } catch (error) {
                    // The status-specific fallback below is safer than exposing
                    // an HTML proxy response or other unreadable body.
                }

                if (response.status === 401) {
                    this.clearSession();
                }
                const providerError = new GoogleDriveProviderError(
                    getApiErrorMessage(response.status, apiMessage),
                    response.status === 401 ? 'connection_expired' : 'drive_api_error',
                    {
                        status: response.status,
                        retryable: response.status === 429 || response.status >= 500
                    }
                );
                this.setErrorStatus(providerError);
                throw providerError;
            }

            this.statusState = 'connected';
            this.statusDetail = 'Connected to Google Drive.';
            return response;
        } catch (error) {
            if (error instanceof GoogleDriveProviderError) {
                throw error;
            }

            let providerError;
            if (controller.signal.aborted || error?.name === 'AbortError') {
                providerError = new GoogleDriveProviderError(
                    'Google Drive took too long to respond. Please try again.',
                    'request_timeout',
                    { cause: error, retryable: true }
                );
            } else if (!isBrowserOnline()) {
                providerError = new GoogleDriveProviderError(
                    'You appear to be offline. Reconnect to the internet to use Google Drive.',
                    'offline',
                    { cause: error, retryable: true }
                );
            } else {
                providerError = new GoogleDriveProviderError(
                    'Teacher Screen could not reach Google Drive. Check the connection and try again.',
                    'network_error',
                    { cause: error, retryable: true }
                );
            }
            this.setErrorStatus(providerError);
            throw providerError;
        } finally {
            browserWindow.clearTimeout(timeoutId);
        }
    }

    assertConfigured({ picker = false } = {}) {
        const configuration = this.getConfigurationStatus();
        if (!configuration.configured) {
            const error = new GoogleDriveProviderError(
                'Google Drive is not configured for this Teacher Screen deployment.',
                'unconfigured'
            );
            this.statusState = 'unconfigured';
            this.statusDetail = error.message;
            throw error;
        }
        if (picker && !configuration.pickerConfigured) {
            const error = new GoogleDriveProviderError(
                'Google Picker needs a public browser API key and Google Cloud app ID before it can be used.',
                'picker_unconfigured'
            );
            this.statusState = 'unconfigured';
            this.statusDetail = error.message;
            throw error;
        }
    }

    assertOnline() {
        if (!isBrowserOnline()) {
            const error = new GoogleDriveProviderError(
                'You appear to be offline. Reconnect to the internet to use Google Drive.',
                'offline',
                { retryable: true }
            );
            this.statusState = 'offline';
            this.statusDetail = error.message;
            throw error;
        }
    }

    assertReadyForDriveRequest() {
        this.assertConfigured();
        this.assertOnline();
        if (!this.hasValidAccessToken()) {
            this.clearSession();
            const error = new GoogleDriveProviderError(
                'Connect Google Drive before browsing cloud resources.',
                'not_connected'
            );
            this.statusState = 'disconnected';
            this.statusDetail = error.message;
            throw error;
        }
    }

    hasValidAccessToken() {
        if (!this.accessToken) {
            return false;
        }
        if (this.accessTokenExpiresAt && Date.now() >= this.accessTokenExpiresAt - 10000) {
            this.clearSession();
            return false;
        }
        return true;
    }

    clearSession() {
        this.accessToken = '';
        this.accessTokenExpiresAt = 0;
        this.tokenClient = null;
        this.rootFolderId = '';
        this.rootFolderResource = null;
    }

    setErrorStatus(error) {
        if (error?.code === 'offline') {
            this.statusState = 'offline';
        } else if (error?.code === 'unconfigured' || error?.code === 'picker_unconfigured') {
            this.statusState = 'unconfigured';
        } else if (error?.code === 'connection_expired' || error?.code === 'not_connected') {
            this.statusState = 'disconnected';
        } else {
            this.statusState = 'error';
        }
        this.statusDetail = cleanText(error?.message, 700) || 'Google Drive could not complete that action.';
    }
}
