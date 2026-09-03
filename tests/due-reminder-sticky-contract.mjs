import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    DUE_REMINDER_STICKY_DISMISSAL_KEY,
    DueReminderStickyController,
    getDueReminders
} from '../js/utils/due-reminder-sticky.js';

const NOW = new Date('2026-09-02T10:30:00+09:30');

function makeReminder(overrides = {}) {
    return {
        id: 'reminder-1',
        text: 'Bring the assessment folder',
        dueDate: '2026-09-02',
        completed: false,
        orderIndex: 0,
        ...overrides
    };
}

function createHarness(reminders = [makeReminder()]) {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://teacher-screen.test/' });
    let currentReminders = reminders.map((reminder) => ({ ...reminder }));
    const listeners = new Set();
    const service = {
        list: () => currentReminders.map((reminder) => ({ ...reminder })),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        toggle: (id, completed) => {
            currentReminders = currentReminders.map((reminder) => (
                reminder.id === id ? { ...reminder, completed } : reminder
            ));
            listeners.forEach((listener) => listener({ reason: 'update', itemId: id }));
        }
    };
    const controller = new DueReminderStickyController({
        service,
        document: dom.window.document,
        window: dom.window,
        storage: dom.window.localStorage,
        now: () => new Date(NOW),
        refreshIntervalMs: 3_600_000
    });

    return {
        controller,
        document: dom.window.document,
        storage: dom.window.localStorage,
        close: () => dom.window.close(),
        setReminders: (next) => {
            currentReminders = next.map((reminder) => ({ ...reminder }));
            listeners.forEach((listener) => listener({ reason: 'test' }));
        }
    };
}

test('daily list includes unfinished reminders due today and overdue only', () => {
    const due = getDueReminders([
        makeReminder({ id: 'overdue', dueDate: '2026-09-01' }),
        makeReminder({ id: 'today' }),
        makeReminder({ id: 'later-today', dueDate: '2026-09-02T11:00:00+09:30' }),
        makeReminder({ id: 'future', dueDate: '2026-09-03' }),
        makeReminder({ id: 'done', completed: true })
    ], NOW);

    assert.deepEqual(due.map(({ reminder }) => reminder.id), ['overdue', 'today']);
    assert.deepEqual(due.map(({ presentation }) => presentation.label), ['Overdue', 'Due today']);
});

test('sticky renders as teacher-only and remains until its close button is used', () => {
    const harness = createHarness();
    harness.controller.init();

    const sticky = harness.document.querySelector('.due-reminder-sticky');
    assert.ok(sticky);
    assert.match(sticky.textContent, /Teacher only/);
    assert.match(sticky.textContent, /Bring the assessment folder/);
    assert.match(sticky.textContent, /stays here until you close it/);

    harness.controller.refresh();
    assert.ok(harness.document.querySelector('.due-reminder-sticky'));

    harness.document.querySelector('.due-reminder-sticky__close').click();
    assert.equal(harness.document.querySelector('.due-reminder-sticky'), null);
    assert.deepEqual(
        JSON.parse(harness.storage.getItem(DUE_REMINDER_STICKY_DISMISSAL_KEY)),
        { date: '2026-09-02', ids: ['reminder-1'] }
    );

    harness.controller.refresh();
    assert.equal(harness.document.querySelector('.due-reminder-sticky'), null);
    harness.controller.destroy();
    harness.close();
});
test('a newly due reminder can reopen a note after earlier items were dismissed', () => {
    const harness = createHarness();
    harness.controller.init();
    harness.document.querySelector('.due-reminder-sticky__close').click();

    harness.setReminders([
        makeReminder(),
        makeReminder({ id: 'reminder-2', text: 'Email the relief notes' })
    ]);

    const sticky = harness.document.querySelector('.due-reminder-sticky');
    assert.ok(sticky);
    assert.doesNotMatch(sticky.textContent, /Bring the assessment folder/);
    assert.match(sticky.textContent, /Email the relief notes/);
    harness.controller.destroy();
    harness.close();
});

test('checking a reminder completes it and removes the finished daily note', () => {
    const harness = createHarness();
    harness.controller.init();

    const checkbox = harness.document.querySelector('.due-reminder-sticky__item input');
    checkbox.checked = true;
    checkbox.dispatchEvent(new harness.document.defaultView.Event('change', { bubbles: true }));

    assert.equal(harness.document.querySelector('.due-reminder-sticky'), null);
    harness.controller.destroy();
    harness.close();
});
