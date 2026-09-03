import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testsDirectory, '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [editorHtml, editorSource, widgetSource, storeSource, packageJson] = await Promise.all([
    read('presentation-editor.html'),
    read('js/presentation-editor-entry.js'),
    read('js/widgets/reveal-manager-widget.js'),
    read('js/utils/local-document-store.js'),
    read('package.json').then(JSON.parse)
]);

assert.match(editorHtml, /id="presentation-editor-host"/, 'PowerPoint editor page should provide a viewer host');
assert.match(editorHtml, /Save in Teacher Screen/, 'PowerPoint editor should expose an in-app save action');
assert.match(editorHtml, /Download edited copy/, 'PowerPoint editor should expose a portable PPTX download');
assert.match(editorSource, /createPptxViewer/, 'PowerPoint editor should use the PPTX viewer/editor runtime');
assert.match(editorSource, /updateSlideDeck\(storageId/, 'PowerPoint edits should be saved back to the stored Teacher Screen copy');
assert.match(editorSource, /teacher-screen-pptx-slide-change/, 'Embedded previews should report slide changes');
assert.match(widgetSource, /reveal-edit-pptx-btn/, 'Presentation widget should expose the PowerPoint edit action');
assert.match(widgetSource, /presentation-editor\.html/, 'Presentation widget should open the Teacher Screen editor route');
assert.match(widgetSource, /sourceBlobAvailable/, 'Presentation widget should prefer the retained PPTX source');
assert.match(storeSource, /sourceBlob instanceof Blob/, 'Local document storage should include retained PPTX bytes in capacity checks');
assert.equal(packageJson.dependencies?.['pptx-vanilla-viewer'], '2.5.1', 'PPTX editor runtime should be pinned');

const [bundle, styles] = await Promise.all([
    stat(path.join(root, 'js/vendor/presentation-editor.js')),
    stat(path.join(root, 'js/vendor/presentation-editor.css'))
]);
assert.ok(bundle.size > 1_000_000, 'Bundled PowerPoint editor runtime should be present');
assert.ok(styles.size > 10_000, 'Bundled PowerPoint editor styles should be present');

console.log('PASS: PowerPoint files retain an editable source, render in-app, save locally, and can download an edited copy');
