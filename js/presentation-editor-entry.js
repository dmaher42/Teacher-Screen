import { createPptxViewer } from 'pptx-vanilla-viewer';
import 'pptx-vanilla-viewer/styles.css';
import '../css/presentation-editor.css';

const PPTX_CHANNEL_NAME = 'teacher-screen-pptx-editor';
const params = new URLSearchParams(window.location.search);
const storageId = String(params.get('storageId') || '').trim();
const mode = params.get('mode') === 'viewer' ? 'viewer' : 'edit';
const initialSlide = Math.max(0, Number(params.get('slide')) || 0);
const isViewer = mode === 'viewer';
const sameOrigin = window.location.origin;

const host = document.getElementById('presentation-editor-host');
const status = document.getElementById('editor-status');
const nameLabel = document.getElementById('presentation-name');
const backButton = document.getElementById('back-button');
const saveButton = document.getElementById('save-button');
const downloadButton = document.getElementById('download-button');
const chooseFileButton = document.getElementById('choose-file-button');
const fileInput = document.getElementById('presentation-file-input');
const documentStore = window.TeacherScreenDocumentStore;
const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel(PPTX_CHANNEL_NAME)
    : null;

document.body.dataset.editorMode = mode;

let sourceRecord = null;
let activeFileName = 'presentation.pptx';
let contrastFrame = 0;

function setStatus(message) {
    if (status) status.textContent = message || '';
}

function normalizePptxName(value = '') {
    const trimmed = String(value || '').trim() || 'presentation.pptx';
    return /\.pptx$/i.test(trimmed) ? trimmed : `${trimmed}.pptx`;
}

function parseHexColor(value = '') {
    const normalized = String(value || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
    return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
}

function relativeLuminance(rgb) {
    if (!rgb) return null;
    const channels = rgb.map((value) => {
        const channelValue = value / 255;
        return channelValue <= 0.03928
            ? channelValue / 12.92
            : ((channelValue + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(left, right) {
    const leftLuminance = relativeLuminance(parseHexColor(left));
    const rightLuminance = relativeLuminance(parseHexColor(right));
    if (leftLuminance === null || rightLuminance === null) return Number.POSITIVE_INFINITY;
    const lighter = Math.max(leftLuminance, rightLuminance);
    const darker = Math.min(leftLuminance, rightLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

function hasAuthoredTextColor(element) {
    if (element?.textStyle?.authoredRunStyle?.color) return true;
    const segments = Array.isArray(element?.textSegments) ? element.textSegments : [];
    return segments.some((segment) => segment?.style?.authoredRunStyle?.color);
}

function applyInheritedTextContrastFixes() {
    contrastFrame = 0;
    const slide = viewer.getActiveSlide();
    const backgroundColor = slide?.backgroundColor;
    if (!backgroundColor) return;

    host.querySelectorAll('.teacher-screen-pptx-contrast-fix').forEach((element) => {
        element.classList.remove('teacher-screen-pptx-contrast-fix');
        element.style.removeProperty('--teacher-screen-pptx-contrast-color');
    });

    host.querySelectorAll('.pptxv-element[data-element-id]').forEach((renderedElement) => {
        const elementId = renderedElement.dataset.elementId;
        const element = elementId ? viewer.getElementById(elementId) : null;
        const textColor = element?.textStyle?.color;
        if (!textColor || hasAuthoredTextColor(element) || contrastRatio(textColor, backgroundColor) >= 2) {
            return;
        }

        const whiteContrast = contrastRatio('#ffffff', backgroundColor);
        const blackContrast = contrastRatio('#000000', backgroundColor);
        renderedElement.classList.add('teacher-screen-pptx-contrast-fix');
        renderedElement.style.setProperty(
            '--teacher-screen-pptx-contrast-color',
            whiteContrast >= blackContrast ? '#ffffff' : '#000000'
        );
    });
}

function scheduleContrastFixes() {
    if (contrastFrame) window.cancelAnimationFrame(contrastFrame);
    contrastFrame = window.requestAnimationFrame(applyInheritedTextContrastFixes);
}

function postToParent(type, detail = {}) {
    if (window.parent === window) return;
    window.parent.postMessage({ type, storageId, ...detail }, sameOrigin);
}

const viewer = createPptxViewer(host, {
    editable: !isViewer,
    showToolbar: !isViewer,
    showThumbnails: !isViewer,
    showFormatToolbar: !isViewer,
    showInspector: false,
    initialSlide,
    autosave: false,
    hiddenActions: ['share', 'broadcast', 'record'],
    onLoad: ({ slideCount }) => {
        if (!isViewer) {
            const enableEditing = () => {
                viewer.enableEditingFromProtectedView();
                viewer.editAnywayFromReadOnlyRecommendation();
                viewer.setEditable(true);
            };
            window.setTimeout(enableEditing, 0);
            window.setTimeout(enableEditing, 150);
            setStatus(`${slideCount} slides loaded. Double-click text on a slide to edit it.`);
        }
        saveButton.disabled = isViewer;
        downloadButton.disabled = isViewer;
        scheduleContrastFixes();
        postToParent('teacher-screen-pptx-ready', {
            slide: viewer.getActiveSlideIndex(),
            slideCount
        });
    },
    onSlideChange: (slide) => {
        scheduleContrastFixes();
        postToParent('teacher-screen-pptx-slide-change', { slide });
    },
    onChange: scheduleContrastFixes,
    onDirtyChange: (dirty) => {
        if (isViewer) return;
        document.body.dataset.dirty = dirty ? 'true' : 'false';
        setStatus(dirty
            ? 'Unsaved changes. Save in Teacher Screen or download an edited copy.'
            : `${viewer.getSlideCount()} slides loaded. Double-click text on a slide to edit it.`);
    },
    onError: (message) => {
        setStatus(message || 'The PowerPoint could not be opened.');
        postToParent('teacher-screen-pptx-error', { message });
    }
});

const renderObserver = new MutationObserver(scheduleContrastFixes);
renderObserver.observe(host, { childList: true, subtree: true });
const resizeObserver = new ResizeObserver(() => {
    if (!isViewer || !viewer.getSlideCount()) return;
    window.requestAnimationFrame(() => viewer.zoomToFit());
});
resizeObserver.observe(host);

async function loadStoredPresentation() {
    if (!storageId || !documentStore?.loadSlideDeck) return false;
    sourceRecord = await documentStore.loadSlideDeck(storageId);
    if (!(sourceRecord?.sourceBlob instanceof Blob)) return false;
    activeFileName = normalizePptxName(sourceRecord.sourceName || sourceRecord.name);
    if (nameLabel) nameLabel.textContent = activeFileName;
    await viewer.loadFile(sourceRecord.sourceBlob, { skipProtectedView: true });
    viewer.goToSlide(initialSlide);
    viewer.zoomToFit();
    return true;
}

async function loadChosenFile(file) {
    if (!file) return;
    activeFileName = normalizePptxName(file.name);
    if (nameLabel) nameLabel.textContent = activeFileName;
    setStatus(`Opening ${activeFileName}...`);
    await viewer.loadFile(file, { skipProtectedView: true });
    viewer.zoomToFit();
}

async function saveToTeacherScreen() {
    if (!storageId || !sourceRecord || !documentStore?.updateSlideDeck) {
        setStatus('This file is not stored in Teacher Screen yet. Download the edited copy instead.');
        return;
    }
    saveButton.disabled = true;
    setStatus('Saving the edited PowerPoint in Teacher Screen...');
    try {
        const bytes = await viewer.save('pptx');
        const sourceBlob = new Blob([bytes], {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        });
        await documentStore.updateSlideDeck(storageId, {
            sourceBlob,
            sourceSize: sourceBlob.size,
            sourceName: activeFileName,
            slideCount: viewer.getSlideCount(),
            editorUpdatedAt: Date.now()
        });
        sourceRecord = { ...sourceRecord, sourceBlob, sourceSize: sourceBlob.size };
        setStatus('Saved in Teacher Screen. The presentation preview will refresh.');
        const message = { type: 'teacher-screen-pptx-updated', storageId };
        channel?.postMessage(message);
        window.opener?.postMessage(message, sameOrigin);
    } catch (error) {
        console.error('Unable to save edited PowerPoint:', error);
        setStatus('The edited PowerPoint could not be saved in Teacher Screen. Download a copy to keep your changes.');
    } finally {
        saveButton.disabled = false;
    }
}

async function downloadCopy() {
    downloadButton.disabled = true;
    setStatus('Preparing the edited PowerPoint download...');
    try {
        const baseName = activeFileName.replace(/\.pptx$/i, '');
        await viewer.downloadPptx(`${baseName} - edited.pptx`);
        setStatus('Edited copy downloaded. Upload that copy if the original came from Google Drive.');
    } catch (error) {
        console.error('Unable to download edited PowerPoint:', error);
        setStatus('The edited copy could not be downloaded.');
    } finally {
        downloadButton.disabled = false;
    }
}

window.addEventListener('message', (event) => {
    if (event.origin !== sameOrigin || event.data?.type !== 'teacher-screen-pptx-command') return;
    if (event.data.storageId && event.data.storageId !== storageId) return;
    const command = event.data.command;
    if (command === 'next') viewer.next();
    if (command === 'prev') viewer.prev();
    if (command === 'slide') viewer.goToSlide(Math.max(0, Number(event.data.slide) || 0));
});

channel?.addEventListener('message', async (event) => {
    if (!isViewer || event.data?.type !== 'teacher-screen-pptx-updated' || event.data.storageId !== storageId) return;
    const slide = viewer.getActiveSlideIndex();
    if (await loadStoredPresentation()) viewer.goToSlide(slide);
});

backButton?.addEventListener('click', () => {
    if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
    }
    window.location.href = 'index.html';
});
saveButton?.addEventListener('click', saveToTeacherScreen);
downloadButton?.addEventListener('click', downloadCopy);
chooseFileButton?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', () => loadChosenFile(fileInput.files?.[0]).catch((error) => setStatus(error.message)));

loadStoredPresentation()
    .then((loaded) => {
        if (loaded) return;
        if (isViewer) {
            postToParent('teacher-screen-pptx-error', { message: 'The stored PowerPoint file is unavailable.' });
            return;
        }
        chooseFileButton.hidden = false;
        setStatus('Choose a PowerPoint from this device.');
    })
    .catch((error) => {
        console.error('Unable to open stored PowerPoint:', error);
        setStatus('The stored PowerPoint could not be opened.');
        chooseFileButton.hidden = false;
        postToParent('teacher-screen-pptx-error', { message: error.message });
    });

window.addEventListener('beforeunload', () => {
    renderObserver.disconnect();
    resizeObserver.disconnect();
    channel?.close();
    viewer.destroy();
});
