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

function buildMockAiProposal(payload = {}) {
    if (payload.mode !== 'quiz') {
        return {
            kind: 'teaching-content',
            title: 'Equivalent Fractions Instructions',
            summary: 'A short set of student-ready instructions for the current lesson.',
            yearLevel: payload.settings?.yearLevel || 'Year 7',
            subject: payload.settings?.subject || 'Mathematics',
            contentType: payload.task || 'student-instructions',
            blocks: [
                {
                    type: 'heading',
                    heading: 'Your task',
                    text: 'Show that two fractions have the same value.',
                    items: []
                },
                {
                    type: 'numbered',
                    heading: 'Steps',
                    text: '',
                    items: ['Choose a fraction.', 'Multiply the numerator and denominator by the same number.', 'Check the values match.']
                }
            ]
        };
    }

    const count = Math.max(3, Math.min(20, Number.parseInt(payload.settings?.questionCount, 10) || 3));
    return {
        kind: 'quiz',
        title: 'Equivalent Fractions Match-Up',
        summary: 'Match each fraction to an equivalent value.',
        yearLevel: payload.settings?.yearLevel || 'Year 7',
        subject: payload.settings?.subject || 'Mathematics',
        difficulty: payload.settings?.difficulty || 'standard',
        quizFormat: payload.task || 'matching',
        responseMode: payload.settings?.responseMode || 'teams',
        showAnswers: payload.settings?.showAnswers !== false,
        showExplanations: payload.settings?.showExplanations === true,
        teams: ['Team 1', 'Team 2'],
        questions: Array.from({ length: count }, (_, index) => ({
            type: 'matching',
            category: 'Equivalent fractions',
            points: index + 1,
            prompt: `Match equivalent fraction set ${index + 1}.`,
            choices: ['1/2', '2/3', '3/4'],
            answerIndex: 0,
            answerText: `${index + 1}/${(index + 1) * 2} matches 1/2`,
            acceptedAnswers: ['1/2'],
            pairs: [{ left: `${index + 1}/${(index + 1) * 2}`, right: '1/2' }],
            items: [],
            explanation: 'Multiplying or dividing the numerator and denominator by the same number keeps the value equal.'
        }))
    };
}

function createStaticServer() {
    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');
        let pathname = decodeURIComponent(requestUrl.pathname);

        if (pathname === '/api/teaching-assistant') {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (request.method === 'GET') {
                response.writeHead(200);
                response.end(JSON.stringify({ ok: true, configured: true, model: 'smoke-test-model' }));
                return;
            }
            if (request.method !== 'POST') {
                response.writeHead(405);
                response.end(JSON.stringify({ error: { message: 'Method not allowed.' } }));
                return;
            }

            const chunks = [];
            request.on('data', (chunk) => chunks.push(chunk));
            request.on('end', () => {
                try {
                    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                    response.writeHead(200);
                    response.end(JSON.stringify({
                        proposal: buildMockAiProposal(payload),
                        model: 'smoke-test-model',
                        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
                        limits: { requestsPerHour: 30, requestsPerDay: 100 }
                    }));
                } catch (error) {
                    response.writeHead(400);
                    response.end(JSON.stringify({ error: { message: 'Invalid mock request.' } }));
                }
            });
            return;
        }

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

    await page.locator('#add-widget-btn').click();
    await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
    await page.locator('#widget-picker-teacher-controls-btn').click();
    await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
}

async function closeTeacherPanel(page) {
    if (await page.locator('#teacher-panel.open').count() === 0) {
        return;
    }

    await page.locator('#close-teacher-panel').click();
    await page.waitForSelector('#teacher-panel.open', { state: 'hidden', timeout: 10000 });
}

async function installMenuSafetyFixture(context) {
    await context.addInitScript(() => {
        let storage;
        try {
            storage = window.localStorage;
        } catch (_error) {
            // Download/object-URL documents have opaque origins. They do not
            // need the app fixture and cannot safely access localStorage.
            return;
        }

        const originalDeckId = 'menu-safety-original';
        const otherDeckId = 'menu-safety-other';
        const makePage = (id, name, background, lessonText, widgets = []) => ({
            id,
            name,
            snapshot: {
                theme: 'theme-ocean',
                background: { type: 'solid', value: background },
                layout: { mode: 'dashboard', widgets },
                timerStates: [],
                lessonPlan: [{ insert: `${lessonText}\n` }]
            }
        });
        const makeState = (id, name, page) => ({
            version: '2.3.0',
            schemaVersion: 1,
            currentDeckId: id,
            projectName: name,
            activeDeckId: id,
            activeClassId: 'class-menu-safety',
            activeClassName: 'Menu Safety Class',
            activePageId: page.id,
            pages: [page],
            theme: page.snapshot.theme,
            background: page.snapshot.background,
            layout: page.snapshot.layout,
            timerStates: page.snapshot.timerStates,
            lessonPlan: page.snapshot.lessonPlan
        });
        const originalPage = makePage('menu-safety-page', 'Welcome', '#123b5d', 'Keep this lesson plan');
        const otherPage = makePage('menu-safety-other-page', 'Other', '#352151', 'Other deck plan');
        const originalState = makeState(originalDeckId, 'Menu Safety Original', originalPage);
        const otherState = makeState(otherDeckId, 'Menu Safety Other', otherPage);
        const now = Date.now();
        const toPreset = (state, createdAt) => ({
            id: state.currentDeckId,
            name: state.projectName,
            classId: state.activeClassId,
            className: state.activeClassName,
            period: '',
            folderId: '',
            projectState: state,
            theme: state.theme,
            background: state.background,
            layout: state.layout,
            lessonPlan: state.lessonPlan,
            createdAt,
            updatedAt: createdAt,
            lastUsedAt: createdAt,
            usageCount: 1,
            isFavorite: false
        });

        storage.setItem('classroomScreenState', JSON.stringify(originalState));
        storage.setItem('classroomLayoutPresets', JSON.stringify([
            toPreset(originalState, now - 1000),
            toPreset(otherState, now - 2000)
        ]));
        storage.setItem('teacherScreenOceanDefaultMigrated', '1');
        storage.setItem('selectedTheme', 'theme-ocean');

    });
}

function getMenuSafetyImportPayload() {
    const importedDeckId = 'menu-safety-imported';
    const importedPage = {
        id: 'menu-safety-imported-page',
        name: 'Imported page',
        snapshot: {
            theme: 'theme-ocean',
            background: { type: 'solid', value: '#164e63' },
            layout: { mode: 'dashboard', widgets: [] },
            timerStates: [],
            lessonPlan: [{ insert: 'Imported lesson plan\n' }]
        }
    };
    const state = {
        version: '2.3.0',
        schemaVersion: 1,
        currentDeckId: importedDeckId,
        projectName: 'Menu Safety Imported',
        activeDeckId: importedDeckId,
        activeClassId: 'class-imported',
        activeClassName: 'Imported Class',
        activePageId: importedPage.id,
        pages: [importedPage],
        theme: importedPage.snapshot.theme,
        background: importedPage.snapshot.background,
        layout: importedPage.snapshot.layout,
        timerStates: [],
        lessonPlan: importedPage.snapshot.lessonPlan
    };
    return JSON.stringify({
        schemaVersion: 1,
        appVersion: '2.3.0',
        state,
        presets: [{
            id: importedDeckId,
            name: state.projectName,
            classId: state.activeClassId,
            className: state.activeClassName,
            period: '',
            folderId: '',
            projectState: state,
            theme: state.theme,
            background: state.background,
            layout: state.layout,
            lessonPlan: state.lessonPlan,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastUsedAt: Date.now(),
            usageCount: 0,
            isFavorite: false
        }],
        folders: [],
        reminders: { schemaVersion: 1, reminders: [] }
    });
}

async function openScreenDeckTools(page) {
    await page.locator('#dashboard-deck-tools-btn').click();
    await page.waitForSelector('#screen-deck-manager-dialog[open]', { timeout: 10000 });
}

async function openClassroomRemindersFromWidgetMenu(page) {
    const reminderDock = page.locator('#classroom-reminder-dock');
    if (await reminderDock.isVisible()) {
        return;
    }

    if (await page.locator('#widget-modal[open]').count() === 0) {
        await page.locator('#add-widget-btn').click();
        await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
    }

    const reminderAction = page.locator('#widget-modal .widget-picker-footer__actions #classroom-reminder-launcher');
    await reminderAction.waitFor({ state: 'visible', timeout: 10000 });
    await reminderAction.click();
    await page.waitForSelector('#widget-modal[open]', { state: 'detached', timeout: 10000 });
    await page.waitForSelector('#classroom-reminder-dock:not([hidden])', { timeout: 10000 });
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

async function getPairedProjectorUrl(page, baseUrl) {
    const syncToken = await page.evaluate(() => window.__TeacherProjectorSyncToken || '');
    assert(Boolean(syncToken), 'Teacher window should provide a projector pairing token');
    const projectorUrl = new URL(`${baseUrl}/projector.html`);
    projectorUrl.searchParams.set('syncToken', syncToken);
    return projectorUrl.toString();
}

async function runWidgetSaveNotificationChecks(browser, baseUrl) {
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);
    await context.addInitScript(() => {
        window.QRCode = {
            toCanvas: () => Promise.resolve()
        };
    });

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForFunction(() => Array.isArray(window.__TeacherDependencyFailures), { timeout: 10000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });

        await addWidget(page, 'name-picker', '.widget.name-picker-widget', 'Random Name Picker');
        await addWidget(page, 'qr-code', '.qr-code-widget-content', 'QR Code');
        await addWidget(page, 'document-viewer', '.widget.document-viewer-widget', 'Document Viewer');
        await addWidget(page, 'wellbeing', '.widget.wellbeing-widget', 'Well-being Check-in');

        // Let the normal add-widget save settle before proving later widget actions save themselves.
        await page.waitForTimeout(700);

        const nameDisplay = page.locator('.widget.name-picker-widget .name-picker-display');
        await nameDisplay.dispatchEvent('click');
        await page.waitForFunction(() => {
            const text = document.querySelector('.widget.name-picker-widget .name-picker-display')?.textContent?.trim();
            return text && text !== 'Click to pick' && text !== 'All Picked';
        }, { timeout: 10000 });
        await page.waitForTimeout(1800);
        const pickedName = (await nameDisplay.textContent()).trim();

        const qrText = 'https://example.com/teacher-screen-save-check';
        const qrWidget = page.locator('.qr-code-widget-content');
        await qrWidget.locator('.qr-input').evaluate((input, value) => {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }, qrText);
        await qrWidget.getByRole('button', { name: 'Generate' }).dispatchEvent('click');

        const documentUrl = 'https://example.com/document-save-check';
        const documentWidget = page.locator('.widget.document-viewer-widget');
        await documentWidget.locator('.document-viewer-url-input').evaluate((input, value) => {
            input.value = value;
        }, documentUrl);
        await documentWidget.locator('.embed-button').dispatchEvent('click');

        const wellbeingWidget = page.locator('.widget.wellbeing-widget');
        await wellbeingWidget.locator('.wellbeing-option[data-key="great"]').dispatchEvent('click');
        await wellbeingWidget.locator('.wellbeing-toggle-btn').dispatchEvent('click');

        await page.waitForFunction(({ expectedName, expectedQrText, expectedDocumentUrl }) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const widgets = state.layout?.widgets || [];
            const byType = (type) => widgets.find((widget) => widget.type === type)?.data;
            return byType('NamePickerWidget')?.lastPicked === expectedName
                && byType('QRCodeWidget')?.text === expectedQrText
                && byType('DocumentViewerWidget')?.url === expectedDocumentUrl
                && byType('WellbeingWidget')?.currentMode === 'dashboard'
                && byType('WellbeingWidget')?.counts?.great === 1;
        }, {
            expectedName: pickedName,
            expectedQrText: qrText,
            expectedDocumentUrl: documentUrl
        }, { timeout: 10000 });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.waitForSelector('.widget.name-picker-widget', { timeout: 10000 });
        await page.waitForSelector('.qr-code-widget-content', { timeout: 10000 });
        await page.waitForSelector('.widget.document-viewer-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.wellbeing-widget', { timeout: 10000 });

        assert((await page.locator('.widget.name-picker-widget .name-picker-display').textContent()).trim() === pickedName, 'Delayed Random Name Picker actions should survive reload');
        assert(await page.locator('.qr-code-widget-content .qr-input').inputValue() === qrText, 'Delayed QR Code changes should survive reload');
        assert(await page.locator('.widget.document-viewer-widget iframe').getAttribute('src') === documentUrl, 'Delayed Document Viewer changes should survive reload');
        assert(await page.locator('.widget.wellbeing-widget .wellbeing-dashboard-mode.active').count() === 1, 'Delayed Well-being mode changes should survive reload');
        await page.locator('.widget.wellbeing-widget button', { hasText: "Save Today's Check-in" }).dispatchEvent('click');
        await page.locator('.widget.wellbeing-widget button', { hasText: 'View History' }).dispatchEvent('click');
        assert(await page.locator('.wellbeing-history-dialog').textContent().then((text) => text.includes('Great: 1')), 'Delayed Well-being responses should survive reload');
    } finally {
        await context.close();
    }
}

async function runMenuSafetyChecks(browser, baseUrl) {
    const context = await browser.newContext({ acceptDownloads: true });
    await makeExternalAssetsDeterministic(context);
    await installMenuSafetyFixture(context);
    const pageErrors = [];
    const consoleErrors = [];
    context.on('page', (openedPage) => {
        openedPage.on('pageerror', (error) => pageErrors.push(error.message));
        openedPage.on('console', (message) => {
            if (message.type() === 'error' && !isExpectedBlockedExternalAssetMessage(message)) {
                consoleErrors.push(message.text());
            }
        });
    });

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });

        assert(await page.locator('#sections-toggle').getAttribute('aria-label') === 'Classroom Home', 'Classroom Home should have an explicit accessible name');
        assert(await page.locator('#sections-toggle').getAttribute('aria-haspopup') === null, 'Classroom Home should not claim to open the Sections menu');
        assert(await page.locator('#sections-toggle').getAttribute('aria-controls') === null, 'Classroom Home should not control a menu it does not open');
        assert(await page.locator('#main-page-next').getAttribute('aria-label') === 'Add page', 'The last-page control should announce Add page');
        assert(await page.locator('#main-page-next').textContent().then((text) => text.trim() === '+'), 'The last-page Add page control should show a visible plus glyph');

        const closedTeacherPanelState = await page.locator('#teacher-panel').evaluate((panel) => {
            return {
                ariaHidden: panel.getAttribute('aria-hidden'),
                inert: panel.inert
            };
        });
        assert(closedTeacherPanelState.ariaHidden === 'true' && closedTeacherPanelState.inert, 'Closed Teacher Controls should be aria-hidden and inert');
        await page.locator('#main-page-next').focus();
        await page.keyboard.press('Tab');
        assert(await page.locator('#teacher-panel').evaluate((panel) => !panel.contains(document.activeElement)), 'Keyboard navigation should skip closed Teacher Controls');

        await page.locator('#add-widget-btn').click();
        await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
        const teacherControlsLauncher = page.locator('#widget-modal .widget-picker-footer__actions #widget-picker-teacher-controls-btn');
        assert(await teacherControlsLauncher.count() === 1 && await teacherControlsLauncher.isVisible(), 'Add Widget should include a visible Teacher Controls button');
        await teacherControlsLauncher.click();
        await page.waitForSelector('#widget-modal[open]', { state: 'detached', timeout: 10000 });
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        await page.waitForFunction(() => document.querySelector('#teacher-panel')?.contains(document.activeElement), null, { timeout: 10000 });
        assert(await page.locator('#teacher-panel').getAttribute('aria-hidden') === 'false', 'Open Teacher Controls should be exposed to assistive technology');
        assert(await page.locator('#teacher-panel').evaluate((panel) => panel.inert === false && panel.contains(document.activeElement)), 'Open Teacher Controls should be interactive and receive keyboard focus');
        assert(await page.locator('#teacher-panel .panel-eyebrow').textContent().then((text) => text.trim() === 'Classroom setup'), 'Teacher Controls should use the classroom setup eyebrow');
        assert(await page.locator('#teacher-panel .control-card--project-pages h4').textContent().then((text) => text.trim() === 'Current deck and pages'), 'Teacher Controls should clearly name current deck and page controls');
        assert(await page.locator('#save-project-screen-btn').textContent().then((text) => text.trim() === 'Save current deck'), 'Teacher Controls should label its current-deck save action');
        await page.keyboard.press('Shift+Tab');
        assert(await page.locator('#teacher-panel').evaluate((panel) => panel.contains(document.activeElement)), 'Shift+Tab should stay inside Teacher Controls');
        await page.keyboard.press('Tab');
        assert(await page.locator('#teacher-panel').evaluate((panel) => panel.contains(document.activeElement)), 'Tab should stay inside Teacher Controls');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#teacher-panel.open', { state: 'hidden', timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.id === 'add-widget-btn', null, { timeout: 10000 });
        assert(await page.locator('#add-widget-btn').evaluate((element) => document.activeElement === element), 'Escape should close Teacher Controls and restore focus to Add Widget');

        await page.locator('#lesson-quick-actions [data-quick-widget="rich-text"]').click();
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        await page.waitForFunction(() => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.id === 'menu-safety-original');
            const activePage = preset?.projectState?.pages?.find((candidate) => candidate?.id === preset?.projectState?.activePageId)
                || preset?.projectState?.pages?.[0];
            return activePage?.snapshot?.layout?.widgets?.some((widget) => widget?.type === 'RichTextWidget');
        }, null, { timeout: 10000 });
        const editedPreset = await page.evaluate(() => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.find((preset) => preset?.id === 'menu-safety-original');
        });
        const editedPresetPage = editedPreset?.projectState?.pages?.find((candidate) => candidate?.id === editedPreset?.projectState?.activePageId)
            || editedPreset?.projectState?.pages?.[0];
        assert(editedPresetPage?.snapshot?.layout?.widgets?.some((widget) => widget?.type === 'RichTextWidget'), 'Current deck widget edits should autosave into its saved Deck Library record');

        const richTextMenuButton = page.locator('.widget.rich-text-widget .widget-header-menu__toggle');
        await richTextMenuButton.click();
        const settingsLauncher = page.locator('.widget.rich-text-widget .widget-header-settings-btn');
        await settingsLauncher.click();
        await page.waitForSelector('#widget-settings-modal.visible', { timeout: 10000 });
        const settingsDialogState = await page.locator('#widget-settings-modal').evaluate((modal) => ({
            role: modal.getAttribute('role'),
            modal: modal.getAttribute('aria-modal'),
            labelledBy: modal.getAttribute('aria-labelledby'),
            containsFocus: modal.contains(document.activeElement)
        }));
        assert(settingsDialogState.role === 'dialog' && settingsDialogState.modal === 'true' && settingsDialogState.labelledBy, 'Widget settings should expose modal dialog semantics and an accessible title');
        assert(settingsDialogState.containsFocus, 'Widget settings should receive focus when opened');
        await page.keyboard.press('Shift+Tab');
        assert(await page.locator('#widget-settings-modal').evaluate((modal) => modal.contains(document.activeElement)), 'Shift+Tab should stay inside Widget settings');
        await page.keyboard.press('Tab');
        assert(await page.locator('#widget-settings-modal').evaluate((modal) => modal.contains(document.activeElement)), 'Tab should stay inside Widget settings');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#widget-settings-modal.visible', { state: 'hidden', timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.classList?.contains('widget-header-menu__toggle'), null, { timeout: 10000 });
        assert(await richTextMenuButton.evaluate((element) => document.activeElement === element), 'Escape should close Widget settings and restore focus to the visible widget options launcher');

        await page.locator('#sections-toggle').dispatchEvent('click');
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        await page.locator('.dashboard-screen-card[data-deck-id="menu-safety-other"] [data-deck-action="toggle"]').click();
        await page.locator('.dashboard-screen-card[data-deck-id="menu-safety-other"] [data-deck-action="open"]').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.locator('#sections-toggle').dispatchEvent('click');
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        await page.locator('.dashboard-screen-card[data-deck-id="menu-safety-original"] [data-deck-action="toggle"]').click();
        await page.locator('.dashboard-screen-card[data-deck-id="menu-safety-original"] [data-deck-action="open"]').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        assert(await page.locator('.widget.rich-text-widget').count() === 1, 'Autosaved widgets should survive switching to another deck and back');

        await page.locator('.widget.rich-text-widget .widget-header-menu__toggle').click();
        await page.locator('.widget.rich-text-widget .widget-header-settings-btn').click();
        await page.waitForSelector('#widget-settings-modal.visible', { timeout: 10000 });
        await page.locator('#widget-settings-modal .modal-danger-btn', { hasText: 'Remove Widget' }).click();
        await page.waitForSelector('.widget.rich-text-widget', { state: 'detached', timeout: 10000 });
        await page.waitForSelector('#widget-settings-modal.visible', { state: 'hidden', timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.id === 'add-widget-btn', null, { timeout: 10000 });
        assert(await page.locator('#add-widget-btn').evaluate((element) => document.activeElement === element), 'Closing settings after removing its widget should move focus to Add widget');
        await page.waitForTimeout(700);

        await page.locator('#sections-toggle').click();
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        const dashboardMore = page.locator('#dashboard-utility-menu > summary');
        await dashboardMore.click();
        await page.locator('#dashboard-settings-btn').click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        await page.keyboard.press('Escape');
        await page.waitForSelector('#teacher-panel.open', { state: 'hidden', timeout: 10000 });
        await page.waitForTimeout(250);
        const dashboardReturnFocus = await page.evaluate(() => ({
            tag: document.activeElement?.tagName || '',
            id: document.activeElement?.id || '',
            matchesMore: document.activeElement?.matches?.('#dashboard-utility-menu > summary') === true
        }));
        const dashboardMoreState = await dashboardMore.evaluate((element) => ({
            rectCount: element.getClientRects().length,
            display: getComputedStyle(element).display,
            visibility: getComputedStyle(element).visibility,
            hiddenAncestor: element.closest('[hidden], [inert], [aria-hidden="true"]')?.id || '',
            dashboardHidden: document.querySelector('#dashboard-view')?.hidden,
            bodyClass: document.body.className
        }));
        assert(dashboardReturnFocus.matchesMore, `Dashboard Teacher Controls should restore focus to the visible More launcher (${JSON.stringify({ dashboardReturnFocus, dashboardMoreState })})`);
        await openScreenDeckTools(page);
        assert(await page.locator('#screen-deck-manager-title').textContent().then((text) => text.trim() === 'Deck details & backup'), 'The separate deck dialog should use the Deck details & backup title');
        assert(await page.locator('#screen-deck-manager-dialog #reset-layout').count() === 0, 'Deck details should not contain the destructive Clear current page action');
        assert(await page.locator('#save-snapshot-btn').textContent().then((text) => text.replace(/\s+/g, ' ').trim() === 'Save dated copy'), 'The passive copy action should be labelled Save dated copy');
        const beforeDatedBackup = await page.evaluate(() => ({
            state: JSON.parse(localStorage.getItem('classroomScreenState') || '{}'),
            presets: JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]')
        }));
        await page.locator('#save-snapshot-btn').click();
        await page.waitForFunction((count) => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').length === count + 1, beforeDatedBackup.presets.length, { timeout: 10000 });
        const afterDatedBackup = await page.evaluate(() => ({
            state: JSON.parse(localStorage.getItem('classroomScreenState') || '{}'),
            presets: JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]')
        }));
        assert(afterDatedBackup.state.currentDeckId === beforeDatedBackup.state.currentDeckId
            && afterDatedBackup.state.projectName === beforeDatedBackup.state.projectName
            && afterDatedBackup.state.activeDeckId === beforeDatedBackup.state.activeDeckId
            && afterDatedBackup.state.activeClassId === beforeDatedBackup.state.activeClassId,
        'Save dated copy should preserve the original current deck identity and class context');
        assert(afterDatedBackup.presets.some((preset) => !beforeDatedBackup.presets.some((before) => before.id === preset.id)), 'Save dated copy should create a separate restore-point preset');

        await page.locator('#screen-deck-manager-dialog .modal-close').click();
        await page.waitForSelector('#screen-deck-manager-dialog[open]', { state: 'detached', timeout: 10000 });
        await dashboardMore.click();
        await page.locator('#dashboard-settings-btn').click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        await page.keyboard.press('Escape');
        await page.waitForSelector('#teacher-panel.open', { state: 'hidden', timeout: 10000 });
        await page.locator('#classroom-tab').dispatchEvent('click');
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.locator('#lesson-quick-actions [data-quick-widget="timer"]').click();
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        const preservedPageContent = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return { background: state.background, lessonPlan: state.lessonPlan };
        });
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#sections-toggle').click();
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        await page.locator('#dashboard-utility-menu > summary').click();
        await page.locator('#dashboard-settings-btn').click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        const pageActions = page.locator('#teacher-panel .project-page-advanced');
        if (await pageActions.getAttribute('open') === null) {
            await pageActions.locator(':scope > summary').click();
        }
        await page.waitForSelector('#teacher-panel .project-page-advanced[open] #reset-layout', { timeout: 10000 });
        await page.locator('#reset-layout').click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('classroomScreenState') || '{}').layout?.widgets?.length === 0, null, { timeout: 10000 });
        const afterReset = await page.evaluate(() => JSON.parse(localStorage.getItem('classroomScreenState') || '{}'));
        assert(afterReset.layout.widgets.length === 0, 'Reset current page should remove all widgets');
        assert(JSON.stringify(afterReset.background) === JSON.stringify(preservedPageContent.background), 'Reset current page should preserve its background');
        assert(JSON.stringify(afterReset.lessonPlan) === JSON.stringify(preservedPageContent.lessonPlan), 'Reset current page should preserve its lesson plan');
        await page.waitForTimeout(700);

        await closeTeacherPanel(page);
        await openScreenDeckTools(page);
        await page.locator('#screen-deck-manager-dialog .screen-manager-advanced > summary').click();
        await page.waitForSelector('#screen-deck-manager-dialog .screen-manager-advanced[open] #import-layout', { timeout: 10000 });
        await page.locator('#import-layout').click();
        await page.waitForSelector('#import-dialog[open]', { timeout: 10000 });
        assert(await page.locator('#import-file-input').count() === 1, 'Import should accept an exported JSON file');
        assert(await page.locator('label[for="import-json-input"]').count() === 1, 'Import JSON fallback should have a visible label');
        assert(await page.locator('input[name="import-mode"][value="merge"]:checked').count() === 1, 'Import should default to non-destructive Merge');
        assert(await page.locator('input[name="import-mode"][value="replace"]').count() === 1, 'Import should offer an explicit Replace choice');
        assert(await page.locator('#import-summary').getAttribute('aria-live') !== null, 'Import preview should announce its summary');
        assert(await page.locator('#confirm-import').textContent().then((text) => text.trim() === 'Preview import'), 'Import should begin with a Preview import action');
        const importPayload = getMenuSafetyImportPayload();
        await page.locator('#import-json-input').fill(importPayload);
        const beforeImportPreview = await page.evaluate(() => ({
            state: localStorage.getItem('classroomScreenState'),
            presets: localStorage.getItem('classroomLayoutPresets')
        }));
        await page.locator('input[name="import-mode"][value="replace"]').check();
        await page.locator('#confirm-import').click();
        await page.waitForFunction(() => document.querySelector('#confirm-import')?.textContent?.trim() === 'Confirm import', null, { timeout: 10000 });
        const afterImportPreview = await page.evaluate(() => ({
            state: localStorage.getItem('classroomScreenState'),
            presets: localStorage.getItem('classroomLayoutPresets')
        }));
        assert(JSON.stringify(afterImportPreview) === JSON.stringify(beforeImportPreview), 'Preview import should not mutate saved decks or the current classroom');
        assert(await page.locator('#import-summary').textContent().then((text) => /1\s+deck/i.test(text) && /replace/i.test(text)), 'Import preview should summarize deck count and the selected Replace mode');
        const backupDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
        await page.locator('#confirm-import').click();
        const backupDownload = await backupDownloadPromise;
        await page.waitForSelector('#import-dialog[open]', { state: 'detached', timeout: 10000 });
        const backupFailure = await backupDownload.failure();
        const backupPath = await backupDownload.path();
        const backupPayload = backupPath
            ? JSON.parse(fs.readFileSync(backupPath, 'utf8'))
            : null;
        const afterReplace = await page.evaluate(() => ({
            state: JSON.parse(localStorage.getItem('classroomScreenState') || '{}'),
            presets: JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]')
        }));
        assert(afterReplace.state.currentDeckId === 'menu-safety-imported', 'Confirmed Replace import should load the imported active deck');
        assert(backupFailure === null
            && /backup.*\.json$/i.test(backupDownload.suggestedFilename())
            && backupPayload?.presets?.some((preset) => preset?.id === 'menu-safety-original'),
        'Confirmed Replace import should download a readable JSON backup containing the original deck before mutation');

        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 390, height: 844 });
        await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await mobilePage.locator('#dashboard-open-classroom-btn').click();
        await mobilePage.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await mobilePage.locator('#lesson-quick-actions [data-quick-widget="timer"]').click();
        await mobilePage.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await mobilePage.locator('.widget.pomodoro-widget .widget-header-menu__toggle').click();
        await mobilePage.locator('.widget.pomodoro-widget .widget-header-settings-btn').click();
        await mobilePage.waitForSelector('#widget-settings-modal.visible', { timeout: 10000 });
        const themeIds = await mobilePage.locator('#theme-selector input[type="radio"]').evaluateAll((inputs) => inputs.map((input) => input.value));
        for (const themeId of themeIds) {
            await mobilePage.evaluate((id) => {
                window.__TeacherScreenApp?.switchTheme(id);
            }, themeId);
            const mobileUi = await mobilePage.evaluate(() => {
                const luminance = (color) => {
                    const values = color.match(/[\d.]+/g)?.slice(0, 3).map((value) => Number(value) / 255) || [];
                    return values.reduce((sum, value, index) => {
                        const channel = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                        return sum + channel * [0.2126, 0.7152, 0.0722][index];
                    }, 0);
                };
                const contrast = (foreground, background) => {
                    const lighter = Math.max(luminance(foreground), luminance(background));
                    const darker = Math.min(luminance(foreground), luminance(background));
                    return (lighter + 0.05) / (darker + 0.05);
                };
                const toolbar = document.querySelector('#lesson-quick-actions');
                const buttons = Array.from(toolbar?.querySelectorAll('button') || []).filter((button) => !button.hidden);
                const settingsModal = document.querySelector('#widget-settings-modal');
                const settings = document.querySelector('#widget-settings-modal .modal-content');
                const settingsHeader = settings?.querySelector('.modal-header');
                const settingsTitle = settings?.querySelector('.modal-title');
                const settingsRect = settings?.getBoundingClientRect();
                const settingsControls = Array.from(settings?.querySelectorAll('button, input, select, textarea') || [])
                    .filter((control) => control.getClientRects().length > 0);
                const toolbarRect = toolbar?.getBoundingClientRect();
                const effectiveBackground = (element) => {
                    let current = element;
                    while (current) {
                        const color = getComputedStyle(current).backgroundColor;
                        if (color && color !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(color)) {
                            return color;
                        }
                        current = current.parentElement;
                    }
                    return 'rgb(255, 255, 255)';
                };
                return {
                    toolbarFits: !!toolbarRect && toolbarRect.left >= -1 && toolbarRect.right <= window.innerWidth + 1
                        && getComputedStyle(toolbar).overflowX !== 'visible',
                    touchFriendly: buttons.every((button) => button.getBoundingClientRect().width >= 39.5 && button.getBoundingClientRect().height >= 39.5),
                    toolbarRect: toolbarRect ? { left: toolbarRect.left, right: toolbarRect.right, width: toolbarRect.width } : null,
                    overflowX: toolbar ? getComputedStyle(toolbar).overflowX : '',
                    buttonSizes: buttons.map((button) => ({ label: button.getAttribute('aria-label') || button.textContent.trim(), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
                    toolbarContrast: buttons.every((button) => contrast(getComputedStyle(button).color, effectiveBackground(button)) >= 3),
                    settingsFits: settingsModal?.classList.contains('visible') && !!settingsRect
                        && settingsRect.left >= -1 && settingsRect.right <= window.innerWidth + 1
                        && settingsRect.top >= -1 && settingsRect.bottom <= window.innerHeight + 1
                        && settings.scrollWidth <= settings.clientWidth + 1,
                    settingsTouchFriendly: settingsControls.every((control) => control.getBoundingClientRect().height >= 39.5),
                    settingsTextContrast: !!settingsTitle && !!settingsHeader
                        && contrast(getComputedStyle(settingsTitle).color, effectiveBackground(settingsHeader)) >= 4.5
                };
            });
            assert(mobileUi.toolbarFits && mobileUi.touchFriendly, `390px quick toolbar should fit and keep touch-friendly controls in ${themeId} (${JSON.stringify(mobileUi)})`);
            assert(mobileUi.settingsFits && mobileUi.settingsTouchFriendly, `390px Widget settings should fit and keep touch-friendly controls in ${themeId} (${JSON.stringify(mobileUi)})`);
            assert(mobileUi.toolbarContrast && mobileUi.settingsTextContrast, `Quick toolbar and settings should retain usable theme contrast in ${themeId} (${JSON.stringify(mobileUi)})`);
        }
        await mobilePage.close();

        assert(pageErrors.length === 0, `Menu safety checks should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Menu safety checks should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runBottomWidgetContainmentChecks(browser, baseUrl) {
    const desktopContext = await browser.newContext({ viewport: { width: 1899, height: 707 } });
    await makeExternalAssetsDeterministic(desktopContext);

    try {
        const page = await desktopContext.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.locator('#lesson-quick-actions [data-quick-widget="timer"]').click();
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });

        const timerBeforeDrag = await getElementBox(page, '.widget.pomodoro-widget');
        await dragElementBy(page, '.widget.pomodoro-widget .pomodoro-display', -1000, 1000);
        const timerInLowerCorner = await getElementBox(page, '.widget.pomodoro-widget');
        const toolbarAtCorner = await getElementBox(page, '#lesson-quick-actions');
        const canvasAtCorner = await getElementBox(page, '#widgets-container');

        assert(
            timerInLowerCorner.y + timerInLowerCorner.height > toolbarAtCorner.y + 20,
            'A small widget should move into the open lower corner beside the lesson toolbar'
        );
        assert(
            timerInLowerCorner.x + timerInLowerCorner.width <= toolbarAtCorner.x - 8,
            'A lower-corner widget should remain clear of the lesson toolbar horizontally'
        );
        assert(
            timerInLowerCorner.y + timerInLowerCorner.height <= canvasAtCorner.y + canvasAtCorner.height + 1,
            'A lower-corner widget should remain fully inside the classroom canvas'
        );
        assert(
            Math.abs(timerInLowerCorner.height - timerBeforeDrag.height) <= 1,
            'Moving a widget beside the lesson toolbar should not resize it'
        );

        await page.waitForTimeout(700);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await page.waitForTimeout(150);

        const timerAfterReload = await getElementBox(page, '.widget.pomodoro-widget');
        assert(
            Math.abs(timerAfterReload.x - timerInLowerCorner.x) <= 20
                && Math.abs(timerAfterReload.y - timerInLowerCorner.y) <= 20,
            'A lower-corner widget position should survive reload'
        );

        const toolbarBeforeCollision = await getElementBox(page, '#lesson-quick-actions');
        const horizontalMove = (toolbarBeforeCollision.x + (toolbarBeforeCollision.width / 2))
            - (timerAfterReload.x + (timerAfterReload.width / 2));
        await dragElementBy(page, '.widget.pomodoro-widget .pomodoro-display', horizontalMove, 1000);
        const timerAboveToolbar = await getElementBox(page, '.widget.pomodoro-widget');
        const toolbarAfterCollision = await getElementBox(page, '#lesson-quick-actions');

        assert(
            timerAboveToolbar.x < toolbarAfterCollision.x + toolbarAfterCollision.width
                && timerAboveToolbar.x + timerAboveToolbar.width > toolbarAfterCollision.x,
            'The collision check should position the widget over the toolbar column'
        );
        assert(
            timerAboveToolbar.y + timerAboveToolbar.height <= toolbarAfterCollision.y - 8,
            'A widget in the toolbar column should stop above the lesson toolbar'
        );
        assert(
            Math.abs(timerAboveToolbar.height - timerBeforeDrag.height) <= 1,
            'Avoiding the lesson toolbar should not resize a standard widget'
        );

        await page.locator('.widget.pomodoro-widget .pomodoro-display').focus();
        for (let step = 0; step < 12; step += 1) {
            await page.keyboard.press('ArrowDown');
        }
        const timerAfterKeyboardMove = await getElementBox(page, '.widget.pomodoro-widget');
        assert(
            timerAfterKeyboardMove.y + timerAfterKeyboardMove.height <= toolbarAfterCollision.y - 8,
            'Keyboard movement should also keep a widget above the lesson toolbar'
        );

        await page.locator('#lesson-quick-actions [data-quick-widget="name-picker"]').click();
        await page.waitForSelector('.widget.name-picker-widget', { timeout: 10000 });
        await page.waitForTimeout(300);
        await dragElementBy(page, '.widget.name-picker-widget .resize-handle.bottom', 0, 1000);
        const tallSideWidget = await getElementBox(page, '.widget.name-picker-widget');
        const toolbarBesideTallWidget = await getElementBox(page, '#lesson-quick-actions');
        const toolbarFootprint = await page.evaluate(() => {
            const toolbar = document.querySelector('#lesson-quick-actions');
            const rect = toolbar?.getBoundingClientRect();
            return rect ? { x: rect.x, width: rect.width } : null;
        });

        assert(
            tallSideWidget.x + tallSideWidget.width <= toolbarBesideTallWidget.x - 8,
            `A tall side widget should stay horizontally clear of the lesson toolbar (${JSON.stringify({ tallSideWidget, toolbarBesideTallWidget, toolbarFootprint })})`
        );
        assert(
            tallSideWidget.y + tallSideWidget.height > toolbarBesideTallWidget.y + 20,
            'A tall side widget should use the full safe height beside the lesson toolbar'
        );

        await page.waitForTimeout(700);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('.widget.name-picker-widget', { timeout: 10000 });
        await page.waitForTimeout(150);
        const tallSideWidgetAfterReload = await getElementBox(page, '.widget.name-picker-widget');
        const toolbarAfterTallReload = await getElementBox(page, '#lesson-quick-actions');

        assert(
            Math.abs(tallSideWidgetAfterReload.height - tallSideWidget.height) <= 20,
            'A tall side widget should keep its height after reload'
        );
        assert(
            tallSideWidgetAfterReload.y + tallSideWidgetAfterReload.height > toolbarAfterTallReload.y + 20,
            'A reloaded tall side widget should remain beside, not above, the lesson toolbar'
        );
    } finally {
        await desktopContext.close();
    }

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await makeExternalAssetsDeterministic(mobileContext);

    try {
        const mobilePage = await mobileContext.newPage();
        await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await mobilePage.locator('#dashboard-open-classroom-btn').click();
        await mobilePage.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await mobilePage.locator('#lesson-quick-actions [data-quick-widget="timer"]').click();
        await mobilePage.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });

        const mobileTimerBeforeDrag = await getElementBox(mobilePage, '.widget.pomodoro-widget');
        await dragElementBy(mobilePage, '.widget.pomodoro-widget .pomodoro-display', 0, 1000);
        const mobileTimerAfterDrag = await getElementBox(mobilePage, '.widget.pomodoro-widget');
        const mobileToolbar = await getElementBox(mobilePage, '#lesson-quick-actions');

        assert(
            mobileTimerAfterDrag.y + mobileTimerAfterDrag.height <= mobileToolbar.y - 8,
            'A mobile widget should stop above the nearly full-width lesson toolbar'
        );
        assert(
            Math.abs(mobileTimerAfterDrag.height - mobileTimerBeforeDrag.height) <= 1,
            'Moving a mobile widget toward the toolbar should not resize it'
        );
    } finally {
        await mobileContext.close();
    }
}

async function runTallWidgetVerticalMovementChecks(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
    await makeExternalAssetsDeterministic(context);

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await addWidget(page, 'reveal-manager', '.widget.reveal-manager-widget', 'Presentation');

        const tallWidgetBeforeDrag = await getElementBox(page, '.widget.reveal-manager-widget');
        await dragElementBy(page, '.widget.reveal-manager-widget .widget-header-title', 0, 320);
        const tallWidgetAfterDrag = await getElementBox(page, '.widget.reveal-manager-widget');
        const canvasAfterTallDrag = await getElementBox(page, '#widgets-container');
        const toolbarAfterTallDrag = await getElementBox(page, '#lesson-quick-actions');
        assert(
            tallWidgetAfterDrag.y - tallWidgetBeforeDrag.y >= 20,
            'A wide tall widget should still move down as far as the lesson toolbar safely allows'
        );
        assert(
            tallWidgetAfterDrag.y + tallWidgetAfterDrag.height <= toolbarAfterTallDrag.y - 8,
            'A wide tall widget that cannot fit beside the lesson toolbar should stop above it'
        );
        assert(
            Math.abs(tallWidgetAfterDrag.height - tallWidgetBeforeDrag.height) <= 1,
            'Dragging a tall widget should not silently resize it'
        );
        assert(
            tallWidgetAfterDrag.y >= canvasAfterTallDrag.y
                && tallWidgetAfterDrag.y + tallWidgetAfterDrag.height <= canvasAfterTallDrag.y + canvasAfterTallDrag.height + 1,
            'A vertically moved tall widget should remain fully inside the classroom canvas'
        );

        await page.waitForTimeout(700);
        const savedTallWidget = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const activePage = Array.isArray(state.pages)
                ? state.pages.find((pageRecord) => pageRecord?.id === state.activePageId)
                : null;
            const widget = activePage?.snapshot?.layout?.widgets?.find((item) => item.type === 'RevealManagerWidget');
            return widget ? { y: widget.y, height: widget.height } : null;
        });
        assert(
            Math.abs(savedTallWidget?.y - tallWidgetAfterDrag.y) <= 20
                && Math.abs(savedTallWidget?.height - tallWidgetAfterDrag.height) <= 20,
            `A moved tall widget should save its unchanged size and new position before reload (saved ${JSON.stringify(savedTallWidget)}, rendered y ${tallWidgetAfterDrag.y}, height ${tallWidgetAfterDrag.height})`
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        const tallWidgetAfterReload = await getElementBox(page, '.widget.reveal-manager-widget');
        const canvasAfterTallReload = await getElementBox(page, '#widgets-container');
        assert(
            Math.abs(tallWidgetAfterReload.y - tallWidgetAfterDrag.y) <= 20
                && Math.abs(tallWidgetAfterReload.height - tallWidgetAfterDrag.height) <= 20,
            `A tall widget should keep its unchanged size and intentional vertical position after reload (restored y ${tallWidgetAfterReload.y}, height ${tallWidgetAfterReload.height})`
        );
        assert(
            tallWidgetAfterReload.y >= canvasAfterTallReload.y
                && tallWidgetAfterReload.y + tallWidgetAfterReload.height <= canvasAfterTallReload.y + canvasAfterTallReload.height + 1,
            'A reloaded tall widget should remain fully inside the classroom canvas'
        );

        await dragElementBy(page, '.widget.reveal-manager-widget .widget-header-title', 0, -600);
        const tallWidgetAfterUpwardDrag = await getElementBox(page, '.widget.reveal-manager-widget');
        const canvasAfterUpwardDrag = await getElementBox(page, '#widgets-container');
        assert(
            tallWidgetAfterUpwardDrag.y <= canvasAfterUpwardDrag.y + 24,
            'Tall widgets should still move back to the top of the classroom canvas'
        );
        assert(
            tallWidgetAfterUpwardDrag.y + tallWidgetAfterUpwardDrag.height <= canvasAfterUpwardDrag.y + canvasAfterUpwardDrag.height + 1,
            'A tall widget moved back to the top should remain fully inside the classroom canvas'
        );
        assert(
            Math.abs(tallWidgetAfterUpwardDrag.height - tallWidgetBeforeDrag.height) <= 1,
            'Moving a tall widget back upward should preserve its height'
        );

        const tallWidgetBeforeKeyboardMove = await getElementBox(page, '.widget.reveal-manager-widget');
        await page.locator('.widget.reveal-manager-widget .widget-header-title').focus();
        await page.locator('.widget.reveal-manager-widget .widget-header-title').press('ArrowDown');
        const tallWidgetAfterKeyboardMove = await getElementBox(page, '.widget.reveal-manager-widget');
        assert(
            tallWidgetAfterKeyboardMove.y - tallWidgetBeforeKeyboardMove.y >= 15,
            'Keyboard movement should still move a tall widget down within the canvas'
        );
        assert(
            Math.abs(tallWidgetAfterKeyboardMove.height - tallWidgetBeforeKeyboardMove.height) <= 1,
            'Keyboard movement should not silently resize a tall widget'
        );
    } finally {
        await context.close();
    }
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

async function installPdfStub(context) {
    await context.addInitScript(() => {
        window.pdfjsLib = {
            getDocument: () => ({
                promise: Promise.resolve({
                    numPages: 2,
                    getPage: (pageNumber) => Promise.resolve({
                        getViewport: ({ scale = 1 } = {}) => ({
                            width: 612 * scale,
                            height: 792 * scale
                        }),
                        render: () => ({ promise: Promise.resolve(pageNumber) })
                    }),
                    destroy: () => Promise.resolve()
                })
            })
        };
    });
}

async function installResourceFolderMock(context) {
    await context.addInitScript(() => {
        const fixedLastModified = Date.UTC(2026, 7, 11, 9, 30, 0);

        const createFileHandle = (name, type, contents) => ({
            kind: 'file',
            name,
            async getFile() {
                return new File([contents], name, { type, lastModified: fixedLastModified });
            }
        });

        const createNotFoundError = (entryName) => new DOMException(
            `The mock resource "${entryName}" was not found.`,
            'NotFoundError'
        );

        const createDirectoryHandle = (name, entries) => {
            const children = new Map(entries);
            return {
                kind: 'directory',
                name,
                async queryPermission(options = {}) {
                    window.__resourceDirectoryPermissionQuery = options;
                    return 'granted';
                },
                async requestPermission(options = {}) {
                    window.__resourceDirectoryPermissionRequest = options;
                    return 'granted';
                },
                async *entries() {
                    for (const entry of children.entries()) {
                        yield entry;
                    }
                },
                async getDirectoryHandle(entryName) {
                    const entry = children.get(entryName);
                    if (entry?.kind === 'directory') return entry;
                    throw createNotFoundError(entryName);
                },
                async getFileHandle(entryName) {
                    const entry = children.get(entryName);
                    if (entry?.kind === 'file') return entry;
                    throw createNotFoundError(entryName);
                }
            };
        };

        const nestedFolder = createDirectoryHandle('Unit Plans', [
            ['Inside folder.pdf', createFileHandle(
                'Inside folder.pdf',
                'application/pdf',
                '%PDF-1.4\nMock nested teaching resource\n%%EOF'
            )]
        ]);
        const rootFolder = createDirectoryHandle('Teacher Resources', [
            ['Unit Plans', nestedFolder],
            ['Lesson handout.pdf', createFileHandle(
                'Lesson handout.pdf',
                'application/pdf',
                '%PDF-1.4\nMock Teacher Screen handout\n%%EOF'
            )],
            ['Lesson slides.pptx', createFileHandle(
                'Lesson slides.pptx',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'Mock PPTX-labelled teaching resource'
            )],
            ['Classroom diagram.png', createFileHandle(
                'Classroom diagram.png',
                'image/png',
                new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
            )]
        ]);

        window.showDirectoryPicker = async (options = {}) => {
            window.__resourceDirectoryPickerOptions = options;
            return rootFolder;
        };
    });
}

async function waitForResourceNames(page, expectedNames) {
    await page.waitForFunction((names) => {
        const visibleNames = Array.from(document.querySelectorAll('.resource-card h3'))
            .map((heading) => heading.textContent?.trim() || '');
        return visibleNames.length === names.length
            && names.every((name) => visibleNames.includes(name));
    }, expectedNames, { timeout: 10000 });
}

async function runResourceLibraryFlowChecks(page) {
    const rootResourceNames = [
        'Unit Plans',
        'Lesson handout.pdf',
        'Lesson slides.pptx',
        'Classroom diagram.png'
    ];

    await page.locator('#dashboard-tab').dispatchEvent('click');
    await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
    await page.locator('[data-dashboard-mode="resources"]').click();
    await page.waitForSelector('.dashboard-resources-panel', { timeout: 10000 });
    assert(await page.locator('.dashboard-nav-item[data-dashboard-mode="resources"].is-active').count() === 1, 'Resources action should open the Resource Library and activate Resources navigation');
    assert(await page.locator('.dashboard-resources-panel h2').textContent().then((text) => text.trim() === 'Teaching resources'), 'Resources should open as a teacher-focused dashboard panel');
    assert(await page.locator('.resource-supported-note').count() === 0, 'Resources should not show the removed file-type helper strip');

    await page.waitForFunction(() => document.querySelector('.resource-status-badge')?.textContent?.trim() === 'No folder linked', null, { timeout: 10000 });
    assert(await page.locator('#resource-connect-btn').textContent().then((text) => text.trim() === 'Choose folder'), 'Local resources should begin with one clear Choose folder action');
    await page.locator('#resource-connect-btn').click();
    await waitForResourceNames(page, rootResourceNames);
    const pickerAccess = await page.evaluate(() => ({
        mode: window.__resourceDirectoryPickerOptions?.mode || '',
        queriedMode: window.__resourceDirectoryPermissionQuery?.mode || ''
    }));
    assert(pickerAccess.mode === 'read' && pickerAccess.queriedMode === 'read', 'Resources should request read-only access to the chosen local folder');
    assert(await page.locator('.resource-status-badge').textContent().then((text) => text.trim() === 'Local folder connected'), 'Chosen local resource folder should show a connected status');
    assert(await page.locator('.resource-card', { hasText: 'Lesson slides.pptx' }).textContent().then((text) => text.includes('PowerPoint')), 'PowerPoint files should be recognised as supported Presentation resources');
    assert(await page.locator('.resource-card', { hasText: 'Classroom diagram.png' }).textContent().then((text) => text.includes('Image')), 'Image files should be recognised as supported deck resources');

    const unitPlansCard = page.locator('.resource-card', { hasText: 'Unit Plans' });
    await unitPlansCard.locator('[data-resource-action="favorite"]').click();
    await page.locator('[data-resource-view="favorites"]').click();
    await waitForResourceNames(page, ['Unit Plans']);
    await page.locator('.resource-card', { hasText: 'Unit Plans' }).locator('[data-resource-action="folder"]').click();
    await waitForResourceNames(page, ['Inside folder.pdf']);
    assert(await page.locator('[data-resource-view="all"]').getAttribute('aria-pressed') === 'true', 'Opening a favourite folder should switch to its live folder contents');
    assert(await page.locator('.resource-breadcrumb').allTextContents().then((items) => items.map((item) => item.trim()).join('|') === 'Teacher Resources|Unit Plans'), 'Opening a resource folder should add it to the breadcrumb trail');
    await page.locator('[data-resource-breadcrumb="-1"]').click();
    await waitForResourceNames(page, rootResourceNames);
    assert(await page.locator('.resource-breadcrumb').count() === 1, 'Root breadcrumb should return to the chosen resources folder');
    await page.locator('.resource-card', { hasText: 'Unit Plans' }).locator('[data-resource-action="favorite"]').click();

    await page.locator('#resource-search-input').fill('slides');
    await waitForResourceNames(page, ['Lesson slides.pptx']);
    assert(await page.locator('#resource-search-input').inputValue() === 'slides', 'Resource search should filter teaching files without losing its value');
    assert(await page.locator('#resource-search-input').evaluate((input) => document.activeElement === input), 'Resource search should keep keyboard focus while filtering');
    await page.locator('#resource-search-input').fill('');
    await waitForResourceNames(page, rootResourceNames);

    const imageCard = page.locator('.resource-card', { hasText: 'Classroom diagram.png' });
    await imageCard.locator('[data-resource-action="favorite"]').click();
    await page.waitForFunction(() => {
        const card = Array.from(document.querySelectorAll('.resource-card'))
            .find((candidate) => candidate.querySelector('h3')?.textContent?.trim() === 'Classroom diagram.png');
        return card?.querySelector('.resource-favorite-btn')?.getAttribute('aria-pressed') === 'true';
    }, null, { timeout: 10000 });
    assert(await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('teacherScreenResourceLibraryState') || '{}');
        return state.favorites?.some((resource) => resource?.name === 'Classroom diagram.png');
    }), 'Resource favourites should persist locally');
    await page.locator('[data-resource-view="favorites"]').click();
    await waitForResourceNames(page, ['Classroom diagram.png']);
    assert(await page.locator('[data-resource-view="favorites"]').getAttribute('aria-pressed') === 'true', 'Resource Favourites view should have a clear active state');
    await page.waitForFunction(() => document.activeElement?.dataset?.resourceView === 'favorites', null, { timeout: 10000 });
    assert(true, 'Resource view controls should retain keyboard focus after filtering');
    await page.locator('[data-resource-view="all"]').click();
    await waitForResourceNames(page, rootResourceNames);

    await page.locator('.resource-card', { hasText: 'Lesson handout.pdf' }).locator('[data-resource-action="add"]').click();
    await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
    await page.waitForSelector('.widget.document-viewer-widget canvas', { timeout: 15000 });
    assert(await page.locator('.widget.document-viewer-widget .document-viewer-page-counter').textContent().then((text) => text.trim() === 'Page 1 of 2'), 'Adding a PDF resource should create a ready Document Viewer');
    await page.waitForFunction(() => {
        const state = JSON.parse(localStorage.getItem('teacherScreenResourceLibraryState') || '{}');
        return state.recents?.some((resource) => resource?.name === 'Lesson handout.pdf');
    }, null, { timeout: 10000 });
    assert(true, 'Adding a PDF resource should persist it in recent resources');

    await page.locator('#dashboard-tab').dispatchEvent('click');
    await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
    await page.locator('[data-dashboard-mode="resources"]').click();
    await page.waitForSelector('.dashboard-resources-panel', { timeout: 10000 });
    await page.locator('[data-resource-view="recent"]').click();
    await waitForResourceNames(page, ['Lesson handout.pdf']);
    assert(await page.locator('[data-resource-view="recent"]').getAttribute('aria-pressed') === 'true', 'Recent resource view should restore the PDF added to the current deck');

    await page.locator('[data-resource-source="google-drive"]').click();
    await page.waitForFunction(() => document.querySelector('.resource-status-badge')?.textContent?.trim() === 'Google Drive setup required', null, { timeout: 10000 });
    await page.waitForFunction(() => document.activeElement?.dataset?.resourceSource === 'google-drive', null, { timeout: 10000 });
    assert(true, 'Resource source controls should retain keyboard focus after switching locations');
    assert(await page.locator('.resource-status-badge').getAttribute('data-state') === 'unconfigured', 'Google Drive setup state should be announced and styled as needing attention');
    assert(await page.locator('#resource-connect-btn').isDisabled(), 'Unconfigured Google Drive should disable its setup action');
    assert(await page.locator('#resource-connect-btn').textContent().then((text) => text.trim() === 'Google setup required'), 'Unconfigured Google Drive should explain that setup is required');
    assert(await page.locator('.resource-connection-card__copy').textContent().then((text) => text.includes('has not been configured')), 'Google Drive tab should render a graceful unconfigured state');

    // The preceding source change already exercises a real pointer click. Use
    // DOM activation for the return trip so a rare long-run CDP pointer stall
    // cannot hide whether the local provider and live folder were restored.
    const localSourceButton = page.locator('[data-resource-source="local"]');
    await localSourceButton.waitFor({ state: 'visible', timeout: 10000 });
    await localSourceButton.dispatchEvent('click');
    await page.waitForFunction(() => document.querySelector('.resource-status-badge')?.textContent?.trim() === 'Local folder connected', null, { timeout: 10000 });
    await page.locator('[data-resource-view="all"]').click();
    await waitForResourceNames(page, rootResourceNames);
    assert(true, 'Switching back from Google Drive should retain the live local-folder connection');
}

async function runMobileResourceLibraryChecks(page) {
    const rootResourceNames = [
        'Unit Plans',
        'Lesson handout.pdf',
        'Lesson slides.pptx',
        'Classroom diagram.png'
    ];

    await page.locator('[data-dashboard-mode="resources"]').click();
    await page.waitForSelector('.dashboard-resources-panel', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.resource-status-badge')?.textContent?.trim() === 'No folder linked', null, { timeout: 10000 });
    await page.locator('#resource-connect-btn').click();
    await waitForResourceNames(page, rootResourceNames);

    const resourceLayout = await page.locator('.dashboard-resources-panel').evaluate((panel) => {
        const main = panel.closest('.dashboard-main');
        const panelRect = panel.getBoundingClientRect();
        const actions = Array.from(panel.querySelectorAll('.resource-card [data-resource-action]'))
            .filter((button) => {
                const style = getComputedStyle(button);
                return style.display !== 'none' && style.visibility !== 'hidden';
            });
        const actionsFit = actions.length > 0 && actions.every((button) => {
            const buttonRect = button.getBoundingClientRect();
            const cardRect = button.closest('.resource-card')?.getBoundingClientRect();
            return !!cardRect
                && buttonRect.width >= 32
                && buttonRect.height >= 32
                && buttonRect.left >= cardRect.left - 1
                && buttonRect.right <= cardRect.right + 1;
        });
        return {
            viewportFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
            mainFits: !main || main.scrollWidth <= main.clientWidth + 1,
            panelFits: panel.scrollWidth <= panel.clientWidth + 1
                && panelRect.left >= -1
                && panelRect.right <= window.innerWidth + 1,
            actionsFit
        };
    });
    assert(resourceLayout.viewportFits && resourceLayout.mainFits && resourceLayout.panelFits, '390px Resources view should not create horizontal overflow');
    assert(resourceLayout.actionsFit, '390px resource cards should keep every action usable inside its card');

    await page.locator('#resource-search-input').fill('diagram');
    await waitForResourceNames(page, ['Classroom diagram.png']);
    assert(await page.locator('.resource-card [data-resource-action="add"]').isVisible(), '390px Resources view should keep Add to current deck visible after filtering');
    await page.locator('#resource-search-input').fill('');
    await waitForResourceNames(page, rootResourceNames);
}

async function runFocusedResourceLibraryChecks(browser, baseUrl) {
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);
    await installPdfStub(context);
    await installResourceFolderMock(context);
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

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForFunction(() => Array.isArray(window.__TeacherDependencyFailures), { timeout: 10000 });
        await runResourceLibraryFlowChecks(page);

        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 390, height: 844 });
        await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await runMobileResourceLibraryChecks(mobilePage);

        assert(pageErrors.length === 0, `Resource Library should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Resource Library should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runPowerPointProjectorRestoreChecks(browser, baseUrl) {
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);
    await context.addInitScript(() => {
        if (!window.location.pathname.toLowerCase().endsWith('/projector.html')) {
            return;
        }

        const diagnostics = {
            readsStarted: 0,
            readsCompleted: 0,
            activeReads: 0,
            maxActiveReads: 0,
            resizeCallbacks: 0,
            readsReleased: false
        };
        let releaseReads;
        const readGate = new Promise((resolve) => {
            releaseReads = resolve;
        });
        diagnostics.releaseReads = () => {
            if (diagnostics.readsReleased) return;
            diagnostics.readsReleased = true;
            releaseReads();
        };
        window.__ProjectorDocumentStoreDelay = diagnostics;

        const NativeResizeObserver = window.ResizeObserver;
        if (typeof NativeResizeObserver === 'function') {
            window.ResizeObserver = class ProjectorSmokeResizeObserver extends NativeResizeObserver {
                constructor(callback) {
                    super((entries, observer) => {
                        diagnostics.resizeCallbacks += 1;
                        callback(entries, observer);
                    });
                }
            };
        }

        let wrappedStore;
        Object.defineProperty(window, 'TeacherScreenDocumentStore', {
            configurable: true,
            enumerable: true,
            get() {
                return wrappedStore;
            },
            set(store) {
                if (!store || wrappedStore) {
                    return;
                }

                const delayRead = (methodName) => async (...args) => {
                    diagnostics.readsStarted += 1;
                    diagnostics.activeReads += 1;
                    diagnostics.maxActiveReads = Math.max(diagnostics.maxActiveReads, diagnostics.activeReads);
                    await readGate;
                    try {
                        return await store[methodName](...args);
                    } finally {
                        diagnostics.activeReads -= 1;
                        diagnostics.readsCompleted += 1;
                    }
                };

                wrappedStore = Object.freeze({
                    ...store,
                    loadSlideDeck: delayRead('loadSlideDeck'),
                    loadSlideAssets: delayRead('loadSlideAssets')
                });
            }
        });
    });
    const pageErrors = [];
    const consoleErrors = [];
    const consoleWarnings = [];

    context.on('page', (page) => {
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error' && !isExpectedBlockedExternalAssetMessage(message)) {
                consoleErrors.push(message.text());
            }
            if (message.type() === 'warning') {
                consoleWarnings.push(message.text());
            }
        });
    });

    try {
        const seedPage = await context.newPage();
        await seedPage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await seedPage.waitForFunction(() => Boolean(window.TeacherScreenDocumentStore?.saveSlideDeck), null, { timeout: 15000 });
        const seededDeck = await seedPage.evaluate(async () => {
            const deckId = 90210;
            const storageId = 'slides-projector-powerpoint-restore-smoke';
            const assetId = `${storageId}-image`;
            const imageBytes = Uint8Array.from(
                atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),
                (character) => character.charCodeAt(0)
            );
            const content = `<section><h2>Stored PowerPoint</h2><img data-slide-asset-id="${assetId}" alt="Stored PowerPoint image"></section>`;
            const activeDeck = {
                id: deckId,
                name: 'Stored PowerPoint',
                type: 'html',
                content: '',
                storageId,
                sourceFormat: 'pptx',
                sourceName: 'stored-powerpoint-smoke.pptx',
                sourceSize: imageBytes.byteLength,
                slideCount: 1
            };
            const layout = {
                mode: 'dashboard',
                viewport: { width: 1280, height: 720 },
                widgets: [{
                    id: 'projector-powerpoint-smoke-widget',
                    type: 'RevealManagerWidget',
                    x: 20,
                    y: 20,
                    width: 720,
                    height: 520,
                    visibleOnProjector: true,
                    projectorVisibilityConfigured: true,
                    data: {
                        type: 'RevealManagerWidget',
                        activeDeck,
                        currentIndices: { h: 0, v: 0 }
                    }
                }]
            };

            await window.TeacherScreenDocumentStore.saveSlideDeck({
                deck: {
                    id: storageId,
                    deckId,
                    name: activeDeck.name,
                    sourceFormat: activeDeck.sourceFormat,
                    sourceName: activeDeck.sourceName,
                    sourceSize: activeDeck.sourceSize,
                    slideCount: activeDeck.slideCount,
                    content,
                    updatedAt: Date.now()
                },
                assets: [{
                    id: assetId,
                    deckId: storageId,
                    blob: new Blob([imageBytes], { type: 'image/gif' }),
                    mimeType: 'image/gif',
                    alt: 'Stored PowerPoint image'
                }]
            });

            localStorage.setItem('classroomScreenState', JSON.stringify({
                schemaVersion: 1,
                theme: 'theme-professional',
                background: { type: 'solid', value: '#0f172a' },
                layout,
                activePageId: 'powerpoint-projector-page',
                pages: [{
                    id: 'powerpoint-projector-page',
                    name: 'Page 1',
                    snapshot: {
                        background: { type: 'solid', value: '#0f172a' },
                        layout
                    }
                }]
            }));

            const storedDeck = await window.TeacherScreenDocumentStore.loadSlideDeck(storageId);
            const storedAssets = await window.TeacherScreenDocumentStore.loadSlideAssets(storageId);
            return {
                storageId,
                storedDeckReady: storedDeck?.content?.includes('Stored PowerPoint') === true,
                storedAssetCount: storedAssets.length,
                storedAssetIsBlob: storedAssets[0]?.blob instanceof Blob
            };
        });

        assert(
            seededDeck.storedDeckReady && seededDeck.storedAssetCount === 1 && seededDeck.storedAssetIsBlob,
            'PowerPoint projector regression should seed one durable stored slide image'
        );
        await seedPage.reload({ waitUntil: 'domcontentloaded' });
        await seedPage.waitForSelector('.widget.reveal-manager-widget .reveal-inline-deck img[src^="blob:"]', { state: 'attached', timeout: 15000 });
        assert(true, 'Teacher view should restore the seeded PowerPoint before projector startup checks');

        const requestedIterations = Number.parseInt(process.env.POWERPOINT_PROJECTOR_ITERATIONS || '10', 10);
        const iterations = Math.max(1, Math.min(20, Number.isFinite(requestedIterations) ? requestedIterations : 10));
        for (let iteration = 1; iteration <= iterations; iteration += 1) {
            const projectorPage = await context.newPage();
            try {
                await projectorPage.goto(`${baseUrl}/projector.html`, { waitUntil: 'domcontentloaded' });
                await projectorPage.waitForFunction(() => Boolean(window.__TeacherScreenProjectorApp), null, { timeout: 15000 });
                if (iteration === 1) {
                    await projectorPage.waitForFunction(() => {
                        const diagnostics = window.__ProjectorDocumentStoreDelay;
                        const widget = window.__TeacherScreenProjectorApp?.getRevealWidgets?.()[0];
                        return diagnostics?.activeReads >= 2 && Boolean(widget);
                    }, null, { timeout: 10000 });
                    const hydrationProbe = await projectorPage.evaluate(async () => {
                        const widget = window.__TeacherScreenProjectorApp?.getRevealWidgets?.()[0];
                        const diagnostics = window.__ProjectorDocumentStoreDelay;
                        if (!widget || !diagnostics) {
                            throw new Error('Projector hydration diagnostics were unavailable');
                        }

                        widget.ensureDeckVisible();
                        await new Promise((resolve) => window.setTimeout(resolve, 150));
                        return {
                            activeReads: diagnostics.activeReads,
                            resizeCallbacks: diagnostics.resizeCallbacks,
                            activeContentLength: String(widget.activeDeck?.content || '').length,
                            hasRenderPromise: Boolean(widget.renderPromise),
                            inlinePresentationRootCount: widget.inlineDeckContainer
                                ?.querySelectorAll('[data-reveal-presentation-root]').length || 0
                        };
                    });
                    assert(
                        hydrationProbe.activeReads >= 2
                            && hydrationProbe.resizeCallbacks > 0
                            && hydrationProbe.activeContentLength === 0
                            && !hydrationProbe.hasRenderPromise
                            && hydrationProbe.inlinePresentationRootCount === 0,
                        'Projector should finish stored PowerPoint hydration before ResizeObserver starts presentation rendering'
                    );
                    await projectorPage.evaluate(() => window.__ProjectorDocumentStoreDelay?.releaseReads?.());
                } else {
                    await projectorPage.evaluate(() => window.__ProjectorDocumentStoreDelay?.releaseReads?.());
                }
                try {
                    await projectorPage.waitForSelector('.widget.reveal-manager-widget [data-reveal-presentation-root]:has(img[src^="blob:"])', { timeout: 10000 });
                } catch (error) {
                    const evidence = await projectorPage.evaluate(async (storageId) => {
                        const store = window.TeacherScreenDocumentStore;
                        const storedDeck = await store?.loadSlideDeck?.(storageId);
                        const assets = await store?.loadSlideAssets?.(storageId);
                        return {
                            topLevelPresentationHtml: document.querySelector('body > #presentation-root')?.innerHTML || '',
                            presentationRootIdCount: document.querySelectorAll('#presentation-root').length,
                            inlinePresentationCount: document.querySelectorAll('.widget.reveal-manager-widget .reveal-inline-deck').length,
                            inlineBlobImageCount: document.querySelectorAll('.widget.reveal-manager-widget img[src^="blob:"]').length,
                            storedDeckReady: storedDeck?.content?.includes('Stored PowerPoint') === true,
                            storedAssetCount: Array.isArray(assets) ? assets.length : -1,
                            storedAssetIsBlob: assets?.[0]?.blob instanceof Blob,
                            documentStoreDelay: window.__ProjectorDocumentStoreDelay
                                ? {
                                    readsStarted: window.__ProjectorDocumentStoreDelay.readsStarted,
                                    readsCompleted: window.__ProjectorDocumentStoreDelay.readsCompleted,
                                    activeReads: window.__ProjectorDocumentStoreDelay.activeReads,
                                    maxActiveReads: window.__ProjectorDocumentStoreDelay.maxActiveReads,
                                    resizeCallbacks: window.__ProjectorDocumentStoreDelay.resizeCallbacks,
                                    readsReleased: window.__ProjectorDocumentStoreDelay.readsReleased
                                }
                                : null,
                            dependencyFailures: window.__ProjectorDependencyFailures || []
                        };
                    }, seededDeck.storageId);
                    throw new Error(
                        `PowerPoint projector restore iteration ${iteration} failed (`
                        + `${JSON.stringify(evidence)}; pageErrors=${JSON.stringify(pageErrors.slice(-6))}; `
                        + `consoleErrors=${JSON.stringify(consoleErrors.slice(-6))}; warnings=${JSON.stringify(consoleWarnings.slice(-6))})`
                    );
                }

                const projectorMode = await projectorPage.evaluate(() => {
                    const widgets = window.__TeacherScreenProjectorApp?.getRevealWidgets?.() || [];
                    return {
                        appMode: window.TeacherScreenAppMode?.APP_MODE || '',
                        allWidgetsAreProjectorMode: widgets.length > 0 && widgets.every((widget) => (
                            widget.isProjectorMode?.() === true && widget.isTeacherMode?.() === false
                        )),
                        presentationRootIdCount: document.querySelectorAll('#presentation-root').length,
                        topLevelPresentationEmpty: !document.querySelector('body > #presentation-root')?.childElementCount
                    };
                });
                assert(
                    projectorMode.appMode === 'projector' && projectorMode.allWidgetsAreProjectorMode,
                    `Restored Presentation widgets should use projector mode without teacher sync feedback (${iteration}/${iterations})`
                );
                assert(
                    projectorMode.presentationRootIdCount === 1,
                    `Projector should keep one unique full-screen presentation root (${iteration}/${iterations})`
                );
                assert(
                    projectorMode.topLevelPresentationEmpty,
                    `Opening the classroom projector should not cover other widgets with an unsolicited full-screen presentation (${iteration}/${iterations})`
                );

                const inlinePresentation = projectorPage.locator('.widget.reveal-manager-widget [data-reveal-presentation-root]');
                assert(
                    await inlinePresentation.textContent().then((text) => text.includes('Stored PowerPoint')),
                    `Projector should restore stored PowerPoint text on startup (${iteration}/${iterations})`
                );
                assert(
                    await inlinePresentation.locator('img[src^="blob:"]').count() === 1,
                    `Projector should restore the stored PowerPoint image on startup (${iteration}/${iterations})`
                );
                if (iteration === 1) {
                    const delayedHydration = await projectorPage.evaluate(() => {
                        const diagnostics = window.__ProjectorDocumentStoreDelay;
                        return diagnostics
                            ? {
                                readsStarted: diagnostics.readsStarted,
                                readsCompleted: diagnostics.readsCompleted,
                                maxActiveReads: diagnostics.maxActiveReads,
                                resizeCallbacks: diagnostics.resizeCallbacks,
                                readsReleased: diagnostics.readsReleased
                            }
                            : null;
                    });
                    assert(
                        delayedHydration?.readsStarted >= 2
                            && delayedHydration.readsCompleted === delayedHydration.readsStarted
                            && delayedHydration.maxActiveReads >= 2
                            && delayedHydration.resizeCallbacks > 0
                            && delayedHydration.readsReleased,
                        'Projector regression should exercise delayed parallel document reads with ResizeObserver active'
                    );
                }

            } finally {
                await projectorPage.close();
            }
        }

        assert(pageErrors.length === 0, `PowerPoint projector restore should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `PowerPoint projector restore should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runDocumentViewerPdfChecks(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await makeExternalAssetsDeterministic(context);
    await installPdfStub(context);
    const pageErrors = [];
    const consoleErrors = [];

    const attachErrorChecks = (page) => {
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error' && !isExpectedBlockedExternalAssetMessage(message)) {
                consoleErrors.push(message.text());
            }
        });
    };
    context.on('page', attachErrorChecks);

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForFunction(() => Array.isArray(window.__TeacherDependencyFailures), { timeout: 10000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await addWidget(page, 'document-viewer', '.widget.document-viewer-widget', 'Document Viewer');

        const documentWidget = page.locator('.widget.document-viewer-widget');
        assert(await documentWidget.locator('.present-button').isDisabled(), 'Document Viewer should disable Present until a document is loaded');
        await documentWidget.locator('.document-viewer-file-input').setInputFiles({
            name: 'two-page-lesson.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7\nTeacher Screen smoke fixture')
        });

        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const documentState = state.layout?.widgets?.find((widget) => widget.type === 'DocumentViewerWidget')?.data;
            return document.querySelector('.document-viewer-page-counter')?.textContent === 'Page 1 of 2'
                && document.querySelector('.document-viewer-canvas-container canvas')
                && typeof documentState?.localPdf?.id === 'string'
                && documentState.localPdf.id.length > 0
                && documentState.localPdf.requiresReupload === false;
        }, { timeout: 15000 });
        assert(true, 'Uploaded PDF should save a durable local document reference');

        await openTeacherPanel(page);
        const deckNameInput = page.locator('#project-screen-name-input');
        await deckNameInput.fill('Keyboard isolation check');
        await deckNameInput.press('ArrowRight');
        assert(await documentWidget.locator('.document-viewer-page-counter').textContent() === 'Page 1 of 2', 'PDF shortcuts should not run while the teacher is editing another input');
        await closeTeacherPanel(page);

        await documentWidget.locator('.document-viewer-canvas-container canvas').click({ position: { x: 10, y: 10 } });
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('.document-viewer-page-counter')?.textContent === 'Page 2 of 2');
        assert(true, 'Focused Document Viewer should support keyboard page navigation');

        const documentPresentGeometry = await page.evaluate(() => {
            const button = document.querySelector('.widget.document-viewer-widget .present-button');
            const toolbar = document.querySelector('#lesson-quick-actions');
            const widget = document.querySelector('.widget.document-viewer-widget');
            const widgetInfo = window.__TeacherScreenApp?.layoutManager?.widgets
                ?.find((info) => info?.element === widget);
            const toBox = (element) => {
                const rect = element?.getBoundingClientRect();
                return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } : null;
            };
            return {
                button: toBox(button),
                toolbar: toBox(toolbar),
                widget: toBox(widget),
                widgetInfo: widgetInfo ? {
                    x: widgetInfo.x,
                    y: widgetInfo.y,
                    width: widgetInfo.width,
                    height: widgetInfo.height,
                    layoutType: widgetInfo.layoutType
                } : null,
                container: toBox(document.querySelector('#widgets-container')),
                panelOpen: document.querySelector('#teacher-panel')?.classList.contains('open') === true
            };
        });
        assert(documentPresentGeometry.button.bottom <= documentPresentGeometry.toolbar.y - 8
            || documentPresentGeometry.button.right <= documentPresentGeometry.toolbar.x - 8
            || documentPresentGeometry.button.x >= documentPresentGeometry.toolbar.right + 8,
        `Document Viewer Present should remain clear of lesson quick actions (${JSON.stringify(documentPresentGeometry)})`);
        await documentWidget.locator('.present-button').click();
        assert(await page.locator('body.document-viewer-presenting').count() === 1, 'Present should enter isolated document presentation mode');
        assert(await page.locator('#lesson-quick-actions').evaluate((element) => getComputedStyle(element).visibility === 'hidden'), 'Document presentation should hide lesson quick actions');
        await page.keyboard.press('Escape');
        assert(await page.locator('body.document-viewer-presenting').count() === 0, 'Escape should exit document presentation mode');

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(100);
        const mobileControlsFit = await documentWidget.locator('.widget-control-bar').evaluate((controlBar) => {
            const barRect = controlBar.getBoundingClientRect();
            return controlBar.scrollWidth <= controlBar.clientWidth + 1
                && Array.from(controlBar.querySelectorAll('button')).filter((button) => {
                    return getComputedStyle(button).display !== 'none';
                }).every((button) => {
                    const buttonRect = button.getBoundingClientRect();
                    return buttonRect.left >= barRect.left - 1 && buttonRect.right <= barRect.right + 1;
                });
        });
        assert(mobileControlsFit, 'Document Viewer controls should stay inside the widget on a phone-sized screen');
        await page.setViewportSize({ width: 1280, height: 720 });

        const projectorPage = await context.newPage();
        await projectorPage.goto(await getPairedProjectorUrl(page, baseUrl), { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForSelector('.widget.document-viewer-widget canvas', { timeout: 15000 });
        assert(await projectorPage.locator('.widget.document-viewer-widget canvas').count() === 1, 'Projector should restore an uploaded PDF from local document storage');
        assert(!(await projectorPage.locator('.widget.document-viewer-widget').textContent()).includes('uploaded again'), 'Projector should not ask for a PDF that is already stored on this device');
        await projectorPage.close();

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('.widget.document-viewer-widget canvas', { timeout: 15000 });
        assert(await page.locator('.widget.document-viewer-widget canvas').count() === 1, 'Uploaded PDF should survive a full teacher-screen reload');

        await page.evaluate(() => {
            delete window.pdfjsLib;
        });
        await page.locator('.widget.document-viewer-widget .document-viewer-file-input').setInputFiles({
            name: 'missing-engine.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7\nMissing engine fixture')
        });
        await page.waitForSelector('.document-viewer-message', { timeout: 10000 });
        assert((await page.locator('.document-viewer-message').textContent()).includes('PDF support could not load'), 'Document Viewer should explain when PDF support is unavailable');
        assert(await page.locator('.widget.document-viewer-widget .present-button').isDisabled(), 'Document Viewer should not present an unavailable PDF');
        assert(pageErrors.length === 0, `Document Viewer PDF checks should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Document Viewer PDF checks should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runNewDeckNavigationChecks(browser, baseUrl) {
    const oceanDefaultGradient = 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)';
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-create-btn', { timeout: 15000 });

        page.once('dialog', (dialog) => dialog.dismiss());
        await page.locator('#dashboard-create-btn').click();
        assert(await page.locator('#dashboard-view').isVisible(), 'Cancelling New Deck should keep the dashboard open');

        const className = `Dashboard Class ${Date.now()}`;
        page.once('dialog', (dialog) => dialog.accept(className));
        await page.locator('#dashboard-add-class-btn').click();
        await page.waitForFunction((expectedClass) => {
            const activeFilter = document.querySelector('.dashboard-filter.is-active');
            return activeFilter?.dataset.className === expectedClass;
        }, className, { timeout: 10000 });

        const currentDeckIdBeforeCreation = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state.currentDeckId || '';
        });
        const deckName = `Fresh Classroom ${Date.now()}`;
        page.once('dialog', (dialog) => dialog.accept(deckName));
        await page.locator('#dashboard-create-btn').click();
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });

        const classDeck = await page.evaluate(({ expectedName, expectedClass }) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.name === expectedName);
            const activeFilter = document.querySelector('.dashboard-filter.is-active');
            return {
                id: preset?.id || '',
                classId: preset?.classId || '',
                className: preset?.className || '',
                currentDeckId: state.currentDeckId || '',
                selectedClassName: activeFilter?.dataset.className || '',
                visibleOnDashboard: Boolean(preset?.id && document.querySelector(`.dashboard-screen-card[data-deck-id="${preset.id}"]`))
            };
        }, { expectedName: deckName, expectedClass: className });
        assert(classDeck.id && classDeck.classId, 'New Deck should create a saved class deck');
        assert(classDeck.className === className, 'New Deck should inherit the class currently open on the dashboard');
        assert(classDeck.currentDeckId === currentDeckIdBeforeCreation, 'Dashboard New Deck should not replace the active classroom deck');
        assert(classDeck.selectedClassName === className && classDeck.visibleOnDashboard, 'Dashboard New Deck should stay in the open class deck list');
        assert(await page.locator('#classroom-view').isHidden(), 'Dashboard New Deck should not open the classroom automatically');

        await page.locator('[data-dashboard-mode="library"]').click();
        const noClassDeckName = `Unclassified Deck ${Date.now()}`;
        page.once('dialog', (dialog) => dialog.accept(noClassDeckName));
        await page.locator('#dashboard-create-btn').click();
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        const noClassDeck = await page.evaluate((expectedName) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.name === expectedName);
            return {
                classId: preset?.classId || '',
                className: preset?.className || '',
                currentDeckId: state.currentDeckId || ''
            };
        }, noClassDeckName);
        assert(!noClassDeck.classId && !noClassDeck.className, 'New Deck should have no class when no class deck list is open');
        assert(noClassDeck.currentDeckId === currentDeckIdBeforeCreation, 'An unclassified dashboard deck should also leave the active classroom unchanged');
        assert(await page.locator('#dashboard-view').isVisible(), 'Creating an unclassified deck should stay on the dashboard');

        const classDeckCard = page.locator(`.dashboard-screen-card[data-deck-id="${classDeck.id}"]`);
        await classDeckCard.locator('[data-deck-action="toggle"]').click();
        await classDeckCard.locator('[data-deck-action="open"]').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.waitForFunction((expectedDeckId) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state.currentDeckId === expectedDeckId;
        }, classDeck.id, { timeout: 10000 });

        const newDeckState = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return {
                projectName: state.projectName,
                pageCount: Array.isArray(state.pages) ? state.pages.length : 0,
                widgetCount: Array.isArray(state.layout?.widgets) ? state.layout.widgets.length : -1,
                background: state.background,
                pageBackground: state.pages?.[0]?.snapshot?.background,
                renderedBackgroundImage: document.querySelector('#student-view')?.style.backgroundImage || '',
                selectedGradientCount: document.querySelectorAll('#background-selector .background-swatch.is-selected').length
            };
        });

        assert(newDeckState.projectName === deckName, 'New Deck should save the chosen deck name');
        assert(newDeckState.pageCount === 1, 'New Deck should start with one page');
        assert(newDeckState.widgetCount === 0, 'Opening the new deck should show a blank classroom');
        assert(newDeckState.background?.type === 'gradient' && newDeckState.background?.value === oceanDefaultGradient, 'New Deck should use the Ocean sky gradient');
        assert(newDeckState.pageBackground?.type === 'gradient' && newDeckState.pageBackground?.value === oceanDefaultGradient, 'New Deck should save the Ocean sky gradient with its first page');
        assert(newDeckState.renderedBackgroundImage.includes('linear-gradient'), 'New Deck should visibly render its gradient on the classroom canvas');
        assert(newDeckState.selectedGradientCount === 1, 'Background picker should show the default gradient as selected');
        assert(await page.locator('#teacher-panel.open').count() === 0, 'Opening the new deck should enter the classroom in lesson mode');

        const projectorPage = await context.newPage();
        await projectorPage.goto(await getPairedProjectorUrl(page, baseUrl), { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForFunction(() => document.querySelector('#student-view')?.style.backgroundImage.includes('linear-gradient'), undefined, { timeout: 20000 });
        assert((await projectorPage.locator('#student-view').evaluate((element) => element.style.backgroundImage)).includes('linear-gradient'), 'Projector should render the new deck gradient');
        await projectorPage.close();

        await page.evaluate(() => {
            const savedOceanBackground = {
                type: 'solid',
                value: '#0f172a',
                source: 'theme-default',
                theme: 'theme-ocean'
            };
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            state.background = savedOceanBackground;
            if (state.pages?.[0]?.snapshot) {
                state.pages[0].snapshot.background = savedOceanBackground;
            }
            localStorage.setItem('background', JSON.stringify(savedOceanBackground));
            localStorage.setItem('classroomScreenState', JSON.stringify(state));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-create-btn', { timeout: 15000 });
        await page.waitForFunction(() => {
            const studentView = document.querySelector('#student-view');
            return Boolean(studentView?.style.backgroundImage || studentView?.style.backgroundColor);
        }, undefined, { timeout: 10000 });
        const restoredExistingDeck = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return {
                backgroundImage: document.querySelector('#student-view')?.style.backgroundImage || '',
                backgroundColor: document.querySelector('#student-view')?.style.backgroundColor || '',
                storedBackground: JSON.parse(localStorage.getItem('background') || 'null'),
                stateBackground: state.background,
                pageBackground: state.pages?.[0]?.snapshot?.background
            };
        });
        assert(restoredExistingDeck.backgroundImage === 'none', 'An existing deck should keep its previously saved background');
        assert(restoredExistingDeck.backgroundColor === 'rgb(15, 23, 42)', 'An existing deck should retain its saved Ocean solid colour');
    } finally {
        await context.close();
    }
}

async function runDeckOrganisationChecks(browser, baseUrl) {
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);
    const page = await context.newPage();

    try {
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.evaluate(() => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            if (!Array.isArray(presets) || presets.length === 0) {
                throw new Error('Expected a seeded deck for the legacy shelf preservation check');
            }

            const sourceDeck = presets[0];
            const legacyDeck = {
                ...sourceDeck,
                name: 'Legacy Deck',
                seededLessonId: '',
                className: '9A Science',
                folderId: 'legacy-shelf',
                projectState: {
                    ...sourceDeck.projectState,
                    projectName: 'Legacy Deck'
                }
            };
            localStorage.setItem('classroomLayoutPresets', JSON.stringify([...presets, legacyDeck]));
            localStorage.setItem('classroomLayoutFolders', JSON.stringify([{
                id: 'legacy-shelf',
                name: 'Archived Organisation',
                createdAt: Date.now(),
                updatedAt: Date.now()
            }]));
        });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        const legacyCard = page.locator('.dashboard-screen-card', { hasText: 'Legacy Deck' });
        assert(await legacyCard.count() === 1, 'A deck with legacy shelf data should remain available');
        assert(!await legacyCard.textContent().then((text) => text.includes('Archived Organisation')), 'Deck cards should not show legacy shelf names');
        assert(await page.locator('#dashboard-folder-list, #dashboard-create-folder-btn, .dashboard-shelves, #preset-folder-select').count() === 0, 'Shelf controls should stay hidden when legacy shelf data exists');

        await legacyCard.locator('[data-deck-action="toggle"]').click();
        await legacyCard.locator('[data-deck-action="open"]').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.locator('#save-project-screen-btn').dispatchEvent('click');
        await page.waitForFunction(() => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.some((preset) => preset?.name === 'Legacy Deck' && preset?.folderId === 'legacy-shelf');
        }, { timeout: 10000 });

        const shelfRecordPreserved = await page.evaluate(() => {
            const folders = JSON.parse(localStorage.getItem('classroomLayoutFolders') || '[]');
            return folders.some((folder) => folder?.id === 'legacy-shelf');
        });
        assert(shelfRecordPreserved, 'Existing shelf records should remain stored for import and export compatibility');
    } finally {
        await context.close();
    }
}

async function installDeckLibraryMigrationFixture(context) {
    await context.addInitScript(({ markerKey, sharedLegacyId }) => {
        if (!window.location.pathname.toLowerCase().endsWith('/index.html')) {
            return;
        }
        if (localStorage.getItem(markerKey) === 'ready') {
            return;
        }

        const makeProjectState = (projectName, pageId, color) => ({
            schemaVersion: 1,
            projectName,
            activePageId: pageId,
            pages: [{
                id: pageId,
                name: 'Page 1',
                snapshot: {
                    theme: 'theme-ocean',
                    background: { type: 'solid', value: color },
                    layout: { widgets: [] },
                    timerStates: {},
                    lessonPlan: null
                }
            }],
            theme: 'theme-ocean',
            background: { type: 'solid', value: color },
            layout: { widgets: [] },
            timerStates: {},
            lessonPlan: null
        });
        const clone = (value) => JSON.parse(JSON.stringify(value));
        const baseTime = 1700000000000;
        const currentState = makeProjectState('Legacy Current Deck', 'legacy-current-page', '#123247');
        const alphaState = makeProjectState('Duplicate ID Alpha', 'duplicate-alpha-page', '#19324a');
        const betaState = makeProjectState('Duplicate ID Beta', 'duplicate-beta-page', '#20394f');

        localStorage.setItem('classroomLayoutPresets', JSON.stringify([{
            name: 'Legacy Current Deck',
            className: 'Migration Class',
            period: 'Period 1',
            folderId: 'legacy-shelf',
            isFavorite: false,
            projectState: clone(currentState),
            theme: currentState.theme,
            background: clone(currentState.background),
            layout: clone(currentState.layout),
            lessonPlan: null,
            createdAt: baseTime,
            updatedAt: baseTime + 1000,
            lastUsedAt: baseTime + 1000,
            usageCount: 0
        }, {
            id: sharedLegacyId,
            name: 'Duplicate ID Alpha',
            className: 'Migration Class',
            period: 'Period 2',
            folderId: '',
            isFavorite: false,
            projectState: clone(alphaState),
            theme: alphaState.theme,
            background: clone(alphaState.background),
            layout: clone(alphaState.layout),
            lessonPlan: null,
            createdAt: baseTime + 2000,
            updatedAt: baseTime + 4000,
            lastUsedAt: baseTime + 4000,
            usageCount: 2
        }, {
            id: sharedLegacyId,
            name: 'Duplicate ID Beta',
            className: 'Migration Class',
            period: 'Period 3',
            folderId: '',
            isFavorite: false,
            projectState: clone(betaState),
            theme: betaState.theme,
            background: clone(betaState.background),
            layout: clone(betaState.layout),
            lessonPlan: null,
            createdAt: baseTime + 3000,
            updatedAt: baseTime + 3000,
            lastUsedAt: baseTime + 3000,
            usageCount: 0
        }]));
        localStorage.setItem('classroomLayoutFolders', JSON.stringify([{
            id: 'legacy-shelf',
            name: 'Archived Organisation',
            createdAt: baseTime,
            updatedAt: baseTime
        }]));
        localStorage.setItem('classroomScreenState', JSON.stringify(currentState));
        localStorage.setItem(markerKey, 'ready');
    }, {
        markerKey: '__teacherScreenDeckLibrarySmokeFixture',
        sharedLegacyId: 'deck-shared-legacy-id'
    });
}

async function runDeckLibraryRedesignChecks(browser, baseUrl) {
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);
    await installDeckLibraryMigrationFixture(context);
    const pageErrors = [];
    const consoleErrors = [];

    context.on('page', (openedPage) => {
        openedPage.on('pageerror', (error) => pageErrors.push(error.message));
        openedPage.on('console', (message) => {
            if (message.type() === 'error' && !isExpectedBlockedExternalAssetMessage(message)) {
                consoleErrors.push(message.text());
            }
        });
    });

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForFunction(() => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return Array.isArray(presets)
                && presets.length >= 3
                && presets.every((preset) => typeof preset?.id === 'string' && preset.id)
                && typeof state.currentDeckId === 'string'
                && state.currentDeckId;
        }, null, { timeout: 10000 });

        const fixtureNames = ['Legacy Current Deck', 'Duplicate ID Alpha', 'Duplicate ID Beta'];
        const readIdentitySnapshot = () => page.evaluate((names) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const records = Object.fromEntries(names.map((name) => {
                const preset = presets.find((candidate) => candidate?.name === name) || null;
                return [name, preset ? {
                    id: preset.id || '',
                    projectDeckId: preset.projectState?.currentDeckId || '',
                    folderId: preset.folderId || '',
                    usageCount: Number(preset.usageCount || 0)
                } : null];
            }));
            const ids = presets.map((preset) => preset?.id).filter(Boolean);
            const folders = JSON.parse(localStorage.getItem('classroomLayoutFolders') || '[]');
            return {
                records,
                presetCount: presets.length,
                uniqueIdCount: new Set(ids).size,
                idCount: ids.length,
                currentDeckId: state.currentDeckId || '',
                currentProjectName: state.projectName || '',
                legacyFolderStored: folders.some((folder) => folder?.id === 'legacy-shelf')
            };
        }, fixtureNames);

        const migratedBeforeReload = await readIdentitySnapshot();
        const currentDeckId = migratedBeforeReload.records['Legacy Current Deck']?.id || '';
        const alphaDeckId = migratedBeforeReload.records['Duplicate ID Alpha']?.id || '';
        const betaDeckId = migratedBeforeReload.records['Duplicate ID Beta']?.id || '';
        assert(currentDeckId && alphaDeckId && betaDeckId, 'Legacy deck migration should preserve every named deck and assign an ID');
        assert(new Set([currentDeckId, alphaDeckId, betaDeckId]).size === 3, 'Legacy duplicate IDs should be replaced with unique stable deck IDs');
        assert(migratedBeforeReload.uniqueIdCount === migratedBeforeReload.idCount, 'Every saved deck should have a unique ID after migration');
        assert(fixtureNames.every((name) => {
            const record = migratedBeforeReload.records[name];
            return record?.id && record.projectDeckId === record.id;
        }), 'Every migrated preset should align its projectState currentDeckId with its saved deck ID');
        assert(migratedBeforeReload.currentDeckId === currentDeckId && migratedBeforeReload.currentProjectName === 'Legacy Current Deck', 'Legacy current state should reconnect to the matching migrated preset');
        assert(migratedBeforeReload.records['Legacy Current Deck']?.folderId === 'legacy-shelf' && migratedBeforeReload.legacyFolderStored, 'Deck identity migration should preserve legacy shelf compatibility data');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        const migratedAfterReload = await readIdentitySnapshot();
        assert(migratedAfterReload.presetCount === migratedBeforeReload.presetCount, 'Reloading migrated deck data should not create another draft deck');
        assert(fixtureNames.every((name) => migratedAfterReload.records[name]?.id === migratedBeforeReload.records[name]?.id), 'Migrated deck IDs should stay stable across reload');
        assert(migratedAfterReload.currentDeckId === currentDeckId, 'Reload should keep the migrated current deck identity');

        const navigationLabels = await page.locator('.dashboard-nav-item').allTextContents();
        assert(navigationLabels.map((label) => label.trim()).join('|') === 'Deck Library|Resources|Favourite decks|Recent decks|More', 'Dashboard navigation should lead with the canonical Deck Library and identify deck filters clearly');
        assert(await page.locator('.dashboard-nav-item.is-active').textContent().then((text) => text.trim() === 'Deck Library'), 'Deck Library should be the active destination on startup');
        assert(await page.locator('.dashboard-library-panel h1').textContent().then((text) => text.trim() === 'All lesson decks'), 'Deck Library should open to all lesson decks');

        const currentCard = page.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"]`);
        const currentToggle = currentCard.locator('[data-deck-action="toggle"]');
        assert(await page.locator('.dashboard-screen-card').first().getAttribute('data-deck-id') === currentDeckId, 'The current deck should be displayed first');
        assert(await currentToggle.getAttribute('aria-expanded') === 'true', 'The current deck should be expanded by default');
        assert(await currentCard.locator('.dashboard-screen-card__details').isVisible(), 'The current deck should reveal its actions on startup');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 1, 'Only one deck action panel should be open at a time');
        assert(await page.locator('#dashboard-open-classroom-btn').count() === 1, 'The dashboard should keep exactly one compatibility Classroom entry button');
        for (const action of ['open', 'arrange', 'present']) {
            assert(await currentCard.locator(`[data-deck-action="${action}"]`).isVisible(), `Expanded deck should show its ${action} action`);
        }
        assert(await currentCard.locator('[data-deck-action="favorite"]').isVisible(), 'Deck rows should keep the favourite action directly available');

        const currentMore = currentCard.locator('.dashboard-deck-more');
        assert(await currentMore.locator('summary').isVisible(), 'Expanded deck should expose a More menu');
        assert(await currentMore.locator('[data-deck-action="rename"]').isHidden(), 'Advanced deck actions should stay collapsed initially');
        await currentMore.locator('summary').click();
        for (const action of ['rename', 'duplicate', 'delete']) {
            assert(await currentMore.locator(`[data-deck-action="${action}"]`).isVisible(), `More should reveal the ${action} action`);
        }
        await page.keyboard.press('Escape');
        assert(await currentMore.getAttribute('open') === null, 'Escape should close the expanded More menu');
        assert(await currentMore.locator('summary').evaluate((element) => document.activeElement === element), 'Closing More with Escape should restore focus to its summary');

        const alphaCard = page.locator(`.dashboard-screen-card[data-deck-id="${alphaDeckId}"]`);
        const alphaToggle = alphaCard.locator('[data-deck-action="toggle"]');
        await alphaToggle.focus();
        await alphaToggle.press('Enter');
        assert(await alphaToggle.getAttribute('aria-expanded') === 'true', 'Enter should expand a focused deck');
        assert(await currentToggle.getAttribute('aria-expanded') === 'false', 'Expanding another deck should collapse the previous deck');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 1, 'Keyboard expansion should still leave only one action panel open');
        assert(await alphaToggle.evaluate((element) => document.activeElement === element), 'Deck toggle should keep focus after keyboard expansion');
        await alphaToggle.press('Space');
        assert(await alphaToggle.getAttribute('aria-expanded') === 'false', 'Space should collapse an expanded deck');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Collapsing the expanded deck should hide every action panel');
        await alphaToggle.press('Space');
        assert(await alphaToggle.getAttribute('aria-expanded') === 'true', 'Space should also reopen a collapsed deck');

        const currentFavorite = currentCard.locator('[data-deck-action="favorite"]');
        await currentFavorite.focus();
        await currentFavorite.press('Enter');
        await page.waitForFunction((deckId) => {
            const active = document.activeElement;
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return active?.dataset?.deckAction === 'favorite'
                && active?.dataset?.deckId === deckId
                && presets.some((preset) => preset?.id === deckId && preset?.isFavorite === true);
        }, currentDeckId, { timeout: 10000 });
        assert(await currentCard.locator('[data-deck-action="favorite"]').getAttribute('aria-pressed') === 'true', 'Favourite should update its accessible state and persist locally');

        const searchInput = page.locator('#dashboard-search-input');
        await searchInput.click();
        await page.keyboard.type('legacy');
        assert(await page.locator('#dashboard-search-input').inputValue() === 'legacy', 'Deck search should keep every continuously typed character');
        assert(await page.locator('#dashboard-search-input').evaluate((element) => document.activeElement === element), 'Deck search should keep keyboard focus while rerendering');
        assert(await currentCard.count() === 1 && await alphaCard.count() === 0, 'Deck search should filter accordion rows by name');
        await page.locator('#dashboard-search-input').fill('');

        const migrationClass = page.locator('.dashboard-filter[data-class-name="Migration Class"]');
        assert(await migrationClass.getAttribute('aria-label') === 'Migration Class, 3 decks', 'Class filters should announce their migrated deck count');
        await migrationClass.click();
        assert(await page.locator('.dashboard-screen-card').count() === 3, 'Class filtering should retain every matching migrated deck');
        assert(await page.locator('.dashboard-nav-item.is-active').textContent().then((text) => text.trim() === 'Deck Library'), 'Class filtering should keep Deck Library active');
        await page.waitForFunction(() => document.activeElement?.dataset?.className === 'Migration Class', null, { timeout: 10000 });

        await page.locator('[data-dashboard-mode="library"]').click();
        assert(await page.locator('.dashboard-filter.is-active').count() === 0, 'Opening Deck Library should clear the class filter');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Opening Deck Library should not expand a deck without a deck click');
        await page.locator('[data-dashboard-mode="favorites"]').click();
        assert(await page.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"]`).count() === 1 && await page.locator('.dashboard-screen-card').count() === 1, 'Favourites should show only pinned decks');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Opening Favourites should not expand its first deck');
        await page.locator('[data-dashboard-mode="recent"]').click();
        assert(await page.locator(`.dashboard-screen-card[data-deck-id="${alphaDeckId}"]`).count() === 1, 'Recent should preserve migrated deck usage history');
        assert(await page.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"]`).count() === 0, 'Recent should exclude decks that have not been opened');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Opening Recent should not expand a deck');
        await page.locator('[data-dashboard-mode="resources"]').click();
        await page.waitForSelector('.dashboard-resources-panel', { timeout: 10000 });
        assert(await page.locator('.dashboard-screen-card').count() === 0, 'Resources should remain separate from deck accordion rows');
        await page.locator('[data-dashboard-mode="library"]').click();
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Returning from Resources should keep lesson decks collapsed');

        const addClassButton = page.locator('#dashboard-add-class-btn');
        assert(await addClassButton.isVisible(), 'Your Classes should provide a clear Add class button');
        assert(await addClassButton.getAttribute('aria-label') === 'Add class', 'Add class should have a concise accessible name');
        assert(await addClassButton.evaluate((button) => button.getBoundingClientRect().height >= 44), 'Add class should have a touch-friendly target');
        const activeDeckBeforeAddClass = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state.currentDeckId || '';
        });
        page.once('dialog', (dialog) => dialog.accept('Year 8 Science'));
        await addClassButton.click();
        await page.waitForFunction(() => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.some((preset) => preset?.className === 'Year 8 Science');
        }, null, { timeout: 10000 });
        const addedClassState = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const starterDecks = presets.filter((preset) => preset?.className === 'Year 8 Science');
            const starterDeck = starterDecks[0] || null;
            return {
                activeDeckId: state.currentDeckId || '',
                starterDeckCount: starterDecks.length,
                starterDeckName: starterDeck?.name || '',
                usageCount: Number(starterDeck?.usageCount || 0),
                widgetCount: starterDeck?.projectState?.pages?.[0]?.snapshot?.layout?.widgets?.length ?? -1
            };
        });
        assert(addedClassState.activeDeckId === activeDeckBeforeAddClass, 'Adding a class should not load or replace the active classroom deck');
        assert(addedClassState.starterDeckCount === 1 && addedClassState.starterDeckName === 'Year 8 Science - New deck', 'Adding a class should create one clearly named starter deck');
        assert(addedClassState.usageCount === 0 && addedClassState.widgetCount === 0, 'A new class starter deck should be blank and should not enter Recent decks');
        assert(await page.locator('.dashboard-filter[data-class-name="Year 8 Science"].is-active').count() === 1, 'A newly added class should be selected in Your Classes');
        assert(await page.locator('.dashboard-screen-card').count() === 1, 'The new class should show its starter deck without unrelated decks');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Adding a class should not automatically open its starter deck');
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1 && await page.locator('#classroom-view:not([hidden])').count() === 0, 'Adding a class should keep the teacher on the Dashboard');

        page.once('dialog', (dialog) => dialog.accept('year 8 science'));
        await page.locator('#dashboard-add-class-btn').click();
        await page.waitForFunction(() => document.activeElement?.dataset?.className === 'Year 8 Science', null, { timeout: 10000 });
        const matchingClassDeckCount = await page.evaluate(() => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.filter((preset) => preset?.className === 'Year 8 Science').length;
        });
        assert(matchingClassDeckCount === 1, 'Adding an existing class name should select it without creating a duplicate');

        const menuDeckStateBefore = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return {
                currentDeckId: state.currentDeckId || '',
                usage: presets
                    .map((preset) => [preset?.id || '', Number(preset?.usageCount || 0), Number(preset?.lastUsedAt || 0)])
                    .sort(([a], [b]) => a.localeCompare(b))
            };
        });
        await page.locator('#dashboard-utility-menu > summary').click();
        await page.locator('#dashboard-settings-btn').click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Dashboard Teacher Controls should open without leaving the Dashboard');
        assert(await page.locator('#classroom-view:not([hidden])').count() === 0, 'Dashboard Teacher Controls should not enter a classroom deck');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Dashboard Teacher Controls should keep lesson decks collapsed');
        const menuDeckStateAfter = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return {
                currentDeckId: state.currentDeckId || '',
                usage: presets
                    .map((preset) => [preset?.id || '', Number(preset?.usageCount || 0), Number(preset?.lastUsedAt || 0)])
                    .sort(([a], [b]) => a.localeCompare(b))
            };
        });
        assert(JSON.stringify(menuDeckStateAfter) === JSON.stringify(menuDeckStateBefore), 'Opening Teacher Controls should not load or touch a saved deck');
        await closeTeacherPanel(page);
        const dashboardMoreSummary = page.locator('#dashboard-utility-menu > summary');
        await dashboardMoreSummary.click();
        await page.locator('#dashboard-sections-btn').click();
        await page.waitForSelector('#sections-menu:not([hidden])', { timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.id === 'sections-menu-close', null, { timeout: 10000 });
        assert(await page.locator('#sections-menu-close').evaluate((element) => document.activeElement === element), 'Opening Sections should place keyboard focus on its close button');
        const sectionsStructure = await page.locator('#sections-menu').evaluate((menu) => {
            const tablist = menu.querySelector('.nav-tabs');
            const directChildren = Array.from(tablist.children);
            return {
                tabCount: directChildren.filter((child) => child.matches('button[role="tab"]')).length,
                tabLabels: directChildren.map((child) => child.textContent?.replace(/Coming soon/g, '').trim()),
                deckLibraryIsSeparate: menu.querySelector('#manage-screens-btn')?.parentElement !== tablist,
                deckLibraryLabel: menu.querySelector('#manage-screens-btn strong')?.textContent?.trim() || '',
                embeddedManagerCount: menu.querySelectorAll('.screen-manager-body').length
            };
        });
        assert(sectionsStructure.tabCount === 5, 'Sections should keep five direct section tabs');
        assert(sectionsStructure.tabLabels.join('|') === 'Dashboard|Classroom|Planner|Timetable|Notes', 'Sections should present the five destinations in a concise order');
        assert(sectionsStructure.deckLibraryIsSeparate && sectionsStructure.deckLibraryLabel === 'Deck Library', 'Deck Library should be a separate destination below the section tabs');
        assert(sectionsStructure.embeddedManagerCount === 0, 'Sections should stay navigation-only without embedding deck controls');
        await page.locator('#manage-screens-btn').click();
        await page.waitForSelector('#sections-menu', { state: 'hidden', timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.id === 'dashboard-search-input', null, { timeout: 10000 });
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Deck Library should keep the Dashboard visible');
        assert(await page.locator('#classroom-view:not([hidden])').count() === 0, 'Deck Library should not enter a classroom deck');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Deck Library should not open a lesson deck after leaving Sections');
        assert(await page.locator('#screen-deck-manager-dialog[open]').count() === 0, 'Choosing Deck Library should not also open Deck details');
        const manageMenuDeckStateAfter = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return {
                currentDeckId: state.currentDeckId || '',
                usage: presets
                    .map((preset) => [preset?.id || '', Number(preset?.usageCount || 0), Number(preset?.lastUsedAt || 0)])
                    .sort(([a], [b]) => a.localeCompare(b))
            };
        });
        assert(JSON.stringify(manageMenuDeckStateAfter) === JSON.stringify(menuDeckStateBefore), 'Opening Deck Library should not load or touch a saved deck');

        await openScreenDeckTools(page);
        assert(await page.locator('#screen-deck-manager-title').textContent().then((text) => text.trim() === 'Deck details & backup'), 'Dashboard Deck details should open in its dedicated dialog');
        assert(await page.locator('#screen-deck-manager-dialog #preset-list').count() === 0 && await page.locator('#screen-deck-manager-dialog #layout-preset').count() === 1, 'Deck details should use one saved-deck selector without a duplicate list');
        assert(await page.locator('#screen-deck-manager-dialog #reset-layout').count() === 0, 'Deck details should not expose Clear current page');
        assert(await page.locator('#current-project-name').textContent().then((text) => text.trim() === 'Legacy Current Deck'), 'Deck details should identify the current deck');
        assert(await page.locator('#current-project-page-summary').textContent().then((text) => /^Page 1 of \d+$/.test(text.trim())), 'Deck details should identify the current page position');
        assert(await page.locator('#preset-name').inputValue() === 'Legacy Current Deck'
            && await page.locator('#preset-class-name').inputValue() === 'Migration Class'
            && await page.locator('#preset-period').inputValue() === 'Period 1', 'Deck details should populate editable metadata from the current deck');
        const visibleScreenManagerActions = await page.locator('#screen-deck-manager-dialog[open] .screen-manager-body button:visible').allTextContents();
        const normalizedScreenManagerActions = visibleScreenManagerActions.map((label) => label.replace(/\s+/g, ' ').trim());
        for (const label of ['Open deck', 'Save changes', 'Save dated copy']) {
            assert(normalizedScreenManagerActions.includes(label), `Deck details should keep ${label} visible`);
        }
        assert(!normalizedScreenManagerActions.includes('Export decks') && !normalizedScreenManagerActions.includes('Import decks'), 'Export and import should stay inside the collapsed advanced disclosure');

        const readDeckSelectionSnapshot = () => page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return {
                currentDeckId: state.currentDeckId || '',
                projectName: state.projectName || '',
                activePageId: state.activePageId || '',
                usage: presets
                    .map((preset) => ({
                        id: preset?.id || '',
                        usageCount: Number(preset?.usageCount || 0),
                        lastUsedAt: Number(preset?.lastUsedAt || 0)
                    }))
                    .sort((a, b) => a.id.localeCompare(b.id))
            };
        });
        const beforePassiveDeckChoice = await readDeckSelectionSnapshot();
        await page.locator('#class-profile-select').selectOption('Migration Class');
        await page.locator('#layout-preset').selectOption(betaDeckId);
        const afterPassiveDeckChoice = await readDeckSelectionSnapshot();
        assert(JSON.stringify(afterPassiveDeckChoice) === JSON.stringify(beforePassiveDeckChoice), 'Changing the class filter and saved-deck choice should not change the current deck, page, or usage history');
        assert(await page.locator('#screen-deck-manager-dialog[open]').count() === 1, 'Selecting a saved deck should keep Deck details open until Open deck is chosen');
        assert(await page.locator('#preset-name').inputValue() === 'Legacy Current Deck'
            && await page.locator('#preset-class-name').inputValue() === 'Migration Class'
            && await page.locator('#preset-period').inputValue() === 'Period 1', 'Browsing another saved deck should not replace the current deck metadata fields');

        const desktopScreenManagerLayout = await page.locator('#screen-deck-manager-dialog').evaluate((dialog) => {
            const content = dialog.querySelector('.sections-menu__content');
            const managerBody = dialog.querySelector('.screen-manager-body');
            const dialogRect = dialog.getBoundingClientRect();
            const undersizedControls = Array.from(dialog.querySelectorAll('button, summary, select, input'))
                .filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden')
                .map((control) => ({
                    label: control.getAttribute('aria-label') || control.textContent?.replace(/\s+/g, ' ').trim() || control.id || control.tagName,
                    height: control.getBoundingClientRect().height
                }))
                .filter((control) => control.height < 39.5);
            return {
                viewportFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
                dialogFits: dialogRect.left >= -1 && dialogRect.right <= window.innerWidth + 1 && dialog.scrollWidth <= dialog.clientWidth + 1,
                contentFits: !!content && content.scrollWidth <= content.clientWidth + 1,
                managerFits: !!managerBody && managerBody.scrollWidth <= managerBody.clientWidth + 1,
                undersizedControls
            };
        });
        assert(desktopScreenManagerLayout.viewportFits && desktopScreenManagerLayout.dialogFits && desktopScreenManagerLayout.contentFits && desktopScreenManagerLayout.managerFits, 'Desktop Deck details should not create horizontal overflow');
        assert(desktopScreenManagerLayout.undersizedControls.length === 0, `Desktop Deck details controls should be at least 40px high (${desktopScreenManagerLayout.undersizedControls.map((control) => `${control.label}: ${control.height.toFixed(1)}px`).join(', ')})`);

        const betaUsageBeforeOpen = beforePassiveDeckChoice.usage.find((record) => record.id === betaDeckId);
        assert(Boolean(betaUsageBeforeOpen), 'The explicit-open regression should find the selected saved deck usage record');
        await page.locator('#apply-layout-preset').click();
        await page.waitForFunction(({ deckId, expectedUsage }) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const selected = presets.find((preset) => preset?.id === deckId);
            return state.currentDeckId === deckId
                && Number(selected?.usageCount || 0) === expectedUsage
                && !document.querySelector('#screen-deck-manager-dialog')?.open;
        }, { deckId: betaDeckId, expectedUsage: betaUsageBeforeOpen.usageCount + 1 }, { timeout: 10000 });
        const afterExplicitOpen = await readDeckSelectionSnapshot();
        const betaUsageAfterOpen = afterExplicitOpen.usage.find((record) => record.id === betaDeckId);
        assert(afterExplicitOpen.currentDeckId === betaDeckId
            && afterExplicitOpen.projectName === 'Duplicate ID Beta'
            && afterExplicitOpen.activePageId === 'duplicate-beta-page', 'Open deck should load the selected saved deck and its active page');
        assert(betaUsageAfterOpen?.usageCount === betaUsageBeforeOpen.usageCount + 1
            && betaUsageAfterOpen.lastUsedAt > betaUsageBeforeOpen.lastUsedAt, 'Open deck should record exactly one use of the selected deck');
        assert(beforePassiveDeckChoice.usage
            .filter((record) => record.id !== betaDeckId)
            .every((record) => JSON.stringify(afterExplicitOpen.usage.find((candidate) => candidate.id === record.id)) === JSON.stringify(record)), 'Open deck should not alter usage history for unselected decks');
        assert(await page.locator(`.dashboard-screen-card[data-deck-id="${betaDeckId}"].is-current`).count() === 1, 'The Dashboard should mark the explicitly opened deck as current');

        await openScreenDeckTools(page);
        await page.locator('#class-profile-select').selectOption('Migration Class');
        await page.locator('#layout-preset').selectOption(currentDeckId);
        await page.locator('#apply-layout-preset').click();
        await page.waitForFunction((deckId) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state.currentDeckId === deckId && !document.querySelector('#screen-deck-manager-dialog')?.open;
        }, currentDeckId, { timeout: 10000 });

        await openScreenDeckTools(page);
        const beforeMetadataSave = await readDeckSelectionSnapshot();
        const presetCountBeforeMetadataSave = await page.evaluate(() => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').length);
        await page.locator('#preset-name').fill('Legacy Current Deck Updated');
        await page.locator('#preset-class-name').fill('Migration Class Updated');
        await page.locator('#preset-period').fill('Period 4');
        await page.locator('#save-preset').click();
        await page.waitForFunction((deckId) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const current = presets.find((preset) => preset?.id === deckId);
            return state.currentDeckId === deckId
                && state.projectName === 'Legacy Current Deck Updated'
                && current?.name === 'Legacy Current Deck Updated'
                && current?.className === 'Migration Class Updated'
                && current?.period === 'Period 4';
        }, currentDeckId, { timeout: 10000 });
        const afterMetadataSave = await readDeckSelectionSnapshot();
        assert(afterMetadataSave.currentDeckId === beforeMetadataSave.currentDeckId
            && afterMetadataSave.activePageId === beforeMetadataSave.activePageId
            && afterMetadataSave.usage.every((record) => JSON.stringify(beforeMetadataSave.usage.find((candidate) => candidate.id === record.id)) === JSON.stringify(record)), 'Save changes should update current metadata without switching decks, pages, or usage history');
        assert(await page.evaluate(() => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').length) === presetCountBeforeMetadataSave, 'Save changes should update the current deck rather than create a new one');

        await page.locator('#preset-name').fill('Legacy Current Deck');
        await page.locator('#preset-class-name').fill('Migration Class');
        await page.locator('#preset-period').fill('Period 1');
        await page.locator('#save-preset').click();
        await page.waitForFunction((deckId) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const current = presets.find((preset) => preset?.id === deckId);
            return state.currentDeckId === deckId
                && state.projectName === 'Legacy Current Deck'
                && current?.name === 'Legacy Current Deck'
                && current?.className === 'Migration Class'
                && current?.period === 'Period 1';
        }, currentDeckId, { timeout: 10000 });
        await page.keyboard.press('Escape');
        await page.waitForSelector('#screen-deck-manager-dialog[open]', { state: 'detached', timeout: 10000 });

        await page.locator('#dashboard-utility-menu > summary').click();
        await page.locator('#dashboard-settings-btn').click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        const advancedPageActions = page.locator('#teacher-panel .project-page-advanced');
        if (await advancedPageActions.getAttribute('open') === null) {
            await advancedPageActions.locator(':scope > summary').click();
        }
        await page.waitForSelector('#teacher-panel .project-page-advanced[open]', { timeout: 10000 });
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Teacher Controls should open over the Dashboard');
        assert(await page.locator('#classroom-view:not([hidden])').count() === 0, 'Teacher Controls should not enter Classroom');
        assert(await page.locator('#reset-layout').isVisible() && await page.locator('#delete-page-btn').isVisible(), 'More page actions should contain Clear current page and Delete page');
        assert(await page.locator('#screen-deck-manager-dialog #reset-layout').count() === 0, 'Clear current page should remain outside Deck details');
        await closeTeacherPanel(page);

        assert(await page.locator('.dashboard-nav-item.is-active').textContent().then((text) => text.trim() === 'Deck Library'), 'The canonical Deck Library destination should remain selected');
        const currentDeckDetails = page.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"] .dashboard-screen-card__details`);
        if (!await currentDeckDetails.isVisible()) {
            await page.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"] [data-deck-action="toggle"]`).click();
        }
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${currentDeckId}"] .dashboard-screen-card__details:not([hidden])`, { timeout: 10000 });

        await page.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"] [data-deck-action="arrange"]`).click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        assert(await page.locator('#teacher-panel.open').count() === 1, 'Arrange should enter the selected classroom deck with Teacher Controls open');
        await page.locator('#project-screen-name-input').fill('Duplicate ID Alpha');
        await page.locator('#save-project-screen-btn').click();
        const rejectedRenameState = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return {
                currentDeckId: state.currentDeckId || '',
                projectName: state.projectName || '',
                inputName: document.querySelector('#project-screen-name-input')?.value || ''
            };
        });
        assert(rejectedRenameState.currentDeckId === currentDeckId
            && rejectedRenameState.projectName === 'Legacy Current Deck'
            && rejectedRenameState.inputName === 'Legacy Current Deck', 'Rejecting a duplicate deck name should keep the current deck identity and restore its saved name');
        await page.locator('#dashboard-tab').dispatchEvent('click');
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        await page.locator('[data-dashboard-mode="recent"]').click();
        assert(await page.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"]`).count() === 1, 'Using the current deck should add it to Recent without reloading its saved snapshot');
        await page.locator('[data-dashboard-mode="library"]').click();
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${currentDeckId}"]`, { timeout: 10000 });

        const betaCard = page.locator(`.dashboard-screen-card[data-deck-id="${betaDeckId}"]`);
        await betaCard.locator('[data-deck-action="toggle"]').click();
        await betaCard.locator('.dashboard-deck-more > summary').click();
        const renamedDeckName = 'Renamed Migration Deck';
        let renameDialogMessage = '';
        page.once('dialog', async (dialog) => {
            renameDialogMessage = dialog.message();
            await dialog.accept(renamedDeckName);
        });
        await betaCard.locator('[data-deck-action="rename"]').click();
        await page.waitForFunction(({ deckId, name }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.some((preset) => preset?.id === deckId
                && preset?.name === name
                && preset?.projectState?.currentDeckId === deckId
                && preset?.projectState?.projectName === name);
        }, { deckId: betaDeckId, name: renamedDeckName }, { timeout: 10000 });
        assert(renameDialogMessage.includes('Rename deck'), 'Rename should ask which deck name to use');
        await page.waitForFunction((deckId) => document.activeElement?.dataset?.deckAction === 'toggle' && document.activeElement?.dataset?.deckId === deckId, betaDeckId, { timeout: 10000 });

        const renamedCard = page.locator(`.dashboard-screen-card[data-deck-id="${betaDeckId}"]`);
        await renamedCard.locator('.dashboard-deck-more > summary').click();
        const duplicateName = 'Migration Action Copy';
        let duplicateDialogMessage = '';
        page.once('dialog', async (dialog) => {
            duplicateDialogMessage = dialog.message();
            await dialog.accept(duplicateName);
        });
        await renamedCard.locator('[data-deck-action="duplicate"]').click();
        await page.waitForFunction((name) => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').some((preset) => preset?.name === name), duplicateName, { timeout: 10000 });
        const duplicateRecord = await page.evaluate((name) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.name === name);
            return preset ? {
                id: preset.id || '',
                projectDeckId: preset.projectState?.currentDeckId || '',
                usageCount: preset.usageCount,
                isFavorite: preset.isFavorite === true
            } : null;
        }, duplicateName);
        assert(duplicateDialogMessage.includes('duplicate'), 'Duplicate should ask for the copied deck name');
        assert(duplicateRecord?.id && duplicateRecord.id !== betaDeckId && duplicateRecord.projectDeckId === duplicateRecord.id, 'Duplicate should create a new aligned deck identity');
        assert(duplicateRecord?.usageCount === 0 && duplicateRecord.isFavorite === false, 'Duplicate should begin outside Recent and Favourites');
        const duplicateDeckId = duplicateRecord.id;
        await page.waitForFunction((deckId) => document.activeElement?.dataset?.deckAction === 'toggle' && document.activeElement?.dataset?.deckId === deckId, duplicateDeckId, { timeout: 10000 });

        const duplicateCard = page.locator(`.dashboard-screen-card[data-deck-id="${duplicateDeckId}"]`);
        await duplicateCard.locator('.dashboard-deck-more > summary').click();
        let cancelledDeleteMessage = '';
        page.once('dialog', async (dialog) => {
            cancelledDeleteMessage = dialog.message();
            await dialog.dismiss();
        });
        await duplicateCard.locator('[data-deck-action="delete"]').click();
        assert(cancelledDeleteMessage === `Delete deck "${duplicateName}"?`, 'Delete should name the affected deck in its confirmation');
        assert(await duplicateCard.count() === 1, 'Cancelling delete should keep the deck row');
        assert(await page.evaluate((deckId) => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').some((preset) => preset?.id === deckId), duplicateDeckId), 'Cancelling delete should keep the saved deck record');
        assert(await duplicateCard.locator('[data-deck-action="delete"]').evaluate((element) => document.activeElement === element), 'Cancelling delete should return focus to Delete');

        page.once('dialog', async (dialog) => dialog.accept());
        await duplicateCard.locator('[data-deck-action="delete"]').click();
        await page.waitForFunction((deckId) => !JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').some((preset) => preset?.id === deckId), duplicateDeckId, { timeout: 10000 });
        assert(await duplicateCard.count() === 0, 'Confirming delete should immediately remove the deck row');
        await page.waitForFunction((deckId) => document.activeElement?.dataset?.deckAction === 'toggle' && document.activeElement?.dataset?.deckId === deckId, currentDeckId, { timeout: 10000 });
        assert(await page.locator('.dashboard-filter[data-class-name="Migration Class"]').getAttribute('aria-label') === 'Migration Class, 3 decks', 'Deleting a duplicate should immediately restore the class deck count');

        const seededCard = page.locator('.dashboard-screen-card[data-deck-id^="deck-year7-"]').first();
        const seededDeckId = await seededCard.getAttribute('data-deck-id');
        const seededLessonId = await seededCard.evaluate((card) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.find((preset) => preset?.id === card.dataset.deckId)?.seededLessonId || '';
        });
        await seededCard.locator('[data-deck-action="toggle"]').click();
        await seededCard.locator('.dashboard-deck-more > summary').click();
        page.once('dialog', async (dialog) => dialog.accept());
        await seededCard.locator('[data-deck-action="delete"]').click();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        assert(await page.locator(`.dashboard-screen-card[data-deck-id="${seededDeckId}"]`).count() === 0, 'Deleting a built-in lesson deck should remain deleted after reload');
        assert(await page.evaluate((seedId) => JSON.parse(localStorage.getItem('teacherScreenDismissedSeededLessons') || '[]').includes(seedId), seededLessonId), 'Deleting a built-in lesson deck should persist its dismissal');

        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 390, height: 844 });
        await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        const mobileLayout = await mobilePage.evaluate(() => {
            const main = document.querySelector('.dashboard-main');
            const current = document.querySelector('.dashboard-screen-card.is-current');
            const details = current?.querySelector('.dashboard-screen-card__details:not([hidden])');
            const cardRect = current?.getBoundingClientRect();
            const directActions = Array.from(details?.querySelectorAll('[data-deck-action="open"], [data-deck-action="arrange"], [data-deck-action="present"]') || []);
            const actionsFit = directActions.length === 3 && directActions.every((action) => {
                const rect = action.getBoundingClientRect();
                return !!cardRect && rect.width > 0 && rect.height > 0
                    && rect.left >= cardRect.left - 1
                    && rect.right <= cardRect.right + 1;
            });
            return {
                viewportFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
                mainFits: !main || main.scrollWidth <= main.clientWidth + 1,
                cardFits: !!current && current.scrollWidth <= current.clientWidth + 1
                    && cardRect.left >= -1
                    && cardRect.right <= window.innerWidth + 1,
                detailsFit: !!details && details.scrollWidth <= details.clientWidth + 1,
                actionsFit,
                navigationColumns: getComputedStyle(document.querySelector('.dashboard-primary-nav__list')).gridTemplateColumns.split(' ').length,
                visibleDetailsCount: document.querySelectorAll('.dashboard-screen-card__details:not([hidden])').length
            };
        });
        assert(mobileLayout.viewportFits && mobileLayout.mainFits && mobileLayout.cardFits && mobileLayout.detailsFit, '390px Deck Library should not create horizontal overflow');
        assert(mobileLayout.actionsFit, '390px expanded deck should keep direct actions inside its card');
        assert(mobileLayout.navigationColumns === 2, '390px Deck Library navigation should keep its compact two-column layout');
        assert(mobileLayout.visibleDetailsCount === 1, '390px Deck Library should open only the current deck by default');

        const mobileCurrentCard = mobilePage.locator(`.dashboard-screen-card[data-deck-id="${currentDeckId}"]`);
        await mobileCurrentCard.locator('.dashboard-deck-more > summary').click();
        const advancedActionsFit = await mobileCurrentCard.locator('.dashboard-deck-more__actions').evaluate((actions) => {
            const cardRect = actions.closest('.dashboard-screen-card')?.getBoundingClientRect();
            return !!cardRect && actions.scrollWidth <= actions.clientWidth + 1
                && Array.from(actions.querySelectorAll('button')).every((button) => {
                    const rect = button.getBoundingClientRect();
                    return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1;
                });
        });
        assert(advancedActionsFit, '390px More actions should remain usable without horizontal overflow');
        await mobileCurrentCard.locator('.dashboard-deck-more > summary').click();

        const mobileDashboardMoreSummary = mobilePage.locator('#dashboard-utility-menu > summary');
        await mobileDashboardMoreSummary.click();
        await mobilePage.locator('#dashboard-sections-btn').click();
        await mobilePage.waitForSelector('#sections-menu:not([hidden])', { timeout: 10000 });
        const mobileSectionsLayout = await mobilePage.locator('#sections-menu').evaluate((menu) => {
            const menuRect = menu.getBoundingClientRect();
            const tablist = menu.querySelector('.nav-tabs');
            const destination = menu.querySelector('#manage-screens-btn');
            const rows = [...menu.querySelectorAll('.nav-tab'), destination].filter(Boolean);
            return {
                menuFits: menuRect.left >= -1 && menuRect.right <= window.innerWidth + 1 && menuRect.top >= -1 && menuRect.bottom <= window.innerHeight + 1,
                hasNoOverflow: menu.scrollWidth <= menu.clientWidth + 1,
                tabCount: tablist?.querySelectorAll(':scope > .nav-tab').length || 0,
                deckLibraryIsSeparate: destination?.parentElement !== tablist,
                embeddedManagerCount: menu.querySelectorAll('.screen-manager-body').length,
                rowsAreTouchFriendly: rows.every((row) => row.getBoundingClientRect().height >= 40)
            };
        });
        assert(mobileSectionsLayout.menuFits && mobileSectionsLayout.hasNoOverflow, '390px Sections should fit without horizontal overflow');
        assert(mobileSectionsLayout.tabCount === 5 && mobileSectionsLayout.deckLibraryIsSeparate, '390px Sections should keep five tabs plus a separate Deck Library destination');
        assert(mobileSectionsLayout.embeddedManagerCount === 0, '390px Sections should stay navigation-only');
        assert(mobileSectionsLayout.rowsAreTouchFriendly, '390px Sections destinations should remain touch-friendly');
        await mobilePage.locator('#manage-screens-btn').click();
        await mobilePage.waitForSelector('#sections-menu', { state: 'hidden', timeout: 10000 });
        assert(await mobilePage.locator('#screen-deck-manager-dialog[open]').count() === 0, 'Choosing Deck Library should not open Deck details on mobile');
        await mobilePage.locator('#dashboard-deck-tools-btn').click();
        await mobilePage.waitForSelector('#screen-deck-manager-dialog[open]', { timeout: 10000 });
        assert(await mobilePage.locator('#screen-deck-manager-title').textContent().then((text) => text.trim() === 'Deck details & backup'), '390px Dashboard Deck details should open in the dedicated dialog');
        assert(await mobilePage.locator('#screen-deck-manager-dialog #reset-layout').count() === 0, '390px Deck details should keep Clear current page out of the dialog');
        const mobileScreenManagerLayout = await mobilePage.locator('#screen-deck-manager-dialog').evaluate((dialog) => {
            const content = dialog.querySelector('.sections-menu__content');
            const managerBody = dialog.querySelector('.screen-manager-body');
            const closeButton = dialog.querySelector('.modal-close');
            const dialogRect = dialog.getBoundingClientRect();
            const closeRect = closeButton?.getBoundingClientRect();
            return {
                viewportFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
                dialogFits: dialogRect.left >= -1 && dialogRect.right <= window.innerWidth + 1 && dialogRect.top >= -1 && dialogRect.bottom <= window.innerHeight + 1,
                dialogHasNoOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
                contentFits: !!content && content.scrollWidth <= content.clientWidth + 1,
                managerFits: !!managerBody && managerBody.scrollWidth <= managerBody.clientWidth + 1,
                contentScrollable: !!content && content.scrollHeight > content.clientHeight + 4,
                closeButtonInViewport: !!closeRect && closeRect.left >= -1 && closeRect.right <= window.innerWidth + 1 && closeRect.top >= -1 && closeRect.bottom <= window.innerHeight + 1
            };
        });
        assert(mobileScreenManagerLayout.viewportFits && mobileScreenManagerLayout.dialogFits && mobileScreenManagerLayout.dialogHasNoOverflow && mobileScreenManagerLayout.contentFits && mobileScreenManagerLayout.managerFits, '390px Deck details should fit without horizontal overflow');
        assert(mobileScreenManagerLayout.contentScrollable, '390px Deck details should scroll inside its dialog');
        assert(mobileScreenManagerLayout.closeButtonInViewport, '390px Deck details should keep Close inside the viewport');

        const mobileMenuContent = mobilePage.locator('#screen-deck-manager-dialog .sections-menu__content');
        await mobileMenuContent.evaluate((content) => {
            content.scrollTop = content.scrollHeight;
        });
        await mobilePage.waitForFunction(() => {
            const content = document.querySelector('#screen-deck-manager-dialog .sections-menu__content');
            return !!content && content.scrollTop > 0;
        }, null, { timeout: 10000 });
        const closeAfterInternalScroll = await mobilePage.locator('#screen-deck-manager-dialog .modal-close').evaluate((closeButton) => {
            const rect = closeButton.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
        });
        assert(closeAfterInternalScroll, 'Scrolling mobile Deck details should keep Close within reach');

        const mobileAdvancedSummary = mobilePage.locator('#screen-deck-manager-dialog .screen-manager-advanced > summary');
        await mobileAdvancedSummary.scrollIntoViewIfNeeded();
        await mobileAdvancedSummary.click();
        await mobilePage.waitForSelector('#screen-deck-manager-dialog .screen-manager-advanced[open] #export-layout', { timeout: 10000 });
        const mobileTouchControls = await mobilePage.locator('#screen-deck-manager-dialog .screen-manager-body').evaluate((managerBody) => {
            return Array.from(managerBody.querySelectorAll('button, select, input, .screen-manager-advanced > summary'))
                .filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden')
                .map((control) => ({
                    label: control.getAttribute('aria-label') || control.textContent?.replace(/\s+/g, ' ').trim() || control.id || control.tagName,
                    height: control.getBoundingClientRect().height
                }))
                .filter((control) => control.height < 39.5);
        });
        assert(mobileTouchControls.length === 0, `390px Deck details actions and fields should be at least 40px high (${mobileTouchControls.map((control) => `${control.label}: ${control.height.toFixed(1)}px`).join(', ')})`);

        const mobileLibraryNote = mobilePage.locator('#screen-deck-manager-dialog .screen-manager-library-note');
        await mobileLibraryNote.scrollIntoViewIfNeeded();
        const mobileLastNoteReachable = await mobileLibraryNote.evaluate((note) => {
            const content = note.closest('.sections-menu__content');
            const noteRect = note.getBoundingClientRect();
            const contentRect = content?.getBoundingClientRect();
            return !!contentRect
                && noteRect.height > 0
                && noteRect.top >= contentRect.top - 1
                && noteRect.bottom <= contentRect.bottom + 1
                && note.textContent.includes('Deck Library');
        });
        assert(await mobilePage.locator('#screen-deck-manager-dialog .screen-manager-advanced').getAttribute('open') !== null, '390px Deck details should make the advanced deck disclosure reachable');
        assert(mobileLastNoteReachable, '390px Deck details should make its final Deck Library note reachable');
        await mobilePage.locator('#screen-deck-manager-dialog .modal-close').click();
        await mobilePage.waitForSelector('#screen-deck-manager-dialog[open]', { state: 'detached', timeout: 10000 });
        await mobilePage.close();

        const remainingSeededCard = page.locator('.dashboard-screen-card[data-deck-id^="deck-year7-"]').first();
        const remainingSeededDeck = await remainingSeededCard.evaluate((card) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.id === card.dataset.deckId);
            return {
                id: preset?.id || '',
                name: preset?.name || '',
                seededLessonId: preset?.seededLessonId || ''
            };
        });
        await remainingSeededCard.locator('[data-deck-action="toggle"]').click();
        await remainingSeededCard.locator('[data-deck-action="open"]').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await openTeacherPanel(page);
        const teacherPanelRename = 'Teacher Panel Seed Rename';
        page.once('dialog', async (dialog) => dialog.accept(teacherPanelRename));
        await page.locator('#rename-project-screen-btn').click();
        await page.waitForFunction(({ deckId, name }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.id === deckId);
            return preset?.name === name && !preset?.seededLessonId;
        }, { deckId: remainingSeededDeck.id, name: teacherPanelRename }, { timeout: 10000 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        assert(await page.evaluate(({ oldName, newName, seedId }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const dismissed = JSON.parse(localStorage.getItem('teacherScreenDismissedSeededLessons') || '[]');
            return !presets.some((preset) => preset?.name === oldName)
                && presets.some((preset) => preset?.name === newName)
                && dismissed.includes(seedId);
        }, { oldName: remainingSeededDeck.name, newName: teacherPanelRename, seedId: remainingSeededDeck.seededLessonId }), 'Renaming a built-in deck from Teacher Controls should not resurrect the original after reload');

        assert(pageErrors.length === 0, `Deck Library checks should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Deck Library checks should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runDeckLibraryStartupSafetyChecks(browser, baseUrl) {
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);
    await context.addInitScript(() => {
        if (localStorage.getItem('__teacherScreenDeckStartupSafetyFixture') === 'ready') {
            return;
        }

        const timestamp = Date.now() + 60000;
        const projectState = {
            schemaVersion: 1,
            currentDeckId: 'deck-existing-weekly-project',
            projectName: 'Weekly Project',
            activePageId: 'saved-weekly-page',
            pages: [{
                id: 'saved-weekly-page',
                name: 'Saved Weekly Page',
                snapshot: {
                    theme: 'theme-ocean',
                    background: { type: 'solid', value: '#14324a' },
                    layout: { widgets: [] },
                    timerStates: {},
                    lessonPlan: null
                }
            }],
            theme: 'theme-ocean',
            background: { type: 'solid', value: '#14324a' },
            layout: { widgets: [] },
            timerStates: {},
            lessonPlan: null
        };
        localStorage.setItem('classroomLayoutPresets', JSON.stringify([{
            id: projectState.currentDeckId,
            name: projectState.projectName,
            className: 'Safety Class',
            period: 'Period 1',
            folderId: '',
            isFavorite: false,
            projectState,
            theme: projectState.theme,
            background: projectState.background,
            layout: projectState.layout,
            lessonPlan: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastUsedAt: timestamp,
            usageCount: 1
        }]));
        localStorage.removeItem('classroomScreenState');
        localStorage.setItem('__teacherScreenDeckStartupSafetyFixture', 'ready');
    });

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        const restored = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return {
                currentDeckId: state.currentDeckId || '',
                projectName: state.projectName || '',
                pageId: state.pages?.[0]?.id || '',
                weeklyDeckCount: presets.filter((preset) => preset?.name === 'Weekly Project').length
            };
        });
        assert(restored.currentDeckId === 'deck-existing-weekly-project'
            && restored.projectName === 'Weekly Project'
            && restored.pageId === 'saved-weekly-page', 'Missing active state should load an existing saved deck instead of attaching blank pages to its ID');
        assert(restored.weeklyDeckCount === 1, 'Startup recovery should not create a duplicate deck with the same name');

        let suggestedName = '';
        page.once('dialog', async (dialog) => {
            suggestedName = dialog.defaultValue();
            await dialog.accept(suggestedName);
        });
        await page.locator('#dashboard-create-btn').click();
        await page.waitForFunction((name) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.some((preset) => preset?.name === name);
        }, suggestedName, { timeout: 10000 });
        assert(suggestedName && suggestedName !== 'Weekly Project', 'New Deck should suggest a usable unique name when Weekly Project already exists');
        assert(await page.evaluate((name) => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').some((preset) => preset?.name === name), suggestedName), 'Accepting the New Deck suggestion should immediately create its saved deck record');
        assert(await page.evaluate(() => JSON.parse(localStorage.getItem('classroomScreenState') || '{}').currentDeckId === 'deck-existing-weekly-project'), 'Dashboard New Deck should leave the existing classroom deck active');
        assert(await page.locator('#dashboard-view').isVisible(), 'Dashboard New Deck should remain on the dashboard');
    } finally {
        await context.close();
    }
}

async function runReminderSystemChecks(browser, baseUrl) {
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

    const fixtureClassName = 'Reminder Smoke Class';
    const deckAName = 'Reminder Smoke Deck A';
    const renamedDeckAName = 'Reminder Smoke Deck A Renamed';
    const deckBName = 'Reminder Smoke Deck B';
    const duplicateDeckName = 'Reminder Smoke Deck A Copy';
    const classPublicText = 'Bring persuasive drafts to class';
    const deckPublicText = 'Collect this lesson exit tickets';
    const deckPrivateText = 'Privately follow up with a family';
    const classroomPublicText = 'Classroom-added public reminder';

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.evaluate(({ fixtureClassName, deckAName, deckBName }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            if (!Array.isArray(presets) || presets.length === 0) {
                throw new Error('Expected a seeded deck for reminder smoke fixtures');
            }

            const sourceDeck = presets[0];
            const now = Date.now();
            const createLegacyDeck = (name, offset) => {
                const fixture = JSON.parse(JSON.stringify(sourceDeck));
                delete fixture.id;
                delete fixture.classId;
                fixture.name = name;
                fixture.seededLessonId = '';
                fixture.className = fixtureClassName;
                fixture.createdAt = now + offset;
                fixture.updatedAt = now + offset;
                fixture.lastUsedAt = now + offset;
                fixture.usageCount = 0;
                fixture.projectState = {
                    ...(fixture.projectState || {}),
                    projectName: name
                };
                return fixture;
            };

            localStorage.setItem('classroomLayoutPresets', JSON.stringify([
                createLegacyDeck(deckAName, 2),
                createLegacyDeck(deckBName, 1)
            ]));
            const activeState = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            activeState.projectName = deckAName;
            delete activeState.activeDeckId;
            delete activeState.activeClassId;
            delete activeState.activeClassName;
            localStorage.setItem('classroomScreenState', JSON.stringify(activeState));
            localStorage.removeItem('teacherScreenClassReminders');
        }, { fixtureClassName, deckAName, deckBName });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForSelector('.dashboard-screen-card[data-deck-id]', { timeout: 10000 });

        const migratedDecks = await page.evaluate(({ deckAName, deckBName }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const selectDeck = (name) => {
                const preset = presets.find((candidate) => candidate?.name === name);
                return preset ? { id: preset.id, classId: preset.classId, className: preset.className } : null;
            };
            return {
                deckA: selectDeck(deckAName),
                deckB: selectDeck(deckBName)
            };
        }, { deckAName, deckBName });
        assert(!!migratedDecks.deckA?.id && !!migratedDecks.deckB?.id, 'Legacy decks should receive persistent reminder IDs on startup');
        assert(migratedDecks.deckA.id !== migratedDecks.deckB.id, 'Migrated decks should receive distinct reminder IDs');
        assert(
            !!migratedDecks.deckA.classId && migratedDecks.deckA.classId === migratedDecks.deckB.classId,
            'Decks in the same class should share one stable class ID'
        );
        await page.waitForFunction((expectedDeckId) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state.activeDeckId === expectedDeckId && Boolean(state.activeClassId);
        }, migratedDecks.deckA.id, { timeout: 10000 });
        assert(true, 'A legacy active deck should reconnect to its migrated reminder identity on startup');

        const deckAId = migratedDecks.deckA.id;
        const deckBId = migratedDecks.deckB.id;
        const classId = migratedDecks.deckA.classId;
        const deckACard = page.locator(`.dashboard-screen-card[data-deck-id="${deckAId}"]`);
        const deckBCard = page.locator(`.dashboard-screen-card[data-deck-id="${deckBId}"]`);
        assert(await deckACard.count() === 1 && await deckBCard.count() === 1, 'Migrated reminder decks should render as distinct dashboard cards');

        await deckACard.locator('[data-reminder-action="expand"]').click();
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${deckAId}"] .dashboard-reminder-panel`, { timeout: 10000 });
        assert(await deckACard.locator('[data-reminder-action="expand"]').getAttribute('aria-expanded') === 'true', 'Deck reminder button should expand its inline panel');

        const addDashboardReminder = async (scope, text, showOnClassroom) => {
            const form = deckACard.locator(`.dashboard-reminder-form[data-reminder-scope="${scope}"]`);
            await form.locator('input[name="text"]').fill(text);
            if (showOnClassroom) {
                await form.locator('input[name="showOnClassroom"]').check();
            }
            await form.locator('button[type="submit"]').click();
            await page.waitForFunction((expectedText) => {
                const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
                return store.reminders?.some((reminder) => reminder?.text === expectedText);
            }, text, { timeout: 10000 });
        };

        await addDashboardReminder('class', classPublicText, true);
        await addDashboardReminder('deck', deckPublicText, true);
        await addDashboardReminder('deck', deckPrivateText, false);

        const reminderRecords = await page.evaluate(({ classPublicText, deckPublicText, deckPrivateText }) => {
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            const byText = (text) => store.reminders?.find((reminder) => reminder?.text === text) || null;
            return {
                classPublic: byText(classPublicText),
                deckPublic: byText(deckPublicText),
                deckPrivate: byText(deckPrivateText)
            };
        }, { classPublicText, deckPublicText, deckPrivateText });
        assert(
            reminderRecords.classPublic?.scope === 'class'
                && reminderRecords.classPublic?.classId === classId
                && reminderRecords.classPublic?.showOnClassroom === true,
            'Class reminder should persist against the shared class and be marked student-visible'
        );
        assert(
            reminderRecords.deckPublic?.scope === 'deck'
                && reminderRecords.deckPublic?.deckId === deckAId
                && reminderRecords.deckPublic?.showOnClassroom === true,
            'Public deck reminder should persist only against its deck'
        );
        assert(
            reminderRecords.deckPrivate?.scope === 'deck'
                && reminderRecords.deckPrivate?.deckId === deckAId
                && reminderRecords.deckPrivate?.showOnClassroom === false,
            'Private deck reminder should persist without student visibility'
        );
        const plannerSnapshotPrivacy = await page.evaluate(async () => {
            const reminderKey = 'teacherScreenClassReminders';
            const originalReminderStore = localStorage.getItem(reminderKey);
            const { captureLocalStorageState, restoreLocalStorageState } = await import('/js/services/state-manager.js');
            const snapshot = captureLocalStorageState();
            restoreLocalStorageState({
                [reminderKey]: JSON.stringify({ version: 1, reminders: [] }),
                reminderSmokeSafeKey: 'restored'
            });
            const result = {
                snapshotExcludesReminders: !Object.prototype.hasOwnProperty.call(snapshot, reminderKey),
                restorePreservesReminders: localStorage.getItem(reminderKey) === originalReminderStore,
                restoreKeepsOrdinaryState: localStorage.getItem('reminderSmokeSafeKey') === 'restored'
            };
            localStorage.removeItem('reminderSmokeSafeKey');
            return result;
        });
        assert(
            plannerSnapshotPrivacy.snapshotExcludesReminders && plannerSnapshotPrivacy.restorePreservesReminders,
            'Planner templates should not copy or roll back the canonical reminder store'
        );
        assert(plannerSnapshotPrivacy.restoreKeepsOrdinaryState, 'Planner template restore should continue to restore ordinary app settings');
        const concurrentTabPersistence = await page.evaluate(async () => {
            const { ClassReminderService } = await import('/js/services/class-reminder-service.js');
            const values = new Map();
            const storage = {
                getItem(key) {
                    return values.has(key) ? values.get(key) : null;
                },
                setItem(key, value) {
                    values.set(key, value);
                }
            };
            let firstId = 0;
            let secondId = 0;
            const firstTab = new ClassReminderService({ storage, eventTarget: null, idFactory: () => `first-${++firstId}` });
            const secondTab = new ClassReminderService({ storage, eventTarget: null, idFactory: () => `second-${++secondId}` });
            firstTab.add({ scope: 'deck', deckId: 'deck-a', text: 'First tab reminder' });
            secondTab.add({ scope: 'deck', deckId: 'deck-b', text: 'Second tab reminder' });
            const reloaded = new ClassReminderService({ storage, eventTarget: null });
            const texts = reloaded.list().map((reminder) => reminder.text).sort();
            firstTab.dispose();
            secondTab.dispose();
            reloaded.dispose();
            return texts;
        });
        assert(
            concurrentTabPersistence.join('|') === 'First tab reminder|Second tab reminder',
            'A stale teacher tab should preserve reminders saved by another tab'
        );

        const importStateBeforeInvalidReminderData = await page.evaluate(() => ({
            presets: localStorage.getItem('classroomLayoutPresets'),
            reminders: localStorage.getItem('teacherScreenClassReminders'),
            payload: JSON.stringify({
                schemaVersion: 1,
                state: JSON.parse(localStorage.getItem('classroomScreenState') || '{}'),
                presets: [],
                folders: [],
                reminders: { version: 999, reminders: [] }
            })
        }));
        await page.evaluate(() => {
            const dialog = document.querySelector('#import-dialog');
            if (!dialog.open) dialog.showModal();
            window.__reminderSmokeConsoleError = console.error;
            console.error = (...args) => {
                if (String(args[0] || '').startsWith('Import failed:')) return;
                window.__reminderSmokeConsoleError(...args);
            };
        });
        await page.locator('#import-json-input').fill(importStateBeforeInvalidReminderData.payload);
        await page.locator('#confirm-import').click();
        await page.waitForFunction(() => document.querySelector('#import-summary')?.textContent?.startsWith('Error:'), undefined, { timeout: 10000 });
        const importStateAfterInvalidReminderData = await page.evaluate(() => {
            const result = {
                presets: localStorage.getItem('classroomLayoutPresets'),
                reminders: localStorage.getItem('teacherScreenClassReminders')
            };
            document.querySelector('#import-dialog')?.close();
            if (window.__reminderSmokeConsoleError) {
                console.error = window.__reminderSmokeConsoleError;
                delete window.__reminderSmokeConsoleError;
            }
            return result;
        });
        assert(
            importStateAfterInvalidReminderData.presets === importStateBeforeInvalidReminderData.presets
                && importStateAfterInvalidReminderData.reminders === importStateBeforeInvalidReminderData.reminders,
            'Invalid reminder imports should not partially replace saved decks or reminders'
        );

        await deckBCard.locator('[data-reminder-action="expand"]').click();
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${deckBId}"] .dashboard-reminder-panel`, { timeout: 10000 });
        const deckBPanel = deckBCard.locator('.dashboard-reminder-panel');
        assert(await deckBPanel.locator('[data-reminder-id]').count() === 1, 'Another deck in the class should receive only the shared class reminder');
        assert((await deckBPanel.textContent()).includes(classPublicText), 'Shared class reminder should appear in every deck for that class');
        assert(!(await deckBPanel.textContent()).includes(deckPublicText) && !(await deckBPanel.textContent()).includes(deckPrivateText), 'Deck reminders should not leak into another deck in the same class');

        await deckACard.locator('[data-reminder-action="expand"]').click();
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${deckAId}"] .dashboard-reminder-panel`, { timeout: 10000 });
        assert(await deckACard.locator('[data-reminder-id]').count() === 3, 'The source deck should combine its class reminder with both deck reminders');
        await deckACard
            .locator(`[data-reminder-id="${reminderRecords.deckPrivate.id}"] [data-reminder-action="toggle"]`)
            .click();
        await page.waitForFunction((reminderId) => {
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            return store.reminders?.find((reminder) => reminder?.id === reminderId)?.completed === true;
        }, reminderRecords.deckPrivate.id, { timeout: 10000 });
        assert(true, 'Completing a reminder should persist through the shared reminder store');

        if (await deckACard.locator('[data-deck-action="toggle"]').getAttribute('aria-expanded') !== 'true') {
            await deckACard.locator('[data-deck-action="toggle"]').click();
        }
        await deckACard.locator('.dashboard-deck-more > summary').click();
        page.once('dialog', (dialog) => dialog.accept(renamedDeckAName));
        await deckACard.locator('[data-deck-action="rename"]').click();
        await page.waitForFunction(({ deckId, expectedName }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.some((preset) => preset?.id === deckId && preset?.name === expectedName);
        }, { deckId: deckAId, expectedName: renamedDeckAName }, { timeout: 10000 });
        const renamedDeckACard = page.locator(`.dashboard-screen-card[data-deck-id="${deckAId}"]`);
        assert(await renamedDeckACard.locator('.dashboard-deck-title').textContent().then((text) => text.trim() === renamedDeckAName), 'Renaming a deck should preserve its stable ID and update its dashboard title');
        assert(await renamedDeckACard.locator('[data-reminder-id]').count() === 3, 'Renaming a deck should keep its class and deck reminders attached');

        await renamedDeckACard.locator('.dashboard-deck-more > summary').click();
        page.once('dialog', (dialog) => dialog.accept(duplicateDeckName));
        await renamedDeckACard.locator('[data-deck-action="duplicate"]').click();
        await page.waitForFunction((expectedName) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.some((preset) => preset?.name === expectedName);
        }, duplicateDeckName, { timeout: 10000 });
        const duplicatedDeck = await page.evaluate((expectedName) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.name === expectedName);
            return preset ? { id: preset.id, classId: preset.classId } : null;
        }, duplicateDeckName);
        assert(!!duplicatedDeck?.id && duplicatedDeck.id !== deckAId, 'Duplicating a deck should create a new stable deck ID');
        assert(duplicatedDeck.classId === classId, 'Duplicating a deck should retain its shared class identity');
        const duplicateCard = page.locator(`.dashboard-screen-card[data-deck-id="${duplicatedDeck.id}"]`);
        await duplicateCard.locator('[data-reminder-action="expand"]').click();
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${duplicatedDeck.id}"] .dashboard-reminder-panel`, { timeout: 10000 });
        assert(await duplicateCard.locator('[data-reminder-id]').count() === 1, 'A duplicated deck should start without copied deck-only reminders');
        assert((await duplicateCard.textContent()).includes(classPublicText), 'A duplicated deck should still show its class reminder');
        assert(!(await duplicateCard.textContent()).includes(deckPublicText) && !(await duplicateCard.textContent()).includes(deckPrivateText), 'A duplicated deck should not inherit stale deck-only reminders');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        const persistedReminderState = await page.evaluate(({ deckAId, deckBId, duplicateDeckId, texts }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            return {
                deckIdsPersisted: [deckAId, deckBId, duplicateDeckId].every((id) => presets.some((preset) => preset?.id === id)),
                classIds: presets
                    .filter((preset) => [deckAId, deckBId, duplicateDeckId].includes(preset?.id))
                    .map((preset) => preset.classId),
                reminders: texts.map((text) => store.reminders?.find((reminder) => reminder?.text === text) || null)
            };
        }, {
            deckAId,
            deckBId,
            duplicateDeckId: duplicatedDeck.id,
            texts: [classPublicText, deckPublicText, deckPrivateText]
        });
        assert(persistedReminderState.deckIdsPersisted, 'Deck reminder identities should survive a full app reload');
        assert(persistedReminderState.classIds.every((candidate) => candidate === classId), 'Shared class identity should survive a full app reload');
        assert(persistedReminderState.reminders.every(Boolean), 'Class and deck reminders should survive a full app reload');
        assert(persistedReminderState.reminders[2]?.completed === true, 'Reminder completion should survive a full app reload');

        const reloadedDeckACard = page.locator(`.dashboard-screen-card[data-deck-id="${deckAId}"]`);
        await reloadedDeckACard.locator('.control-button--primary').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.locator('#add-widget-btn').click();
        await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
        const reloadedReminderAction = page.locator('#widget-modal .widget-picker-footer__actions #classroom-reminder-launcher');
        await reloadedReminderAction.waitFor({ state: 'visible', timeout: 10000 });
        assert(await reloadedReminderAction.getAttribute('aria-expanded') === 'false', 'Classroom reminders should start as a compact Add Widget action');
        await openClassroomRemindersFromWidgetMenu(page);
        const classroomReminderList = page.locator('#classroom-reminder-list');
        assert(await classroomReminderList.locator('[data-reminder-id]').count() === 3, 'Classroom dock should combine the loaded deck and class reminders');
        const classroomReminderText = await classroomReminderList.textContent();
        assert(
            classroomReminderText.includes(classPublicText)
                && classroomReminderText.includes(deckPublicText)
                && classroomReminderText.includes(deckPrivateText),
            'Teacher classroom dock should retain public and private reminders for the loaded deck'
        );

        await page.evaluate(() => {
            window.__reminderBroadcasts = [];
            window.__reminderTestChannel = new BroadcastChannel('teacher-screen-sync');
            window.__reminderTestChannel.onmessage = (event) => window.__reminderBroadcasts.push(event.data);
        });
        const projectorPairing = await page.evaluate(() => {
            const href = window.__TeacherScreenApp?.getPairedProjectorUrl?.() || '';
            const token = window.__TeacherProjectorSyncToken || '';
            return {
                token,
                linkToken: href ? new URL(href).searchParams.get('syncToken') : ''
            };
        });
        assert(
            Boolean(projectorPairing.token) && projectorPairing.linkToken === projectorPairing.token,
            'Dashboard Projector link should be paired to its teacher tab'
        );

        const unpairedProjectorPage = await context.newPage();
        await unpairedProjectorPage.goto(`${baseUrl}/projector.html`, { waitUntil: 'domcontentloaded' });
        await unpairedProjectorPage.waitForFunction(() => Boolean(window.__TeacherScreenProjectorApp), undefined, { timeout: 15000 });
        await unpairedProjectorPage.waitForTimeout(500);
        assert(await unpairedProjectorPage.locator('#classroom-reminder-dock').isHidden(), 'An unpaired projector should reject another teacher tab\'s reminders');
        await unpairedProjectorPage.close();

        const projectorPage = await context.newPage();
        await projectorPage.goto(await getPairedProjectorUrl(page, baseUrl), { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForFunction(() => Boolean(window.__TeacherScreenProjectorApp), undefined, { timeout: 15000 });
        await projectorPage.waitForSelector('#classroom-reminder-dock:not([hidden])', { timeout: 15000 });
        await projectorPage.waitForFunction(({ classPublicText, deckPublicText }) => {
            const text = document.querySelector('#classroom-reminder-list')?.textContent || '';
            return text.includes(classPublicText) && text.includes(deckPublicText);
        }, { classPublicText, deckPublicText }, { timeout: 10000 });
        const projectorReminderText = await projectorPage.locator('#classroom-reminder-list').textContent();
        assert(projectorReminderText.includes(classPublicText) && projectorReminderText.includes(deckPublicText), 'Projector should receive class-visible class and deck reminders');
        assert(!projectorReminderText.includes(deckPrivateText), 'Projector should never render a teacher-private reminder');
        assert(await projectorPage.locator('#classroom-reminder-list input, #classroom-reminder-list button, #classroom-reminder-form').count() === 0, 'Projector reminder dock should be read-only');

        await page.waitForFunction(({ classPublicText, deckPublicText }) => {
            return window.__reminderBroadcasts.some((message) => {
                const serialized = JSON.stringify(message || {});
                return serialized.includes(classPublicText) && serialized.includes(deckPublicText);
            });
        }, { classPublicText, deckPublicText }, { timeout: 10000 });
        const initialProjectorPayloadPrivacy = await page.evaluate(({ classPublicText, deckPublicText, deckPrivateText }) => {
            const serialized = JSON.stringify(window.__reminderBroadcasts || []);
            return {
                includesPublic: serialized.includes(classPublicText) && serialized.includes(deckPublicText),
                includesPrivate: serialized.includes(deckPrivateText)
            };
        }, { classPublicText, deckPublicText, deckPrivateText });
        assert(initialProjectorPayloadPrivacy.includesPublic, 'Projector sync payload should include student-visible reminders');
        assert(!initialProjectorPayloadPrivacy.includesPrivate, 'Projector sync payload should omit teacher-private reminder text entirely');

        const classroomForm = page.locator('#classroom-reminder-form');
        await classroomForm.locator('input[name="text"]').fill(classroomPublicText);
        await classroomForm.locator('input[name="scope"][value="deck"]').check();
        await classroomForm.locator('input[name="showOnClassroom"]').check();
        await classroomForm.locator('button[type="submit"]').click();
        await page.waitForFunction((expectedText) => {
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            return store.reminders?.some((reminder) => reminder?.text === expectedText);
        }, classroomPublicText, { timeout: 10000 });
        await projectorPage.waitForFunction((expectedText) => {
            return (document.querySelector('#classroom-reminder-list')?.textContent || '').includes(expectedText);
        }, classroomPublicText, { timeout: 10000 });
        assert(true, 'A classroom-added public reminder should sync live to the projector');

        await page.locator('#dashboard-tab').dispatchEvent('click');
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        const dashboardDeckAfterClassroomAdd = page.locator(`.dashboard-screen-card[data-deck-id="${deckAId}"]`);
        await dashboardDeckAfterClassroomAdd.locator('[data-reminder-action="expand"]').click();
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${deckAId}"] .dashboard-reminder-panel`, { timeout: 10000 });
        assert((await dashboardDeckAfterClassroomAdd.textContent()).includes(classroomPublicText), 'Dashboard deck panel should immediately reflect reminders added in Classroom');
        const allProjectorPayloadsStayPrivate = await page.evaluate((privateText) => {
            return !JSON.stringify(window.__reminderBroadcasts || []).includes(privateText);
        }, deckPrivateText);
        assert(allProjectorPayloadsStayPrivate, 'Live reminder syncing should continue to exclude teacher-private text');

        const emptyContextSnapshot = await page.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const previousContext = app.activeReminderContext;
            app.activeReminderContext = { deckId: '', classId: '', className: '', deckName: 'Unsaved deck' };
            const snapshot = app.getPublicReminderSnapshot();
            app.syncClassroomRemindersToProjector();
            app.activeReminderContext = previousContext;
            return snapshot;
        });
        assert(Array.isArray(emptyContextSnapshot.reminders) && emptyContextSnapshot.reminders.length === 0, 'A deck without a reminder identity should create an empty public reminder snapshot');
        await projectorPage.waitForFunction(() => document.querySelector('#classroom-reminder-dock')?.hidden === true, undefined, { timeout: 10000 });
        assert(true, 'A deck without a reminder identity should send an empty projector reminder list');

        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 390, height: 844 });
        await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        const mobileDeckCard = mobilePage.locator(`.dashboard-screen-card[data-deck-id="${deckAId}"]`);
        await mobileDeckCard.locator('[data-reminder-action="expand"]').click();
        await mobilePage.waitForSelector(`.dashboard-screen-card[data-deck-id="${deckAId}"] .dashboard-reminder-panel`, { timeout: 10000 });
        const mobileDashboardReminderLayout = await mobileDeckCard.locator('.dashboard-reminder-panel').evaluate((panel) => {
            const card = panel.closest('.dashboard-screen-card');
            const main = panel.closest('.dashboard-main');
            const panelRect = panel.getBoundingClientRect();
            const cardRect = card?.getBoundingClientRect();
            const visibleControls = Array.from(panel.querySelectorAll('button, input')).filter((control) => {
                const style = getComputedStyle(control);
                return style.display !== 'none' && style.visibility !== 'hidden';
            });
            return {
                viewportFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
                mainFits: !main || main.scrollWidth <= main.clientWidth + 1,
                panelFits: panel.scrollWidth <= panel.clientWidth + 1
                    && panelRect.left >= -1
                    && panelRect.right <= window.innerWidth + 1,
                controlsFit: !!cardRect && visibleControls.every((control) => {
                    const rect = control.getBoundingClientRect();
                    return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1;
                })
            };
        });
        assert(
            mobileDashboardReminderLayout.viewportFits
                && mobileDashboardReminderLayout.mainFits
                && mobileDashboardReminderLayout.panelFits,
            '390px expanded reminder panel should not create horizontal overflow'
        );
        assert(mobileDashboardReminderLayout.controlsFit, '390px reminder forms and actions should remain inside their deck card');

        await mobileDeckCard.locator('.dashboard-screen-card__actions .control-button--primary').click();
        await mobilePage.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await openClassroomRemindersFromWidgetMenu(mobilePage);
        const mobileClassroomReminderLayout = await mobilePage.locator('#classroom-reminder-dock').evaluate((dock) => {
            const dockRect = dock.getBoundingClientRect();
            const panel = dock.querySelector('#classroom-reminder-panel');
            const toolbar = document.querySelector('#lesson-quick-actions');
            const toolbarRect = toolbar?.getBoundingClientRect();
            return {
                viewportFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
                dockFits: dock.scrollWidth <= dock.clientWidth + 1
                    && dockRect.left >= -1
                    && dockRect.right <= window.innerWidth + 1,
                panelFits: !panel || panel.scrollWidth <= panel.clientWidth + 1,
                clearsToolbar: !toolbarRect || dockRect.bottom <= toolbarRect.top - 4
            };
        });
        assert(
            mobileClassroomReminderLayout.viewportFits
                && mobileClassroomReminderLayout.dockFits
                && mobileClassroomReminderLayout.panelFits,
            '390px Classroom reminder dock should remain fully usable without horizontal overflow'
        );
        assert(mobileClassroomReminderLayout.clearsToolbar, '390px Classroom reminder dock should stay above lesson quick actions');

        assert(pageErrors.length === 0, `Reminder checks should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Reminder checks should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runMemoryCueSyncUiChecks(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await makeExternalAssetsDeterministic(context);
    await context.addInitScript(() => {
        const USER = Object.freeze({
            uid: 'memory-cue-smoke-teacher',
            email: 'teacher.sync@example.test'
        });
        const OPERATIONS_KEY = '__memoryCueSmokeOperations';
        const ATTEMPTS_KEY = '__memoryCueSmokeAttempts';
        const OFFLINE_KEY = '__memoryCueSmokeOffline';
        let authListener = null;

        const clone = (value) => JSON.parse(JSON.stringify(value));
        const readList = (key) => {
            try {
                const parsed = JSON.parse(localStorage.getItem(key) || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch (_error) {
                return [];
            }
        };
        const append = (key, entry) => {
            const entries = readList(key);
            entries.push(clone(entry));
            localStorage.setItem(key, JSON.stringify(entries));
        };
        const failIfOffline = (operation) => {
            const offline = localStorage.getItem(OFFLINE_KEY) === '1';
            append(ATTEMPTS_KEY, { ...operation, succeeded: !offline });
            if (!offline) return;
            const error = new Error('Fake Memory Cue is offline');
            error.code = 'unavailable';
            throw error;
        };

        window.__memoryCueSmoke = {
            user: USER,
            getOperations: () => readList(OPERATIONS_KEY),
            getAttempts: () => readList(ATTEMPTS_KEY),
            setOffline: (offline) => localStorage.setItem(OFFLINE_KEY, offline ? '1' : '0')
        };
        window.__TeacherScreenMemoryCueSyncTestAdapters = {
            authAdapter: {
                async start(listener) {
                    authListener = listener;
                    listener(null);
                    return () => {
                        if (authListener === listener) authListener = null;
                    };
                },
                async signIn() {
                    authListener?.(clone(USER));
                    return clone(USER);
                },
                async signOut() {
                    authListener?.(null);
                }
            },
            remoteAdapter: {
                async upsert(uid, remoteId, payload, options = {}) {
                    const operation = {
                        type: 'upsert',
                        uid,
                        remoteId,
                        payload: clone(payload),
                        options: clone(options)
                    };
                    failIfOffline(operation);
                    append(OPERATIONS_KEY, operation);
                },
                async remove(uid, remoteId) {
                    const operation = { type: 'delete', uid, remoteId };
                    failIfOffline(operation);
                    append(OPERATIONS_KEY, operation);
                }
            }
        };
    });

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

    const reminderText = 'Memory Cue browser smoke reminder';
    const offlineReminderText = 'Memory Cue offline reminder';

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });

        const currentCard = page.locator('.dashboard-screen-card.is-current').first();
        const deckId = await currentCard.getAttribute('data-deck-id');
        assert(Boolean(deckId), 'Memory Cue sync smoke should start with a current saved deck');
        await currentCard.locator('[data-reminder-action="expand"]').click();
        await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${deckId}"] .dashboard-reminder-panel`, { timeout: 10000 });
        const dashboardSync = currentCard.locator('.dashboard-reminder-panel [data-memory-cue-sync]');
        assert(await dashboardSync.locator('[data-memory-cue-sync-action]').textContent().then((text) => text.trim() === 'Connect Memory Cue'), 'Dashboard reminders should offer Connect Memory Cue without opening another screen');

        await currentCard.locator('.dashboard-screen-card__actions .control-button--primary').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await openClassroomRemindersFromWidgetMenu(page);
        const classroomSync = page.locator('#classroom-reminder-panel [data-memory-cue-sync]');
        assert(await classroomSync.locator('[data-memory-cue-sync-action]').textContent().then((text) => text.trim() === 'Connect Memory Cue'), 'Classroom reminders should offer the same Connect Memory Cue action');

        page.once('dialog', (dialog) => dialog.accept());
        await classroomSync.locator('[data-memory-cue-sync-action]').click();
        await page.waitForFunction(() => {
            const control = document.querySelector('#classroom-reminder-panel [data-memory-cue-sync]');
            return control?.dataset.syncState === 'connected'
                && (control.querySelector('[data-memory-cue-sync-status]')?.textContent || '').includes('teacher.sync@example.test');
        }, undefined, { timeout: 10000 });
        assert(true, 'Accepting the explicit confirmation should connect the selected Memory Cue email');

        await page.locator('#dashboard-tab').dispatchEvent('click');
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        const connectedCard = page.locator(`.dashboard-screen-card[data-deck-id="${deckId}"]`);
        if (await connectedCard.locator('.dashboard-reminder-panel').count() === 0) {
            await connectedCard.locator('[data-reminder-action="expand"]').click();
            await page.waitForSelector(`.dashboard-screen-card[data-deck-id="${deckId}"] .dashboard-reminder-panel`, { timeout: 10000 });
        }
        assert(
            await connectedCard.locator('[data-memory-cue-sync-status]').textContent().then((text) => text.includes('teacher.sync@example.test')),
            'Dashboard and Classroom should mirror the connected Memory Cue email'
        );

        await connectedCard.locator('.dashboard-screen-card__actions .control-button--primary').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        if (await page.locator('#classroom-reminder-dock').isHidden()) {
            await openClassroomRemindersFromWidgetMenu(page);
        }
        await page.waitForSelector('#classroom-reminder-dock:not([hidden])', { timeout: 10000 });
        const classroomForm = page.locator('#classroom-reminder-form');
        await classroomForm.locator('input[name="text"]').fill(reminderText);
        await classroomForm.locator('input[name="scope"][value="deck"]').check();
        await classroomForm.locator('input[name="showOnClassroom"]').check();
        await classroomForm.locator('button[type="submit"]').click();
        await page.waitForFunction((expectedText) => {
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            return store.reminders?.some((reminder) => reminder?.text === expectedText);
        }, reminderText, { timeout: 10000 });
        await page.waitForFunction((expectedText) => {
            return window.__memoryCueSmoke.getOperations()
                .some((operation) => operation.type === 'upsert' && operation.payload?.text === expectedText);
        }, reminderText, { timeout: 10000 });

        const firstSync = await page.evaluate((expectedText) => {
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            const reminder = store.reminders.find((item) => item?.text === expectedText);
            const operation = window.__memoryCueSmoke.getOperations()
                .find((item) => item.type === 'upsert' && item.payload?.text === expectedText);
            return { reminder, operation };
        }, reminderText);
        assert(Boolean(firstSync.reminder?.id && firstSync.operation?.remoteId), 'Adding a local reminder should create one fake Memory Cue upsert');
        assert(firstSync.operation.remoteId.startsWith('teacher-screen--'), 'Memory Cue upserts should use a deterministic integration-owned document ID');
        assert(firstSync.operation.payload.metadata?.teacherScreen?.reminderId === firstSync.reminder.id, 'Memory Cue metadata should retain the local reminder ID for traceability');
        const serializedPatch = JSON.stringify(firstSync.operation.payload);
        assert(!serializedPatch.includes('showOnClassroom'), 'Memory Cue payloads should never include the student visibility setting');
        assert(
            ['createdAt', 'category', 'priority', 'source', 'pendingSync', 'orderIndex', 'keywords', 'semanticEmbedding', 'plannerLessonId']
                .every((field) => !Object.prototype.hasOwnProperty.call(firstSync.operation.payload, field)),
            'Memory Cue update payloads should leave Memory-owned reminder fields untouched'
        );
        assert(
            firstSync.operation.options?.createDefaults?.category === 'School'
                && firstSync.operation.options?.createDefaults?.metadata?.suppressNotification === true,
            'The first fake upsert should supply safe School defaults only for a new Memory Cue document'
        );

        const reminderRow = page.locator(`#classroom-reminder-list [data-reminder-id="${firstSync.reminder.id}"]`);
        await reminderRow.locator('[data-reminder-action="toggle"]').click();
        await page.waitForFunction(({ reminderId, remoteId }) => {
            const matching = window.__memoryCueSmoke.getOperations()
                .filter((operation) => operation.type === 'upsert' && operation.remoteId === remoteId);
            return matching.length >= 2
                && matching.at(-1)?.payload?.completed === true
                && matching.at(-1)?.payload?.metadata?.teacherScreen?.reminderId === reminderId;
        }, { reminderId: firstSync.reminder.id, remoteId: firstSync.operation.remoteId }, { timeout: 10000 });
        const updateSync = await page.evaluate((remoteId) => window.__memoryCueSmoke.getOperations()
            .filter((operation) => operation.type === 'upsert' && operation.remoteId === remoteId), firstSync.operation.remoteId);
        assert(updateSync.every((operation) => operation.remoteId === firstSync.operation.remoteId), 'Adding and completing a reminder should reuse the same Memory Cue document ID');
        assert(
            updateSync.at(-1).options?.createDefaults?.category === 'School'
                && !Object.prototype.hasOwnProperty.call(updateSync.at(-1).payload, 'category'),
            'Later updates should keep create-only defaults separate from Memory-owned fields'
        );

        page.once('dialog', (dialog) => dialog.accept());
        await reminderRow.locator('[data-reminder-action="delete"]').click();
        await page.waitForFunction((remoteId) => window.__memoryCueSmoke.getOperations()
            .some((operation) => operation.type === 'delete' && operation.remoteId === remoteId), firstSync.operation.remoteId, { timeout: 10000 });
        const deleteCall = await page.evaluate((remoteId) => window.__memoryCueSmoke.getOperations()
            .find((operation) => operation.type === 'delete' && operation.remoteId === remoteId), firstSync.operation.remoteId);
        assert(deleteCall.remoteId === firstSync.operation.remoteId, 'Deleting the Teacher Screen reminder should issue an explicit delete for the same Memory Cue document');

        await page.evaluate(() => window.__memoryCueSmoke.setOffline(true));
        await classroomForm.locator('input[name="text"]').fill(offlineReminderText);
        await classroomForm.locator('input[name="scope"][value="deck"]').check();
        await classroomForm.locator('button[type="submit"]').click();
        await page.waitForFunction((expectedText) => {
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            return store.reminders?.some((reminder) => reminder?.text === expectedText);
        }, offlineReminderText, { timeout: 10000 });
        await page.waitForFunction(() => {
            const control = document.querySelector('#classroom-reminder-panel [data-memory-cue-sync]');
            return control?.dataset.syncState === 'offline'
                && control.querySelector('[data-memory-cue-sync-action]')?.textContent?.trim() === 'Retry';
        }, undefined, { timeout: 10000 });
        assert((await page.locator('#classroom-reminder-list').textContent()).includes(offlineReminderText), 'An offline Memory Cue failure should not block the local reminder from appearing instantly');
        assert(
            await page.evaluate((expectedText) => window.__memoryCueSmoke.getAttempts()
                .some((attempt) => attempt.succeeded === false && attempt.payload?.text === expectedText), offlineReminderText),
            'The fake remote should report the offline upsert failure before retry'
        );

        await page.evaluate(() => window.__memoryCueSmoke.setOffline(false));
        await page.locator('#classroom-reminder-panel [data-memory-cue-sync-action]').click();
        await page.waitForFunction((expectedText) => {
            const control = document.querySelector('#classroom-reminder-panel [data-memory-cue-sync]');
            const synced = window.__memoryCueSmoke.getOperations()
                .some((operation) => operation.type === 'upsert' && operation.payload?.text === expectedText);
            return synced && control?.dataset.syncState === 'connected';
        }, offlineReminderText, { timeout: 10000 });
        assert(true, 'Retry should flush the queued local reminder and return the UI to connected');

        await page.setViewportSize({ width: 390, height: 844 });
        const mobileClassroomSync = await page.locator('#classroom-reminder-dock').evaluate((dock) => {
            const action = dock.querySelector('.memory-cue-sync__action');
            const dockRect = dock.getBoundingClientRect();
            const actionRect = action?.getBoundingClientRect();
            return {
                viewportFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
                dockFits: dock.scrollWidth <= dock.clientWidth + 1
                    && dockRect.left >= -1
                    && dockRect.right <= window.innerWidth + 1,
                actionHeight: actionRect?.height || 0
            };
        });
        assert(mobileClassroomSync.viewportFits && mobileClassroomSync.dockFits, '390px Memory Cue controls should not create horizontal overflow');
        assert(mobileClassroomSync.actionHeight >= 44, '390px Memory Cue action should retain at least a 44px touch target');

        assert(pageErrors.length === 0, `Memory Cue sync UI should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Memory Cue sync UI should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runWholeClassAssignmentChecks(browser, baseUrl) {
    const context = await browser.newContext();
    await makeExternalAssetsDeterministic(context);
    const pageErrors = [];
    const consoleErrors = [];
    const deckName = 'Whole Class Assignment Deck';
    const className = 'Year 7 HASS';
    const guardText = 'Must not silently become a deck reminder';
    const classReminderText = 'Bring HASS workbook tomorrow';

    context.on('page', (page) => {
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error' && !isExpectedBlockedExternalAssetMessage(message)) {
                consoleErrors.push(message.text());
            }
        });
    });

    try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-create-btn', { timeout: 15000 });

        page.once('dialog', (dialog) => dialog.accept(deckName));
        await page.locator('#dashboard-create-btn').click();
        const createdDeckId = await page.evaluate((expectedName) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.find((candidate) => candidate?.name === expectedName)?.id || '';
        }, deckName);
        assert(createdDeckId, 'Dashboard New Deck should create the deck before it is opened');
        const createdDeckCard = page.locator(`.dashboard-screen-card[data-deck-id="${createdDeckId}"]`);
        await createdDeckCard.locator('[data-deck-action="toggle"]').click();
        await createdDeckCard.locator('[data-deck-action="open"]').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.waitForFunction((expectedDeckId) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state.currentDeckId === expectedDeckId;
        }, createdDeckId, { timeout: 10000 });

        const noClassDeck = await page.evaluate((expectedName) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.name === expectedName);
            return {
                id: preset?.id || '',
                classId: preset?.classId || '',
                className: preset?.className || '',
                currentDeckId: state.currentDeckId || ''
            };
        }, deckName);
        assert(
            !!noClassDeck.id
                && noClassDeck.id === noClassDeck.currentDeckId
                && !noClassDeck.classId
                && !noClassDeck.className,
            'A newly created deck should begin without an assigned class'
        );

        await openClassroomRemindersFromWidgetMenu(page);
        const classroomForm = page.locator('#classroom-reminder-form');
        const deckScope = classroomForm.locator('input[name="scope"][value="deck"]');
        const classScope = page.locator('#classroom-reminder-class-scope');
        assert(!(await classScope.isDisabled()), 'Whole class should be actionable even before the deck has a class name');
        assert(
            (await page.locator('#classroom-reminder-class-help').textContent()).includes('asked to name the class'),
            'A no-class deck should explain what happens when Whole class is selected'
        );

        await page.evaluate(() => {
            const classRadio = document.querySelector('#classroom-reminder-class-scope');
            const deckRadio = document.querySelector('#classroom-reminder-form input[name="scope"][value="deck"]');
            classRadio.checked = true;
            deckRadio.checked = false;
        });
        await classroomForm.locator('input[name="text"]').fill(guardText);
        await classroomForm.locator('button[type="submit"]').click();
        assert(
            await page.locator('.notification-toast').textContent().then((text) => text.includes('Assign this deck to a class')),
            'Missing class context should show a clear warning'
        );
        assert(
            await page.evaluate((expectedText) => {
                const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
                return !store.reminders?.some((reminder) => reminder?.text === expectedText);
            }, guardText),
            'A requested Whole class reminder must never silently fall back to This deck'
        );
        await classroomForm.locator('input[name="text"]').fill('');
        await deckScope.click();

        page.once('dialog', (dialog) => dialog.dismiss());
        await classScope.click();
        assert(await deckScope.isChecked() && !(await classScope.isChecked()), 'Cancelling class assignment should return the composer to This deck');
        assert(
            await page.evaluate((expectedId) => {
                const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
                const preset = presets.find((candidate) => candidate?.id === expectedId);
                return !preset?.classId && !preset?.className;
            }, noClassDeck.id),
            'Cancelling class assignment should not change the saved deck'
        );

        page.once('dialog', (dialog) => dialog.accept(className));
        await classScope.click();
        await page.waitForFunction(({ expectedId, expectedClassName }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const preset = presets.find((candidate) => candidate?.id === expectedId);
            return preset?.className === expectedClassName
                && Boolean(preset.classId)
                && state.activeClassId === preset.classId
                && state.activeClassName === expectedClassName;
        }, { expectedId: noClassDeck.id, expectedClassName: className }, { timeout: 10000 });
        assert(await classScope.isChecked(), 'Assigning a class from the reminder composer should keep Whole class selected');
        assert(
            (await page.locator('#classroom-reminder-class-help').textContent()).includes(className),
            'The reminder composer should confirm the assigned class name'
        );

        await classroomForm.locator('input[name="text"]').fill(classReminderText);
        await classroomForm.locator('button[type="submit"]').click();
        const savedWholeClassReminder = await page.evaluate(({ expectedDeckId, expectedText }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.id === expectedDeckId);
            const store = JSON.parse(localStorage.getItem('teacherScreenClassReminders') || '{"reminders":[]}');
            const reminder = store.reminders?.find((candidate) => candidate?.text === expectedText);
            return {
                presetClassId: preset?.classId || '',
                reminder: reminder || null
            };
        }, { expectedDeckId: noClassDeck.id, expectedText: classReminderText });
        assert(
            savedWholeClassReminder.reminder?.scope === 'class'
                && savedWholeClassReminder.reminder?.classId === savedWholeClassReminder.presetClassId
                && savedWholeClassReminder.reminder?.deckId === '',
            'Whole class should save a true class reminder after inline assignment'
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        await page.waitForFunction(({ expectedDeckId, expectedClassName }) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            const preset = presets.find((candidate) => candidate?.id === expectedDeckId);
            return preset?.className === expectedClassName && Boolean(preset.classId);
        }, { expectedDeckId: noClassDeck.id, expectedClassName: className }, { timeout: 10000 });
        await page.locator(`.dashboard-screen-card[data-deck-id="${noClassDeck.id}"] [data-deck-action="open"]`).click();
        await openClassroomRemindersFromWidgetMenu(page);
        assert(
            (await page.locator('#classroom-reminder-list').textContent()).includes(classReminderText),
            'Inline class assignment and its Whole class reminder should survive reload'
        );
        assert(!(await page.locator('#classroom-reminder-class-scope').isDisabled()), 'Whole class should remain enabled after reload');

        assert(pageErrors.length === 0, `Whole class assignment checks should not raise page errors (${pageErrors.join('; ')})`);
        assert(consoleErrors.length === 0, `Whole class assignment checks should not raise console errors (${consoleErrors.join('; ')})`);
    } finally {
        await context.close();
    }
}

async function runSmoke() {
    const server = createStaticServer();
    const baseUrl = await listen(server);
    let browser;

    try {
        browser = await launchBrowser();
        if (process.argv.includes('--menu-safety-only')) {
            await runMenuSafetyChecks(browser, baseUrl);
            console.log('Menu safety browser checks passed.');
            return;
        }
        if (process.argv.includes('--deck-library-only')) {
            await runDeckLibraryRedesignChecks(browser, baseUrl);
            await runDeckLibraryStartupSafetyChecks(browser, baseUrl);
            console.log('Deck Library browser checks passed.');
            return;
        }
        if (process.argv.includes('--projector-powerpoint-only')) {
            await runPowerPointProjectorRestoreChecks(browser, baseUrl);
            console.log('PowerPoint projector restore browser checks passed.');
            return;
        }
        if (process.argv.includes('--resources-only')) {
            await runFocusedResourceLibraryChecks(browser, baseUrl);
            console.log('Resource Library browser checks passed.');
            return;
        }
        if (process.argv.includes('--widget-containment-only')) {
            await runBottomWidgetContainmentChecks(browser, baseUrl);
            await runTallWidgetVerticalMovementChecks(browser, baseUrl);
            console.log('Widget containment browser checks passed.');
            return;
        }
        if (process.argv.includes('--document-only')) {
            await runDocumentViewerPdfChecks(browser, baseUrl);
            console.log('Document Viewer browser checks passed.');
            return;
        }
        if (process.argv.includes('--memory-cue-sync-only')) {
            await runMemoryCueSyncUiChecks(browser, baseUrl);
            console.log('Memory Cue reminder sync browser checks passed.');
            return;
        }
        if (process.argv.includes('--reminders-only')) {
            await runReminderSystemChecks(browser, baseUrl);
            await runWholeClassAssignmentChecks(browser, baseUrl);
            await runMemoryCueSyncUiChecks(browser, baseUrl);
            console.log('Class and deck reminder browser checks passed.');
            return;
        }
        if (process.argv.includes('--new-deck-only')) {
            await runNewDeckNavigationChecks(browser, baseUrl);
            console.log('New Deck dashboard browser checks passed.');
            return;
        }
        if (!process.argv.includes('--main-ui-only')) {
            await runMenuSafetyChecks(browser, baseUrl);
            await runDeckLibraryRedesignChecks(browser, baseUrl);
            await runDeckLibraryStartupSafetyChecks(browser, baseUrl);
            await runDeckOrganisationChecks(browser, baseUrl);
            await runReminderSystemChecks(browser, baseUrl);
            await runWholeClassAssignmentChecks(browser, baseUrl);
            await runMemoryCueSyncUiChecks(browser, baseUrl);
            await runNewDeckNavigationChecks(browser, baseUrl);
            await runWidgetSaveNotificationChecks(browser, baseUrl);
            await runBottomWidgetContainmentChecks(browser, baseUrl);
            await runTallWidgetVerticalMovementChecks(browser, baseUrl);
            await runDocumentViewerPdfChecks(browser, baseUrl);
        }
        const context = await browser.newContext();
        await makeExternalAssetsDeterministic(context);
        await installPdfStub(context);
        await installResourceFolderMock(context);
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
        assert(await page.title() === 'Teacher Screen', 'Teacher app page title should load');
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Dashboard should be visible first');
        assert(await page.locator('#lesson-quick-actions').isHidden(), 'Lesson quick actions should stay hidden on the dashboard');
        assert(await page.locator('.dashboard-screen-card.is-current.is-expanded #dashboard-open-classroom-btn').isVisible(), 'Deck Library should reveal Classroom on the expanded current deck');
        assert(await page.locator('#dashboard-create-btn').isVisible(), 'Deck Library should keep New Deck clearly available');
        const desktopDashboardScale = await page.evaluate(() => {
            const sidebar = document.querySelector('.dashboard-sidebar')?.getBoundingClientRect();
            const organisationSection = document.querySelector('.dashboard-sidebar__section');
            const navigationItems = Array.from(document.querySelectorAll('.dashboard-nav-item'));
            const activeNavigationItems = navigationItems.filter((item) => item.classList.contains('is-active'));
            const classFilters = Array.from(document.querySelectorAll('.dashboard-filter'));
            const currentDeckId = JSON.parse(localStorage.getItem('classroomScreenState') || '{}').currentDeckId || '';
            const deckCards = Array.from(document.querySelectorAll('.dashboard-screen-card[data-deck-id]'));
            return {
                sidebarWidth: sidebar?.width || 0,
                organisationHeading: organisationSection?.querySelector('h3')?.textContent?.trim() || '',
                shelfControlCount: document.querySelectorAll('#dashboard-folder-list, #dashboard-create-folder-btn, .dashboard-shelves').length,
                folderFieldCount: document.querySelectorAll('#preset-folder-select').length,
                moveActionCount: Array.from(document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Move').length,
                utilityMenuLabels: Array.from(document.querySelectorAll('#dashboard-utility-menu button')).map((button) => button.textContent?.trim()),
                brandTitle: document.querySelector('.dashboard-brand h2')?.textContent?.trim() || '',
                brandTitleFits: (() => {
                    const title = document.querySelector('.dashboard-brand h2');
                    if (!title) return false;
                    const textRange = document.createRange();
                    textRange.selectNodeContents(title);
                    return textRange.getBoundingClientRect().width <= title.clientWidth - 2;
                })(),
                navigationCaptionCount: document.querySelectorAll('.dashboard-sidebar__label').length,
                navigationLabels: navigationItems.map((item) => item.textContent?.trim()),
                activeNavigationLabels: activeNavigationItems.map((item) => item.textContent?.trim()),
                navigationItemHeight: navigationItems[0]?.getBoundingClientRect().height || 0,
                classFilterLabels: classFilters.map((item) => item.querySelector('span')?.textContent?.trim()),
                classFilterHeight: classFilters[0]?.getBoundingClientRect().height || 0,
                legacyFooterCount: document.querySelectorAll('.dashboard-sidebar__footer').length,
                currentDeckFirst: deckCards[0]?.dataset.deckId === currentDeckId,
                expandedDeckCount: deckCards.filter((card) => card.classList.contains('is-expanded')).length,
                libraryFits: document.querySelector('.dashboard-library-panel')?.scrollWidth
                    <= document.querySelector('.dashboard-library-panel')?.clientWidth + 1
            };
        });
        assert(desktopDashboardScale.sidebarWidth >= 184 && desktopDashboardScale.sidebarWidth <= 196, 'Desktop dashboard navigation should keep a narrow readable footprint');
        assert(desktopDashboardScale.organisationHeading === 'Your Classes', 'The dashboard should present Classes as the single deck organisation system');
        assert(desktopDashboardScale.shelfControlCount === 0, 'Deck Shelf controls should no longer compete with Classes');
        assert(desktopDashboardScale.folderFieldCount === 0, 'The advanced deck manager should not expose a second folder system');
        assert(desktopDashboardScale.moveActionCount === 0, 'Deck actions should not offer movement into hidden shelves');
        assert(desktopDashboardScale.brandTitle === 'Teacher Screen', 'Sidebar should show the app name once as its clear title');
        assert(desktopDashboardScale.brandTitleFits, 'Sidebar app name should fit without clipping or an ellipsis');
        assert(desktopDashboardScale.navigationCaptionCount === 0, 'Sidebar should not repeat an unnecessary Navigation caption');
        assert(desktopDashboardScale.navigationLabels.join('|') === 'Deck Library|Resources|Favourite decks|Recent decks|More', 'Sidebar should lead with Deck Library and distinguish deck filters from resource filters');
        assert(desktopDashboardScale.activeNavigationLabels.join('|') === 'Deck Library', 'Deck Library should be the only active navigation item on launch');
        assert(desktopDashboardScale.navigationItemHeight >= 40, 'Primary navigation items should have clear touch-friendly height');
        assert(desktopDashboardScale.classFilterLabels.join('|') === 'Year 7 English', 'Class filters should be generated from saved deck metadata without duplicating Library');
        assert(desktopDashboardScale.classFilterHeight < desktopDashboardScale.navigationItemHeight, 'Class filters should be visually secondary to primary navigation');
        assert(desktopDashboardScale.utilityMenuLabels.join('|') === 'Sections|Teacher Controls|About updates|Help', 'Sections and clearly named utilities should live in the compact teacher options menu');
        assert(desktopDashboardScale.legacyFooterCount === 0, 'The sidebar should not reserve a footer row for utility links');
        assert(desktopDashboardScale.currentDeckFirst && desktopDashboardScale.expandedDeckCount === 1, 'Desktop Deck Library should show the current deck first and expand only it');
        assert(desktopDashboardScale.libraryFits, 'Desktop Deck Library should fit without horizontal overflow');
        assert(await page.locator('#tour-dialog').count() === 0, 'The removed welcome tour should not be part of the app');

        await page.locator('.dashboard-screen-card.is-current [data-deck-action="toggle"]').click();
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Collapsing the current deck should leave the dashboard menus independent of deck actions');
        const dashboardMenuStateBefore = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return {
                currentDeckId: state.currentDeckId || '',
                projectName: state.projectName || '',
                usage: presets
                    .map((preset) => ({
                        id: preset?.id || '',
                        lastUsedAt: Number(preset?.lastUsedAt || 0),
                        usageCount: Number(preset?.usageCount || 0)
                    }))
                    .sort((a, b) => a.id.localeCompare(b.id))
            };
        });

        await page.locator('#dashboard-utility-menu > summary').click();
        assert(await page.locator('#dashboard-settings-btn').getByText('Teacher Controls', { exact: true }).isVisible(), 'Dashboard More should reveal Teacher Controls');
        assert(await page.locator('#dashboard-updates-btn').getByText('About updates', { exact: true }).isVisible(), 'Dashboard More should reveal About updates');
        assert(await page.locator('#dashboard-help-btn').isVisible(), 'Dashboard More should reveal Help');
        await page.locator('#dashboard-sections-btn').click();
        await page.waitForSelector('#sections-menu:not([hidden])', { timeout: 10000 });
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Opening Sections should keep the dashboard in place behind the section picker');
        assert(await page.locator('#classroom-view:not([hidden])').count() === 0, 'Opening Sections should not enter a classroom deck');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Opening Sections should not expand a lesson deck');
        assert(await page.locator('#dashboard-utility-menu[open]').count() === 0, 'Opening Sections should close the compact menu');
        assert(await page.locator('#sections-menu .nav-tabs > .nav-tab').count() === 5, 'Sections should expose five direct section tabs');
        assert(await page.locator('#sections-menu > .sections-menu__content > #manage-screens-btn').count() === 1, 'Sections should expose Deck Library as a separate destination');
        assert(await page.locator('#sections-menu .screen-manager-body').count() === 0, 'Sections should not embed deck controls');
        assert(await page.locator('#sections-menu-close').evaluate((element) => document.activeElement === element), 'Opening Sections should focus its close button');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#sections-menu:not([hidden])', { state: 'detached', timeout: 10000 });
        assert(await page.locator('#dashboard-utility-menu > summary').evaluate((element) => document.activeElement === element), 'Escape should return focus to Dashboard More');

        await page.locator('#dashboard-utility-menu > summary').click();
        await page.locator('#dashboard-sections-btn').click();
        await page.waitForSelector('#sections-menu:not([hidden])', { timeout: 10000 });
        await page.locator('#manage-screens-btn').click();
        await page.waitForSelector('#sections-menu', { state: 'hidden', timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.id === 'dashboard-search-input', null, { timeout: 10000 });
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Deck Library should remain on the Dashboard');
        assert(await page.locator('#classroom-view:not([hidden])').count() === 0, 'Deck Library should not enter Classroom');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Deck Library should not open a lesson deck');
        assert(await page.locator('#screen-deck-manager-dialog[open]').count() === 0, 'Deck Library should not open the separate Deck details dialog');
        assert(await page.locator('#dashboard-deck-tools-btn').isVisible(), 'Deck details should remain discoverable from the Dashboard');
        await openScreenDeckTools(page);
        assert(await page.locator('#screen-deck-manager-title').textContent().then((text) => text.trim() === 'Deck details & backup'), 'Dashboard Deck details should open the dedicated dialog');
        assert(await page.locator('#screen-deck-manager-dialog .screen-manager-body').isVisible(), 'The dedicated Deck details dialog should contain the deck actions');
        await page.locator('#screen-deck-manager-dialog .modal-close').click();
        await page.waitForSelector('#screen-deck-manager-dialog[open]', { state: 'detached', timeout: 10000 });
        await page.locator('#dashboard-utility-menu > summary').click();
        await page.locator('#dashboard-settings-btn').click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Teacher Controls should open over the Dashboard');
        assert(await page.locator('#classroom-view:not([hidden])').count() === 0, 'Teacher Controls should not enter or reveal a classroom deck');
        assert(await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Teacher Controls should not expand a dashboard deck');
        const dashboardMenuStateAfter = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return {
                currentDeckId: state.currentDeckId || '',
                projectName: state.projectName || '',
                usage: presets
                    .map((preset) => ({
                        id: preset?.id || '',
                        lastUsedAt: Number(preset?.lastUsedAt || 0),
                        usageCount: Number(preset?.usageCount || 0)
                    }))
                    .sort((a, b) => a.id.localeCompare(b.id))
            };
        });
        assert(JSON.stringify(dashboardMenuStateAfter) === JSON.stringify(dashboardMenuStateBefore), 'Opening dashboard menus should not load a deck or change its usage history');
        await closeTeacherPanel(page);
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Closing Teacher Controls should keep the same dashboard view visible');
        await page.locator('#dashboard-utility-menu > summary').click();
        await page.locator('#dashboard-updates-btn').click();
        assert(await page.locator('.notification-toast').textContent().then((text) => text.includes('applied automatically')), 'Updates should explain how the web app receives updates');
        assert(await page.locator('#dashboard-utility-menu[open]').count() === 0, 'Choosing a utility option should close the compact menu');
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1 && await page.locator('.dashboard-screen-card__details:visible').count() === 0, 'Updates should leave the Dashboard and its decks unchanged');
        await page.locator('#dashboard-utility-menu > summary').click();
        await page.locator('#dashboard-help-btn').click();
        await page.waitForSelector('#help-dialog[open]', { timeout: 10000 });
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1 && await page.locator('#classroom-view:not([hidden])').count() === 0, 'Help should open over the Dashboard without entering Classroom');
        await page.locator('#help-dialog .modal-close').click();
        await page.waitForSelector('#help-dialog[open]', { state: 'detached', timeout: 10000 });

        await page.locator('[data-dashboard-mode="library"]').click();
        assert(await page.locator('.dashboard-nav-item.is-active').textContent().then((text) => text.trim() === 'Deck Library'), 'Deck Library should become the only active navigation destination');
        assert(await page.locator('.dashboard-library-panel h1').textContent().then((text) => text.trim() === 'All lesson decks'), 'Deck Library should display all lesson decks');
        const storedDeckCount = await page.evaluate(() => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').length);
        assert(await page.locator('.dashboard-screen-card').count() === storedDeckCount, 'Deck Library should include every saved and seeded lesson deck');

        await page.locator('.dashboard-screen-card [data-deck-action="favorite"]').first().click();
        assert(await page.locator('.dashboard-screen-card [data-deck-action="favorite"][aria-pressed="true"]').count() === 1, 'Deck cards should provide a working favourite control');
        assert(await page.evaluate(() => JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]').filter((preset) => preset?.isFavorite).length === 1), 'Favourite deck state should persist locally');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        assert(await page.locator('.dashboard-screen-card [data-deck-action="favorite"][aria-pressed="true"]').count() === 1, 'Favourite deck state should survive a full app reload');
        await page.locator('[data-dashboard-mode="favorites"]').click();
        assert(await page.locator('.dashboard-nav-item.is-active').textContent().then((text) => text.trim() === 'Favourite decks'), 'Favourite decks should become the only active navigation destination');
        assert(await page.locator('.dashboard-screen-card').count() === 1, 'Favourites should show only pinned lesson decks');

        await page.locator('.dashboard-filter[data-class-name="Year 7 English"]').click();
        assert(await page.locator('.dashboard-nav-item.is-active').textContent().then((text) => text.trim() === 'Deck Library'), 'Selecting a class filter should keep Deck Library as the active destination');
        assert(await page.locator('.dashboard-filter[data-class-name="Year 7 English"]').getAttribute('aria-pressed') === 'true', 'The selected class should have a clear active state');
        assert(await page.locator('.dashboard-filter[data-class-name="Year 7 English"]').getAttribute('aria-label') === 'Year 7 English, 2 decks', 'Class buttons should announce their deck count');
        assert(await page.locator('.dashboard-library-panel h1').textContent().then((text) => text.trim() === 'Year 7 English'), 'Class filters should label the Deck Library with the selected class');
        assert(await page.locator('.dashboard-screen-card').count() === 2, 'Class filters should show only decks saved for that teaching class');
        await page.locator('[data-dashboard-mode="library"]').click();
        assert(await page.locator('.dashboard-filter.is-active').count() === 0, 'Opening Library should clear the class filter');
        assert(await page.locator('.dashboard-library-panel h1').textContent().then((text) => text.trim() === 'All lesson decks'), 'Deck Library should return to all lesson decks after filtering by class');

        await page.locator('[data-dashboard-mode="recent"]').click();
        assert(await page.locator('.dashboard-empty').textContent().then((text) => text.includes('No recently opened decks')), 'Recent should explain when no lesson deck has been opened yet');
        await page.locator('[data-dashboard-mode="library"]').click();

        await page.locator('.dashboard-screen-card.is-current [data-deck-action="toggle"]').click();
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        assert(await page.locator('#student-view').isVisible(), 'Classroom view should open');
        assert(await page.locator('#classroom-reminder-dock').evaluate((dock) => (
            dock.classList.contains('is-collapsed')
                && getComputedStyle(dock).display === 'none'
                && document.querySelector('#classroom-reminder-panel')?.hidden === true
                && document.querySelector('#classroom-reminder-launcher')?.hidden === false
        )), 'Classroom reminders should start collapsed and leave the widget canvas clear');
        assert(await page.locator('.widget-placeholder').textContent().then((text) => text.trim() === ''), 'Empty classroom should not show instructional placeholder text');
        assert(await page.locator('#teacher-panel.open').count() === 0, 'Classroom should open in lesson mode with Teacher Controls closed');
        assert(await page.locator('#widgets-container.layout-edit-mode').count() === 1, 'Classroom widgets should always be ready to move and resize');
        assert(await page.locator('#lesson-quick-actions').isVisible(), 'Lesson quick actions should appear in classroom mode');
        assert(await page.locator('#layout-edit-quick-btn').count() === 0, 'The widget bar should not require an Edit or Done mode button');
        assert(await page.locator('#teacher-controls-quick-btn').count() === 0, 'Teacher Controls should no longer crowd the lesson bar');
        assert(await page.locator('#lesson-quick-actions #classroom-reminder-launcher').count() === 0, 'Reminders should no longer crowd the lesson bar');
        assert(await page.locator('#lesson-quick-actions [data-quick-widget]').count() >= 5, 'Lesson quick actions should expose common live widgets');

        await page.locator('#add-widget-btn').click();
        await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
        assert(await page.locator('#widget-modal .widget-picker-footer__actions #classroom-reminder-launcher').isVisible(), 'Add Widget should provide the Reminders action');
        assert(await page.locator('#widget-modal .widget-picker-footer__actions #widget-picker-teacher-controls-btn').isVisible(), 'Add Widget should provide Teacher Controls beside Reminders');
        assert(await page.locator('#widget-picker-projector-btn').isVisible(), 'Add Widget should provide a Projector action');
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
        const projectorLaunch = await page.evaluate(() => {
            const originalOpen = window.open;
            let call = null;
            window.open = (...args) => {
                call = args;
                return null;
            };
            document.getElementById('widget-picker-projector-btn').click();
            window.open = originalOpen;
            return call;
        });
        const projectorLaunchUrl = new URL(projectorLaunch?.[0] || baseUrl);
        assert(projectorLaunchUrl.pathname.endsWith('/projector.html'), 'Widget picker Projector action should open the projector page');
        assert(Boolean(projectorLaunchUrl.searchParams.get('syncToken')), 'Widget picker Projector action should pair the projector with its teacher screen');
        assert(projectorLaunch?.[1] === '_blank' && projectorLaunch?.[2]?.includes('noopener'), 'Widget picker Projector action should open safely in a new tab');
        await page.locator('#widget-modal .modal-close').click();
        await page.waitForSelector('#widget-modal[open]', { state: 'detached', timeout: 10000 });

        await page.locator('#lesson-quick-actions [data-quick-widget="rich-text"]').click();
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        assert(await page.locator('.widget.rich-text-widget').count() === 1, 'Quick Text action should add a Rich Text Board');
        assert(await page.locator('.widget.rich-text-widget .widget-header').isVisible(), 'The compact widget grab bar should always remain visible');
        assert(await page.locator('.widget.rich-text-widget .rich-text-editor-toolbar').isVisible(), 'Rich Text toolbar should be visible in edit mode');
        const richTextWidget = page.locator('.widget.rich-text-widget');
        const richTextEditor = richTextWidget.locator('.ql-editor');
        const richTextToolbar = richTextWidget.locator('.rich-text-editor-toolbar');
        const moreFormatting = richTextToolbar.locator('.rich-text-toolbar-more');
        const textColourMenu = richTextToolbar.locator('[data-format-menu="color"]');
        const highlightColourMenu = richTextToolbar.locator('[data-format-menu="background"]');
        assert(await richTextToolbar.locator('select[aria-label="Text style"] option').allTextContents().then((options) => options.includes('Small notes')), 'Text Board should offer a semantic Small notes style');
        assert(await richTextToolbar.locator('select[aria-label="Alignment"]').isVisible(), 'Text Board should expose alignment controls');
        assert(await richTextToolbar.locator('.rich-text-toolbar-present').count() === 0, 'Present should not take permanent space in the formatting toolbar');
        assert(await richTextToolbar.locator('.rich-text-toolbar-main [data-format-menu]').count() === 0, 'Colour tools should not crowd the everyday formatting bar');

        await richTextWidget.evaluate((widget) => {
            widget.dataset.smokeOriginalWidth = widget.style.width;
            widget.style.width = '418px';
        });
        assert(await richTextToolbar.locator('.rich-text-control-text').count() === 0, 'List controls should use compact icons without redundant text labels');
        assert(await moreFormatting.locator('.rich-text-toolbar-more__label').count() === 0, 'More should use its compact icon without a redundant text label');
        assert(await moreFormatting.locator(':scope > summary').getAttribute('aria-label') === 'More formatting tools', 'The compact More icon should keep a clear accessible name');
        assert(await moreFormatting.locator(':scope > summary').evaluate((summary) => summary.getBoundingClientRect().width <= 34), 'The compact More icon should reclaim toolbar space');
        assert(await richTextToolbar.locator('.rich-text-toolbar-main').evaluate((main) => main.scrollWidth <= main.clientWidth + 1), 'Everyday formatting controls should fit without hidden horizontal scrolling at the compact Text Board size');
        await richTextWidget.evaluate((widget) => {
            widget.style.width = widget.dataset.smokeOriginalWidth;
            delete widget.dataset.smokeOriginalWidth;
        });

        await moreFormatting.locator(':scope > summary').click();
        assert(await moreFormatting.getAttribute('open') !== null, 'More should open the advanced formatting panel');
        assert(await textColourMenu.locator('summary').isVisible(), 'More should provide an accessible text colour control');
        assert(await highlightColourMenu.locator('summary').isVisible(), 'More should provide an accessible highlight control');
        assert(await textColourMenu.locator('.rich-text-colour-letter').textContent() === 'A', 'Text colour should use a compact bold A trigger');
        assert(await richTextToolbar.locator('.rich-text-colour-control-label').count() === 0, 'Colour triggers should not use space on visible text labels');
        assert(await textColourMenu.locator('summary').evaluate((summary) => summary.getBoundingClientRect().width <= 44), 'Text colour should remain a compact action button');
        assert(await highlightColourMenu.locator('summary').evaluate((summary) => summary.getBoundingClientRect().width <= 44), 'Highlight should remain a compact action button');
        assert(await highlightColourMenu.locator('summary').evaluate((summary) => getComputedStyle(summary).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'Highlight should keep its subtle colour accent');
        assert(await moreFormatting.locator('.rich-text-toolbar-more-panel').evaluate((panel) => {
            const widgetBounds = panel.closest('.widget')?.getBoundingClientRect();
            const panelBounds = panel.getBoundingClientRect();
            const discussionButton = panel.querySelector('[data-insert="discussion-question"]');
            return !!widgetBounds
                && panelBounds.left >= widgetBounds.left
                && panelBounds.right <= widgetBounds.right
                && panelBounds.bottom <= widgetBounds.bottom
                && discussionButton.scrollWidth <= discussionButton.clientWidth + 1;
        }), 'More should stay inside the Text Board without clipping its longest teaching-block label');

        if (await richTextEditor.count() === 1) {
            const selectAllRichText = async (text = 'Selection safeguard') => {
                await richTextEditor.evaluate((root, nextText) => {
                    const editor = window.Quill?.find(root.parentElement);
                    if (!editor || typeof editor.setText !== 'function') {
                        throw new Error('Rich Text editor instance was not available');
                    }
                    editor.setText(nextText, 'api');
                    editor.setSelection(0, nextText.length, 'api');
                }, text);
            };
            const clearQuillSelectionMemory = async () => {
                await richTextEditor.evaluate((root) => {
                    const editor = window.Quill.find(root.parentElement);
                    // Some browser focus changes can clear Quill's internal saved range while a palette is open.
                    editor.selection.savedRange = null;
                    editor.selection.lastRange = null;
                });
            };
            const assertColourPaletteIsReachable = async (menu, label) => {
                const state = await menu.locator('.rich-text-toolbar-colour-panel').evaluate((panel) => {
                    const moreMenu = panel.closest('.rich-text-toolbar-more');
                    const bounds = panel.getBoundingClientRect();
                    const hitTarget = document.elementFromPoint(bounds.left + 16, bounds.top + 16);
                    return {
                        moreMenuOpen: moreMenu?.hasAttribute('open'),
                        panelReceivesPointer: panel.contains(hitTarget)
                    };
                });
                assert(state.moreMenuOpen, `${label} should open without closing More`);
                assert(state.panelReceivesPointer, `${label} should be visible and clickable below the toolbar`);
            };

            await selectAllRichText();
            await textColourMenu.locator('summary').click();
            await assertColourPaletteIsReachable(textColourMenu, 'Text colour palette');
            await clearQuillSelectionMemory();
            await textColourMenu.getByRole('button', { name: 'Red text' }).click();
            assert(await richTextEditor.locator('span').evaluate((span) => getComputedStyle(span).color) === 'rgb(220, 38, 38)', 'Text colour should survive palette focus replacing the browser selection');
            assert(await textColourMenu.locator('.rich-text-colour-preview').evaluate((preview) => getComputedStyle(preview).backgroundColor) === 'rgb(220, 38, 38)', 'Text colour trigger should show the active colour in its underline');

            await selectAllRichText();
            await highlightColourMenu.locator('summary').click();
            await assertColourPaletteIsReachable(highlightColourMenu, 'Highlight palette');
            await clearQuillSelectionMemory();
            await highlightColourMenu.getByRole('button', { name: 'Yellow highlight' }).click();
            assert(await richTextEditor.locator('span').evaluate((span) => getComputedStyle(span).backgroundColor) === 'rgb(254, 240, 138)', 'Highlight should survive palette focus replacing the browser selection');
        }

        assert(await moreFormatting.getByRole('button', { name: 'Learning intention' }).isVisible(), 'More should offer the Learning intention teaching block');
        assert(await moreFormatting.getByRole('button', { name: 'Success criteria' }).isVisible(), 'More should offer the Success criteria teaching block');
        assert(await moreFormatting.getByRole('button', { name: 'Warm-up' }).isVisible(), 'More should offer the Warm-up teaching block');
        assert(await moreFormatting.getByRole('button', { name: 'Discussion question' }).isVisible(), 'More should offer the Discussion question teaching block');
        assert(await moreFormatting.getByRole('button', { name: 'Exit ticket' }).isVisible(), 'More should offer the Exit ticket teaching block');
        assert(await moreFormatting.getByRole('button', { name: 'Tip' }).isVisible(), 'More should offer classroom callouts');
        assert(await moreFormatting.getByRole('button', { name: 'Undo' }).count() === 1, 'More should provide Undo');
        assert(await moreFormatting.getByRole('button', { name: 'Redo' }).count() === 1, 'More should provide Redo');
        assert(await moreFormatting.locator('.rich-text-toolbar-more-panel').evaluate((panel) => {
            const clearButton = panel.querySelector('[aria-label="Clear formatting"]');
            clearButton?.scrollIntoView({ block: 'nearest' });
            const clearRect = clearButton?.getBoundingClientRect();
            if (!clearRect?.width || !clearRect?.height) return false;
            const hitTarget = document.elementFromPoint(clearRect.left + (clearRect.width / 2), clearRect.top + (clearRect.height / 2));
            return !!hitTarget?.closest?.('.rich-text-toolbar-more-panel');
        }), 'More should reveal every advanced formatting control above the editor');
        await moreFormatting.locator(':scope > summary').click();

        assert(await page.locator('.widget.rich-text-widget .widget-header').evaluate((header) => header.getBoundingClientRect().height <= 37), 'The permanent widget grab bar should stay about five percent slimmer');
        assert(await page.locator('.widget.rich-text-widget .widget-header .fa-grip-vertical').count() === 0, 'The draggable widget header should not show a redundant grip icon');
        assert(await page.locator('.widget.rich-text-widget .widget-header-actions').count() === 0, 'Widget editing buttons should not remain exposed in a row');
        assert(await page.locator('.widget.rich-text-widget .widget-header-menu > summary').isVisible(), 'Each widget should expose one compact options menu');
        assert(await page.locator('.widget.rich-text-widget .widget-header').evaluate((header) => {
            const titleRect = header.querySelector('.widget-header-title')?.getBoundingClientRect();
            const menuRect = header.querySelector('.widget-header-menu > summary')?.getBoundingClientRect();
            return !!titleRect && !!menuRect && menuRect.left - titleRect.right <= 8;
        }), 'The widget options menu should stay beside the title instead of colliding with corner controls');
        const richTextOptionsToggle = page.locator('.widget.rich-text-widget .widget-header-menu > summary');
        const richTextOptionsMenu = page.locator('.widget.rich-text-widget .widget-header-menu__popover');
        assert(await richTextOptionsMenu.isHidden(), 'Widget options should stay hidden until requested');
        await richTextOptionsToggle.click();
        const presentTextBoard = richTextOptionsMenu.getByRole('button', { name: 'Present Text Board' });
        assert(await presentTextBoard.isVisible(), 'Text Board options should include Present');
        await presentTextBoard.click();
        assert(await richTextWidget.locator('.rich-text-widget-inner.display-mode[data-presentation-mode="fullscreen"]').count() === 1, 'Present should open the Text Board in full-screen display mode');
        assert(await page.locator('.project-switcher--corner').evaluate((element) => getComputedStyle(element).visibility === 'hidden'), 'Text Board presentation should prevent the page switcher from blocking the exit control');
        assert(await page.locator('#classroom-reminder-dock').evaluate((element) => getComputedStyle(element).visibility === 'hidden'), 'Text Board presentation should keep the reminder dock away from presentation controls');
        const exitPresentButton = richTextWidget.getByRole('button', { name: 'Exit presentation mode' });
        assert(await exitPresentButton.isVisible(), 'Present mode should expose a clear Exit Present button');
        assert((await exitPresentButton.textContent()).trim() === 'Exit Present', 'The presentation exit control should use an unambiguous label');
        await exitPresentButton.click();
        assert(await richTextWidget.locator('.rich-text-widget-inner[data-presentation-mode="normal"]:not(.display-mode)').count() === 1, 'Exit Present should restore Text Board editing mode');
        assert(await richTextToolbar.isVisible(), 'Exit Present should restore the formatting toolbar');

        await richTextOptionsToggle.click();
        await presentTextBoard.click();
        await page.keyboard.press('Escape');
        assert(await richTextWidget.locator('.rich-text-widget-inner[data-presentation-mode="normal"]:not(.display-mode)').count() === 1, 'Escape should also exit Text Board presentation mode');
        await openTeacherPanel(page);
        assert(await page.locator('#widgets-container.layout-edit-mode').count() === 1, 'Teacher Controls should not change the permanent widget interaction state');
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
        assert(teacherControlsScale.openSectionCount === 1, 'Teacher Controls should open with only Current deck and pages expanded');
        assert(teacherControlsScale.deckCardHeight <= 420, `Current deck and pages should keep the larger touch-friendly controls within a compact card (${JSON.stringify(teacherControlsScale)})`);
        assert(teacherControlsScale.summariesCompact, 'Teacher Controls section rows should share a compact height');
        assert(teacherControlsScale.newPageFillsRow, 'New Page should align to the full action row');
        assert(teacherControlsScale.lastCardVisible, 'All Teacher Controls sections should be reachable in the first desktop view');
        assert(teacherControlsScale.advancedControlClosed, 'More page actions should show the correct closed-state affordance');
        assert(await page.locator('.widget.rich-text-widget .widget-header').isVisible(), 'Teacher Controls should leave the widget grab bar visible');
        assert(await page.locator('.widget.rich-text-widget .widget-header-title').textContent().then((text) => text.includes('Text Board')), 'The grab bar should use the friendly Text Board label');
        await page.locator('.widget.rich-text-widget .widget-header-menu > summary').click();
        assert(await page.locator('.widget.rich-text-widget .widget-header-menu__item').count() === 4, 'The Text Board options menu should contain minimise, present, settings, and remove actions');
        const widgetMenuScale = await page.locator('.widget.rich-text-widget .widget-header-menu__popover').evaluate((popover) => {
            const popoverRect = popover.getBoundingClientRect();
            const items = Array.from(popover.querySelectorAll('.widget-header-menu__item'));
            const labels = items
                .filter((item) => !item.classList.contains('widget-minimize-btn'))
                .map((item) => item.querySelector('span'));
            return {
                width: popoverRect.width,
                rowsFillMenu: items.every((item) => item.getBoundingClientRect().width >= popoverRect.width - 14),
                rowsAreComfortable: items.every((item) => item.getBoundingClientRect().height >= 36),
                labelsStayOnOneLine: labels.every((label) => label && label.scrollWidth <= label.clientWidth)
            };
        });
        assert(widgetMenuScale.width >= 198 && widgetMenuScale.width <= 222, 'The widget options menu should use a compact, readable width');
        assert(widgetMenuScale.rowsFillMenu, 'Every widget option should fill the menu instead of collapsing to an icon-sized control');
        assert(widgetMenuScale.rowsAreComfortable, 'Widget options should share a consistent touch-friendly row height');
        assert(widgetMenuScale.labelsStayOnOneLine, 'Widget option labels should remain on one line');
        assert(await page.locator('.widget.rich-text-widget .widget-header-menu__popover').evaluate((popover) => {
            const rect = popover.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= window.innerWidth;
        }), 'The widget options menu should remain fully inside the screen');

        const richTextBoxBeforeMinimize = await getElementBox(page, '.widget.rich-text-widget');
        const minimizeButton = page.locator('.widget.rich-text-widget .widget-minimize-btn');
        assert(await minimizeButton.textContent().then((text) => text.includes('Minimise') && text.includes('students')), 'The widget menu should explain that minimising also hides the widget from students');
        await minimizeButton.click();
        await page.waitForSelector('.widget.rich-text-widget.is-minimized', { timeout: 10000 });
        const richTextBoxWhileMinimized = await getElementBox(page, '.widget.rich-text-widget');
        assert(richTextBoxWhileMinimized.height <= 42, 'Minimising should collapse the teacher widget to its title bar');
        assert(richTextBoxWhileMinimized.height < richTextBoxBeforeMinimize.height - 40, 'Minimising should reclaim meaningful teacher-screen space');
        assert(await page.locator('.widget.rich-text-widget > .widget-content').isHidden(), 'A minimised teacher widget should hide its content and resize controls');
        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const widget = state.layout?.widgets?.find((item) => item?.type === 'RichTextWidget');
            return widget?.visibleOnProjector === false && widget.height > 42;
        }, { timeout: 10000 });
        assert(true, 'A minimised widget should save its student-hidden state and remember its expanded height');

        const minimizedProjectorPage = await context.newPage();
        try {
            await minimizedProjectorPage.goto(await getPairedProjectorUrl(page, baseUrl), { waitUntil: 'domcontentloaded' });
            await minimizedProjectorPage.waitForFunction(() => Boolean(window.__TeacherScreenProjectorApp), { timeout: 15000 });
            await minimizedProjectorPage.waitForTimeout(500);
            assert(await minimizedProjectorPage.locator('.widget.rich-text-widget').count() === 0, 'A minimised widget should be hidden from the student projector');
        } finally {
            await minimizedProjectorPage.close();
        }

        await page.locator('.widget.rich-text-widget .widget-header-menu > summary').click();
        assert(await minimizeButton.textContent().then((text) => text.includes('Restore') && text.includes('students')), 'A minimised widget should offer one clear restore-and-show action');
        await minimizeButton.click();
        await page.waitForSelector('.widget.rich-text-widget.is-minimized', { state: 'detached', timeout: 10000 });
        const richTextBoxAfterRestore = await getElementBox(page, '.widget.rich-text-widget');
        assert(Math.abs(richTextBoxAfterRestore.height - richTextBoxBeforeMinimize.height) <= 2, 'Restoring should return the teacher widget to its previous height');
        assert(await page.locator('.widget.rich-text-widget > .widget-content').isVisible(), 'Restoring should return the widget content to the teacher screen');
        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const widget = state.layout?.widgets?.find((item) => item?.type === 'RichTextWidget');
            return widget?.visibleOnProjector === true;
        }, { timeout: 10000 });
        assert(true, 'Restoring should show the widget to students again');

        await page.locator('.widget.rich-text-widget .widget-header-menu > summary').click();
        await page.locator('.widget.rich-text-widget .widget-header-settings-btn').click();
        await page.waitForSelector('#widget-settings-modal.visible', { timeout: 10000 });
        assert(await page.locator('#widget-settings-modal #projectorToggle').count() === 0, 'Widget settings should not repeat the replaced projector visibility switch');
        await page.locator('#widget-settings-modal .rich-text-controls--modes button', { hasText: 'Display' }).click();
        await page.locator('#widget-settings-modal .modal-close-btn').click();
        await page.waitForSelector('#widget-settings-modal.visible', { state: 'hidden', timeout: 10000 });
        assert(await page.locator('.widget.rich-text-widget .rich-text-editor-toolbar').isHidden(), 'Rich Text toolbar should hide in display mode');
        assert(await page.locator('.widget.rich-text-widget .rich-text-inline-edit-button').isVisible(), 'Rich Text display mode should expose a quick Edit button');
        await page.locator('.widget.rich-text-widget .rich-text-inline-edit-button').click();
        assert(await page.locator('.widget.rich-text-widget .rich-text-editor-toolbar').isVisible(), 'Rich Text toolbar should return after quick Edit');
        await closeTeacherPanel(page);
        assert(await page.locator('#widgets-container.layout-edit-mode').count() === 1, 'Closing Teacher Controls should keep widget movement available');
        assert(await page.locator('.widget.rich-text-widget .widget-header').isVisible(), 'The widget grab bar should remain visible after closing Teacher Controls');

        await addWidget(page, 'timer', '.widget.pomodoro-widget', 'Pomodoro');
        await page.waitForTimeout(800);
        assert(await page.locator('#teacher-panel.open').count() === 0, 'Immediate widget movement should not require Teacher Controls');
        const timerWidget = page.locator('.widget.pomodoro-widget');
        assert(await timerWidget.locator('.pomodoro-display > .pomodoro-time').count() === 1, 'Timer should show one clean countdown display');
        assert(await timerWidget.locator('.pomodoro-phase-badge, .pomodoro-rhythm-badge, .pomodoro-actions, .pomodoro-progress, .pomodoro-status').count() === 0, 'Timer canvas card should not repeat controls, badges, progress, or status text');
        assert(await timerWidget.locator('.pomodoro-time').textContent().then((text) => /^\d{2,}:\d{2}$/.test(text.trim())), 'Timer should display countdown time only');
        assert(await timerWidget.locator('.widget-header-title').isHidden(), 'Timer should not spend canvas space on a visible title bar');
        assert(await timerWidget.locator('.pomodoro-display').getAttribute('tabindex') === '0', 'Timer body should remain keyboard reachable as its move handle');
        assert(await timerWidget.locator('.pomodoro-display').evaluate((display) => getComputedStyle(display).cursor === 'grab'), 'Timer body should clearly behave as the drag handle');
        assert(await timerWidget.locator('.widget-header').evaluate((header) => getComputedStyle(header).position === 'absolute'), 'Timer options should float without increasing widget height');
        const timerInlineToggle = timerWidget.locator('.pomodoro-inline-toggle');
        assert(await timerInlineToggle.isVisible(), 'Compact timer should expose a start button inside the widget');
        assert(await timerInlineToggle.getAttribute('aria-label') === 'Start timer', 'Inline timer control should explain that it starts the timer');
        const timerTextBeforeStart = (await timerWidget.locator('.pomodoro-time').textContent()).trim();
        await timerInlineToggle.click();
        assert(await timerInlineToggle.getAttribute('aria-label') === 'Pause timer', 'Inline timer control should become Pause while running');
        await page.waitForFunction((initialText) => {
            const currentText = document.querySelector('.widget.pomodoro-widget .pomodoro-time')?.textContent?.trim();
            return currentText && currentText !== initialText;
        }, timerTextBeforeStart, { timeout: 3000 });
        await timerInlineToggle.click();
        assert(await timerInlineToggle.getAttribute('aria-label') === 'Start timer', 'Inline timer control should return to Start after pausing');
        const timerTextAfterPause = (await timerWidget.locator('.pomodoro-time').textContent()).trim();
        await page.waitForTimeout(1100);
        assert((await timerWidget.locator('.pomodoro-time').textContent()).trim() === timerTextAfterPause, 'Inline Pause should stop the countdown');
        const timerOptionsButton = timerWidget.locator('.widget-header-menu > summary');
        assert(await timerOptionsButton.isVisible(), 'Compact timer should retain its options button');
        await timerOptionsButton.click();
        assert(await timerWidget.locator('.widget-header-menu__popover').isVisible(), 'Compact timer options should still open');
        await timerOptionsButton.press('Escape');
        assert(await timerWidget.locator('.widget-header-menu__popover').isHidden(), 'Compact timer options should close with Escape');
        const timerBoxBeforeDrag = await getElementBox(page, '.widget.pomodoro-widget');
        const classroomCanvasBox = await getElementBox(page, '#widgets-container');
        assert(timerBoxBeforeDrag.width <= classroomCanvasBox.width * 0.22, 'New timer should use only about one fifth of the canvas width');
        assert(timerBoxBeforeDrag.height <= classroomCanvasBox.height * 0.15, 'New timer should use a single compact row of canvas height');
        const timerDragDelta = await page.evaluate(() => {
            const timer = document.querySelector('.widget.pomodoro-widget');
            const canvas = document.querySelector('#widgets-container');
            if (!timer || !canvas) return null;

            const timerRect = timer.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            const otherRects = Array.from(document.querySelectorAll('.widget:not(.pomodoro-widget)'))
                .map((widget) => widget.getBoundingClientRect());
            const gap = 20;

            for (let top = canvasRect.top + 16; top <= canvasRect.bottom - timerRect.height - 16; top += 20) {
                for (let left = canvasRect.left + 16; left <= canvasRect.right - timerRect.width - 16; left += 20) {
                    if (Math.abs(left - timerRect.left) < 20 && Math.abs(top - timerRect.top) < 20) continue;

                    const candidate = {
                        left,
                        top,
                        right: left + timerRect.width,
                        bottom: top + timerRect.height
                    };
                    const overlaps = otherRects.some((rect) => (
                        candidate.left < rect.right + gap
                        && candidate.right + gap > rect.left
                        && candidate.top < rect.bottom + gap
                        && candidate.bottom + gap > rect.top
                    ));
                    if (!overlaps) {
                        return { x: left - timerRect.left, y: top - timerRect.top };
                    }
                }
            }

            return null;
        });
        assert(!!timerDragDelta, 'Timer drag check should find an open position on the classroom canvas');
        await dragElementBy(page, '.widget.pomodoro-widget .pomodoro-display', timerDragDelta.x, timerDragDelta.y);
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

        await page.locator('#teaching-assistant-toggle').click();
        await page.waitForSelector('#teaching-assistant-panel:not([hidden])', { timeout: 10000 });
        assert(await page.locator('#teaching-assistant-panel').isVisible(), 'Teaching Assistant should open as a collapsible classroom panel');
        assert(await page.locator('#teaching-assistant-api-url').inputValue() === '/api/teaching-assistant', 'Teaching Assistant should default to the secure same-origin API route');
        await page.locator('#teaching-assistant-subject').fill('Year 7 Mathematics - equivalent fractions');
        await page.locator('#teaching-assistant-request').fill('Create concise student instructions for the current page.');
        await page.locator('#teaching-assistant-form button[type="submit"]').click();
        await page.waitForSelector('#teaching-assistant-preview .teaching-assistant-preview__header', { timeout: 10000 });
        assert(await page.locator('#teaching-assistant-preview').textContent().then((text) => text.includes('Equivalent Fractions Instructions')), 'Teaching Assistant should show a classroom-ready preview');
        assert(await page.locator('.widget.rich-text-widget').count() === 1, 'Generating a Teaching Assistant preview should not change classroom widgets');
        assert(await page.locator('#teaching-assistant-status').textContent().then((text) => text.includes('Nothing has been added')), 'Teaching Assistant should state that preview generation has not changed the screen');
        await page.locator('#teaching-assistant-add').click();
        await page.waitForFunction(() => document.querySelectorAll('.widget.rich-text-widget').length === 2, { timeout: 10000 });
        const generatedTextWidget = page.locator('.widget.rich-text-widget').last();
        assert(await generatedTextWidget.locator('.rich-text-editor-surface').textContent().then((text) => text.includes('Show that two fractions have the same value')), 'Add to Screen should create the preview through the existing Rich Text widget');
        await page.locator('#teaching-assistant-close').click();
        await generatedTextWidget.locator('.widget-header-menu > summary').dispatchEvent('click');
        await generatedTextWidget.locator('.widget-remove-btn').dispatchEvent('click');
        await page.waitForFunction(() => document.querySelectorAll('.widget.rich-text-widget').length === 1, { timeout: 10000 });

        await page.locator('#teaching-assistant-toggle').click();
        await page.locator('[data-ai-mode="quiz"]').click();
        await page.locator('#quiz-master-type').selectOption('matching');
        await page.locator('#quiz-master-response-mode').selectOption('teams');
        await page.locator('#quiz-master-question-count').fill('3');
        await page.locator('#quiz-master-subject').fill('Year 7 Mathematics - equivalent fractions');
        await page.locator('#quiz-master-form button[type="submit"]').click();
        await page.waitForSelector('#teaching-assistant-preview .quiz-master-preview-question', { timeout: 10000 });
        assert(await page.locator('#teaching-assistant-preview .quiz-master-preview-question').count() === 3, 'Quiz Master should preview the requested number of matching questions');
        assert(await page.locator('.widget.quiz-game-widget').count() === 1, 'Generating a Quiz Master preview should not create a quiz widget');
        await page.locator('#teaching-assistant-add').click();
        await page.waitForFunction(() => document.querySelectorAll('.widget.quiz-game-widget').length === 2, { timeout: 10000 });
        const generatedQuizWidget = page.locator('.widget.quiz-game-widget').last();
        assert(await generatedQuizWidget.locator('.quiz-game-question-number').textContent().then((text) => text.includes('Matching')), 'Add to Screen should load the requested quiz type into the existing Quiz Game widget');
        assert(await generatedQuizWidget.locator('.quiz-game-answer-bank').isVisible(), 'Matching quiz should show a student-facing answer bank before reveal');
        await page.locator('#teaching-assistant-close').click();
        await generatedQuizWidget.locator('button', { hasText: 'Reveal Answer' }).click();
        assert(await generatedQuizWidget.locator('.quiz-game-answer.is-correct').count() >= 1, 'Generated matching quiz should reveal its correct pairs');
        assert(await generatedQuizWidget.locator('.quiz-game-explanation').isVisible(), 'Generated quiz should show explanations when the teacher selected them');
        await generatedQuizWidget.locator('.widget-header-menu > summary').dispatchEvent('click');
        await generatedQuizWidget.locator('.widget-remove-btn').dispatchEvent('click');
        await page.waitForFunction(() => document.querySelectorAll('.widget.quiz-game-widget').length === 1, { timeout: 10000 });

        await addWidget(page, 'reveal-manager', '.widget.reveal-manager-widget', 'Presentation');
        const smokeSlidesWidget = page.locator('.widget.reveal-manager-widget');
        assert(await smokeSlidesWidget.locator('.widget-header-title').textContent().then((text) => text.trim() === 'Presentation'), 'The presentation tool should not compete with classroom Deck terminology');
        assert(await smokeSlidesWidget.locator('.reveal-toggle-controls-btn').textContent().then((text) => text.trim() === 'Choose presentation'), 'A new Presentation should expose one clear starting action');
        assert(!await smokeSlidesWidget.locator('.reveal-launch-btn').isVisible(), 'A new Presentation should not show Open before a source is chosen');
        assert(!await smokeSlidesWidget.locator('.reveal-projector-btn').isVisible(), 'Projector should stay hidden until a presentation is ready');
        await smokeSlidesWidget.locator('.widget-header-menu > summary').click();
        assert(await smokeSlidesWidget.locator('.widget-header-settings-btn').count() === 0, 'Presentation should not duplicate its chooser in Widget Settings');
        assert(await smokeSlidesWidget.locator('.widget-remove-btn').count() === 1, 'Presentation options should retain the essential remove action');
        await smokeSlidesWidget.locator('.widget-header-menu > summary').click();
        await smokeSlidesWidget.locator('.reveal-toggle-controls-btn').click();
        assert(await smokeSlidesWidget.locator('.reveal-manager__panel').isVisible(), 'Choose presentation should open the one canonical chooser');
        assert(await smokeSlidesWidget.locator('.reveal-source-type').inputValue() === 'google-slides', 'The chooser should default to the common Google Slides link path');
        assert(await smokeSlidesWidget.locator('.reveal-external-row').isVisible(), 'The default chooser should show the presentation link input');
        assert(!await smokeSlidesWidget.locator('.reveal-html-row').isVisible(), 'Technical Reveal HTML should stay out of the default path');
        assert(await smokeSlidesWidget.locator('.reveal-convert-btn').textContent().then((text) => text.trim() === 'Choose PowerPoint or PDF'), 'The file route should say exactly what it opens');
        assert(!await smokeSlidesWidget.locator('.reveal-saved-section').isVisible(), 'Saved presentations should stay hidden when none exist');
        const presentationChooserPolish = await smokeSlidesWidget.evaluate((widget) => {
            const section = widget.querySelector('.reveal-manager__open-section');
            const sectionRect = section?.getBoundingClientRect();
            const visibleFields = Array.from(section?.querySelectorAll('select, input:not([type="file"]), textarea') || [])
                .filter((control) => control.getClientRects().length > 0);
            const actionButtons = Array.from(section?.querySelectorAll('.reveal-manager-actions button') || [])
                .filter((button) => button.getClientRects().length > 0);
            const primary = section?.querySelector('.reveal-open-input-btn');
            const secondary = section?.querySelector('.reveal-convert-btn');
            const save = section?.querySelector('.reveal-save-btn');
            const primaryStyle = primary ? getComputedStyle(primary) : null;
            const secondaryStyle = secondary ? getComputedStyle(secondary) : null;
            const saveStyle = save ? getComputedStyle(save) : null;
            const controls = [...visibleFields, ...actionButtons];
            return {
                semanticSection: section?.tagName === 'SECTION'
                    && section.querySelector('.reveal-manager__section-title')?.textContent.trim() === 'Open presentation',
                visibleFieldsLabelled: visibleFields.length === 3
                    && visibleFields.every((control) => control.closest('label')?.querySelector('.reveal-field-label')),
                liveValidation: section?.querySelector('.reveal-external-validation')?.getAttribute('role') === 'status'
                    && section.querySelector('.reveal-external-validation')?.getAttribute('aria-live') === 'polite',
                noHorizontalOverflow: !!section && section.scrollWidth <= section.clientWidth + 1,
                controlsFit: !!sectionRect && controls.every((control) => {
                    const rect = control.getBoundingClientRect();
                    return rect.left >= sectionRect.left - 1 && rect.right <= sectionRect.right + 1;
                }),
                readableFields: visibleFields.every((control) => {
                    const style = getComputedStyle(control);
                    const fontSize = Number.parseFloat(style.fontSize);
                    return control.getBoundingClientRect().height >= 38 && fontSize >= 13 && fontSize <= 17;
                }),
                touchFriendlyActions: actionButtons.every((button) => button.getBoundingClientRect().height >= 38),
                clearActionHierarchy: !!primaryStyle
                    && !!secondaryStyle
                    && primaryStyle.backgroundImage !== 'none'
                    && primaryStyle.backgroundImage !== secondaryStyle.backgroundImage
                    && primaryStyle.color === 'rgb(255, 255, 255)'
                    && saveStyle?.boxShadow === 'none'
            };
        });
        assert(presentationChooserPolish.semanticSection && presentationChooserPolish.visibleFieldsLabelled && presentationChooserPolish.liveValidation, 'Presentation chooser should use a clear labelled form hierarchy');
        assert(presentationChooserPolish.noHorizontalOverflow && presentationChooserPolish.controlsFit, 'Presentation chooser controls should stay inside the polished card');
        assert(presentationChooserPolish.readableFields && presentationChooserPolish.touchFriendlyActions && presentationChooserPolish.clearActionHierarchy, 'Presentation chooser should keep readable fields and one clear primary action');
        await smokeSlidesWidget.locator('.reveal-external-url').fill('https://docs.google.com/presentation/d/1NOf1lzIqOJNSCcSIKxhKGbBgrZ3TkBZDJ8peCLPgFLo/edit?usp=sharing');
        const presentationWarningLayout = await smokeSlidesWidget.locator('.reveal-external-validation').evaluate((warning) => {
            const section = warning.closest('.reveal-manager__open-section');
            const warningRect = warning.getBoundingClientRect();
            const sectionRect = section?.getBoundingClientRect();
            return {
                visible: !warning.hidden && getComputedStyle(warning).display !== 'none',
                wrapsCleanly: warning.scrollWidth <= warning.clientWidth + 1,
                fitsCard: !!sectionRect && warningRect.left >= sectionRect.left - 1 && warningRect.right <= sectionRect.right + 1,
                compactText: Number.parseFloat(getComputedStyle(warning).fontSize) <= 14
            };
        });
        assert(presentationWarningLayout.visible && presentationWarningLayout.wrapsCleanly && presentationWarningLayout.fitsCard && presentationWarningLayout.compactText, 'Presentation link advice should stay compact and contained');
        await smokeSlidesWidget.locator('.reveal-source-type').selectOption('html');
        assert(await smokeSlidesWidget.locator('.reveal-html-row').isVisible(), 'Reveal HTML should remain available as an advanced source');
        assert(!await smokeSlidesWidget.locator('.reveal-external-row').isVisible(), 'Reveal HTML should hide the presentation link input');

        await smokeSlidesWidget.locator('.reveal-deck-name').fill('Smoke Reveal Deck');
        await page.evaluate(() => { window.__slidesSanitizerProbe = 0; });
        await smokeSlidesWidget.locator('.reveal-content-textarea').fill('<section data-transition="fade" style="background-color: #fff; position: relative" onclick="window.__slidesSanitizerProbe=2"><h2>Smoke Slide</h2><p>Deck content</p><img alt="probe" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" onload="window.__slidesSanitizerProbe=1"><a href="javascript:window.__slidesSanitizerProbe=3">Unsafe</a><script>window.__slidesSanitizerProbe=4</script></section>');
        await smokeSlidesWidget.locator('.reveal-open-input-btn').click();
        await page.waitForSelector('.widget.reveal-manager-widget .reveal-inline-deck .slides section', { timeout: 10000 });
        assert(!await smokeSlidesWidget.locator('.reveal-manager__panel').isVisible(), 'Opening a presentation should collapse the chooser');
        assert(await smokeSlidesWidget.locator('.reveal-launch-btn').textContent().then((text) => text.trim() === 'Close'), 'A loaded presentation should expose Close instead of a second Open route');
        assert(await smokeSlidesWidget.locator('.reveal-projector-btn').isVisible(), 'A loaded presentation should expose Show on projector');
        assert(await smokeSlidesWidget.locator('.reveal-toggle-controls-btn').textContent().then((text) => text.trim() === 'Change presentation'), 'A loaded presentation should expose one clear change route');
        await page.waitForFunction(() => {
            const status = document.querySelector('.widget.reveal-manager-widget .reveal-presenter-status');
            return status && /Unable to load Reveal deck/i.test(status.textContent || '');
        }, undefined, { timeout: 10000 });
        assert(await smokeSlidesWidget.locator('.reveal-presenter-status').textContent().then((text) => /Unable to load Reveal deck/i.test(text)), 'Slides should fail gracefully when Reveal.js is unavailable');
        const sanitizedSlidesState = await smokeSlidesWidget.evaluate((widget) => {
            const section = widget.querySelector('.reveal-inline-deck .slides section');
            const image = section?.querySelector('img');
            const unsafeLink = section?.querySelector('a');
            return {
                probe: window.__slidesSanitizerProbe,
                scriptCount: section?.querySelectorAll('script').length || 0,
                sectionHandler: section?.getAttribute('onclick') || '',
                imageHandler: image?.getAttribute('onload') || '',
                linkHref: unsafeLink?.getAttribute('href') || '',
                transition: section?.getAttribute('data-transition') || '',
                backgroundColour: section?.style.backgroundColor || ''
            };
        });
        assert(sanitizedSlidesState.probe === 0, 'Slides should never execute pasted event handlers or scripts');
        assert(sanitizedSlidesState.scriptCount === 0 && !sanitizedSlidesState.sectionHandler && !sanitizedSlidesState.imageHandler, 'Slides should remove executable markup before mounting a pasted deck');
        assert(!sanitizedSlidesState.linkHref && sanitizedSlidesState.transition === 'fade' && sanitizedSlidesState.backgroundColour, 'Slides should keep safe Reveal formatting while removing unsafe links');

        const slidesKeyboardIsolation = await page.evaluate(() => {
            const slidesWidget = document.querySelector('.widget.reveal-manager-widget');
            const slidesButton = slidesWidget?.querySelector('.reveal-launch-btn');
            const projectNameInput = document.querySelector('#project-screen-name-input');
            slidesButton?.focus();
            const activeBeforeTyping = window.RevealManagerWidget?.activeInstance?.element === slidesWidget?.querySelector('.reveal-manager-widget-content');
            projectNameInput?.focus();
            const arrowEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
            projectNameInput?.dispatchEvent(arrowEvent);
            slidesButton?.focus();
            const activeBeforeOutsidePointer = window.RevealManagerWidget?.activeInstance?.element === slidesWidget?.querySelector('.reveal-manager-widget-content');
            projectNameInput?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            return {
                activeBeforeTyping,
                arrowPrevented: arrowEvent.defaultPrevented,
                activeBeforeOutsidePointer,
                clearedAfterOutsidePointer: window.RevealManagerWidget?.activeInstance === null
            };
        });
        assert(slidesKeyboardIsolation.activeBeforeTyping && !slidesKeyboardIsolation.arrowPrevented, 'Slides should leave arrow keys alone while typing in another field');
        assert(slidesKeyboardIsolation.activeBeforeOutsidePointer && slidesKeyboardIsolation.clearedAfterOutsidePointer, 'Slides should release keyboard ownership when the teacher clicks elsewhere');

        await page.locator('#main-page-next').focus();
        await smokeSlidesWidget.locator('.reveal-launch-btn').focus();
        const teacherSlidesVisibilityResume = await page.evaluate(async () => {
            const widget = window.RevealManagerWidget?.activeInstance;
            if (!widget) throw new Error('Slides widget instance was not active for visibility checks');
            const revealSurface = widget.inlineDeckContainer.querySelector('.reveal');
            const originalRenderActiveDeck = widget.renderActiveDeck;
            let rebuildCount = 0;
            widget.renderActiveDeck = async () => {
                rebuildCount += 1;
                return null;
            };
            try {
                widget.handleDocumentVisibilityChange();
                await new Promise((resolve) => setTimeout(resolve, 250));
            } finally {
                widget.renderActiveDeck = originalRenderActiveDeck;
            }
            return {
                rebuildCount,
                sameSurface: revealSurface === widget.inlineDeckContainer.querySelector('.reveal')
            };
        });
        assert(teacherSlidesVisibilityResume.rebuildCount === 0 && teacherSlidesVisibilityResume.sameSurface, 'Teacher Slides should not rebuild when the browser tab becomes visible again');

        const externalSlidesVisibilityResume = await page.evaluate(async () => {
            const previousActive = window.RevealManagerWidget.activeInstance;
            const widget = new window.RevealManagerWidget();
            widget.persistActiveDeckState = () => {};
            widget.activeDeck = {
                id: Date.now(),
                name: 'External visibility check',
                type: 'google-slides',
                sourceUrl: 'https://docs.google.com/presentation/d/visibility-check/edit'
            };
            widget.renderExternalDeckScaffold(widget.activeDeck);
            const externalSurface = widget.inlineDeckContainer.firstElementChild;
            const originalRenderActiveDeck = widget.renderActiveDeck;
            let rebuildCount = 0;
            widget.renderActiveDeck = async () => {
                rebuildCount += 1;
                return null;
            };
            try {
                widget.handleDocumentVisibilityChange();
                await new Promise((resolve) => setTimeout(resolve, 250));
                return {
                    rebuildCount,
                    sameSurface: externalSurface === widget.inlineDeckContainer.firstElementChild
                };
            } finally {
                widget.renderActiveDeck = originalRenderActiveDeck;
                widget.remove();
                window.RevealManagerWidget.activeInstance = previousActive;
            }
        });
        assert(externalSlidesVisibilityResume.rebuildCount === 0 && externalSlidesVisibilityResume.sameSurface, 'Embedded Slides should keep the same frame when the browser tab becomes visible again');

        const originalSlidesSize = await smokeSlidesWidget.evaluate((widget) => ({
            width: widget.style.width,
            height: widget.style.height
        }));
        await smokeSlidesWidget.evaluate((widget) => {
            widget.style.width = '140px';
            widget.style.height = '460px';
        });
        await page.waitForFunction(() => {
            const widget = document.querySelector('.widget.reveal-manager-widget');
            const topbar = widget?.querySelector('.reveal-manager__topbar');
            return widget?.getBoundingClientRect().width <= 141 && topbar && topbar.scrollWidth <= topbar.clientWidth + 1;
        }, undefined, { timeout: 10000 });
        const narrowSlidesLayout = await smokeSlidesWidget.evaluate((widget) => {
            const topbar = widget.querySelector('.reveal-manager__topbar');
            const topbarRect = topbar?.getBoundingClientRect();
            const buttons = Array.from(topbar?.querySelectorAll('button') || []);
            return {
                noHorizontalScroll: !!topbar && topbar.scrollWidth <= topbar.clientWidth + 1,
                buttonsFit: !!topbarRect && buttons.every((button) => {
                    const rect = button.getBoundingClientRect();
                    return rect.left >= topbarRect.left - 1 && rect.right <= topbarRect.right + 1;
                })
            };
        });
        assert(narrowSlidesLayout.noHorizontalScroll && narrowSlidesLayout.buttonsFit, 'Slides controls should remain visible without sideways scrolling in a narrow widget');
        await smokeSlidesWidget.locator('.reveal-toggle-controls-btn').click();
        assert(await smokeSlidesWidget.locator('.reveal-manager-widget-content').evaluate((content) => (
            getComputedStyle(content).overflowY === 'auto' && content.scrollHeight > content.clientHeight
        )), 'Narrow Slides setup should scroll vertically when it is taller than the widget');
        const narrowPresentationChooser = await smokeSlidesWidget.evaluate((widget) => {
            const content = widget.querySelector('.reveal-manager-widget-content');
            const section = widget.querySelector('.reveal-manager__open-section');
            const sectionRect = section?.getBoundingClientRect();
            const controls = Array.from(section?.querySelectorAll('select, input:not([type="file"]), textarea, button') || [])
                .filter((control) => control.getClientRects().length > 0);
            return {
                noHorizontalOverflow: !!content
                    && !!section
                    && content.scrollWidth <= content.clientWidth + 1
                    && section.scrollWidth <= section.clientWidth + 1,
                controlsFit: !!sectionRect && controls.every((control) => {
                    const rect = control.getBoundingClientRect();
                    return rect.left >= sectionRect.left - 1 && rect.right <= sectionRect.right + 1;
                })
            };
        });
        assert(narrowPresentationChooser.noHorizontalOverflow && narrowPresentationChooser.controlsFit, 'Narrow Presentation chooser should keep every field and action inside the widget');
        await smokeSlidesWidget.locator('.reveal-toggle-controls-btn').click();
        await smokeSlidesWidget.evaluate((widget, originalSize) => {
            widget.style.width = originalSize.width;
            widget.style.height = originalSize.height;
        }, originalSlidesSize);

        const slidesStorageFailure = await page.evaluate(() => {
            const storagePrototype = Storage.prototype;
            const originalSetItem = storagePrototype.setItem;
            const widget = new window.RevealManagerWidget();
            storagePrototype.setItem = function setItemWithQuotaFailure(key, value) {
                if (key === 'revealDecks') {
                    const error = new Error('Storage is full');
                    error.name = 'QuotaExceededError';
                    throw error;
                }
                return originalSetItem.call(this, key, value);
            };
            let saved;
            try {
                saved = widget.saveDecks([{ id: 'too-large', name: 'Too large', html: '<section>Large</section>' }]);
            } finally {
                storagePrototype.setItem = originalSetItem;
            }
            const status = widget.statusLabel.textContent || '';
            widget.remove();
            return { saved, status };
        });
        assert(slidesStorageFailure.saved === false && /too large/i.test(slidesStorageFailure.status), 'Slides should explain when a PDF or PowerPoint deck is too large to save');

        await smokeSlidesWidget.locator('.reveal-launch-btn').focus();
        const storedSlidesDeck = await page.evaluate(async () => {
            const widget = window.RevealManagerWidget?.activeInstance;
            if (!widget) throw new Error('Slides widget instance was not active');
            await widget.stopDeck();

            const deckId = Date.now();
            const storageId = widget.createImportedDeckStorageId(deckId);
            const assetId = `${storageId}-smoke-image`;
            const imageBytes = Uint8Array.from(
                atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),
                (character) => character.charCodeAt(0)
            );
            const imageBlob = new Blob([imageBytes, new Uint8Array(6 * 1024 * 1024)], { type: 'image/gif' });
            const preparedDeck = widget.buildRevealDeckFromImportedSlides({
                id: deckId,
                name: 'Stored Slides Smoke Deck',
                storageId,
                sourceFormat: 'pdf',
                sourceName: 'stored-slides-smoke.pdf',
                sourceSize: imageBlob.size,
                slides: [`<section><h2>Stored slide asset</h2><img data-slide-asset-id="${assetId}" alt="Stored smoke image"></section>`]
            });
            const deckReference = await widget.persistImportedDeck(preparedDeck, [{
                id: assetId,
                blob: imageBlob,
                mimeType: imageBlob.type,
                alt: 'Stored smoke image'
            }]);
            const savedDecks = widget.getSavedDecks().filter((deck) => Number(deck?.id) !== deckId);
            savedDecks.push(deckReference);
            if (!widget.saveDecks(savedDecks)) throw new Error('Stored Slides smoke deck metadata was not saved');

            widget.renderSavedDeckOptions();
            widget.savedSelect.value = String(deckId);
            widget.deckNameInput.value = deckReference.name;
            widget.sourceTypeSelect.value = 'html';
            widget.htmlInput.value = '';
            await widget.launchDeck(deckReference, { preserveIndices: false });
            widget.persistActiveDeckState();

            const storedRecord = await window.TeacherScreenDocumentStore.loadSlideDeck(storageId);
            const storedAssets = await window.TeacherScreenDocumentStore.loadSlideAssets(storageId);
            const serialized = widget.serialize();
            const localDecksText = localStorage.getItem(widget.storageKey) || '';
            return {
                deckId,
                storageId,
                localDecksText,
                storedRecordUsesAssetReference: storedRecord?.content?.includes('data-slide-asset-id') === true,
                storedAssetCount: storedAssets.length,
                storedAssetIsBlob: storedAssets[0]?.blob instanceof Blob,
                storedAssetBytes: storedAssets[0]?.blob?.size || 0,
                serializedStorageId: serialized.activeDeck?.storageId || '',
                serializedContent: serialized.activeDeck?.content || '',
                runtimeImageSource: widget.inlineDeckContainer.querySelector('img')?.src || '',
                htmlInputDisabled: widget.htmlInput.disabled
            };
        });
        assert(!storedSlidesDeck.localDecksText.includes('data:image') && !storedSlidesDeck.localDecksText.includes('Stored slide asset'), 'Imported Slides metadata should stay small instead of embedding image or slide content in localStorage');
        assert(storedSlidesDeck.storedRecordUsesAssetReference && storedSlidesDeck.storedAssetCount === 1 && storedSlidesDeck.storedAssetIsBlob && storedSlidesDeck.storedAssetBytes > 5 * 1024 * 1024, 'Imported Slides should store a deck larger than localStorage as a real image Blob in IndexedDB');
        assert(storedSlidesDeck.serializedStorageId === storedSlidesDeck.storageId && !storedSlidesDeck.serializedContent, 'Classroom state should serialize only the imported deck storage reference');
        assert(storedSlidesDeck.runtimeImageSource.startsWith('blob:') && storedSlidesDeck.htmlInputDisabled, 'Stored Slides should restore a runtime image without exposing temporary asset HTML for editing');
        await page.waitForFunction((storageId) => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            const layouts = [state.layout, ...(Array.isArray(state.pages) ? state.pages.map((pageState) => pageState?.snapshot?.layout) : [])];
            return layouts.some((layout) => layout?.widgets?.some((widget) => (
                widget?.type === 'RevealManagerWidget'
                && widget?.data?.activeDeck?.storageId === storageId
                && !widget?.data?.activeDeck?.content
            )));
        }, storedSlidesDeck.storageId, { timeout: 10000 });
        assert(true, 'Classroom persistence should keep only the imported Slides storage reference');

        await smokeSlidesWidget.locator('.reveal-deck-file-input').setInputFiles({
            name: 'stored-import-smoke.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7\nSlides import smoke fixture')
        });
        await page.waitForFunction(() => {
            const widget = window.RevealManagerWidget?.activeInstance;
            return widget?.activeDeck?.sourceName === 'stored-import-smoke.pdf'
                && widget.inlineDeckContainer.querySelectorAll('img[src^="blob:"]').length === 2;
        }, { timeout: 15000 });
        const importedPdfDeck = await page.evaluate(async () => {
            const widget = window.RevealManagerWidget?.activeInstance;
            if (!widget?.activeDeck?.storageId) throw new Error('Imported PDF deck did not receive a storage reference');
            const reference = widget.getPersistentDeckReference(widget.activeDeck);
            const storedRecord = await window.TeacherScreenDocumentStore.loadSlideDeck(reference.storageId);
            const storedAssets = await window.TeacherScreenDocumentStore.loadSlideAssets(reference.storageId);
            return {
                deckId: reference.id,
                storageId: reference.storageId,
                localDecksText: localStorage.getItem(widget.storageKey) || '',
                storedAssetCount: storedAssets.length,
                allAssetsAreBlobs: storedAssets.every((asset) => asset.blob instanceof Blob),
                manifestUsesReferences: (storedRecord?.content?.match(/data-slide-asset-id/g) || []).length === 2,
                runtimeImageCount: widget.inlineDeckContainer.querySelectorAll('img[src^="blob:"]').length,
                serializedContent: widget.serialize().activeDeck?.content || ''
            };
        });
        assert(importedPdfDeck.storedAssetCount === 2 && importedPdfDeck.allAssetsAreBlobs && importedPdfDeck.manifestUsesReferences, 'PDF import should convert each page into a separately stored image Blob');
        assert(importedPdfDeck.runtimeImageCount === 2 && !importedPdfDeck.serializedContent && !importedPdfDeck.localDecksText.includes('data:image'), 'PDF import should render from Blob URLs while keeping saved classroom data lightweight');

        const importedPptxDeck = await page.evaluate(async () => {
            const widget = window.RevealManagerWidget?.activeInstance;
            if (!widget) throw new Error('Slides widget instance was not active for PowerPoint import');
            const originalJsZip = window.JSZip;
            const presentationXml = '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>';
            const presentationRels = '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>';
            const slideXml = '<p:sld xmlns:p="urn:p" xmlns:a="urn:a" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Stored PowerPoint</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rIdImg1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>';
            const slideRels = '<Relationships><Relationship Id="rIdImg1" Target="../media/image1.gif"/></Relationships>';
            const imageBytes = Uint8Array.from(
                atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),
                (character) => character.charCodeAt(0)
            );
            const entries = {
                'ppt/presentation.xml': { async: async () => presentationXml },
                'ppt/_rels/presentation.xml.rels': { async: async () => presentationRels },
                'ppt/slides/slide1.xml': { async: async () => slideXml },
                'ppt/slides/_rels/slide1.xml.rels': { async: async () => slideRels },
                'ppt/media/image1.gif': { async: async () => new Blob([imageBytes], { type: 'image/gif' }) }
            };
            const fakeZip = {
                files: Object.fromEntries(Object.keys(entries).map((name) => [name, {}])),
                file: (name) => entries[String(name || '').replace(/\\/g, '/')] || null
            };
            window.JSZip = { loadAsync: async () => fakeZip };

            let deckReference;
            try {
                deckReference = await widget.importDeckFile(new File(
                    [new Uint8Array([80, 75, 3, 4])],
                    'stored-import-smoke.pptx',
                    { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
                ));
            } finally {
                window.JSZip = originalJsZip;
            }
            if (!deckReference?.storageId) throw new Error('Imported PowerPoint deck did not receive a storage reference');
            const storedRecord = await window.TeacherScreenDocumentStore.loadSlideDeck(deckReference.storageId);
            const storedAssets = await window.TeacherScreenDocumentStore.loadSlideAssets(deckReference.storageId);
            return {
                deckId: deckReference.id,
                storageId: deckReference.storageId,
                storedAssetCount: storedAssets.length,
                storedAssetIsBlob: storedAssets[0]?.blob instanceof Blob,
                manifestHasText: storedRecord?.content?.includes('Stored PowerPoint') === true,
                manifestUsesAssetReference: storedRecord?.content?.includes('data-slide-asset-id') === true,
                runtimeHasText: widget.inlineDeckContainer.textContent.includes('Stored PowerPoint'),
                runtimeImageCount: widget.inlineDeckContainer.querySelectorAll('img[src^="blob:"]').length,
                serializedContent: widget.serialize().activeDeck?.content || ''
            };
        });
        assert(importedPptxDeck.storedAssetCount === 1 && importedPptxDeck.storedAssetIsBlob && importedPptxDeck.manifestHasText && importedPptxDeck.manifestUsesAssetReference, 'PowerPoint import should store extracted text and image files without base64 content');
        assert(
            importedPptxDeck.runtimeHasText && importedPptxDeck.runtimeImageCount === 1 && !importedPptxDeck.serializedContent,
            `PowerPoint import should render from its stored manifest while classroom state remains lightweight (${JSON.stringify(importedPptxDeck)})`
        );

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

        await closeTeacherPanel(page);
        const mainPageNext = page.locator('#main-page-next');
        assert(await page.locator('#main-page-add').count() === 0, 'The classroom page strip should not use a separate Add page button');
        assert(await mainPageNext.getAttribute('aria-label') === 'Add page', 'The final-page next arrow should identify its Add page action');
        assert(await mainPageNext.isEnabled(), 'The final-page next arrow should remain available to add a page');
        await mainPageNext.click();
        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state && Array.isArray(state.pages) && state.pages.length >= 2;
        }, { timeout: 10000 });
        await waitForWidgetCount(page, 0, 'New deck page should start blank');
        assert(behaviourControls.isClosed(), 'Changing deck pages should close the old private behaviour controls');
        assert(await page.locator('.widget-placeholder').textContent().then((text) => text.trim() === ''), 'New blank page should not show instructional placeholder text');

        await openTeacherPanel(page);
        await page.locator('#teacher-page-switcher [data-page-id]').first().click();
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.drawing-tool-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.quiz-game-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.reveal-manager-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.reveal-manager-widget .reveal-inline-deck img[src^="blob:"]', { timeout: 10000 });
        await page.waitForSelector('.widget.url-viewer-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.notes-widget', { timeout: 10000 });
        await waitForWidgetCount(page, 8, 'Switching back to deck page one should restore its widgets');

        await closeTeacherPanel(page);
        assert(await mainPageNext.getAttribute('aria-label') === 'Next page', 'The next arrow should identify its navigation action when another page exists');
        await mainPageNext.click();
        await page.waitForFunction(
            () => document.getElementById('main-page-current')?.textContent.trim() === 'Page 2',
            undefined,
            { timeout: 10000 }
        );
        const pageCountAfterNextNavigation = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return Array.isArray(state.pages) ? state.pages.length : 0;
        });
        assert(pageCountAfterNextNavigation === 2, 'The next arrow should navigate to an existing page without creating another page');

        const mainPageCurrent = page.locator('#main-page-current');
        assert((await mainPageCurrent.getAttribute('aria-label'))?.includes('Manage or delete this page'), 'The page number should identify its page-management action');
        await mainPageCurrent.click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });
        assert(await page.locator('.project-page-advanced').getAttribute('open') !== null, 'The page number should reveal the current page actions');
        assert(await page.locator('#delete-page-btn').isVisible(), 'The revealed page actions should include Delete Page');

        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#delete-page-btn').click();
        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return document.getElementById('main-page-current')?.textContent.trim() === 'Page 1'
                && Array.isArray(state.pages)
                && state.pages.length === 1;
        }, undefined, { timeout: 10000 });
        await closeTeacherPanel(page);
        await page.waitForFunction(
            () => document.getElementById('main-page-current')?.textContent.trim() === 'Page 1',
            undefined,
            { timeout: 10000 }
        );
        await waitForWidgetCount(page, 8, 'Deleting page two should restore page one and its widgets');

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
        await page.waitForSelector('.widget.reveal-manager-widget .reveal-inline-deck img[src^="blob:"]', { timeout: 10000 });
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
        const smokeDeckId = await page.evaluate((name) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return presets.find((preset) => preset?.name === name)?.id || '';
        }, smokeScreenName);
        assert(smokeDeckId, 'Named classroom deck should receive a stable ID');
        assert(true, 'Named classroom deck should save');

        await page.evaluate(() => {
            localStorage.removeItem('classroomScreenState');
            localStorage.removeItem('classroomScreenState.backup1');
            localStorage.removeItem('classroomScreenState.backup2');
            localStorage.removeItem('classroomScreenState.backup3');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        const smokeDeckCard = page.locator(`.dashboard-screen-card[data-deck-id="${smokeDeckId}"]`);
        const smokeDeckToggle = smokeDeckCard.locator('[data-deck-action="toggle"]');
        if (await smokeDeckToggle.getAttribute('aria-expanded') !== 'true') {
            await smokeDeckToggle.click();
        }
        await smokeDeckCard.locator('[data-deck-action="open"]').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        await page.waitForSelector('.widget.rich-text-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.drawing-tool-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.quiz-game-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.reveal-manager-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.reveal-manager-widget .reveal-inline-deck img[src^="blob:"]', { timeout: 10000 });
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
        assert(await page.locator('.widget.reveal-manager-widget .reveal-inline-deck img[src^="blob:"]').count() === 1, 'Saved deck should restore imported Slides from IndexedDB without re-uploading');
        assert(await page.locator('.widget.behaviour-tracker-widget').textContent().then((text) => !text.includes('Alex') && !text.includes('Bailey')), 'Saved deck should keep names off the classroom canvas');

        await page.locator('#dashboard-tab').dispatchEvent('click');
        await page.waitForSelector('#dashboard-view:not([hidden])', { timeout: 10000 });
        assert(await page.locator(`.dashboard-screen-card.is-current[data-deck-id="${smokeDeckId}"] .dashboard-current-badge`).count() === 1, 'Dashboard should identify the loaded current deck');
        await page.locator('#dashboard-search-input').click();
        await page.keyboard.type('year');
        assert(await page.locator('#dashboard-search-input').inputValue() === 'year', 'Dashboard deck search should accept continuous typing without losing characters');
        assert(await page.locator('#dashboard-search-input').evaluate((element) => document.activeElement === element), 'Dashboard deck search should keep keyboard focus while filtering');
        await page.locator('#dashboard-search-input').fill('');
        await page.locator('[data-dashboard-mode="recent"]').click();
        assert(await page.locator(`.dashboard-screen-card.is-current[data-deck-id="${smokeDeckId}"]`).count() === 1, 'Recent should show a lesson deck after it has been opened');
        await page.locator('[data-dashboard-mode="library"]').click();
        await page.locator('.dashboard-screen-card.is-current [data-deck-action="toggle"]').click();
        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });

        const projectorPage = await context.newPage();
        const projectorWarnings = [];
        projectorPage.on('console', (message) => {
            if (message.type() === 'warning') projectorWarnings.push(message.text());
        });
        await projectorPage.goto(await getPairedProjectorUrl(page, baseUrl), { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForSelector('.widget.rich-text-widget', { timeout: 15000 });
        await projectorPage.waitForSelector('.widget.pomodoro-widget', { timeout: 15000 });
        await projectorPage.waitForSelector('.widget.behaviour-tracker-widget', { timeout: 15000 });
        try {
            await projectorPage.waitForSelector('.widget.reveal-manager-widget [data-reveal-presentation-root]:has(img[src^="blob:"])', { timeout: 25000 });
        } catch (error) {
            const projectorEvidence = await projectorPage.evaluate(async () => {
                const app = window.__TeacherScreenProjectorApp;
                const store = window.TeacherScreenDocumentStore;
                const savedState = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
                const savedPresentation = savedState.layout?.widgets?.find((widget) => widget.type === 'RevealManagerWidget')?.data?.activeDeck || null;
                const widgets = app?.getRevealWidgets?.() || [];
                const widgetEvidence = await Promise.all(widgets.map(async (widget) => {
                    const storageId = String(widget.activeDeck?.storageId || '');
                    const storedDeck = storageId ? await store?.loadSlideDeck?.(storageId) : null;
                    const storedAssets = storageId ? await store?.loadSlideAssets?.(storageId) : [];
                    return {
                        connected: widget.element?.isConnected === true,
                        inlineConnected: widget.inlineDeckContainer?.isConnected === true,
                        appMode: widget.appMode,
                        teacherMode: widget.isTeacherMode?.(),
                        storageId,
                        activeName: widget.activeDeck?.name || '',
                        activeContentLength: String(widget.activeDeck?.content || '').length,
                        hasRenderPromise: Boolean(widget.renderPromise),
                        hasRevealDeck: Boolean(widget.revealDeck),
                        inlineChildCount: widget.inlineDeckContainer?.childElementCount || 0,
                        inlineBlobImageCount: widget.inlineDeckContainer?.querySelectorAll('img[src^="blob:"]').length || 0,
                        status: widget.statusLabel?.textContent || '',
                        storedDeckReady: storedDeck?.content?.includes('Stored PowerPoint') === true,
                        storedAssetCount: Array.isArray(storedAssets) ? storedAssets.length : -1,
                        storedAssetIsBlob: storedAssets?.[0]?.blob instanceof Blob
                    };
                }));
                return {
                    presentationWidgetCount: widgets.length,
                    inlineRootCount: document.querySelectorAll('[data-reveal-presentation-root]').length,
                    topLevelPresentationHtml: document.querySelector('body > #presentation-root')?.innerHTML || '',
                    savedPresentation,
                    widgetEvidence,
                    dependencyFailures: window.__ProjectorDependencyFailures || []
                };
            });
            throw new Error(`Projector PowerPoint restore did not settle (${JSON.stringify(projectorEvidence)}; warnings=${JSON.stringify(projectorWarnings.slice(-10))})`);
        }
        assert(await projectorPage.locator('.widget.rich-text-widget').count() === 1, 'Projector should render the quick Rich Text widget');
        assert(await projectorPage.locator('.widget.pomodoro-widget').count() === 1, 'Projector should render the saved Pomodoro widget');
        assert(await projectorPage.locator('.widget.drawing-tool-widget').count() === 1, 'Projector should render the saved Drawing Tool widget');
        const publicTracker = projectorPage.locator('.widget.behaviour-tracker-widget');
        assert(await publicTracker.locator('.behaviour-tracker-widget-content[data-mode="public"]').count() === 1, 'Projector should render the aggregate class tracker view');
        assert(await publicTracker.locator('.behaviour-timer-value').textContent().then((text) => text.trim() !== '00:00'), 'Projector should show the saved class lost-time total');
        assert(await publicTracker.locator('.behaviour-student-name').count() === 0, 'Projector tracker should not render student-name controls');
        assert(await publicTracker.textContent().then((text) => !text.includes('Alex') && !text.includes('Bailey')), 'Projector tracker should keep individual names private');
        const projectorPresentation = projectorPage.locator('.widget.reveal-manager-widget [data-reveal-presentation-root]');
        assert(await projectorPresentation.textContent().then((text) => text.includes('Stored PowerPoint')), 'Projector should restore imported PowerPoint text from the shared local document store');
        assert(await projectorPresentation.locator('img[src^="blob:"]').count() === 1, 'Projector should restore imported PowerPoint images from the shared local document store');
        const projectorSlidesVisibilityResume = await projectorPage.evaluate(async () => {
            const widget = window.__TeacherScreenProjectorApp?.getRevealWidgets?.()[0];
            if (!widget) throw new Error('Projector Slides widget was not available for visibility checks');
            const revealSurface = widget.inlineDeckContainer.querySelector('.reveal');
            const originalRenderActiveDeck = widget.renderActiveDeck;
            let rebuildCount = 0;
            widget.renderActiveDeck = async () => {
                rebuildCount += 1;
                return null;
            };
            try {
                widget.handleDocumentVisibilityChange();
                await new Promise((resolve) => setTimeout(resolve, 250));
            } finally {
                widget.renderActiveDeck = originalRenderActiveDeck;
            }
            return {
                rebuildCount,
                sameSurface: revealSurface === widget.inlineDeckContainer.querySelector('.reveal')
            };
        });
        assert(projectorSlidesVisibilityResume.rebuildCount === 0 && projectorSlidesVisibilityResume.sameSurface, 'Projector Slides should not rebuild when the browser tab becomes visible again');
        await projectorPage.close();

        await page.locator('.widget.reveal-manager-widget .reveal-launch-btn').focus();
        const deletedStoredSlides = await page.evaluate(async (deckId) => {
            const widget = window.RevealManagerWidget?.activeInstance;
            if (!widget) throw new Error('Slides widget instance was not active for deletion');
            const deck = widget.getSavedDeckById(deckId);
            const storageId = deck?.storageId || '';
            const deleted = await widget.deleteSavedDeckById(deckId);
            const storedRecord = storageId ? await window.TeacherScreenDocumentStore.loadSlideDeck(storageId) : null;
            const storedAssets = storageId ? await window.TeacherScreenDocumentStore.loadSlideAssets(storageId) : [];
            const lastDeck = widget.getLastDeck();
            return {
                deleted,
                storedRecord,
                storedAssetCount: storedAssets.length,
                lastDeckStillReferencesDeletedStorage: lastDeck?.storageId === storageId
            };
        }, storedSlidesDeck.deckId);
        assert(deletedStoredSlides.deleted && !deletedStoredSlides.storedRecord && deletedStoredSlides.storedAssetCount === 0, 'Deleting an imported Slides deck should remove its manifest and image files');

        await page.locator('.widget.reveal-manager-widget .reveal-launch-btn').focus();
        const deletedImportedPdf = await page.evaluate(async (deckId) => {
            const widget = window.RevealManagerWidget?.activeInstance;
            const deck = widget?.getSavedDeckById(deckId);
            const storageId = deck?.storageId || '';
            const deleted = widget ? await widget.deleteSavedDeckById(deckId) : false;
            return {
                deleted,
                storedRecord: storageId ? await window.TeacherScreenDocumentStore.loadSlideDeck(storageId) : null,
                storedAssets: storageId ? await window.TeacherScreenDocumentStore.loadSlideAssets(storageId) : []
            };
        }, importedPdfDeck.deckId);
        assert(deletedImportedPdf.deleted && !deletedImportedPdf.storedRecord && deletedImportedPdf.storedAssets.length === 0, 'Deleting an imported PDF deck should clean up every stored page image');

        await page.locator('.widget.reveal-manager-widget .reveal-launch-btn').focus();
        const deletedImportedPptx = await page.evaluate(async (deckId) => {
            const widget = window.RevealManagerWidget?.activeInstance;
            const deck = widget?.getSavedDeckById(deckId);
            const storageId = deck?.storageId || '';
            const deleted = widget ? await widget.deleteSavedDeckById(deckId) : false;
            const lastDeck = widget?.getLastDeck();
            return {
                deleted,
                storedRecord: storageId ? await window.TeacherScreenDocumentStore.loadSlideDeck(storageId) : null,
                storedAssets: storageId ? await window.TeacherScreenDocumentStore.loadSlideAssets(storageId) : [],
                lastDeckStillReferencesDeletedStorage: lastDeck?.storageId === storageId
            };
        }, importedPptxDeck.deckId);
        assert(deletedImportedPptx.deleted && !deletedImportedPptx.storedRecord && deletedImportedPptx.storedAssets.length === 0, 'Deleting an imported PowerPoint deck should clean up every stored image');
        assert(!deletedImportedPptx.lastDeckStillReferencesDeletedStorage, 'Deleting the active imported deck should clear its stale last-deck shortcut');

        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#reset-layout').dispatchEvent('click');
        await waitForWidgetCount(page, 0, 'Clear Current Page should remove the active widgets');
        assert(await page.locator('.widget.behaviour-tracker-widget').count() === 0, 'Clear Current Page should discard the active behaviour tracker');

        await runResourceLibraryFlowChecks(page);

        const presentationPage = await context.newPage();
        await presentationPage.goto(`${baseUrl}/presentations/year7-rhetoric-marine-turtles/slides.html`, { waitUntil: 'domcontentloaded' });
        assert(await presentationPage.locator('body').textContent().then((text) => text.toLowerCase().includes('marine turtles')), 'Local presentation link should load its slide content');

        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 390, height: 844 });
        await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        assert(await mobilePage.locator('.dashboard-screen-card.is-current.is-expanded #dashboard-open-classroom-btn').isVisible(), 'Mobile Deck Library should show Classroom inside the expanded current deck');
        assert(await mobilePage.locator('.dashboard-sidebar').evaluate((element) => element.getBoundingClientRect().height < 340), 'Mobile dashboard navigation should stay compact');
        assert(await mobilePage.locator('.dashboard-primary-nav__list').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length === 2), 'Mobile primary navigation should use an even two-column layout');
        assert(await mobilePage.locator('.dashboard-nav-item.is-active').count() === 1, 'Mobile sidebar should keep exactly one primary destination active');
        assert(await mobilePage.locator('.dashboard-main').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'Mobile dashboard content should not create horizontal scrolling');
        assert(await mobilePage.locator('#dashboard-folder-list, #dashboard-create-folder-btn, .dashboard-shelves').count() === 0, 'Mobile should use Classes without a second Deck Shelves system');
        assert(await mobilePage.locator('#dashboard-utility-menu > summary').textContent().then((text) => text.trim() === 'More'), 'Mobile dashboard should expose utility links through a clearly labelled More item');
        assert(await mobilePage.locator('.dashboard-sidebar__footer').count() === 0, 'Mobile dashboard should not render a separate utility footer');
        assert(await mobilePage.locator('.dashboard-library-panel').evaluate((element) => element.getBoundingClientRect().top < 600), 'Mobile dashboard should bring the Deck Library into the first screenful');
        assert(await mobilePage.locator('#dashboard-search-input').evaluate((element) => element.getBoundingClientRect().height <= 46), 'Mobile deck search should not stretch into unused vertical space');
        assert(await mobilePage.locator('.dashboard-deck-toggle').first().evaluate((element) => element.getBoundingClientRect().top < window.innerHeight), 'Mobile dashboard should show the first saved deck without scrolling');
        await runMobileResourceLibraryChecks(mobilePage);
        await mobilePage.locator('[data-dashboard-mode="library"]').click();
        await mobilePage.locator('.dashboard-screen-card.is-current [data-deck-action="toggle"]').click();
        await mobilePage.waitForSelector('#dashboard-open-classroom-btn', { timeout: 10000 });
        await mobilePage.locator('#dashboard-open-classroom-btn').click();
        await mobilePage.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        assert(await mobilePage.locator('#lesson-quick-actions').isVisible(), 'Mobile classroom should show lesson quick actions');
        assert(await mobilePage.locator('#layout-edit-quick-btn').count() === 0, 'Mobile should not require an Edit mode button');
        assert(await mobilePage.locator('#widgets-container.layout-edit-mode').count() === 1, 'Mobile widgets should keep their permanent interaction state');
        await mobilePage.locator('#lesson-quick-actions [data-quick-widget="timer"]').click();
        await mobilePage.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        const mobileTimerFits = await mobilePage.locator('.widget.pomodoro-widget').evaluate((timerWidget) => {
            const displayRect = timerWidget.querySelector('.pomodoro-display')?.getBoundingClientRect();
            const timeRect = timerWidget.querySelector('.pomodoro-time')?.getBoundingClientRect();
            return !!displayRect && !!timeRect
                && timeRect.left >= displayRect.left
                && timeRect.right <= displayRect.right
                && timeRect.top >= displayRect.top
                && timeRect.bottom <= displayRect.bottom;
        });
        assert(mobileTimerFits, 'Mobile timer should stay compact without clipping the countdown');
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
