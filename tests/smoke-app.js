const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const OPTIONAL_EXTERNAL_SCRIPT_URL = /^https:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\/.*\.js(?:\?|$)/i;
const EXTERNAL_ASSET_URL = /^https:\/\//i;
const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8'
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
    console.log(`PASS: ${message}`);
}

function isExpectedBlockedExternalAssetMessage(message) {
    return message.type() === 'error'
        && message.text().includes('net::ERR_BLOCKED_BY_CLIENT');
}

function createStaticServer() {
    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');
        let pathname = decodeURIComponent(requestUrl.pathname);

        if (pathname === '/') {
            pathname = '/index.html';
        }

        if (pathname.endsWith('/')) {
            pathname += 'index.html';
        }

        const resolved = path.resolve(root, pathname.replace(/^\/+/, ''));
        if (!resolved.startsWith(root)) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
        }

        fs.readFile(resolved, (error, data) => {
            if (error) {
                response.writeHead(404);
                response.end('Not found');
                return;
            }

            response.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': mimeTypes[path.extname(resolved)] || 'application/octet-stream'
            });
            response.end(data);
        });
    });
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve(`http://127.0.0.1:${address.port}`);
        });
    });
}

async function addWidget(page, widgetKey, selector, label) {
    await page.locator('#add-widget-btn').click();
    await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
    assert(await page.locator(`#widget-modal [data-widget="${widgetKey}"]`).count() > 0, `Widget picker should include ${label}`);
    await page.locator(`#widget-modal [data-widget="${widgetKey}"]`).first().click();
    await page.waitForSelector(selector, { timeout: 10000 });
    assert(await page.locator(selector).count() === 1, `${label} widget should be added to the classroom`);
}

async function waitForWidgetCount(page, expectedCount, label) {
    await page.waitForFunction((count) => {
        return document.querySelectorAll('#widgets-container .widget').length === count;
    }, expectedCount, { timeout: 10000 });
    assert(await page.locator('#widgets-container .widget').count() === expectedCount, label);
}

async function openTeacherPanel(page) {
    if (await page.locator('#teacher-panel.open').count() > 0) {
        return;
    }

    await page.locator('#teacher-controls-quick-btn').click();
    await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
}

async function closeTeacherPanel(page) {
    if (await page.locator('#teacher-panel.open').count() === 0) {
        return;
    }

    await page.locator('#close-teacher-panel').click();
    await page.waitForSelector('#teacher-panel.open', { state: 'hidden', timeout: 10000 });
}

async function dragElementBy(page, selector, deltaX, deltaY) {
    const box = await page.locator(selector).boundingBox();
    assert(!!box, `${selector} should have a bounding box before drag`);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
    await page.mouse.up();
}

async function getElementBox(page, selector) {
    const box = await page.locator(selector).boundingBox();
    assert(!!box, `${selector} should have a bounding box`);
    return box;
}

async function launchBrowser() {
    const candidates = [
        process.env.TEACHER_SCREEN_BROWSER ? { channel: process.env.TEACHER_SCREEN_BROWSER } : null,
        { channel: 'msedge' },
        { channel: 'chrome' },
        {}
    ].filter(Boolean);

    const failures = [];
    for (const candidate of candidates) {
        try {
            return await chromium.launch({ ...candidate, headless: true });
        } catch (error) {
            failures.push(`${candidate.channel || 'bundled chromium'}: ${error.message.split('\n')[0]}`);
        }
    }

    throw new Error(`Unable to launch a browser for smoke tests. Tried ${failures.join('; ')}`);
}

async function makeExternalAssetsDeterministic(context) {
    await context.route(EXTERNAL_ASSET_URL, async (route) => {
        const request = route.request();
        const url = request.url();

        if (OPTIONAL_EXTERNAL_SCRIPT_URL.test(url) && request.resourceType() === 'script') {
            // Leave optional CDN scripts pending so the app must prove it can start without them.
            return;
        }

        await route.abort('blockedbyclient');
    });
}

async function runSmoke() {
    const server = createStaticServer();
    const baseUrl = await listen(server);
    let browser;

    try {
        browser = await launchBrowser();
        const context = await browser.newContext();
        await makeExternalAssetsDeterministic(context);
        const pageErrors = [];
        const consoleErrors = [];

        context.on('page', (page) => {
            page.on('pageerror', (error) => pageErrors.push(error.message));
            page.on('console', (message) => {
                if (message.type() === 'error' && !isExpectedBlockedExternalAssetMessage(message)) {
                    consoleErrors.push(message.text());
                }
            });
        });

        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForFunction(() => Array.isArray(window.__TeacherDependencyFailures), { timeout: 10000 });
        const optionalDependencyFailures = await page.evaluate(() => window.__TeacherDependencyFailures || []);
        assert(optionalDependencyFailures.length > 0, 'Teacher app should continue after optional online scripts stall');
        assert(await page.title() === 'Custom Classroom Screen', 'Teacher app page title should load');
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Dashboard should be visible first');
        assert(await page.locator('#lesson-quick-actions').isHidden(), 'Lesson quick actions should stay hidden on the dashboard');
        assert(await page.locator('#dashboard-open-classroom-btn.dashboard-launch-card--primary').isVisible(), 'Dashboard should make Open Classroom the primary action');
        const desktopDashboardScale = await page.evaluate(() => {
            const sidebar = document.querySelector('.dashboard-sidebar')?.getBoundingClientRect();
            const launchCard = document.querySelector('.dashboard-launch-card')?.getBoundingClientRect();
            const launchCards = Array.from(document.querySelectorAll('.dashboard-launch-card'));
            const launchCardRects = launchCards.map((card) => card.getBoundingClientRect());
            const commandPanel = document.querySelector('.dashboard-command-panel');
            const lessonTitle = commandPanel?.querySelector('h1');
            const originalLessonTitle = lessonTitle?.textContent || '';
            if (lessonTitle) lessonTitle.textContent = 'Year 7 English - Persuasion Weeks 2 and 3';
            const longTitlePanelHeight = commandPanel?.getBoundingClientRect().height || 0;
            if (lessonTitle) lessonTitle.textContent = originalLessonTitle;
            return {
                sidebarWidth: sidebar?.width || 0,
                launchCardWidth: launchCard?.width || 0,
                launchCardHeight: launchCard?.height || 0,
                longTitlePanelHeight,
                launchCardsAligned: launchCardRects.every((rect) => (
                    Math.abs(rect.top - launchCardRects[0].top) < 1
                    && Math.abs(rect.height - launchCardRects[0].height) < 1
                )),
                launchCardLabels: launchCards.map((card) => card.querySelector('strong')?.textContent?.trim())
            };
        });
        assert(desktopDashboardScale.sidebarWidth <= 220, 'Desktop dashboard navigation should not crowd the lesson actions');
        assert(desktopDashboardScale.launchCardWidth >= 130 && desktopDashboardScale.launchCardWidth <= 140, 'Desktop dashboard actions should use a consistent compact width');
        assert(desktopDashboardScale.launchCardHeight >= 54 && desktopDashboardScale.launchCardHeight <= 58, 'Desktop dashboard actions should use a compact touch-friendly height');
        assert(desktopDashboardScale.launchCardsAligned, 'Desktop dashboard actions should align on one even row');
        assert(desktopDashboardScale.launchCardLabels.join('|') === 'Classroom|New Deck|Arrange|Projector', 'Dashboard actions should use concise single-line labels');
        assert(desktopDashboardScale.longTitlePanelHeight <= 112, 'Desktop dashboard command strip should stay compact with a long lesson title');
        assert(await page.locator('#tour-dialog').textContent().then((text) => !text.includes('Floating Action Button')), 'Welcome tour should not mention the old floating action button');

        if (await page.locator('#tour-dialog[open]').count() === 1) {
            await page.locator('#tour-dialog [data-close]').click();
            await page.waitForSelector('#tour-dialog[open]', { state: 'detached', timeout: 10000 });
        }

        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        assert(await page.locator('#student-view').isVisible(), 'Classroom view should open');
        assert(await page.locator('.widget-placeholder').textContent().then((text) => text.includes('quick actions')), 'Empty classroom should point teachers to quick actions');
        assert(await page.locator('#teacher-panel.open').count() === 0, 'Classroom should open in lesson mode with Teacher Controls closed');
        assert(await page.locator('#widgets-container.layout-edit-mode').count() === 0, 'Classroom should open in clean teaching mode');
        assert(await page.locator('#lesson-quick-actions').isVisible(), 'Lesson quick actions should appear in classroom mode');
        assert(await page.locator('#teacher-controls-quick-btn').isVisible(), 'Teacher Controls should remain one click away in lesson mode');
        assert(await page.locator('#lesson-quick-actions [data-quick-widget]').count() >= 4, 'Lesson quick actions should expose common live widgets');

        await page.locator('#add-widget-btn').click();
        await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
        assert(await page.locator('#widget-picker-search').isVisible(), 'Widget picker should open with a visible search field');
        const allWidgetKeys = await page.locator('#widget-modal [data-widget]').evaluateAll((buttons) => (
            buttons.map((button) => button.dataset.widget)
        ));
        assert(allWidgetKeys.length >= 14, 'Widget picker should expose the complete tool collection');
        assert(new Set(allWidgetKeys).size === allWidgetKeys.length, 'Widget picker should show each tool once without duplicate cards');
        const compactWidgetCardHeight = await page.locator('#widget-modal [data-widget]').first().evaluate((button) => (
            button.getBoundingClientRect().height
        ));
        assert(compactWidgetCardHeight <= 82, 'Widget picker cards should stay compact on desktop');
        await page.locator('#widget-picker-search').fill('noise');
        assert(await page.locator('#widget-modal [data-widget]').count() === 1, 'Widget search should narrow the picker to matching tools');
        assert(await page.locator('#widget-modal [data-widget="noise-meter"]').isVisible(), 'Widget search should find the Noise Meter');
        await page.locator('#widget-modal .widget-picker-search__clear').click();
        await page.locator('#widget-modal [data-filter="Secondary"]').click();
        assert(await page.locator('#widget-modal [data-widget="timer"]').count() === 0, 'Widget filters should hide tools from other categories');
        assert(await page.locator('#widget-modal [data-widget="notes"]').isVisible(), 'Content filter should keep matching display tools visible');
        await page.locator('#widget-modal .modal-close').click();
        await page.waitForSelector('#widget-modal[open]', { state: 'detached', timeout: 10000 });

        await page.locator('#lesson-quick-actions [data-quick-widget="rich-text"]').click();
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        assert(await page.locator('.widget.rich-text-widget').count() === 1, 'Quick Text action should add a Rich Text Board');
        assert(await page.locator('.widget.rich-text-widget .widget-header').isHidden(), 'Teaching mode should hide widget editing chrome');
        assert(await page.locator('.widget.rich-text-widget .rich-text-editor-toolbar').isVisible(), 'Rich Text toolbar should be visible in edit mode');
        await openTeacherPanel(page);
        assert(await page.locator('#widgets-container.layout-edit-mode').count() === 1, 'Opening Teacher Controls should enable arrange mode');
        const teacherControlsScale = await page.locator('#teacher-panel').evaluate((panel) => {
            const rect = panel.getBoundingClientRect();
            const headerRect = panel.querySelector('.panel-header')?.getBoundingClientRect();
            const summaries = Array.from(panel.querySelectorAll('.control-card > details > summary'));
            const deckCardRect = panel.querySelector('.control-card--project-pages')?.getBoundingClientRect();
            const newPageRect = panel.querySelector('#new-page-btn')?.getBoundingClientRect();
            const deckBodyRect = panel.querySelector('.control-card--project-pages .card-body')?.getBoundingClientRect();
            const lastCardRect = panel.querySelector('.control-card:last-child')?.getBoundingClientRect();
            const advancedSummary = panel.querySelector('.project-page-advanced > summary');
            return {
                width: rect.width,
                headerHeight: headerRect?.height || 0,
                openSectionCount: panel.querySelectorAll('.control-card > details[open]').length,
                deckCardHeight: deckCardRect?.height || 0,
                summariesCompact: summaries.every((summary) => summary.getBoundingClientRect().height <= 52),
                newPageFillsRow: (newPageRect?.width || 0) >= (deckBodyRect?.width || 0) - 24,
                lastCardVisible: (lastCardRect?.bottom || Infinity) <= window.innerHeight,
                advancedControlClosed: advancedSummary ? getComputedStyle(advancedSummary, '::after').content.includes('+') : false
            };
        });
        assert(teacherControlsScale.width >= 390 && teacherControlsScale.width <= 402, 'Desktop Teacher Controls should use a focused compact drawer width');
        assert(teacherControlsScale.headerHeight <= 70, 'Teacher Controls header should stay compact');
        assert(teacherControlsScale.openSectionCount === 1, 'Teacher Controls should open with only Deck & Pages expanded');
        assert(teacherControlsScale.deckCardHeight <= 360, 'Deck & Pages should keep the main controls within a compact card');
        assert(teacherControlsScale.summariesCompact, 'Teacher Controls section rows should share a compact height');
        assert(teacherControlsScale.newPageFillsRow, 'New Page should align to the full action row');
        assert(teacherControlsScale.lastCardVisible, 'All Teacher Controls sections should be reachable in the first desktop view');
        assert(teacherControlsScale.advancedControlClosed, 'More page actions should show the correct closed-state affordance');
        assert(await page.locator('.widget.rich-text-widget .widget-header').isVisible(), 'Arrange mode should reveal widget editing chrome');
        assert(await page.locator('.widget.rich-text-widget .widget-header-title').textContent().then((text) => text.includes('Text Board')), 'Arrange mode should use the friendly Text Board label');
        await page.locator('.widget.rich-text-widget .widget-header-settings-btn').click();
        await page.waitForSelector('#widget-settings-modal.visible', { timeout: 10000 });
        await page.locator('#widget-settings-modal .rich-text-controls--modes button', { hasText: 'Display' }).click();
        await page.locator('#widget-settings-modal .modal-close-btn').click();
        await page.waitForSelector('#widget-settings-modal.visible', { state: 'hidden', timeout: 10000 });
        assert(await page.locator('.widget.rich-text-widget .rich-text-editor-toolbar').isHidden(), 'Rich Text toolbar should hide in display mode');
        assert(await page.locator('.widget.rich-text-widget .rich-text-inline-edit-button').isVisible(), 'Rich Text display mode should expose a quick Edit button');
        await page.locator('.widget.rich-text-widget .rich-text-inline-edit-button').click();
        assert(await page.locator('.widget.rich-text-widget .rich-text-editor-toolbar').isVisible(), 'Rich Text toolbar should return after quick Edit');
        await closeTeacherPanel(page);
        assert(await page.locator('#widgets-container.layout-edit-mode').count() === 0, 'Closing Teacher Controls should return to teaching mode');
        assert(await page.locator('.widget.rich-text-widget .widget-header').isHidden(), 'Teaching mode should hide widget chrome again');

        await addWidget(page, 'timer', '.widget.pomodoro-widget', 'Pomodoro');
        await openTeacherPanel(page);
        await page.waitForTimeout(800);
        const timerBoxBeforeDrag = await getElementBox(page, '.widget.pomodoro-widget');
        const classroomCanvasBox = await getElementBox(page, '#widgets-container');
        const verticalDragDelta = timerBoxBeforeDrag.y - classroomCanvasBox.y < classroomCanvasBox.height / 2 ? 200 : -200;
        await dragElementBy(page, '.widget.pomodoro-widget .widget-header', 0, verticalDragDelta);
        const timerBoxAfterDrag = await getElementBox(page, '.widget.pomodoro-widget');
        assert(
            Math.abs(timerBoxAfterDrag.x - timerBoxBeforeDrag.x) > 20
                || Math.abs(timerBoxAfterDrag.y - timerBoxBeforeDrag.y) > 12,
            'Dragging should move a widget within the arranged canvas'
        );
        await dragElementBy(page, '.widget.pomodoro-widget .resize-handle.bottom-right', 64, 48);
        const timerBoxAfterResize = await getElementBox(page, '.widget.pomodoro-widget');
        assert(timerBoxAfterResize.width > timerBoxAfterDrag.width + 20, 'Resizing should widen a widget');
        assert(timerBoxAfterResize.height > timerBoxAfterDrag.height + 12, 'Resizing should heighten a widget');
        await closeTeacherPanel(page);

        await page.locator('#lesson-quick-actions [data-quick-widget="behaviour-tracker"]').click();
        await page.waitForSelector('.widget.behaviour-tracker-widget', { timeout: 10000 });
        const behaviourTracker = page.locator('.widget.behaviour-tracker-widget');
        assert(await behaviourTracker.locator('.behaviour-tracker-widget-content[data-mode="class"]').count() === 1, 'Track quick action should add the aggregate classroom tracker');
        assert(await behaviourTracker.locator('.behaviour-student-name, .behaviour-recent-list, .behaviour-roster-input').count() === 0, 'The classroom canvas should never render private student controls');
        await page.evaluate(() => {
            window.__behaviourBroadcasts = [];
            window.__behaviourTestChannel = new BroadcastChannel('teacher-screen-sync');
            window.__behaviourTestChannel.onmessage = (event) => {
                if (event.data?.type === 'layout-update') window.__behaviourBroadcasts.push(event.data);
            };
        });
        const behaviourPopupPromise = page.waitForEvent('popup');
        await behaviourTracker.locator('[data-action="open-controls"]').click();
        const behaviourControls = await behaviourPopupPromise;
        await behaviourControls.waitForSelector('.behaviour-tracker-widget-content[data-mode="private"]', { timeout: 10000 });
        await behaviourControls.locator('.behaviour-tracker-widget-content').press('2');
        assert(await behaviourControls.locator('[data-category-id="calling-out"]').getAttribute('aria-pressed') === 'true', 'Tracker number shortcuts should select a behaviour category');
        await behaviourControls.locator('[data-action="class-mark"]').click();
        assert(await behaviourControls.locator('.behaviour-recent-list').textContent().then((text) => text.includes('Calling out')), 'Tracker should record an anonymous class observation');
        assert(await behaviourControls.locator('.behaviour-timer-value').textContent().then((text) => text.trim() === '00:00'), 'Behaviour marks should not invent lost learning time');
        await behaviourControls.locator('[data-action="undo"]').click();
        assert(await behaviourControls.locator('.behaviour-recent-list').count() === 0, 'Tracker Undo should remove the last observation');
        await behaviourControls.locator('[data-action="class-mark"]').click();
        await behaviourControls.locator('.behaviour-roster-details summary').click();
        await behaviourControls.locator('.behaviour-roster-input').fill('Alex\nBailey');
        await behaviourControls.locator('[data-action="save-roster"]').click();
        await behaviourControls.locator('.behaviour-student-mark', { hasText: 'Alex' }).click();
        assert(await behaviourControls.locator('.behaviour-student-mark', { hasText: 'Alex' }).locator('.behaviour-student-count').textContent().then((text) => text.trim() === '1'), 'Tracker should keep private per-student observation counts');
        assert(await behaviourTracker.textContent().then((text) => !text.includes('Alex') && !text.includes('Bailey')), 'Named observations should stay out of the classroom canvas');
        await behaviourControls.locator('.behaviour-timer-toggle').click();
        await page.waitForTimeout(1100);
        const storedRunningStateIsSafe = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const tracker = state.layout?.widgets?.find((widget) => widget.type === 'BehaviourTrackerWidget');
            return tracker?.data?.runningSince === null;
        });
        assert(storedRunningStateIsSafe, 'Saved tracker state should not keep counting after the app closes');
        await behaviourControls.locator('.behaviour-timer-toggle').click();
        assert(await behaviourControls.locator('.behaviour-timer-value').textContent().then((text) => text.trim() !== '00:00'), 'Tracker should measure actual paused learning time');
        await page.waitForFunction(() => window.__behaviourBroadcasts.some((message) => {
            const tracker = message.state?.layout?.widgets?.find((widget) => widget.type === 'BehaviourTrackerWidget');
            return tracker && tracker.data?.observationCount >= 2;
        }), { timeout: 10000 });
        const projectorPayloadIsPrivate = await page.evaluate(() => {
            const message = [...window.__behaviourBroadcasts].reverse().find((candidate) => {
                return candidate.state?.layout?.widgets?.some((widget) => widget.type === 'BehaviourTrackerWidget');
            });
            const tracker = message?.state?.layout?.widgets?.find((widget) => widget.type === 'BehaviourTrackerWidget');
            return Boolean(message && !Object.prototype.hasOwnProperty.call(message.state, 'pages')
                && tracker && tracker.data?.students?.length === 0 && tracker.data?.events?.length === 0);
        });
        assert(projectorPayloadIsPrivate, 'Projector sync should contain aggregate tracker data only');

        await addWidget(page, 'drawing-tool', '.widget.drawing-tool-widget', 'Drawing Tool');
        assert(await page.locator('.widget.drawing-tool-widget .drawing-tool-tool').count() >= 4, 'Drawing Tool should expose compact tool choices');
        assert(await page.locator('.widget.drawing-tool-widget .drawing-tool-swatch').count() >= 4, 'Drawing Tool should expose quick colour swatches');
        assert(await page.locator('.drawing-board').count() === 0, 'Legacy fixed drawing board should not be present during lesson mode');
        await addWidget(page, 'quiz-game', '.widget.quiz-game-widget', 'Quiz Game');
        await page.locator('.widget.quiz-game-widget button', { hasText: 'Reveal Answer' }).click();
        await page.waitForSelector('.widget.quiz-game-widget .quiz-game-answer.is-correct', { timeout: 10000 });
        assert(await page.locator('.widget.quiz-game-widget .quiz-game-answer.is-correct').count() >= 1, 'Quiz Game should reveal the correct answer');
        await page.locator('.widget.quiz-game-widget .quiz-game-score-actions button', { hasText: '+1' }).first().click();
        assert(await page.locator('.widget.quiz-game-widget .quiz-game-team-score').first().textContent().then((text) => text.trim() === '1'), 'Quiz Game should update team score');
        await addWidget(page, 'reveal-manager', '.widget.reveal-manager-widget', 'Slides');
        await page.locator('.widget.reveal-manager-widget .reveal-toggle-controls-btn').click();
        await page.locator('.widget.reveal-manager-widget .reveal-deck-name').fill('Smoke Reveal Deck');
        await page.locator('.widget.reveal-manager-widget .reveal-content-textarea').fill('<section><h2>Smoke Slide</h2><p>Deck content</p></section>');
        await page.locator('.widget.reveal-manager-widget .reveal-launch-btn').click();
        await page.waitForSelector('.widget.reveal-manager-widget .reveal-inline-deck .slides section', { timeout: 10000 });
        await page.waitForFunction(() => {
            const status = document.querySelector('.widget.reveal-manager-widget .reveal-presenter-status');
            return status && /Unable to load Reveal deck/i.test(status.textContent || '');
        }, undefined, { timeout: 10000 });
        assert(await page.locator('.widget.reveal-manager-widget .reveal-presenter-status').textContent().then((text) => /Unable to load Reveal deck/i.test(text)), 'Slides should fail gracefully when Reveal.js is unavailable');

        await addWidget(page, 'url-viewer', '.widget.url-viewer-widget', 'Web Page');

        await addWidget(page, 'notes', '.widget.notes-widget', 'Quick Notes');
        await page.locator('.widget.notes-widget .notes-main-display').click({ force: true });
        await page.waitForSelector('.widget.notes-widget .notes-editor-wrapper', { timeout: 10000 });
        assert(await page.locator('.widget.notes-widget .notes-fallback-editor').isVisible(), 'Notes should expose a plain editor when Quill is unavailable');
        await page.locator('.widget.notes-widget .notes-fallback-editor').fill('Smoke note for classroom follow-up checks');
        await page.locator('.widget.notes-widget button', { hasText: 'Save and Close' }).click();
        await page.waitForSelector('.widget.notes-widget .notes-main-display', { timeout: 10000 });
        assert(await page.locator('.widget.notes-widget .notes-preview-snippet').textContent().then((text) => text.includes('Smoke note')), 'Notes should save text with the fallback editor');
        await page.locator('#notes-tab').dispatchEvent('click');
        await page.waitForSelector('#notes-view:not([hidden])', { timeout: 10000 });
        assert(await page.locator('#saved-notes-list').textContent().then((text) => text.includes('Smoke note')), 'Saved Notes view should list the fallback note');
        await page.locator('#planner-tab').dispatchEvent('click');
        await page.waitForSelector('#planner-view:not([hidden])', { timeout: 10000 });
        const plannerTemplateName = `Smoke Planner ${Date.now()}`;
        await page.locator('#planner-layout-name-input').fill(plannerTemplateName);
        await page.locator('#planner-save-layout-btn').click();
        await page.waitForFunction((name) => localStorage.getItem(`layouts_${name}`) !== null, plannerTemplateName, { timeout: 10000 });
        assert(await page.locator('#saved-layouts-list').textContent().then((text) => text.includes(plannerTemplateName)), 'Planner should list a saved template');
        await page.locator('#open-weekly-planner-btn').click();
        await page.waitForSelector('#planner-modal.visible', { timeout: 10000 });
        await page.locator('.planner-slot').first().click();
        await page.locator('.layout-dropdown').selectOption(plannerTemplateName);
        await page.waitForFunction((name) => {
            const schedule = JSON.parse(localStorage.getItem('teacherScreenSchedule') || '{}');
            return Object.values(schedule).some((entry) => (
                entry === name || (entry && typeof entry === 'object' && entry.layout === name)
            ));
        }, plannerTemplateName, { timeout: 10000 });
        assert(true, 'Planner should schedule a saved template into a weekly slot');
        await page.locator('#planner-modal .modal-close-btn').click();
        await page.waitForSelector('#planner-modal.visible', { state: 'hidden', timeout: 10000 });
        await page.locator('#classroom-tab').dispatchEvent('click');
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await waitForWidgetCount(page, 8, 'Deck page one should contain the tracker, quick text, and smoke-test widgets');

        await openTeacherPanel(page);
        await page.locator('#new-page-btn').click();
        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state && Array.isArray(state.pages) && state.pages.length >= 2;
        }, { timeout: 10000 });
        await waitForWidgetCount(page, 0, 'New deck page should start blank');
        assert(behaviourControls.isClosed(), 'Changing deck pages should close the old private behaviour controls');
        assert(await page.locator('.widget-placeholder').textContent().then((text) => text.includes('quick actions')), 'New blank page should keep the quick-action empty state');

        await page.locator('#teacher-page-switcher [data-page-id]').first().click();
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.drawing-tool-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.quiz-game-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.reveal-manager-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.url-viewer-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.notes-widget', { timeout: 10000 });
        await waitForWidgetCount(page, 8, 'Switching back to deck page one should restore its widgets');

        await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const makeLegacyLayoutOversized = (layout) => {
                if (!layout || !Array.isArray(layout.widgets)) return;
                const slides = layout.widgets.find((widget) => widget.type === 'RevealManagerWidget');
                const webPage = layout.widgets.find((widget) => widget.type === 'UrlViewerWidget');
                if (slides) slides.height = 1600;
                if (webPage) webPage.width = 160;
            };

            makeLegacyLayoutOversized(state.layout);
            const activePage = Array.isArray(state.pages)
                ? state.pages.find((candidate) => candidate?.id === state.activePageId)
                : null;
            makeLegacyLayoutOversized(activePage?.snapshot?.layout);
            localStorage.setItem('classroomScreenState', JSON.stringify(state));
        });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.drawing-tool-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.quiz-game-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.reveal-manager-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.url-viewer-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.notes-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.behaviour-tracker-widget', { timeout: 10000 });
        const reloadedTracker = page.locator('.widget.behaviour-tracker-widget');
        assert(await reloadedTracker.textContent().then((text) => !text.includes('Alex') && !text.includes('Bailey')), 'Reloaded classroom canvas should still hide the private roster');
        const privateRosterPersisted = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const tracker = state.layout?.widgets?.find((widget) => widget.type === 'BehaviourTrackerWidget');
            return tracker?.data?.students?.some((student) => student.name === 'Alex') === true;
        });
        assert(privateRosterPersisted, 'Reload should keep the private tracker roster in local teacher state');
        await waitForWidgetCount(page, 8, 'Reload should keep the active deck page widgets');
        const restoredLayoutFits = await page.evaluate(() => {
            const canvas = document.querySelector('#widgets-container')?.getBoundingClientRect();
            const slides = document.querySelector('.widget.reveal-manager-widget')?.getBoundingClientRect();
            if (!canvas || !slides) return false;
            return slides.top >= canvas.top - 1
                && slides.left >= canvas.left - 1
                && slides.right <= canvas.right + 1
                && slides.bottom <= canvas.bottom + 1;
        });
        assert(restoredLayoutFits, 'Oversized saved widgets should be fitted inside the classroom canvas on reload');
        assert(await page.locator('.widget.url-viewer-widget').evaluate((element) => element.getBoundingClientRect().width >= 400), 'Narrow saved web-page widgets should restore at a readable width');

        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state && state.layout && Array.isArray(state.layout.widgets) && state.layout.widgets.length >= 8;
        }, { timeout: 10000 });
        const savedWidgetCount = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state && state.layout && Array.isArray(state.layout.widgets)
                ? state.layout.widgets.length
                : 0;
        });
        assert(savedWidgetCount >= 8, 'Classroom state should save all smoke-test widgets');

        await openTeacherPanel(page);

        const smokeScreenName = `Smoke Deck ${Date.now()}`;
        await page.locator('#project-screen-name-input').fill(smokeScreenName);
        await page.locator('#save-project-screen-btn').click();
        await page.waitForFunction((name) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return Array.isArray(presets) && presets.some((preset) => preset && preset.name === name);
        }, smokeScreenName, { timeout: 10000 });
        assert(true, 'Named classroom deck should save');

        await page.evaluate(() => {
            localStorage.removeItem('classroomScreenState');
            localStorage.removeItem('classroomScreenState.backup1');
            localStorage.removeItem('classroomScreenState.backup2');
            localStorage.removeItem('classroomScreenState.backup3');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForSelector('#dashboard-load-latest-btn', { timeout: 10000 });
        await page.locator('#dashboard-load-latest-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.drawing-tool-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.quiz-game-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.reveal-manager-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.url-viewer-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.notes-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.behaviour-tracker-widget', { timeout: 10000 });
        assert(await page.locator('.widget.rich-text-widget').count() === 1, 'Saved deck should reload the quick Rich Text widget');
        assert(await page.locator('.widget.pomodoro-widget').count() === 1, 'Saved deck should reload the Pomodoro widget');
        assert(await page.locator('.widget.drawing-tool-widget').count() === 1, 'Saved deck should reload the Drawing Tool widget');
        assert(await page.locator('.widget.quiz-game-widget').count() === 1, 'Saved deck should reload the Quiz Game widget');
        assert(await page.locator('.widget.reveal-manager-widget').count() === 1, 'Saved deck should reload the Slides widget');
        assert(await page.locator('.widget.url-viewer-widget').count() === 1, 'Saved deck should reload the Web Page widget');
        assert(await page.locator('.widget.notes-widget').count() === 1, 'Saved deck should reload the Notes widget');
        assert(await page.locator('.widget.behaviour-tracker-widget').count() === 1, 'Saved deck should reload the learning-time tracker');
        assert(await page.locator('.widget.behaviour-tracker-widget').textContent().then((text) => !text.includes('Alex') && !text.includes('Bailey')), 'Saved deck should keep names off the classroom canvas');

        await page.locator('#dashboard-tab').dispatchEvent('click');
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        assert(await page.locator('.dashboard-screen-card.is-current .dashboard-current-badge').count() === 1, 'Dashboard should identify the loaded current deck');
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });

        const projectorPage = await context.newPage();
        await projectorPage.goto(`${baseUrl}/projector.html`, { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForSelector('.widget.rich-text-widget', { timeout: 15000 });
        await projectorPage.waitForSelector('.widget.pomodoro-widget', { timeout: 15000 });
        await projectorPage.waitForSelector('.widget.behaviour-tracker-widget', { timeout: 15000 });
        assert(await projectorPage.locator('.widget.rich-text-widget').count() === 1, 'Projector should render the quick Rich Text widget');
        assert(await projectorPage.locator('.widget.pomodoro-widget').count() === 1, 'Projector should render the saved Pomodoro widget');
        assert(await projectorPage.locator('.widget.drawing-tool-widget').count() === 1, 'Projector should render the saved Drawing Tool widget');
        const publicTracker = projectorPage.locator('.widget.behaviour-tracker-widget');
        assert(await publicTracker.locator('.behaviour-tracker-widget-content[data-mode="public"]').count() === 1, 'Projector should render the aggregate class tracker view');
        assert(await publicTracker.locator('.behaviour-timer-value').textContent().then((text) => text.trim() !== '00:00'), 'Projector should show the saved class lost-time total');
        assert(await publicTracker.locator('.behaviour-student-name').count() === 0, 'Projector tracker should not render student-name controls');
        assert(await publicTracker.textContent().then((text) => !text.includes('Alex') && !text.includes('Bailey')), 'Projector tracker should keep individual names private');

        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#reset-layout').dispatchEvent('click');
        await waitForWidgetCount(page, 0, 'Clear Current Page should remove the active widgets');
        assert(await page.locator('.widget.behaviour-tracker-widget').count() === 0, 'Clear Current Page should discard the active behaviour tracker');

        const presentationPage = await context.newPage();
        await presentationPage.goto(`${baseUrl}/presentations/year7-rhetoric-marine-turtles/slides.html`, { waitUntil: 'domcontentloaded' });
        assert(await presentationPage.locator('body').textContent().then((text) => text.toLowerCase().includes('marine turtles')), 'Local presentation link should load its slide content');

        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 390, height: 844 });
        await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        assert(await mobilePage.locator('#dashboard-open-classroom-btn').isVisible(), 'Mobile dashboard should show the classroom entry button');
        assert(await mobilePage.locator('.dashboard-command-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length === 2), 'Mobile dashboard should keep quick actions in a compact two-column grid');
        assert(await mobilePage.locator('.dashboard-launch-card').first().evaluate((element) => element.getBoundingClientRect().height <= 58), 'Mobile dashboard actions should keep the compact toolbar height');
        assert(await mobilePage.locator('.dashboard-sidebar').evaluate((element) => element.getBoundingClientRect().height < 270), 'Mobile dashboard navigation should stay compact');
        assert(await mobilePage.locator('.dashboard-command-panel').evaluate((element) => element.getBoundingClientRect().height < 300), 'Mobile dashboard lesson actions should stay above the deck library');
        assert(await mobilePage.locator('.dashboard-library-panel').evaluate((element) => element.getBoundingClientRect().top < 600), 'Mobile dashboard should bring the deck library into the first screenful');
        await mobilePage.locator('#dashboard-open-classroom-btn').click();
        await mobilePage.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        assert(await mobilePage.locator('#lesson-quick-actions').isVisible(), 'Mobile classroom should show lesson quick actions');
        await openTeacherPanel(mobilePage);
        const mobileTeacherControlsScale = await mobilePage.locator('#teacher-panel').evaluate((panel) => {
            const panelRect = panel.getBoundingClientRect();
            const lastCardRect = panel.querySelector('.control-card:last-child')?.getBoundingClientRect();
            return {
                width: panelRect.width,
                openSectionCount: panel.querySelectorAll('.control-card > details[open]').length,
                lastCardVisible: (lastCardRect?.bottom || Infinity) <= window.innerHeight
            };
        });
        assert(Math.abs(mobileTeacherControlsScale.width - 390) < 1, 'Mobile Teacher Controls should use the full screen width');
        assert(mobileTeacherControlsScale.openSectionCount === 1, 'Mobile Teacher Controls should keep one focused section open');
        assert(mobileTeacherControlsScale.lastCardVisible, 'Mobile Teacher Controls should show all section choices without initial scrolling');
        assert(await mobilePage.locator('#top-nav').evaluate((element) => getComputedStyle(element).opacity === '0'), 'Mobile Teacher Controls should not be obscured by the Home button');
        await closeTeacherPanel(mobilePage);

        assert(pageErrors.length === 0, `Browser page errors should be absent (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Browser console errors should be absent (${consoleErrors.join('; ')})`);
        console.log('Teacher Screen smoke test passed.');
    } finally {
        if (browser) {
            await browser.close();
        }
        await new Promise((resolve) => server.close(resolve));
    }
}

runSmoke().catch((error) => {
    console.error(`Smoke test failed: ${error.message}`);
    process.exit(1);
});
