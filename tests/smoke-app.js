const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
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

async function runSmoke() {
    const server = createStaticServer();
    const baseUrl = await listen(server);
    let browser;

    try {
        browser = await launchBrowser();
        const context = await browser.newContext();
        const pageErrors = [];
        const consoleErrors = [];

        context.on('page', (page) => {
            page.on('pageerror', (error) => pageErrors.push(error.message));
            page.on('console', (message) => {
                if (message.type() === 'error') {
                    consoleErrors.push(message.text());
                }
            });
        });

        const page = await context.newPage();
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashboard-open-classroom-btn', { timeout: 15000 });
        assert(await page.title() === 'Custom Classroom Screen', 'Teacher app page title should load');
        assert(await page.locator('#dashboard-view:not([hidden])').count() === 1, 'Dashboard should be visible first');

        if (await page.locator('#tour-dialog[open]').count() === 1) {
            await page.locator('#tour-dialog [data-close]').click();
            await page.waitForSelector('#tour-dialog[open]', { state: 'detached', timeout: 10000 });
        }

        await page.locator('#dashboard-open-classroom-btn').click();
        await page.waitForSelector('#classroom-view:not([hidden])', { timeout: 10000 });
        assert(await page.locator('#student-view').isVisible(), 'Classroom view should open');

        if (await page.locator('#teacher-panel').isVisible()) {
            await page.locator('#close-teacher-panel').click();
        }

        await addWidget(page, 'timer', '.widget.pomodoro-widget', 'Pomodoro');
        await addWidget(page, 'drawing-tool', '.widget.drawing-tool-widget', 'Drawing Tool');

        await page.waitForFunction(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state && state.layout && Array.isArray(state.layout.widgets) && state.layout.widgets.length >= 2;
        }, { timeout: 10000 });
        const savedWidgetCount = await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('classroomScreenState') || '{}');
            return state && state.layout && Array.isArray(state.layout.widgets)
                ? state.layout.widgets.length
                : 0;
        });
        assert(savedWidgetCount >= 2, 'Classroom state should save both smoke-test widgets');

        await page.locator('#add-widget-btn').click();
        await page.waitForSelector('#widget-modal[open]', { timeout: 10000 });
        await page.locator('#widget-picker-teacher-controls-btn').click();
        await page.waitForSelector('#teacher-panel.open', { timeout: 10000 });

        const smokeScreenName = `Smoke Screen ${Date.now()}`;
        await page.locator('#project-screen-name-input').fill(smokeScreenName);
        await page.locator('#save-project-screen-btn').click();
        await page.waitForFunction((name) => {
            const presets = JSON.parse(localStorage.getItem('classroomLayoutPresets') || '[]');
            return Array.isArray(presets) && presets.some((preset) => preset && preset.name === name);
        }, smokeScreenName, { timeout: 10000 });
        assert(true, 'Named classroom screen should save as a preset');

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
        await page.waitForSelector('.widget.pomodoro-widget', { timeout: 10000 });
        await page.waitForSelector('.widget.drawing-tool-widget', { timeout: 10000 });
        assert(await page.locator('.widget.pomodoro-widget').count() === 1, 'Saved screen should reload the Pomodoro widget');
        assert(await page.locator('.widget.drawing-tool-widget').count() === 1, 'Saved screen should reload the Drawing Tool widget');

        const projectorPage = await context.newPage();
        await projectorPage.goto(`${baseUrl}/projector.html`, { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForSelector('.widget.pomodoro-widget', { timeout: 15000 });
        assert(await projectorPage.locator('.widget.pomodoro-widget').count() === 1, 'Projector should render the saved Pomodoro widget');
        assert(await projectorPage.locator('.widget.drawing-tool-widget').count() === 1, 'Projector should render the saved Drawing Tool widget');

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
