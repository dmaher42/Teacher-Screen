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
        await teacher.evaluate(() => window.__TeacherScreenApp.toggleTeacherPanel(false));
        await teacher.waitForFunction(() => document.getElementById('teacher-panel').getBoundingClientRect().left >= innerWidth - 1);
        // Closing Teacher Controls restores the full canvas. Place the board in
        // that canvas before saving the overlap fixture and reloading it.
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find(item => item.widget.constructor.name === 'RichTextWidget');
            Object.assign(info, { x: 600, y: 100, width: 750, height: 650 });
            app.layoutManager.mountWidgetElement(info);
            app.saveStateImmediately();
        });
        await teacher.reload();
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.projectState?.instructions?.height === 50);
        await teacher.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
        await projector.reload();
        await projector.waitForFunction(() => document.getElementById('student-view').style.getPropertyValue('--instruction-height-ratio') === '0.5');
        assert(await checkOverlay(teacher), JSON.stringify(await teacher.evaluate(() => ({
            state: window.__TeacherScreenApp.projectState.instructions,
            rail: document.getElementById('instruction-rail').getBoundingClientRect().toJSON(),
            widget: document.querySelector('.widget.rich-text-widget').getBoundingClientRect().toJSON(),
            panel: document.getElementById('teacher-panel').className
        }))));
        assert(await checkOverlay(projector));
        const output = path.join(root, 'output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await projector.screenshot({ path: path.join(output, 'instruction-overlay-projector.png') });
        const handle = teacher.getByRole('button', { name: 'Move student instructions', exact: true });
        assert.equal(await handle.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(24, 62, 72)', 'Drag handle keeps a contrasting dark background');
        assert.equal(await projector.locator('.instruction-move-handle').count(), 0, 'Teacher drag controls never appear on the projector');
        const drag = async (dx, dy) => {
            const box = await handle.boundingBox();
            await teacher.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await teacher.mouse.down();
            await teacher.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
            await teacher.mouse.up();
        };
        await drag(-500, 150);
        const position = await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().instructions);
        assert(position.x < 100 && position.x > 0 && position.y > 0 && position.y < 100, 'Real mouse drag moves both axes');
        const waitPosition = () => projector.waitForFunction(position => {
            const style = document.getElementById('student-view').style;
            return style.getPropertyValue('--instruction-x-ratio') === String(position.x / 100)
                && style.getPropertyValue('--instruction-y-ratio') === String(position.y / 100);
        }, position);
        await waitPosition();
        await teacher.reload();
        await teacher.waitForFunction(position => window.__TeacherScreenApp?.projectState?.instructions?.x === position.x && window.__TeacherScreenApp.projectState.instructions.y === position.y, position);
        await teacher.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
        await projector.reload();
        await waitPosition();
        await projector.setViewportSize({ width: 1024, height: 768 });
        const onScreen = page => page.evaluate(() => {
            const box = document.getElementById('instruction-rail').getBoundingClientRect();
            const screen = document.getElementById('student-view').getBoundingClientRect();
            return box.left >= screen.left - 1 && box.right <= screen.right + 1 && box.top >= screen.top - 1 && box.bottom <= screen.bottom + 1;
        });
        assert(await onScreen(projector), 'Saved position fits a smaller projector screen');
        await teacher.screenshot({ path: path.join(output, 'instruction-drag-teacher.png') });
        await projector.screenshot({ path: path.join(output, 'instruction-drag-projector.png') });
        await drag(-2000, 2000);
        assert(await onScreen(teacher), 'Dragging beyond the edges stays on screen');
        assert.deepEqual(await teacher.evaluate(() => {
            const { x, y } = window.__TeacherScreenApp.projectState.instructions;
            return { x, y };
        }), { x: 0, y: 100 });
        await handle.focus();
        await teacher.keyboard.press('Home');
        await teacher.keyboard.press('ArrowLeft');
        assert.equal(await teacher.evaluate(() => window.__TeacherScreenApp.projectState.instructions.x), 98);
        await teacher.evaluate(() => {
            window.__TeacherScreenApp.toggleTeacherPanel(true);
            document.getElementById('instruction-controls-section').open = true;
        });
        await teacher.getByRole('button', { name: 'Reset position', exact: true }).click();
        assert.deepEqual(await teacher.evaluate(() => {
            const { x, y, height, today } = window.__TeacherScreenApp.projectState.instructions;
            return { x, y, height, today };
        }), { x: 100, y: 0, height: 50, today: 'Read the passage.' });
        await teacher.bringToFront();
        await teacher.locator('[data-present-instructions="whole"]').click();
        await teacher.waitForFunction(() => document.fullscreenElement?.id === 'student-view');
        await drag(-400, 200);
        assert(await onScreen(teacher));
        assert(await teacher.evaluate(() => document.getElementById('instruction-rail').getBoundingClientRect().top >= document.getElementById('instruction-presentation-controls').getBoundingClientRect().bottom));
        await teacher.getByRole('button', { name: 'Exit presentation', exact: true }).click();
        await teacher.waitForFunction(() => !document.fullscreenElement);
        assert(await onScreen(teacher));
        assert.equal(await projector.locator('.instruction-resize-handle').count(), 0, 'Resize controls stay teacher-only');
        const setResizeFixture = () => teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.projectState.instructions = { ...app.projectState.instructions, width: 30, height: 50, x: 50, y: 40 };
            app.renderProjectControls();
        });
        const resizeDrag = async (edge, dx, dy) => {
            const control = teacher.locator(`.instruction-resize-handle[data-edge="${edge}"]`);
            const box = await control.boundingBox();
            await teacher.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await teacher.mouse.down();
            await teacher.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 });
            await teacher.mouse.up();
        };
        const bounds = () => teacher.locator('#instruction-rail').boundingBox();
        for (const edge of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
            await setResizeFixture();
            const before = await bounds();
            const dx = edge.includes('e') ? 40 : edge.includes('w') ? -40 : 0;
            const dy = edge.includes('s') ? 30 : edge.includes('n') ? -30 : 0;
            await resizeDrag(edge, dx, dy);
            const after = await bounds();
            assert(Math.abs(after.width - before.width - Math.abs(dx)) < 2, `${edge} changes width correctly`);
            assert(Math.abs(after.height - before.height - Math.abs(dy)) < 2, `${edge} changes height correctly`);
            const fixedX = edge.includes('w') ? after.x + after.width - before.x - before.width : after.x - before.x;
            const fixedY = edge.includes('n') ? after.y + after.height - before.y - before.height : after.y - before.y;
            assert(Math.abs(fixedX) < 2 && Math.abs(fixedY) < 2, `${edge} preserves the opposite edges`);
            await resizeDrag(edge, -dx, -dy);
            const restored = await bounds();
            assert(Math.abs(restored.width - before.width) < 2 && Math.abs(restored.height - before.height) < 2, `${edge} also shrinks`);
        }
        await setResizeFixture();
        await resizeDrag('se', 5000, 5000);
        const maximum = await teacher.evaluate(() => window.__TeacherScreenApp.projectState.instructions);
        assert(Math.abs(maximum.width - 45) < .01 && maximum.height <= 100);
        assert(await onScreen(teacher), 'Resizing beyond the screen stays within it');
        await resizeDrag('se', -5000, -5000);
        const minimum = await teacher.evaluate(() => window.__TeacherScreenApp.projectState.instructions);
        assert(Math.abs(minimum.width - 22) < .01 && Math.abs(minimum.height - 20) < .01);
        await setResizeFixture();
        await resizeDrag('nw', -45, -35);
        const savedResize = await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().instructions);
        await teacher.reload();
        await teacher.waitForFunction(saved => window.__TeacherScreenApp?.projectState?.instructions?.width === saved.width && window.__TeacherScreenApp.projectState.instructions.height === saved.height, savedResize);
        await teacher.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
        await projector.reload();
        await projector.waitForFunction(saved => {
            const style = document.getElementById('student-view')?.style;
            return Math.abs(Number.parseFloat(style?.getPropertyValue('--instruction-width')) - saved.width) < .01
                && Math.abs(Number.parseFloat(style?.getPropertyValue('--instruction-height-ratio')) * 100 - saved.height) < .01;
        }, savedResize);
        assert(await onScreen(projector));
        await teacher.locator('.instruction-resize-handle[data-edge="e"]').focus();
        const beforeKeyboard = await bounds();
        await teacher.keyboard.press('ArrowLeft');
        assert(Math.abs((await bounds()).width - beforeKeyboard.width + 10) < 2, 'Arrow key resizes without moving the opposite edge');
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.projectState.instructions.now = Array(40).fill('Long scrolling instruction text.').join('\n');
            app.renderProjectControls();
            document.querySelector('#instruction-rail .instruction-content').scrollTop = 1000;
        });
        const beforeScrollResize = await bounds();
        await resizeDrag('se', 20, 20);
        assert((await bounds()).height > beforeScrollResize.height, 'Resize handles remain usable while instructions are scrolled');
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.toggleTeacherPanel(true);
            document.getElementById('instruction-controls-section').open = true;
        });
        await teacher.bringToFront();
        await teacher.locator('[data-present-instructions="whole"]').click();
        await teacher.waitForFunction(() => document.fullscreenElement?.id === 'student-view');
        await resizeDrag('nw', -30, -5000);
        assert(await onScreen(teacher));
        assert(await teacher.evaluate(() => document.getElementById('instruction-rail').getBoundingClientRect().top >= document.getElementById('instruction-presentation-controls').getBoundingClientRect().bottom), 'Resizing respects the fullscreen recovery toolbar');
        await teacher.getByRole('button', { name: 'Exit presentation', exact: true }).click();
        await teacher.waitForFunction(() => !document.fullscreenElement);
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.projectState.instructions.now = 'Find two examples.';
            app.renderProjectControls();
            document.querySelector('#instruction-rail .instruction-content').scrollTop = 0;
        });
        await teacher.screenshot({ path: path.join(output, 'instruction-resize-teacher.png') });
        console.log('PASS: All eight resize handles grow/shrink, retain opposite edges, clamp limits, save and sync, support keyboard resizing and remain usable with scrolled content.');
        console.log('PASS: Mouse dragging, edge limits, keyboard movement, reset, fullscreen toolbar clearance, saved position, smaller projector and refresh; handle stays teacher-only.');
        console.log('PASS: Real Text Board behind a half-height panel, accessible space below, keyboard height controls, preset retention, saved state and projector refresh.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
