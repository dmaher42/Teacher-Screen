const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

// A real, locally encoded WebM movie; no external media or student data.
const fixture = `<!doctype html><html><body style="margin:0;background:#071d2b;color:white;font:18px sans-serif">
<video id="movie" controls muted loop playsinline style="display:block;width:100%;height:calc(100vh - 44px);object-fit:contain"></video>
<button id="play">Play synthetic video</button><button id="fullscreen">Video fullscreen</button><span id="status">Encoding synthetic WebM…</span>
<script>
const video = document.getElementById('movie');
document.getElementById('play').onclick = async () => { window.playClicked = true; await video.play(); };
document.getElementById('fullscreen').onclick = async () => { window.fullscreenClicked = true; try { await video.requestFullscreen(); } catch(error) { window.fullscreenError=error.message; } };
(async () => {
 const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
 const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(20);
 const recorder = new MediaRecorder(stream, { mimeType:'video/webm;codecs=vp8' });
 const parts = []; recorder.ondataavailable = e => { if(e.data.size) parts.push(e.data); };
 const finished = new Promise(resolve => recorder.onstop = resolve);
 let frame = 0; const draw = () => { ctx.fillStyle = frame % 2 ? '#164e63' : '#0e7490'; ctx.fillRect(0,0,640,360); ctx.fillStyle='white'; ctx.font='36px sans-serif'; ctx.fillText('Synthetic moving video',40,100); ctx.fillText('Frame '+frame++,40,170); ctx.fillRect(40+(frame*13)%500,230,45,45); };
 draw(); const timer=setInterval(draw,50); recorder.start();
 await new Promise(resolve => setTimeout(resolve,2200)); recorder.stop(); await finished;
 clearInterval(timer); stream.getTracks().forEach(track => track.stop());
 await new Promise(resolve => { video.onloadeddata=resolve; video.src=URL.createObjectURL(new Blob(parts,{type:'video/webm'})); });
 document.getElementById('status').textContent='Ready';
})().catch(error => { document.getElementById('status').textContent=error.message; });
</script></body></html>`;

async function openInstructionSection(page) {
 const section=page.locator('#instruction-controls-section');
 if(await section.getAttribute('open')===null) await section.locator(':scope > summary').click();
}
async function run() {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/synthetic-video.html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(fixture);
        const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
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
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        const teacher = await context.newPage();
        await teacher.goto(`http://127.0.0.1:${server.address().port}`);
        await teacher.waitForFunction(() => window.__TeacherScreenApp?.layoutManager);
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.createNewProject('Synthetic video lesson', { className: 'Synthetic video class' });
            app.handleNavClick('classroom');
            app.projectState.instructions = { visible: true, today: 'Observe motion', now: 'Watch the synthetic video', next: 'Describe what changed', width: 30, fontSize: 28 };
            app.renderProjectControls();
            const widget = app.addWidget('url-viewer');
            widget.loadUrl('/synthetic-video.html');
            window.__videoWidget = widget;
            app.saveStateImmediately();
        });
        const teacherFrame = teacher.frameLocator('.url-viewer-iframe');
        await teacherFrame.locator('#status').filter({ hasText: 'Ready' }).waitFor();
        await teacher.bringToFront();
        await teacherFrame.locator('#play').focus();
        await teacher.keyboard.press('Enter');
        const assertPlaying = async frame => {
            const initial = await frame.locator('video').evaluate(v => ({ time: v.currentTime, frames: v.getVideoPlaybackQuality().totalVideoFrames }));
            await frame.locator('video').evaluate(async (v, before) => {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Decoded video frames did not advance: ' + JSON.stringify({paused:v.paused,readyState:v.readyState,time:v.currentTime,duration:v.duration,width:v.videoWidth,error:v.error?.message,quality:v.getVideoPlaybackQuality(),before}))), 5000);
                    const inspect = () => {
                        if (!v.paused && v.readyState >= 2 && v.getVideoPlaybackQuality().totalVideoFrames > before.frames + 5 && Math.abs(v.currentTime - before.time) > .05) { clearTimeout(timeout); resolve(); }
                        else setTimeout(inspect, 50);
                    }; inspect();
                });
            }, initial);
        };
        await assertPlaying(teacherFrame);
        const projector = await context.newPage();
        await projector.goto(await teacher.evaluate(() => window.__TeacherScreenApp.getPairedProjectorUrl()));
        const projectorFrame = projector.frameLocator('.url-viewer-iframe');
        await projectorFrame.locator('#status').filter({ hasText: 'Ready' }).waitFor();
        await projectorFrame.locator('#play').focus();
        await projector.keyboard.press('Enter');
        await assertPlaying(projectorFrame);
        const railFits = async page => page.evaluate(() => {
            const rail = document.getElementById('instruction-rail');
            const media = document.getElementById('student-media').getBoundingClientRect();
            const bounds = rail.getBoundingClientRect();
            return !rail.hidden && bounds.width > 200 && media.width > 500 && Math.abs(media.right - bounds.right) < 2;
        });
        assert(await railFits(teacher)); assert(await railFits(projector));
        console.log('PASS: Actual embedded WebM decodes and advances on teacher and projector beside the rail');
        await teacher.bringToFront();
        await teacher.evaluate(() => window.__TeacherScreenApp.toggleTeacherPanel(true));
        await openInstructionSection(teacher);
        await teacher.locator('[data-present-instructions="whole"]').click();
        await teacher.waitForFunction(() => document.fullscreenElement?.id === 'student-view');
        await assertPlaying(teacherFrame); assert(await railFits(teacher));
        console.log('PASS: Actual video playback advances in whole-layout fullscreen with instructions visible');
        // This calls the browser's native Fullscreen API on the video element,
        // as the native player's fullscreen control does, using a trusted click.
        await teacherFrame.locator('#fullscreen').focus();
        await teacher.keyboard.press('Enter');
        await teacherFrame.locator('video').evaluate(async v => {
            for (let attempt = 0; attempt < 100 && document.fullscreenElement !== v; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
            if (document.fullscreenElement !== v) throw new Error('Video did not enter native fullscreen: '+JSON.stringify({clicked:window.fullscreenClicked,error:window.fullscreenError,enabled:document.fullscreenEnabled,active:document.fullscreenElement?.tagName,playClicked:window.playClicked}));
        });
        await teacher.waitForFunction(() => document.fullscreenElement?.classList.contains('url-viewer-iframe'));
        const videoBounds = await teacherFrame.locator('video').boundingBox();
        assert(Math.abs(videoBounds.width - 1440) < 2 && Math.abs(videoBounds.height - 900) < 2);
        await assertPlaying(teacherFrame);
        console.log('PASS: Native video-element fullscreen owns the whole display and playback continues');
        await teacher.keyboard.press('Escape');
        await teacherFrame.locator('video').evaluate(async () => {
            if (document.fullscreenElement) await document.exitFullscreen();
        });
        await teacher.waitForFunction(() => !document.fullscreenElement || document.fullscreenElement.id === 'student-view');
        assert(await railFits(teacher));
        await assertPlaying(teacherFrame);
        console.log('PASS: Exiting native video fullscreen restores the instruction rail and ongoing playback');
        const output = path.join(root, 'output/playwright'); fs.mkdirSync(output, { recursive: true });
        await teacher.screenshot({ path: path.join(output, 'instruction-video-after-fullscreen.png') });
        await teacher.evaluate(async () => {
            if (document.fullscreenElement) await document.exitFullscreen();
            window.__TeacherScreenApp.createNewProject('Synthetic empty video follow-up', { className: 'Synthetic next class' });
        });
        await projector.waitForFunction(() => document.getElementById('instruction-rail').hidden && !document.querySelector('.url-viewer-iframe'));
        assert.equal(await teacher.locator('.url-viewer-iframe').count(), 0);
        assert.equal(await teacher.locator('[data-instruction="today"]').textContent(), '');
        assert.equal(await projector.locator('[data-instruction="now"]').textContent(), '');
        console.log('PASS: Switching to an empty deck clears the video and previous instructions on both displays');
        assert.deepEqual(errors, []);
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
