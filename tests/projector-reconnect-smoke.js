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
