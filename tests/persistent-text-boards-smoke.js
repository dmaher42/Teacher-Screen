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
        const libraries = new Map(await Promise.all(['quill.min.js', 'quill.snow.css'].map(async name => {
            const url = `https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/${name}`;
            const response = await fetch(url); assert(response.ok);
            return [url, await response.text()];
        })));
        await context.route(/^https:\/\//, route => libraries.has(route.request().url())
            ? route.fulfill({ contentType: route.request().url().endsWith('.css') ? 'text/css' : 'text/javascript', body: libraries.get(route.request().url()) })
            : route.request().url().startsWith(base) ? route.continue() : route.abort());
        const teacher = await context.newPage();
        await teacher.goto(base);
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.layoutManager);

        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        teacher.on('pageerror', error => errors.push(error.message));
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.createNewProject('Synthetic native instruction boards', { className: 'Synthetic board class' });
            app.handleNavClick('classroom');
            app.addWidget('rich-text', { initialData: { content: '<h2>Page one original board</h2>' } });
            const state = app.buildStateSnapshot();
            state.instructions = { visible: true, today: 'Read the passage.\nCollect evidence.', now: '<img src=x onerror=alert(1)>', next: 'Explain your choices.', width: 30, height: 50, x: 20, y: 30, fontSize: 28 };
            app.applyState(state);
            app.handleNavClick('classroom');
            app.saveStateImmediately();
        });
        const boards = () => teacher.locator('.widget.rich-text-widget');
        const shared = () => teacher.locator('.text-board-front-layer .widget.rich-text-widget');
        await shared().waitFor();
        await teacher.waitForFunction(() => window.__TeacherScreenApp.layoutManager.widgets.filter(info => info.widget.constructor.name === 'RichTextWidget').every(info => info.widget.quill));
        assert.equal(await boards().count(), 2);
        assert.equal(await shared().locator('img').count(), 0, 'Legacy text is escaped, never interpreted as HTML');
        assert((await shared().innerText()).includes('<img src=x onerror=alert(1)>'));
        const geometry = await teacher.evaluate(() => {
            const box = document.querySelector('.text-board-front-layer .widget').getBoundingClientRect();
            const screen = document.getElementById('student-view').getBoundingClientRect();
            return { width: box.width / screen.width, height: box.height / screen.height,
                x: (box.left - screen.left) / (screen.width - box.width), y: (box.top - screen.top) / (screen.height - box.height) };
        });
        for (const [key, value] of Object.entries({ width: .3, height: .5, x: .2, y: .3 })) assert(Math.abs(geometry[key] - value) < .005, `Migration preserves ${key}: ${JSON.stringify(geometry)}`);
        assert.equal(await shared().locator('.ql-editor').evaluate(el => getComputedStyle(el).fontSize), '28px');
        const originalId = await teacher.evaluate(() => window.__TeacherScreenApp.projectState.activePageId);
        await teacher.evaluate(() => window.__TeacherScreenApp.createNewPage('Second page'));
        assert.equal(await boards().count(), 1, 'Shared board appears once; page-local original stays on page one');
        const secondId = await teacher.evaluate(() => window.__TeacherScreenApp.projectState.activePageId);
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find(info => info.widget.showOnEveryPage);
            info.widget.quill.setText('Shared instructions edited on page two.\n');
            info.widget.quill.formatText(0, 6, 'bold', true);
            app.saveStateImmediately();
        });
        await teacher.evaluate(id => window.__TeacherScreenApp.switchToPage(id), originalId);
        assert.equal(await boards().count(), 2);
        assert((await shared().locator('.ql-editor').innerHTML()).includes('<strong>Shared'));
        const snapshot = await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot());
        assert.equal(snapshot.instructions.boards.widgets.length, 1);
        assert(snapshot.pages.every(page => !page.snapshot.layout.widgets.some(record => record.data?.showOnEveryPage)), 'Page snapshots never duplicate shared boards');
        assert.equal(snapshot.instructions.today, 'Read the passage.\nCollect evidence.', 'Original instructions remain as recovery data');
        await teacher.reload();
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.layoutManager?.widgets?.some(info => info.widget.showOnEveryPage));
        await teacher.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
        assert.equal(await boards().count(), 2);
        assert((await shared().innerText()).includes('Shared instructions edited on page two.'));
        console.log('PASS: Legacy text, geometry and font retained; normal board protected; shared rich formatting across pages and refresh; recovery copy retained.');
        const projector = await context.newPage();
        await projector.goto(await teacher.evaluate(() => window.__TeacherScreenApp.getPairedProjectorUrl()));
        await projector.waitForFunction(() => document.querySelector('.text-board-front-layer .ql-editor')?.textContent.includes('Shared instructions edited'));
        assert.equal(await projector.locator('.rich-text-scope-options:visible').count(), 0);
        await projector.setViewportSize({ width: 1024, height: 768 });
        await projector.waitForFunction(() => {
            const box = document.querySelector('.text-board-front-layer .widget').getBoundingClientRect();
            return Math.abs(box.width / innerWidth - .3) < .005;
        });
        await teacher.bringToFront();
        await shared().getByRole('button', { name: 'Show text toolbar', exact: true }).click();
        const frontToggle = shared().getByLabel('Keep in front of presentations', { exact: true });
        await frontToggle.uncheck();
        assert.equal(await shared().count(), 0, 'Front setting can be turned off independently');
        const edited = teacher.locator('.widget.rich-text-widget').filter({ hasText: 'Shared instructions edited' });
        await edited.getByLabel('Keep in front of presentations', { exact: true }).check();
        await shared().getByLabel('Show on every page', { exact: true }).uncheck();
        await teacher.evaluate(id => window.__TeacherScreenApp.switchToPage(id), secondId);
        assert.equal(await boards().count(), 0, 'Turning off every-page leaves the board on its current page');
        await teacher.evaluate(id => window.__TeacherScreenApp.switchToPage(id), originalId);
        const current = teacher.locator('.widget.rich-text-widget').filter({ hasText: 'Shared instructions edited' });
        await current.getByLabel('Show on every page', { exact: true }).check();
        await teacher.evaluate(id => window.__TeacherScreenApp.switchToPage(id), secondId);
        assert.equal(await boards().count(), 1, 'Promoting a normal board makes it shared without duplicates');
        console.log('PASS: Both options work independently; shared -> page-only -> shared is lossless.');
        await teacher.bringToFront();
        await shared().hover();
        const beforeMove = await shared().boundingBox();
        const move = await shared().locator('.widget-header-title').boundingBox();
        await teacher.mouse.move(move.x + move.width / 2, move.y + move.height / 2);
        await teacher.mouse.down();
        await teacher.mouse.move(move.x + move.width / 2 + 60, move.y + move.height / 2 + 40, { steps: 8 });
        await teacher.mouse.up();
        const afterMove = await shared().boundingBox();
        assert(afterMove.x > beforeMove.x + 20 && afterMove.y > beforeMove.y + 20, 'Native Text Board drag moves the shared board');
        const corner = await shared().locator('.resize-handle.bottom-right').boundingBox();
        await teacher.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
        await teacher.mouse.down();
        await teacher.mouse.move(corner.x + corner.width / 2 + 40, corner.y + corner.height / 2 + 40, { steps: 8 });
        await teacher.mouse.up();
        const resized = await shared().boundingBox();
        assert(resized.width > afterMove.width + 10 && resized.height > afterMove.height + 10, 'Native corner resize works in the front layer');
        await teacher.evaluate(() => window.__TeacherScreenApp.saveStateImmediately());
        const ratio = await teacher.evaluate(() => {
            const box = document.querySelector('.text-board-front-layer .widget').getBoundingClientRect();
            const screen = document.getElementById('student-view').getBoundingClientRect();
            return { width: box.width / screen.width, height: box.height / screen.height };
        });
        await projector.waitForFunction(ratio => {
            const box = document.querySelector('.text-board-front-layer .widget')?.getBoundingClientRect();
            return box && Math.abs(box.width / innerWidth - ratio.width) < .01 && Math.abs(box.height / innerHeight - ratio.height) < .01;
        }, ratio);
        console.log('PASS: Native move and corner resize work and sync proportionally to a smaller projector.');

        const exportCheck = await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const payload = app.buildExportPayload();
            const plan = app.buildReplaceImportPlan(app.prepareImport(JSON.stringify(payload), 'replace'));
            const merged = app.buildMergeImportPlan(app.prepareImport(JSON.stringify(payload), 'merge'));
            return { before: payload.state.instructions.boards, after: plan.state.instructions.boards,
                mergeHasBoard: merged.presets.some(preset => preset.projectState?.instructions?.boards?.widgets?.some(record => record.data.content.includes('instructions edited'))) };
        });
        assert.deepEqual(exportCheck.after, exportCheck.before, 'Replace import preserves complete shared board records and viewport');
        assert(exportCheck.mergeHasBoard, 'Merge import retains the shared board');
        const privacy = await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find(info => info.widget.showOnEveryPage);
            const saved = info.widget.serialize();
            info.widget.deserialize({ ...saved, content: '<p>PRIVATE SHARED BOARD SENTINEL</p>', teacherOnly: true });
            const snapshot = app.buildProjectorStateSnapshot();
            info.widget.deserialize(saved);
            app.saveStateImmediately();
            return JSON.stringify(snapshot);
        });
        assert(!privacy.includes('PRIVATE SHARED BOARD SENTINEL'), 'Private shared content cannot leak through compatibility storage');
        teacher.once('dialog', dialog => dialog.accept());
        await teacher.evaluate(() => window.__TeacherScreenApp.resetLayout());
        assert.equal(await boards().count(), 1, 'Clear current page preserves shared boards');
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.addWidget('rich-text', { initialData: { customTitle: 'Second shared board', content: '<p>Another shared board</p>', showOnEveryPage: true, keepInFront: false } });
            app.createNewPage('Third page');
        });
        assert.equal(await boards().count(), 2, 'Multiple shared boards follow page changes');
        assert.equal(await shared().count(), 1, 'A shared board can remain in the ordinary layer');
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const other = app.layoutManager.widgets.find(info => info.widget.customTitle === 'Second shared board');
            app.layoutManager.removeWidget(other.widget);
            app.saveStateImmediately();
        });
        console.log('PASS: Export, Replace/Merge import projections, private content exclusion and Clear current page.');
        const output = path.join(root, 'output/playwright'); fs.mkdirSync(output, { recursive: true });
        await teacher.screenshot({ path: path.join(output, 'native-text-board-options.png') });
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find(info => info.widget.showOnEveryPage);
            app.layoutManager.removeWidget(info.widget);
            app.saveStateImmediately();
        });
        await teacher.reload();
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.layoutManager);
        assert.equal(await boards().count(), 0, 'Deleted migrated instructions do not reappear');
        await teacher.evaluate(() => window.__TeacherScreenApp.createNewProject('Synthetic empty separate deck'));
        assert.equal(await boards().count(), 0, 'Boards never leak between decks/classes');
        assert.deepEqual(errors, []);
        for (const visible of [false, true]) {
        const upgradeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await upgradeContext.route(/^https:\/\//, route => libraries.has(route.request().url())
            ? route.fulfill({ contentType: route.request().url().endsWith('.css') ? 'text/css' : 'text/javascript', body: libraries.get(route.request().url()) })
            : route.request().url().startsWith(base) ? route.continue() : route.abort());
        const upgrade = await upgradeContext.newPage();
        const rawLegacyState = JSON.stringify({ schemaVersion: 1, projectName: 'Synthetic hidden upgrade', currentDeckId: 'synthetic-upgrade', activePageId: 'page-1',
            layout: { mode: 'dashboard', viewport: { width: 940, height: 700 }, widgets: [] },
            instructions: { visible, width: 27, height: 45, x: 12, y: 34, fontSize: 32, today: 'SHOULD STAY HIDDEN', now: '', next: '' } });
        await upgrade.addInitScript(raw => localStorage.setItem('classroomScreenState', raw), rawLegacyState);
        await upgrade.goto(base);
        await upgrade.waitForFunction(() => window.__TeacherScreenApp?.layoutManager?.widgets?.some(info => info.widget.showOnEveryPage));
        assert.equal(await upgrade.evaluate(() => JSON.parse(localStorage.getItem('teacherScreenTextBoardUpgradeBackup-v1')).state), rawLegacyState, 'Upgrade backup retains the exact unmodified previous state string');
        const hidden = await upgrade.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().instructions.boards.widgets[0]);
        assert.equal(hidden.minimized, !visible);
        assert.equal(hidden.visibleOnProjector, visible);
        assert.equal(hidden.data.instructionFontSize, 32);
        if (visible) {
            await upgrade.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
            await upgrade.waitForFunction(() => {
                const box = document.querySelector('.text-board-front-layer .widget').getBoundingClientRect();
                const screen = document.getElementById('student-view').getBoundingClientRect();
                return Math.abs(box.width / screen.width - .27) < .005 && Math.abs(box.height / screen.height - .45) < .005
                    && Math.abs((box.left - screen.left) / (screen.width - box.width) - .12) < .005
                    && Math.abs((box.top - screen.top) / (screen.height - box.height) - .34) < .005;
            });
        }
        await upgradeContext.close();
        }
        console.log('PASS: Actual startup upgrade keeps hidden saved instructions hidden and makes an untouched local recovery backup.');

        const fallbackContext = await browser.newContext();
        await fallbackContext.route(/^https:\/\//, route => route.request().url().startsWith(base) ? route.continue() : route.abort());
        const fallback = await fallbackContext.newPage();
        await fallback.goto(base);
        await fallback.waitForFunction(() => window.__TeacherScreenApp?.layoutManager);
        await fallback.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.createNewProject('Synthetic editor unavailable'); app.handleNavClick('classroom');
            app.addWidget('rich-text', { initialData: { content: '<p>Original offline text</p>', showOnEveryPage: true, keepInFront: true } });
        });
        const plainEditor = fallback.locator('.rich-text-editor-fallback[contenteditable="true"]');
        await plainEditor.fill('Updated instructions without the formatting library.');
        await fallback.evaluate(() => { const app = window.__TeacherScreenApp; app.saveStateImmediately(); app.createNewPage('Another offline page'); });
        assert((await fallback.locator('.rich-text-editor-fallback').innerText()).includes('Updated instructions without the formatting library.'));
        await fallbackContext.close();
        console.log('PASS: Basic shared Text Board editing still works when the external formatting library is unavailable.');
        console.log('PASS: Deletion stays deleted after refresh; deck/class isolation; no browser errors.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
