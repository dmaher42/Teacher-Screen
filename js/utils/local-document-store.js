(function initializeTeacherScreenDocumentStore(global) {
    if (!global || global.TeacherScreenDocumentStore) {
        return;
    }

    const DATABASE_NAME = 'teacher-screen-documents';
    const DATABASE_VERSION = 2;
    const PDF_STORE_NAME = 'pdfs';
    const SLIDE_DECK_STORE_NAME = 'slideDecks';
    const SLIDE_ASSET_STORE_NAME = 'slideAssets';
    const SLIDE_ASSET_DECK_INDEX = 'deckId';
    const STORAGE_HEADROOM_BYTES = 5 * 1024 * 1024;
    let databasePromise = null;

    function createStorageError(message, name = 'InvalidStateError') {
        try {
            return new DOMException(message, name);
        } catch (error) {
            const fallback = new Error(message);
            fallback.name = name;
            return fallback;
        }
    }

    function openDatabase() {
        if (databasePromise) {
            return databasePromise;
        }

        databasePromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(createStorageError('Browser document storage is unavailable.'));
                return;
            }

            const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(PDF_STORE_NAME)) {
                    database.createObjectStore(PDF_STORE_NAME, { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains(SLIDE_DECK_STORE_NAME)) {
                    database.createObjectStore(SLIDE_DECK_STORE_NAME, { keyPath: 'id' });
                }

                const assetStore = database.objectStoreNames.contains(SLIDE_ASSET_STORE_NAME)
                    ? request.transaction.objectStore(SLIDE_ASSET_STORE_NAME)
                    : database.createObjectStore(SLIDE_ASSET_STORE_NAME, { keyPath: 'id' });
                if (!assetStore.indexNames.contains(SLIDE_ASSET_DECK_INDEX)) {
                    assetStore.createIndex(SLIDE_ASSET_DECK_INDEX, 'deckId', { unique: false });
                }
            };
            request.onerror = () => reject(request.error || createStorageError('Unable to open document storage.'));
            request.onblocked = () => reject(createStorageError('Document storage is blocked by another open Teacher Screen tab.'));
            request.onsuccess = () => {
                const database = request.result;
                database.onversionchange = () => {
                    database.close();
                    databasePromise = null;
                };
                resolve(database);
            };
        }).catch((error) => {
            databasePromise = null;
            throw error;
        });

        return databasePromise;
    }

    function waitForTransaction(transaction, fallbackMessage) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || createStorageError(fallbackMessage));
            transaction.onabort = () => reject(transaction.error || createStorageError(fallbackMessage));
        });
    }

    function waitForRequest(request, fallbackMessage) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error || createStorageError(fallbackMessage));
        });
    }

    async function putRecord(storeName, record, fallbackMessage) {
        const database = await openDatabase();
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(record);
        await waitForTransaction(transaction, fallbackMessage);
        return record.id;
    }

    async function getRecord(storeName, id, fallbackMessage) {
        const database = await openDatabase();
        const transaction = database.transaction(storeName, 'readonly');
        return waitForRequest(transaction.objectStore(storeName).get(id), fallbackMessage);
    }

    async function ensureStorageCapacity(requiredBytes = 0) {
        const required = Math.max(0, Number(requiredBytes) || 0);
        if (!required || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
            return true;
        }

        const estimate = await navigator.storage.estimate();
        const quota = Number(estimate?.quota) || 0;
        const usage = Number(estimate?.usage) || 0;
        if (quota > 0 && quota - usage < required + STORAGE_HEADROOM_BYTES) {
            throw createStorageError('There is not enough browser storage for this slide deck.', 'QuotaExceededError');
        }
        return true;
    }

    async function savePdf(record) {
        if (!record || !record.id) {
            throw createStorageError('A PDF storage id is required.');
        }
        return putRecord(PDF_STORE_NAME, record, 'Unable to save the PDF.');
    }

    async function loadPdf(id) {
        if (!id) return null;
        return getRecord(PDF_STORE_NAME, id, 'Unable to restore the PDF.');
    }

    async function saveSlideDeck({ deck, assets = [] } = {}) {
        if (!deck || !deck.id) {
            throw createStorageError('A slide deck storage id is required.');
        }

        const normalizedAssets = Array.isArray(assets)
            ? assets.filter((asset) => asset && asset.id && asset.blob instanceof Blob)
            : [];
        const contentBytes = new Blob([String(deck.content || '')], { type: 'text/html' }).size;
        const assetBytes = normalizedAssets.reduce((total, asset) => total + (Number(asset.blob.size) || 0), 0);
        await ensureStorageCapacity(contentBytes + assetBytes);

        const database = await openDatabase();
        const transaction = database.transaction([SLIDE_DECK_STORE_NAME, SLIDE_ASSET_STORE_NAME], 'readwrite');
        const deckStore = transaction.objectStore(SLIDE_DECK_STORE_NAME);
        const assetStore = transaction.objectStore(SLIDE_ASSET_STORE_NAME);
        const existingAssets = assetStore.index(SLIDE_ASSET_DECK_INDEX).openKeyCursor(deck.id);

        existingAssets.onsuccess = () => {
            const cursor = existingAssets.result;
            if (cursor) {
                assetStore.delete(cursor.primaryKey);
                cursor.continue();
                return;
            }

            deckStore.put({
                ...deck,
                assetCount: normalizedAssets.length,
                storedBytes: contentBytes + assetBytes,
                updatedAt: Number(deck.updatedAt) || Date.now()
            });
            normalizedAssets.forEach((asset) => {
                assetStore.put({
                    ...asset,
                    deckId: deck.id,
                    updatedAt: Number(asset.updatedAt) || Date.now()
                });
            });
        };
        existingAssets.onerror = () => transaction.abort();

        await waitForTransaction(transaction, 'Unable to save the slide deck.');
        if (navigator.storage && typeof navigator.storage.persist === 'function') {
            navigator.storage.persist().catch(() => false);
        }
        return deck.id;
    }

    async function loadSlideDeck(id) {
        if (!id) return null;
        return getRecord(SLIDE_DECK_STORE_NAME, id, 'Unable to restore the slide deck.');
    }

    async function loadSlideAssets(deckId) {
        if (!deckId) return [];
        const database = await openDatabase();
        const transaction = database.transaction(SLIDE_ASSET_STORE_NAME, 'readonly');
        const request = transaction.objectStore(SLIDE_ASSET_STORE_NAME)
            .index(SLIDE_ASSET_DECK_INDEX)
            .getAll(deckId);
        const result = await waitForRequest(request, 'Unable to restore slide images.');
        return Array.isArray(result) ? result : [];
    }

    async function updateSlideDeck(id, updates = {}) {
        const existing = await loadSlideDeck(id);
        if (!existing) return false;
        await putRecord(SLIDE_DECK_STORE_NAME, {
            ...existing,
            ...updates,
            id: existing.id,
            updatedAt: Date.now()
        }, 'Unable to update the slide deck.');
        return true;
    }

    async function deleteSlideDeck(id) {
        if (!id) return false;
        const database = await openDatabase();
        const transaction = database.transaction([SLIDE_DECK_STORE_NAME, SLIDE_ASSET_STORE_NAME], 'readwrite');
        const deckStore = transaction.objectStore(SLIDE_DECK_STORE_NAME);
        const assetStore = transaction.objectStore(SLIDE_ASSET_STORE_NAME);
        const assetsRequest = assetStore.index(SLIDE_ASSET_DECK_INDEX).openKeyCursor(id);

        deckStore.delete(id);
        assetsRequest.onsuccess = () => {
            const cursor = assetsRequest.result;
            if (!cursor) return;
            assetStore.delete(cursor.primaryKey);
            cursor.continue();
        };
        assetsRequest.onerror = () => transaction.abort();

        await waitForTransaction(transaction, 'Unable to delete the slide deck.');
        return true;
    }

    global.TeacherScreenDocumentStore = Object.freeze({
        databaseName: DATABASE_NAME,
        databaseVersion: DATABASE_VERSION,
        ensureStorageCapacity,
        loadPdf,
        savePdf,
        deleteSlideDeck,
        loadSlideAssets,
        loadSlideDeck,
        saveSlideDeck,
        updateSlideDeck
    });
})(typeof window !== 'undefined' ? window : null);
