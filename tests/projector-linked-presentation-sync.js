const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:rgb(200,20,20);color:white;font:24px sans-serif">
<h1 style="position:absolute;top:20px;left:24px;font-size:28px">First linked slide</h1><button id="next" style="position:absolute;top:110px;left:24px;font-size:24px" onclick="document.body.style.background='rgb(20,40,200)';document.querySelector('h1').textContent='Second linked slide'">Next slide</button>
</body></html>`;

async function run() {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end();
            return;
        }
        const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
        response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = process.env.PRESENTATION_SYNC_BASE_URL || `http://127.0.0.1:${server.address().port}/`;
    let browser;
    try {
        // Browser automation approves this test tab only; normal users still see
        // the browser's sharing picker on every start. The capture is real.
        browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
            '--auto-select-tab-capture-source-by-title=Teacher Screen',
            '--autoplay-policy=no-user-gesture-required'
        ] });
        const context = await browser.newContext();
        await context.route(/^https:\/\//, (route) => {
            const url = route.request().url();
            if (new URL(url).origin === new URL(baseUrl).origin) return route.continue();
            return url.startsWith('https://docs.google.com/presentation/') || url.startsWith('https://view.officeapps.live.com/')
                ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort();
        });
        const errors = [];
        context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
        const teacher = await context.newPage();
        await teacher.goto(baseUrl);
        await teacher.waitForFunction(() => Boolean(window.__TeacherScreenApp));
        await teacher.evaluate(async () => {
            const app = window.__TeacherScreenApp;
            app.layoutManager.deserialize({ mode: 'dashboard', widgets: [] }, () => null);
            await app.ensureRevealManagerWidget();
            app.handleNavClick('classroom');
            window.__linkedTestWidget = app.getPrimaryRevealManagerWidget();
        });
        let projector;
        for (const type of ['google-slides', 'powerpoint']) {
            await teacher.bringToFront();
            await teacher.evaluate(async (sourceType) => {
                await window.__linkedTestWidget.loadExternalSource({ type: sourceType, name: 'Linked lesson',
                    sourceUrl: sourceType === 'google-slides' ? 'https://docs.google.com/presentation/d/test-deck/edit'
                        : 'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fexample.com%2Flesson.pptx' });
            }, type);
            const frame = teacher.frameLocator('.reveal-external-embed-frame');
            await frame.locator('#next').waitFor();
            // Red private teacher content overlaps the source. Element Capture
            // must exclude it, unlike a rectangle crop or whole-tab mirror.
            await teacher.evaluate(() => {
                const shell = document.querySelector('.reveal-external-embed-shell');
                const bounds = shell.getBoundingClientRect();
                const note = document.createElement('div');
                note.id = 'private-overlap-test';
                note.textContent = 'PRIVATE TEACHER NOTES';
                note.style.cssText = `position:fixed;z-index:99999;background:rgb(20,200,20);left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height / 2}px;pointer-events:none;`;
                document.body.appendChild(note);
            });
            const popup = projector ? Promise.resolve(projector) : context.waitForEvent('page');
            await teacher.locator('.reveal-projector-btn').click();
            projector = await popup;
            await teacher.waitForFunction(() => window.TeacherScreenPresentationMirror?.session?.stream, null, { timeout: 15000 });
            try {
                await projector.waitForFunction(() => document.querySelector('.presentation-mirror-projector video')?.readyState >= 2,
                    null, { timeout: 30000 });
            } catch (error) {
                console.log('Teacher connection:', await teacher.evaluate(() => ({
                    status: window.__linkedTestWidget.statusLabel.textContent,
                    connected: window.__linkedTestWidget.element.isConnected,
                    sharing: Boolean(window.TeacherScreenPresentationMirror.session),
                    tracks: window.TeacherScreenPresentationMirror.session?.stream?.getVideoTracks().map((track) => ({ state: track.readyState, muted: track.muted }))
                })));
                console.log('Projector connection:', await projector.evaluate(() => ({
                    app: Boolean(window.__TeacherScreenProjectorApp),
                    session: window.__TeacherScreenProjectorApp?.presentationMirror?.sessionId,
                    message: document.querySelector('.presentation-mirror-projector p')?.textContent,
                    failures: window.__ProjectorDependencyFailures
                })), errors);
                throw error;
            }
            const waitForColour = async (colour) => projector.waitForFunction((expected) => {
                const video = document.querySelector('.presentation-mirror-projector video');
                if (!video || video.readyState < 2) return false;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, video.videoWidth * 0.9, video.videoHeight * 0.1, 1, 1, 0, 0, 1, 1);
                const rgb = ctx.getImageData(0, 0, 1, 1).data;
                return expected.every((value, index) => Math.abs(value - rgb[index]) < 30);
            }, colour, { timeout: 30000 }).catch(async (error) => {
                console.log('Stream state:', await teacher.evaluate(() => ({
                    status: window.__linkedTestWidget.statusLabel.textContent,
                    active: Boolean(window.TeacherScreenPresentationMirror.session),
                    target: document.querySelector('.reveal-external-embed-shell')?.getBoundingClientRect().toJSON()
                })), await projector.evaluate(() => ({
                    app: Boolean(window.__TeacherScreenProjectorApp),
                    receiver: Boolean(window.__TeacherScreenProjectorApp?.presentationMirror),
                    session: window.__TeacherScreenProjectorApp?.presentationMirror?.sessionId,
                    video: (() => { const v = document.querySelector('.presentation-mirror-projector video'); return v && { width: v.videoWidth, height: v.videoHeight, ready: v.readyState, paused: v.paused }; })(),
                    message: document.querySelector('.presentation-mirror-projector p')?.textContent
                })));
                throw error;
            });
            try {
                await waitForColour([200, 20, 20]);
            } catch (error) {
                const dir = path.join(root, 'output', 'playwright');
                fs.mkdirSync(dir, { recursive: true });
                await teacher.screenshot({ path: path.join(dir, 'linked-teacher-failure.png') });
                await projector.screenshot({ path: path.join(dir, 'linked-projector-failure.png') });
                console.log(await projector.evaluate(() => {
                    const v = document.querySelector('.presentation-mirror-projector video');
                    const c = document.createElement('canvas'); c.width = c.height = 1;
                    const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, 1, 1);
                    return { width: v.videoWidth, height: v.videoHeight, pixel: [...ctx.getImageData(0, 0, 1, 1).data] };
                }));
                throw error;
            }
            console.log(`PASS: ${type} shares only the embedded presentation, excluding overlapping teacher notes`);
            await teacher.bringToFront();
            await teacher.evaluate(() => document.querySelector('#private-overlap-test').remove());
            // Activate the provider's own control with real keyboard input;
            // the test never changes slide state through application internals.
            await frame.locator('#next').focus();
            await teacher.keyboard.press('Enter');
            await frame.locator('h1').filter({ hasText: 'Second linked slide' }).waitFor({ timeout: 5000 });
            await waitForColour([20, 40, 200]);
            console.log(`PASS: Advancing inside Teacher Screen updates the actual projector video (${type})`);
            await teacher.evaluate(() => window.__TeacherScreenApp.layoutManager.clampAllWidgetsToContainer());
            await frame.locator('h1').filter({ hasText: 'Second linked slide' }).waitFor({ timeout: 3000 });
            await waitForColour([20, 40, 200]);
            console.log(`PASS: Resizing the teacher layout preserves the current linked slide (${type})`);
            assert.equal(await projector.locator('.reveal-external-embed-frame').count(), 0,
                'The projector must not open a second independent linked presentation');
            await projector.reload();
            await waitForColour([20, 40, 200]);
            console.log(`PASS: Projector reconnect resumes the same live slide (${type})`);
            const screenshotDir = path.join(root, 'output', 'playwright');
            fs.mkdirSync(screenshotDir, { recursive: true });
            await projector.screenshot({ path: path.join(screenshotDir, `linked-${type}-projector.png`) });
            await teacher.evaluate(() => {
                window.__lastCapture = window.TeacherScreenPresentationMirror.session.stream.getVideoTracks()[0];
                document.querySelector('#private-overlap-test')?.remove();
            });
            await teacher.locator('.reveal-projector-btn').click();
            await projector.waitForFunction(() => !document.querySelector('.presentation-mirror-projector'));
            assert.equal(await teacher.evaluate(() => window.__lastCapture.readyState), 'ended');
            console.log(`PASS: Stop syncing releases browser capture and clears projector playback (${type})`);
        }
        // Verify failure cleanup without granting capture. No source can leak.
        await teacher.evaluate(() => {
            window.__originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
            navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('Cancelled', 'NotAllowedError'); };
        });
        await teacher.locator('.reveal-projector-btn').click();
        await teacher.waitForFunction(() => window.__linkedTestWidget.statusLabel.textContent.includes('cancelled'));
        assert.equal(await teacher.evaluate(() => window.TeacherScreenPresentationMirror.session), null);
        assert.equal(await projector.locator('.presentation-mirror-projector').count(), 0);
        console.log('PASS: Cancelling sharing leaves no capture or projector playback running');
        await teacher.evaluate(() => {
            navigator.mediaDevices.getDisplayMedia = async () => {
                const canvas = document.createElement('canvas');
                const stream = canvas.captureStream();
                stream.getVideoTracks()[0].getSettings = () => ({ displaySurface: 'monitor' });
                window.__rejectedCapture = stream;
                return stream;
            };
        });
        await teacher.locator('.reveal-projector-btn').click();
        await teacher.waitForFunction(() => window.__linkedTestWidget.statusLabel.textContent.includes('rather than a window'));
        assert.equal(await teacher.evaluate(() => window.__rejectedCapture.getVideoTracks()[0].readyState), 'ended');
        assert.equal(await projector.locator('.presentation-mirror-projector').count(), 0);
        console.log('PASS: Entire-screen capture is rejected and stopped before any picture is sent');
        assert.deepEqual(errors, [], 'Linked presentation sharing must not raise browser errors');
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
