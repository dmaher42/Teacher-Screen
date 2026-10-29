// Uses only a new browser context and an ephemeral local server. Obtain approval for their cleanup before running.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

async function run() {
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'output/playwright'); fs.mkdirSync(output, { recursive: true });
    const libraries = new Map(await Promise.all(['quill.min.js', 'quill.snow.css'].map(async file => {
        const url = `https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/${file}`;
        const response = await fetch(url); assert(response.ok); return [url, await response.text()];
    })));
    const server = http.createServer((req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname;
        const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.route(/^https:\/\//, route => libraries.has(route.request().url())
            ? route.fulfill({ body: libraries.get(route.request().url()), contentType: route.request().url().endsWith('.css') ? 'text/css' : 'text/javascript' }) : route.abort());
        const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        const page = await context.newPage(); const base = `http://127.0.0.1:${server.address().port}`;
        const ready = () => page.waitForFunction(() => window.__TeacherScreenApp?.widgets?.some(widget => widget.textPages && widget.quill));
        const remember = () => page.evaluate(() => { window.__editingPresentation = window.__TeacherScreenApp.widgets.find(widget => widget.textPages); });
        await page.goto(base); await page.waitForFunction(() => window.__TeacherScreenApp?.layoutManager);
        await page.evaluate(() => { const app = window.__TeacherScreenApp; app.createNewProject('Synthetic editable presentation'); app.handleNavClick('classroom'); });
        await page.locator('#add-widget-btn').click();
        await page.getByRole('button', { name: 'Add Text presentation', exact: true }).click();
        await ready(); await remember();
        const board = page.locator('.widget:has(.is-text-presentation)');
        const editor = board.locator('.ql-editor'); const nav = board.locator('.text-presentation-nav');
        await page.evaluate(() => {
            const app = window.__TeacherScreenApp; const widget = window.__editingPresentation;
            const info = app.layoutManager.widgets.find(info => info.widget === widget);
            Object.assign(info, { x: 40, y: 40, width: 680, height: 700 }); app.layoutManager.mountWidgetElement(info); widget.syncEditorLayout();
        });
        await editor.fill('First synthetic slide');
        await page.evaluate(picture => {
            const q = window.__editingPresentation.quill;
            const index = q.getLength() - 1; q.insertEmbed(index, 'image', picture, 'user');
            q.formatText(index, 1, { width: '40%' }, 'user'); q.history.clear();
        }, picture);
        const image = editor.locator('img'); await image.evaluate(img => img.decode());
        await image.click(); const size = board.getByLabel('Image width percent', { exact: true }); await size.waitFor();
        const handle = board.locator('.text-board-image-handle--se'); const box = await handle.boundingBox(); assert(box.width >= 44 && box.height >= 44);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 8 }); await page.mouse.up();
        const resized = await image.getAttribute('width'); assert(parseFloat(resized) > 40);
        await editor.focus(); await page.keyboard.press('Control+z'); assert.equal(await image.getAttribute('width'), '40%');
        await page.keyboard.press('Control+y'); assert.equal(await image.getAttribute('width'), resized);
        await image.click(); await size.fill('70'); await size.press('Enter'); assert.equal(await image.getAttribute('width'), '70%');
        await size.press('Escape'); assert(!await size.isVisible());
        await image.click(); await board.screenshot({ path: path.join(output, 'text-board-image-resize-desktop.png') });

        await nav.locator('summary').click(); await nav.getByRole('menuitem', { name: 'Add slide', exact: true }).click();
        await editor.fill('Second synthetic slide');
        await nav.getByRole('button', { name: 'Previous text slide', exact: true }).click(); assert.equal(await image.getAttribute('width'), '70%');
        await nav.getByRole('button', { name: 'Next text slide', exact: true }).click(); assert((await editor.innerText()).includes('Second synthetic slide'));
        await nav.locator('summary').click(); page.once('dialog', dialog => dialog.accept());
        await nav.getByRole('menuitem', { name: 'Remove slide', exact: true }).click(); assert.equal(await nav.locator('option').count(), 1);
        await nav.locator('summary').click(); await nav.getByRole('menuitem', { name: 'Undo remove', exact: true }).click(); assert.equal(await nav.locator('option').count(), 2);
        await page.evaluate(() => window.__TeacherScreenApp.saveStateImmediately()); await page.reload(); await ready(); await remember();
        await page.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
        assert((await editor.innerText()).includes('Second synthetic slide'));
        const exported = await page.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot());
        await page.evaluate(state => { const app = window.__TeacherScreenApp; app.createNewProject('Synthetic import target'); app.applyState(state); app.handleNavClick('classroom'); }, exported);
        await ready(); await remember(); assert.equal(await nav.locator('option').count(), 2);
        await nav.getByRole('button', { name: 'Previous text slide', exact: true }).click(); assert.equal(await image.getAttribute('width'), '70%');
        assert(!await page.evaluate(() => JSON.stringify(window.__TeacherScreenApp.buildProjectorStateSnapshot()).includes('Second synthetic slide')));
        const projector = await context.newPage(); await projector.goto(await page.evaluate(() => window.__TeacherScreenApp.getPairedProjectorUrl()));
        await projector.waitForFunction(() => document.querySelector('.ql-editor')?.textContent.includes('First synthetic slide'));
        assert.equal(await projector.locator('.text-presentation-nav,.text-board-image-overlay').count(), 0);
        assert.equal(await projector.locator('.ql-editor img').getAttribute('width'), '70%');
        await nav.getByRole('button', { name: 'Next text slide', exact: true }).click();
        await projector.waitForFunction(() => document.querySelector('.ql-editor')?.textContent.includes('Second synthetic slide'));
        await projector.reload(); await projector.waitForFunction(() => document.querySelector('.ql-editor')?.textContent.includes('Second synthetic slide'));
        await nav.getByRole('button', { name: 'Present', exact: true }).click();
        assert(await board.getByRole('button', { name: 'Exit presentation mode', exact: true }).isVisible());
        await nav.getByRole('button', { name: 'Previous text slide', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
        assert((await editor.innerText()).includes('First synthetic slide'));
        await board.screenshot({ path: path.join(output, 'text-presentation-present.png') });
        await page.keyboard.press('Escape'); assert(await editor.evaluate(el => el.contentEditable === 'true'));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => { const nav = document.querySelector('.text-presentation-nav'); return nav && nav.scrollWidth <= nav.clientWidth + 1; });
        assert(await nav.evaluate(el => [...el.querySelectorAll('button,select,summary')].filter(control => control.getClientRects().length).every(control => {
            const b = control.getBoundingClientRect(); const n = el.getBoundingClientRect(); return b.width >= 44 && b.height >= 44 && b.left >= n.left - 1 && b.right <= n.right + 1;
        })));
        await board.screenshot({ path: path.join(output, 'text-presentation-narrow.png') });
        assert.deepEqual(errors, []);
        console.log('PASS: Browser editing/drag/undo, pages, reload/import, live projector/reconnect, presentation recovery and narrow controls.');
    } finally {
        await browser?.close(); await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
