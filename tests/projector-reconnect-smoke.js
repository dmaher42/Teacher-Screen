const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const syncToken = 'projector-reconnect-smoke-token';
const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8'
};

function createStaticServer() {
    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');
        const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
        const filePath = path.resolve(root, `.${decodeURIComponent(requestedPath)}`);

        if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }

        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(response);
    });
}

async function launchBrowser() {
    const candidates = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
    for (const candidate of candidates) {
        try {
            return await chromium.launch({ ...candidate, headless: true });
        } catch (_error) {
            // Try the next locally available browser.
        }
    }
    throw new Error('Unable to launch Edge, Chrome, or bundled Chromium.');
}

async function dragElementBy(page, selector, deltaX, deltaY) {
    const element = page.locator(selector);
    const box = await element.boundingBox();
    if (!box) {
        throw new Error(`Unable to drag hidden element: ${selector}`);
    }

    const startX = box.x + (box.width / 2);
    const startY = box.y + (box.height / 2);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
    await page.mouse.up();
}

async function run() {
    const server = createStaticServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const browser = await launchBrowser();
    const context = await browser.newContext();

    try {
        await context.route(/^https:\/\//, (route) => route.abort('blockedbyclient'));
        await context.addInitScript((token) => {
            sessionStorage.setItem('teacher-screen-projector-sync-token', token);
        }, syncToken);

        const projectorPage = await context.newPage();
        await projectorPage.goto(`${baseUrl}/projector.html?syncToken=${syncToken}`, { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForFunction(() => Boolean(window.__TeacherScreenProjectorApp));

        const teacherPage = await context.newPage();
        await teacherPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await teacherPage.waitForFunction(() => Boolean(window.__TeacherScreenApp));
        await projectorPage.waitForFunction(() => window.__TeacherScreenProjectorApp?.hasTeacherSync === true);
        console.log('PASS: A projector opened first automatically connects when the teacher screen becomes ready');

        await projectorPage.evaluate(() => {
            window.__TeacherScreenProjectorApp.hasTeacherSync = false;
        });
        await teacherPage.reload({ waitUntil: 'domcontentloaded' });
        await teacherPage.waitForFunction(() => Boolean(window.__TeacherScreenApp));
        await projectorPage.waitForFunction(() => window.__TeacherScreenProjectorApp?.hasTeacherSync === true);
        console.log('PASS: An open projector automatically reconnects after the teacher screen refreshes');

        const textBoard = await teacherPage.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.handleNavClick('classroom');
            const widget = app.addWidget('rich-text', { notification: 'Resize sync test board added' });
            const info = app.layoutManager.widgets.find((candidate) => candidate.widget === widget);
            return {
                id: info.id,
                width: info.width,
                height: info.height
            };
        });
        await projectorPage.waitForFunction((widgetId) => (
            window.__TeacherScreenProjectorApp?.layoutManager.widgets.some((widget) => widget.id === widgetId)
        ), textBoard.id);

        const projectorNodeWasPreserved = await projectorPage.evaluate((widgetId) => {
            const app = window.__TeacherScreenProjectorApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            window.__projectorResizeSyncNode = info?.element || null;
            return Boolean(window.__projectorResizeSyncNode);
        }, textBoard.id);
        if (!projectorNodeWasPreserved) {
            throw new Error('Projector Text Board was not available for resize sync testing');
        }

        await dragElementBy(teacherPage, '.widget.rich-text-widget .resize-handle.bottom-right', 80, 40);
        await teacherPage.waitForFunction(({ widgetId, initialWidth, initialHeight }) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width !== initialWidth || info?.height !== initialHeight;
        }, { widgetId: textBoard.id, initialWidth: textBoard.width, initialHeight: textBoard.height });
        const resizedTextBoard = await teacherPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return { width: info.width, height: info.height };
        }, textBoard.id);

        await projectorPage.waitForFunction(({ widgetId, width, height }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width === width && info?.height === height;
        }, { widgetId: textBoard.id, ...resizedTextBoard });
        const projectorKeptTextBoard = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.element === window.__projectorResizeSyncNode;
        }, textBoard.id);
        if (!projectorKeptTextBoard) {
            throw new Error('Projector rebuilt the Text Board instead of applying its resize');
        }
        console.log('PASS: Text Board resizing syncs live to the projector without rebuilding its content');
    } finally {
        await context.close();
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
