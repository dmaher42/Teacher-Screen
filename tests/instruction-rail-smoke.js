const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

async function openInstructionSection(page) {
 const section=page.locator('#instruction-controls-section');
 if(await section.getAttribute('open')===null) await section.locator(':scope > summary').click();
}
async function run() {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((req, res) => {
        const file = path.resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await context.route(/^https:\/\//, route => route.abort());
        const teacher = await context.newPage();
        const errors = [];
        teacher.on('pageerror', e => errors.push(e.message));
        const url = `http://127.0.0.1:${server.address().port}`;
        await teacher.goto(url);
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.layoutManager);
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.handleNavClick('classroom');
            app.createNewProject('Synthetic rail lesson', { className: 'Synthetic class A' });
        }).catch(async error => { throw new Error('Synthetic deck setup: ' + error.message); });
        // Use real editor events, including hostile text which must remain plain text.
        await teacher.evaluate(() => {
            const values = { visible: true, today: 'Explain cause and effect', now: '<img src=x onerror=alert(1)>\nWatch and collect evidence.', next: 'Compare two examples', width: '35', fontSize: '32' };
            for (const [key, value] of Object.entries(values)) {
                const input = document.querySelector(`[data-instruction-field="${key}"]`);
                if (input.type === 'checkbox') input.checked = value; else input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            window.__TeacherScreenApp.saveStateImmediately();
        });
        const expected = await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().instructions);
        assert.equal(expected.now.includes('<img'), true);
        assert.equal(await teacher.locator('#instruction-rail img').count(), 0);
        const firstPage = await teacher.evaluate(() => window.__TeacherScreenApp.projectState.activePageId);
        await teacher.evaluate(() => window.__TeacherScreenApp.createNewPage('Synthetic video page'));
        await teacher.evaluate(id => window.__TeacherScreenApp.switchToPage(id), firstPage);
        assert.deepEqual(await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().instructions), expected);
        assert.equal(await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().pages.some(p => 'instructions' in p.snapshot)), false);
        console.log('PASS: Real editor, plain text, sizing and page transitions preserve deck instructions outside page snapshots');
        const projector = await context.newPage();
        projector.on('pageerror', e => errors.push(e.message));
        await projector.goto(await teacher.evaluate(() => window.__TeacherScreenApp.getPairedProjectorUrl()));
        const waitRail = () => projector.waitForFunction(() => document.querySelector('[data-instruction="today"]')?.textContent === 'Explain cause and effect' && !document.querySelector('#instruction-rail').hidden);
        await waitRail();
        await projector.reload(); await waitRail();
        await teacher.reload();
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.projectState?.instructions?.today === 'Explain cause and effect');
        await waitRail();
        assert.deepEqual(await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().instructions), expected);
        console.log('PASS: Teacher persistence and projector initial, refresh and teacher reconnect state');
        await teacher.evaluate(() => window.__TeacherScreenApp.handleNavClick('classroom'));
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const payload = app.buildExportPayload();
            window.__railExport = payload;
            const prepared = app.prepareImport(JSON.stringify(payload), 'replace');
            window.__railImported = app.buildReplaceImportPlan(prepared);
            window.__railMerged = app.buildMergeImportPlan(app.prepareImport(JSON.stringify(payload), 'merge'));
        });
        assert.deepEqual(await teacher.evaluate(() => window.__railExport.state.instructions), expected);
        assert.deepEqual(await teacher.evaluate(() => window.__railImported.state.instructions), expected);
        assert.deepEqual(await teacher.evaluate(() => window.__railMerged.presets.find(p => p.name.startsWith('Synthetic rail lesson') && p.id !== window.__railExport.state.currentDeckId)?.projectState.instructions), expected);
        assert.deepEqual(await teacher.evaluate(() => window.__TeacherScreenApp.normalizePresetRecord(window.__railExport.presets.find(p => p.id === window.__railExport.state.currentDeckId)).projectState.instructions), expected);
        console.log('PASS: Export and preset normalisation retain instructions');
        // Token checked live updates and privacy allowlisting.
        const privacy = await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.projectState.instructions.privateTeacherNotes = 'PRIVATE SYNTHETIC SENTINEL';
            const snapshot = app.buildProjectorStateSnapshot();
            app.broadcastProjectorState();
            return JSON.stringify(snapshot);
        });
        assert(!privacy.includes('PRIVATE SYNTHETIC SENTINEL'));
        await projector.evaluate(() => {
            const c = new BroadcastChannel('teacher-screen-sync');
            c.postMessage({ type: 'layout-update', syncToken: 'wrong-token', state: { layout: { widgets: [] }, instructions: { visible: true, today: 'UNTRUSTED' } } });
            c.close();
        });
        await projector.waitForTimeout(200); await waitRail();
        // Legacy presentations and embedded video must fit wholly left of the rail.
        await projector.evaluate(async () => {
            const root = document.getElementById('presentation-root');
            root.innerHTML = '<video id="synthetic-embedded-video" controls style="width:100%;height:100%;object-fit:contain"></video>';
            root.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
        });
        const fit = async () => projector.evaluate(() => {
            const rail = document.getElementById('instruction-rail').getBoundingClientRect();
            const media = document.getElementById('student-media').getBoundingClientRect();
            return media.width > window.innerWidth * .5 && rail.width > window.innerWidth * .2 && Math.abs(rail.right - window.innerWidth) < 2
                && Math.abs(media.top - rail.top) < 2
                && ['student-media', 'presentation-root'].every(id => document.getElementById(id).getBoundingClientRect().right <= rail.left + 1)
                && document.querySelector('#synthetic-embedded-video').getBoundingClientRect().right <= rail.left + 1;
        });
        assert(await fit());
        await projector.setViewportSize({ width: 1024, height: 768 }); assert(await fit());
        await teacher.evaluate(() => {
            const input = document.querySelector('[data-instruction-field="width"]'); input.value = '45'; input.dispatchEvent(new Event('input', { bubbles: true }));
            window.__TeacherScreenApp.saveStateImmediately();
        });
        await projector.waitForFunction(() => document.getElementById('student-view').style.getPropertyValue('--instruction-width') === '45%');
        assert(await fit());
        fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
        await projector.screenshot({ path: path.join(root, 'output/playwright/instruction-rail-projector.png') });
        console.log('PASS: Live resize, privacy allowlist, wrong-token rejection, legacy presentation and embedded video bounds');
        // Exercise the existing two-step import and backup flow with synthetic data only.
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.importJsonInput.value = JSON.stringify(window.__railExport);
            document.querySelector('input[name="import-mode"][value="replace"]').checked = true;
            app.handleConfirmImport(); app.handleConfirmImport();
        });
        assert.deepEqual(await teacher.evaluate(() => window.__TeacherScreenApp.buildStateSnapshot().instructions), expected);
        await waitRail();
        console.log('PASS: Actual Replace import restores the exported rail through the existing backup workflow');
        await teacher.bringToFront();
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.handleNavClick('classroom');
            app.toggleTeacherPanel(true);
        });
        await openInstructionSection(teacher);
        await teacher.locator('[data-present-instructions="whole"]').click();
        await teacher.waitForFunction(() => document.fullscreenElement?.id === 'student-view');
        assert(await teacher.locator('#instruction-rail').isVisible());
        const recovery = teacher.locator('#instruction-presentation-controls');
        assert(await recovery.isVisible());
        for (const name of ['Exit presentation', 'Home', 'Teacher Controls']) assert(await recovery.getByRole('button', { name, exact: true }).isVisible());
        assert(await teacher.evaluate(() => {
            const bar = document.getElementById('instruction-presentation-controls').getBoundingClientRect();
            return document.getElementById('student-media').getBoundingClientRect().top >= bar.bottom
                && document.getElementById('instruction-rail').getBoundingClientRect().top >= bar.bottom;
        }), 'Recovery toolbar must reserve space above media and instructions');
        assert.equal(await projector.locator('#instruction-presentation-controls').count(), 0);
        assert(!await teacher.evaluate(() => JSON.stringify(window.__TeacherScreenApp.buildProjectorStateSnapshot()).includes('instruction-presentation-controls')));
        await teacher.screenshot({ path: path.join(root, 'output/playwright/instruction-recovery-controls.png') });
        await recovery.getByRole('button', { name: 'Teacher Controls', exact: true }).click();
        await teacher.waitForFunction(() => !document.fullscreenElement && document.getElementById('teacher-panel').classList.contains('open'));
        await openInstructionSection(teacher);
        await teacher.locator('[data-present-instructions="whole"]').click();
        await teacher.waitForFunction(() => document.fullscreenElement?.id === 'student-view');
        await recovery.getByRole('button', { name: 'Home', exact: true }).click();
        await teacher.waitForFunction(() => !document.fullscreenElement && document.body.classList.contains('is-dashboard-active'));
        await teacher.evaluate(() => { window.__TeacherScreenApp.handleNavClick('classroom'); window.__TeacherScreenApp.toggleTeacherPanel(true); });
        await openInstructionSection(teacher);
        await teacher.locator('[data-present-instructions="whole"]').click();
        await teacher.waitForFunction(() => document.fullscreenElement?.id === 'student-view');
        await teacher.keyboard.press('Escape');
        await teacher.waitForFunction(() => !document.fullscreenElement);
        assert(!await recovery.isVisible());
        await teacher.evaluate(() => window.__TeacherScreenApp.toggleTeacherPanel(true));
        await openInstructionSection(teacher);
        await teacher.locator('[data-present-instructions="media"]').click();
        await teacher.waitForFunction(() => document.fullscreenElement?.id === 'student-media');
        assert(!await teacher.locator('#instruction-rail').isVisible());
        assert(await recovery.isVisible());
        assert(await teacher.evaluate(() => document.getElementById('widgets-container').getBoundingClientRect().top >= document.getElementById('instruction-presentation-controls').getBoundingClientRect().bottom));
        await recovery.getByRole('button', { name: 'Exit presentation', exact: true }).click();
        await teacher.waitForFunction(() => !document.getElementById('instruction-rail').hidden);
        console.log('PASS: Whole-layout/media-only fullscreen retain teacher recovery controls; Home, Teacher Controls, Exit and Escape work without covering media or leaking controls to projector');
        await teacher.evaluate(() => {
            const input = document.querySelector('[data-instruction-field="visible"]'); input.checked = false; input.dispatchEvent(new Event('input', { bubbles: true }));
            window.__TeacherScreenApp.saveStateImmediately();
        });
        await projector.waitForFunction(() => document.getElementById('instruction-rail').hidden);
        assert(await projector.evaluate(() => Math.abs(document.getElementById('student-media').getBoundingClientRect().width - innerWidth) < 2));
        await teacher.evaluate(() => {
            const input = document.querySelector('[data-instruction-field="visible"]'); input.checked = true; input.dispatchEvent(new Event('input', { bubbles: true }));
            window.__TeacherScreenApp.saveStateImmediately();
        });
        await waitRail();
        const savedDeckId = await teacher.evaluate(() => window.__TeacherScreenApp.projectState.currentDeckId);
        await teacher.evaluate(() => window.__TeacherScreenApp.createNewProject('Synthetic empty lesson', { className: 'Synthetic class B' }));
        await projector.waitForFunction(() => document.getElementById('instruction-rail').hidden);
        assert.equal(await teacher.locator('[data-instruction="today"]').textContent(), '');
        await teacher.evaluate(id => window.__TeacherScreenApp.loadPreset(id), savedDeckId);
        await waitRail();
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const legacy = app.buildStateSnapshot(); delete legacy.instructions;
            app.applyState(legacy); app.saveStateImmediately();
        });
        await projector.waitForFunction(() => document.getElementById('instruction-rail').hidden && document.querySelector('[data-instruction="now"]').textContent === '');
        console.log('PASS: Switching deck/class clears previous instructions; old decks default empty and hidden');
        assert.deepEqual(errors, []);
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
