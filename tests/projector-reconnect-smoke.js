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

        const projectorLaunch = await teacherPage.evaluate(() => {
            const originalOpen = window.open;
            let call = null;
            window.open = (...args) => {
                call = args;
                return null;
            };
            window.__TeacherScreenApp.openProjectorView();
            window.open = originalOpen;
            return call;
        });
        const projectorLaunchUrl = new URL(projectorLaunch?.[0] || baseUrl);
        if (projectorLaunchUrl.searchParams.get('syncToken') !== syncToken) {
            throw new Error('Projector action did not preserve the teacher pairing token');
        }
        console.log('PASS: Projector action opens a paired projector that can receive teacher updates');

        const testWidgets = await teacherPage.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.handleNavClick('classroom');
            const textBoardWidget = app.addWidget('rich-text', { notification: 'Resize sync test board added' });
            const noiseMeterWidget = app.addWidget('noise-meter', { notification: 'Layer sync test meter added' });
            const info = app.layoutManager.widgets.find((candidate) => candidate.widget === textBoardWidget);
            const noiseInfo = app.layoutManager.widgets.find((candidate) => candidate.widget === noiseMeterWidget);
            return {
                textBoard: {
                    id: info.id,
                    width: info.width,
                    height: info.height
                },
                noiseMeterId: noiseInfo.id
            };
        });
        const textBoard = testWidgets.textBoard;
        await projectorPage.waitForFunction(({ textBoardId, noiseMeterId }) => {
            const widgets = window.__TeacherScreenProjectorApp?.layoutManager.widgets || [];
            return widgets.some((widget) => widget.id === textBoardId)
                && widgets.some((widget) => widget.id === noiseMeterId);
        }, { textBoardId: textBoard.id, noiseMeterId: testWidgets.noiseMeterId });

        const projectorNoiseStatusHidden = await projectorPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.status
                ? window.getComputedStyle(info.widget.status).display === 'none'
                : false;
        }, testWidgets.noiseMeterId);
        if (!projectorNoiseStatusHidden) {
            throw new Error('Projector should hide the Noise Meter microphone status sentence');
        }
        console.log('PASS: Projector hides the misleading Noise Meter microphone status sentence');

        await teacherPage.evaluate((noiseMeterId) => {
            window.TeacherScreenEventBus.eventBus.emit('noise-meter:level', {
                widgetId: noiseMeterId,
                level: 170,
                listening: true
            });
        }, testWidgets.noiseMeterId);
        await projectorPage.waitForFunction((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.meter?.lastLevel === 170
                && info.widget.meter.lastRenderedWidth > (info.widget.canvas.width * 0.6)
                && info.widget.meterDisplay?.dataset.noiseState === 'loud'
                && info.widget.classroomStatusText?.textContent === 'Too Loud';
        }, testWidgets.noiseMeterId);
        console.log('PASS: High live readings render the red Too Loud projector state');

        for (const expected of [
            { level: 80, state: 'warning', label: 'Getting Loud' },
            { level: 25, state: 'ready', label: 'Ready to Learn' }
        ]) {
            await teacherPage.evaluate(({ noiseMeterId, level }) => {
                window.TeacherScreenEventBus.eventBus.emit('noise-meter:level', {
                    widgetId: noiseMeterId,
                    level,
                    listening: true
                });
            }, { noiseMeterId: testWidgets.noiseMeterId, level: expected.level });
            await projectorPage.waitForFunction(({ noiseMeterId, state, label }) => {
                const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
                return info?.widget?.meterDisplay?.dataset.noiseState === state
                    && info.widget.classroomStatusText?.textContent === label;
            }, { noiseMeterId: testWidgets.noiseMeterId, state: expected.state, label: expected.label });
        }
        console.log('PASS: Projector Noise Meter shows Ready to Learn, Getting Loud, and Too Loud states');

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

        const syncedStackOrder = await Promise.all([
            teacherPage.evaluate(() => {
                const app = window.__TeacherScreenApp;
                return {
                    ids: app.layoutManager.widgets.map((widget) => widget.id)
                };
            }),
            projectorPage.evaluate(() => {
                const app = window.__TeacherScreenProjectorApp;
                return {
                    ids: app.layoutManager.widgets.map((widget) => widget.id),
                    topId: app.layoutManager.widgets.find((widget) => widget.element === app.layoutManager.container.lastElementChild)?.id || ''
                };
            })
        ]);
        const teacherStackIds = syncedStackOrder[0].ids;
        const projectorStackIds = syncedStackOrder[1].ids;
        if (teacherStackIds.at(-1) !== textBoard.id
            || projectorStackIds.at(-1) !== textBoard.id
            || syncedStackOrder[1].topId !== textBoard.id) {
            throw new Error('Projector did not preserve the teacher widget front-to-back order');
        }
        console.log('PASS: Projector preserves the teacher widget front-to-back order after resizing');

        await projectorPage.evaluate((widgetId) => {
            window.__TeacherScreenProjectorApp.layoutManager.applyLayoutDelta({
                type: 'widget-update',
                id: widgetId,
                w: 999,
                h: 777
            });
        }, textBoard.id);
        await teacherPage.evaluate(() => window.__TeacherScreenApp.broadcastProjectorState());
        await projectorPage.waitForFunction(({ widgetId, width, height }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width === width && info?.height === height;
        }, { widgetId: textBoard.id, ...resizedTextBoard });
        const projectorRecoveredWithoutRebuild = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.element === window.__projectorResizeSyncNode;
        }, textBoard.id);
        if (!projectorRecoveredWithoutRebuild) {
            throw new Error('Projector rebuilt the Text Board while recovering missed geometry');
        }
        console.log('PASS: Full teacher sync repairs missed Text Board resizing without rebuilding content');
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
