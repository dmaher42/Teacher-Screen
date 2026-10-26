const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

async function run() {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const base = process.env.TEACHER_SCREEN_SMOKE_URL || `http://127.0.0.1:${server.address().port}/`;
        if (!process.env.TEACHER_SCREEN_SMOKE_URL) await context.route(/^https:\/\//, route => route.abort());
        const teacher = await context.newPage();
        await teacher.goto(base);
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.layoutManager);
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.createNewProject('Synthetic instruction overlay');
            app.handleNavClick('classroom');
            const widget = app.addWidget('rich-text', { initialData: { content: '<h2>Student activity</h2><p>Read the passage and collect evidence.</p><p>This Text Board extends behind the instructions.</p>', displayMode: true } });
            const info = app.layoutManager.widgets.find(item => item.widget === widget);
            Object.assign(info, { x: 600, y: 100, width: 750, height: 650 });
            app.layoutManager.mountWidgetElement(info);
            app.projectState.instructions = { visible: true, width: 30, height: 50, fontSize: 28, today: 'Read the passage.', now: 'Find two examples.', next: 'Explain your choices.' };
            app.renderProjectControls();
            app.saveStateImmediately();
        });
        const projector = await context.newPage();
        await projector.goto(await teacher.evaluate(() => window.__TeacherScreenApp.getPairedProjectorUrl()));
        await projector.waitForFunction(() => document.querySelector('[data-instruction="next"]')?.textContent === 'Explain your choices.');
        const checkOverlay = page => page.evaluate(() => {
            const rail = document.getElementById('instruction-rail');
            const bounds = rail.getBoundingClientRect();
            const widget = document.querySelector('.widget.rich-text-widget');
            const box = widget.getBoundingClientRect();
            const x = Math.min(box.right, bounds.right) - 20;
            const coveredY = Math.max(box.top, bounds.top) + 40;
            const belowY = bounds.bottom + 30;
            return box.left < bounds.left && box.right > bounds.left && box.bottom > belowY
                && rail.contains(document.elementFromPoint(x, coveredY))
                && widget.contains(document.elementFromPoint(x, belowY));
        });
        assert(await checkOverlay(teacher), 'Actual Text Board extends behind the panel and stays accessible below it');
        assert(await checkOverlay(projector), 'Projector keeps the same layering');
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.toggleTeacherPanel(true);
            document.getElementById('instruction-controls-section').open = true;
            document.querySelector('.instruction-fine-tuning').open = true;
        });
        const height = teacher.locator('[data-instruction-field="height"]');
        await height.focus();
        await teacher.keyboard.press('Home');
        assert.equal(await height.inputValue(), '20');
        await projector.waitForFunction(() => document.getElementById('student-view').style.getPropertyValue('--instruction-height-ratio') === '0.2');
        await teacher.locator('[data-instruction-size-preset]').selectOption('compact');
        assert.equal(await height.inputValue(), '20', 'Size presets preserve the chosen height');
        await height.focus();
        await teacher.keyboard.press('End');
        assert.equal(await height.inputValue(), '100');
        await teacher.keyboard.press('Home');
        for (let i = 0; i < 30; i++) await teacher.keyboard.press('ArrowRight');
        assert.equal(await height.inputValue(), '50');
        await teacher.evaluate(() => { window.__TeacherScreenApp.saveStateImmediately(); window.__TeacherScreenApp.toggleTeacherPanel(false); });
        await teacher.reload();
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.projectState?.instructions?.height === 50);
        await teacher.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
        await projector.reload();
        await projector.waitForFunction(() => document.getElementById('student-view').style.getPropertyValue('--instruction-height-ratio') === '0.5');
        assert(await checkOverlay(teacher));
        assert(await checkOverlay(projector));
        const output = path.join(root, 'output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await projector.screenshot({ path: path.join(output, 'instruction-overlay-projector.png') });
        console.log('PASS: Real Text Board behind a half-height panel, accessible space below, keyboard height controls, preset retention, saved state and projector refresh.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
