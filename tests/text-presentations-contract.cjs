const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

async function run() {
    const response = await fetch('https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.min.js');
    assert(response.ok);
    const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
    const pending = [];
    w.setTimeout = callback => { pending.push(callback); return pending.length; };
    w.requestAnimationFrame = () => 0;
    w.cancelAnimationFrame = () => {};
    w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    w.Range.prototype.getClientRects = () => [];
    let notifications = 0;
    w.TeacherScreenWidgetState = { notifyChanged: () => notifications++ };
    w.confirm = () => true;
    w.eval(await response.text());
    for (const file of ['js/utils/text-board-images.js', 'js/utils/text-board-pages.js', 'js/widgets/rich-text-widget.js']) {
        w.eval(fs.readFileSync(path.join(root, file), 'utf8') + (file.endsWith('rich-text-widget.js') ? '\nwindow.RichTextWidget = RichTextWidget;' : ''));
    }
    const initialize = widget => {
        w.document.body.append(widget.element);
        pending[widget.initTimer - 1](); widget.quill.update('silent'); widget.quill.history.clear(); return widget;
    };
    const make = data => { const widget = new w.RichTextWidget(); if (data) widget.deserialize(data); return initialize(widget); };
    const oldData = { content: '<h2>Existing board</h2><p><strong>Keep this.</strong></p>', customTitle: 'My board' };
    const oldInput = JSON.stringify(oldData);
    const old = make(oldData);
    assert(!old.textPages); assert.equal(old.element.querySelector('.text-presentation-nav'), null);
    assert.equal(old.serialize().textPresentation, undefined); assert.equal(JSON.stringify(oldData), oldInput);
    assert(old.serialize().content.includes('Keep this.'));

    const widget = initialize(new w.RichTextWidget().enableTextPresentation());
    const pages = widget.textPages;
    assert.equal(pages.state.pages.length, 1); assert.equal(widget.quill.root.dataset.placeholder, '');
    assert.equal(pages.nav.querySelector('[data-slide-action="remove"]').disabled, true);
    widget.quill.setText('First slide\n', 'user');
    pages.nav.querySelector('[data-slide-action="add"]').click();
    assert.equal(pages.state.pages.length, 2); assert.equal(widget.quill.getText(), '\n');
    widget.quill.setText('Second slide\n', 'user');
    pages.go(0); assert.equal(widget.quill.getText(), 'First slide\n');
    widget.quill.insertText(0, 'Edited ', 'user'); widget.quill.history.undo(); assert.equal(widget.quill.getText(), 'First slide\n');
    pages.go(1); assert.equal(widget.quill.getText(), 'Second slide\n');
    widget.quill.history.undo(); assert.equal(widget.quill.getText(), 'Second slide\n', 'Undo must never bring content from a different slide');
    const beforeCancel = widget.serialize(); w.confirm = () => false; pages.remove();
    assert.deepEqual(widget.serialize(), beforeCancel); w.confirm = () => true;
    pages.remove(); assert.equal(pages.state.pages.length, 1); assert.equal(widget.quill.getText(), 'First slide\n');
    pages.undoRemove(); assert.equal(pages.state.pages.length, 2); assert.equal(widget.quill.getText(), 'Second slide\n');
    assert(notifications > 0);
    console.log('PASS: Separate text presentation, blank slides, editing, add/navigation, scoped text undo, cancel/remove and Undo remove.');

    const exported = JSON.parse(JSON.stringify(widget.serialize()));
    const inputCopy = JSON.stringify(exported);
    const restored = make(exported);
    assert.equal(JSON.stringify(exported), inputCopy);
    assert.equal(restored.textPages.state.pages.length, 2); assert.equal(restored.quill.getText(), 'Second slide\n');
    restored.textPages.go(0); assert.equal(restored.quill.getText(), 'First slide\n');
    const publicData = restored.serializeForProjector();
    assert.equal(publicData.textPresentation, undefined); assert(!JSON.stringify(publicData).includes('Second slide'));
    w.APP_MODE = 'projector'; const projector = make(publicData);
    assert.equal(projector.quill.getText(), 'First slide\n'); assert(!projector.textPages); assert(!projector.imageControls);
    w.APP_MODE = 'teacher'; restored.teacherOnly = true; assert.equal(restored.serializeForProjector().content, ''); restored.teacherOnly = false;
    console.log('PASS: JSON save/reload/import retains all slides; projector receives only active public content and no editor controls.');

    restored.enterPresentationMode(); assert(restored.textPages.menu.hidden);
    const next = restored.textPages.nav.querySelector('[data-slide-action="next"]');
    next.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(restored.quill.getText(), 'Second slide\n');
    restored.exitPresentationMode(); restored.quill.focus();
    restored.quill.root.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(restored.quill.getText(), 'Second slide\n', 'Editing arrow keys must not navigate slides');
    restored.textPages.menu.open = true;
    restored.textPages.menu.querySelector('summary').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(w.document.activeElement.dataset.slideAction, 'add');
    restored.textPages.menu.querySelector('summary').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(restored.textPages.menu.open, false);
    restored.remove({ notify: false }); assert.equal(restored.textPages, null);
    console.log('PASS: Present/edit recovery, presentation keyboard navigation, editing isolation, menu Escape and widget lifecycle.');

    w.eval(fs.readFileSync(path.join(root, 'js/widgets/widget-registry.js'), 'utf8').replace(/\bexport /g, ''));
    const fromPicker = w.createWidgetByType('text-presentation'); assert(fromPicker.textPages);
    const normalized = w.TeacherScreenTextBoardPages.normalize({ pages: [{ id: 'same', content: 'A' }, { id: 'same', content: 'B' }] });
    assert.notEqual(normalized.pages[0].id, normalized.pages[1].id); assert.equal(normalized.pages[1].content, 'B');
    console.log('PASS: Picker option and lossless duplicate-page-ID normalization.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
