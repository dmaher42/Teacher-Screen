import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInstructions, pageOnlyLayout, layoutWithSharedTextBoards } from '../js/utils/instruction-rail.js';

test('legacy instructions migrate once, preserving text, geometry, visibility and recovery source', () => {
    const source = { visible: true, width: 37, height: 62, x: 18, y: 29, fontSize: 36,
        today: 'Read\nthen write', now: '<img src=x onerror=alert(1)> & evidence', next: 'Explain.' };
    const untouched = structuredClone(source);
    const migrated = normalizeInstructions(source);
    assert.deepEqual(source, untouched);
    for (const key of Object.keys(source)) assert.equal(migrated[key], source[key]);
    const board = migrated.boards.widgets[0];
    assert.equal(board.width, 370); assert.equal(board.height, 620);
    assert(Math.abs(board.x - 630 * .18) < .0001); assert(Math.abs(board.y - 380 * .29) < .0001);
    assert.equal(board.data.instructionFontSize, 36);
    assert(board.data.content.includes('Read<br>then write'));
    assert(board.data.content.includes('&lt;img'));
    assert(board.data.showOnEveryPage && board.data.keepInFront);
    assert.deepEqual(normalizeInstructions(migrated), migrated);
    migrated.boards.widgets = [];
    assert.equal(normalizeInstructions(migrated).boards.widgets.length, 0, 'Deleting the converted board is final');
});

test('empty legacy state stays empty; hidden saved instructions stay private to the teacher until shown', () => {
    assert.equal(normalizeInstructions().boards.widgets.length, 0);
    const hidden = normalizeInstructions({ visible: false, today: 'Saved but hidden' }).boards.widgets[0];
    assert.equal(hidden.minimized, true);
    assert.equal(hidden.visibleOnProjector, false);
    assert.equal(hidden.projectorVisibilityConfigured, true);
    assert(hidden.data.content.includes('Saved but hidden'));
});

test('page composition preserves page-local content, shared viewport and original inputs', () => {
    const instructions = normalizeInstructions({ visible: true, today: 'Shared' });
    const shared = instructions.boards.widgets[0];
    const local = { id: 'local', type: 'RichTextWidget', x: 10, y: 20, width: 400, height: 300, data: { content: '<h2>Local</h2>' } };
    const page = { mode: 'dashboard', viewport: { width: 1440, height: 900 }, widgets: [local] };
    const merged = layoutWithSharedTextBoards(page, instructions);
    assert.deepEqual(merged.widgets[0], local);
    assert.deepEqual(merged.widgets[1], shared);
    assert.deepEqual(pageOnlyLayout(merged), page);
    assert.equal(page.widgets.length, 1);
});

test('duplicate shared IDs retain both boards instead of silently dropping content', () => {
    const base = normalizeInstructions({ visible: true, today: 'First' });
    const first = base.boards.widgets[0];
    base.boards.widgets.push({ ...structuredClone(first), data: { ...first.data, content: '<p>Second</p>' } });
    const boards = normalizeInstructions(base).boards.widgets;
    assert.equal(boards.length, 2);
    assert.notEqual(boards[0].id, boards[1].id);
    assert(boards[1].data.content.includes('Second'));
});
