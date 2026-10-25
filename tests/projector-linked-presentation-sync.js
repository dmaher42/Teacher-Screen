const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const JSZip = require('jszip');

function pdfFixture() {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 360] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R >>',
        '',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 360] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>',
        '',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 360] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>',
        '',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    for (const [index, color] of [[3, '0.8 0.1 0.1'], [5, '0.1 0.2 0.8'], [7, '0.1 0.7 0.2']]) {
        const stream = `${color} rg 0 0 640 360 re f 1 1 1 rg BT /F1 32 Tf 40 180 Td (Slide ${(index - 1) / 2}) Tj ET`;
        objects[index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }
    let text = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = text.length;
    text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(text);
}

async function pptxFixture() {
    const zip = new JSZip();
    const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${[1,2,3].map(i => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
    zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
    zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:sldIdLst>${[1,2,3].map(i => `<p:sldId id="${255 + i}" r:id="rId${i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1,2,3].map(i => `<Relationship Id="rId${i}" Type="${r}/slide" Target="slides/slide${i}.xml"/>`).join('')}</Relationships>`);
    for (const i of [1,2,3]) zip.file(`ppt/slides/slide${i}.xml`, `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${['AA2222','2233AA','228833'][i-1]}"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="9144000" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>PowerPoint slide ${i}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    return zip.generateAsync({ type: 'nodebuffer' });
}

async function run() {
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'output', 'playwright');
    fs.mkdirSync(output, { recursive: true });
    const powerpoint = await pptxFixture();
    const urls = [
        'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
        'https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.js',
        'https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.css',
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.worker.min.js'
    ];
    const libraries = new Map(await Promise.all(urls.map(async url => {
        const filename = path.join(output, `sync-test-${new URL(url).pathname.split('/').pop()}`);
        if (!fs.existsSync(filename)) {
            const response = await fetch(url);
            assert(response.ok, `Cannot load test library: ${url}`);
            fs.writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
        }
        return [url, fs.readFileSync(filename)];
    })));
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
        response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = process.env.PRESENTATION_SYNC_BASE_URL || `http://127.0.0.1:${server.address().port}/`;
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(() => {
            window.__captureCalls = 0;
            if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = () => {
                window.__captureCalls++; throw new Error('Tab sharing must never be required');
            };
        });
        await context.route(/^https:\/\//, route => {
            const url = route.request().url();
            if (new URL(url).origin === new URL(baseUrl).origin) return route.continue();
            if (libraries.has(url)) return route.fulfill({ contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: libraries.get(url) });
            if (url === 'https://example.com/lesson.pptx') return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', body: powerpoint });
            if (url === 'https://docs.google.com/presentation/d/test-deck/export/pdf') return route.fulfill({ contentType: 'application/pdf', body: pdfFixture() });
            return route.abort();
        });
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        const teacher = await context.newPage();
        await teacher.goto(baseUrl);
        await teacher.waitForFunction(() => Boolean(window.__TeacherScreenApp));
        await teacher.evaluate(async () => {
            const app = window.__TeacherScreenApp;
            app.layoutManager.deserialize({ mode: 'dashboard', widgets: [] }, () => null);
            await app.ensureRevealManagerWidget();
            app.handleNavClick('classroom');
            window.__syncWidget = app.getPrimaryRevealManagerWidget();
            const ok = await window.__syncWidget.loadExternalSource({ type: 'google-slides', name: 'Linked lesson', sourceUrl: 'https://docs.google.com/presentation/d/test-deck/edit' });
            if (!ok) throw new Error(window.__syncWidget.statusLabel.textContent);
        });
        await teacher.waitForFunction(() => window.__syncWidget.revealDeck?.isReady());
        assert.equal(await teacher.locator('.reveal-slide-select option').count(), 3);
        const popup = context.waitForEvent('page');
        await teacher.locator('.reveal-more-btn').click();
        await teacher.locator('.reveal-projector-btn').click();
        const projector = await popup;
        await projector.waitForFunction(() => window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.revealDeck?.isReady());
        const expectSlide = async h => {
            await teacher.waitForFunction(index => window.__syncWidget.currentIndices.h === index, h);
            await projector.waitForFunction(index => window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.revealDeck?.getIndices().h === index, h);
            await projector.waitForFunction(() => document.querySelector('.reveal-inline-deck .present img')?.complete);
        };
        await expectSlide(0);
        await projector.evaluate(() => { window.__initialPlayer = window.__TeacherScreenProjectorApp.getRevealWidgets()[0].revealDeck; });
        await teacher.locator('.reveal-next-btn').click(); await expectSlide(1);
        await teacher.locator('.reveal-prev-btn').click(); await expectSlide(0);
        await teacher.locator('.reveal-slide-select').selectOption('2:0'); await expectSlide(2);
        assert(await projector.evaluate(() => window.__initialPlayer === window.__TeacherScreenProjectorApp.getRevealWidgets()[0].revealDeck), 'Slide navigation must preserve the mounted player');
        const teacherBounds = await teacher.locator('.reveal-manager-widget-content').boundingBox();
        await teacher.locator('.reveal-more-btn').click();
        await teacher.locator('.reveal-projector-fullscreen-btn').click();
        await projector.waitForFunction(() => document.querySelector('.projector-presentation-fullscreen')?.getBoundingClientRect().width === innerWidth);
        await expectSlide(2);
        assert.deepEqual(await teacher.locator('.reveal-manager-widget-content').boundingBox(), teacherBounds);
        const fullBounds = await projector.locator('.projector-presentation-fullscreen').boundingBox();
        assert.equal(fullBounds.x, 0); assert.equal(fullBounds.y, 0); assert.equal(fullBounds.height, 1000);
        await teacher.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.projectState.instructions = { visible: true, today: 'Synthetic linked lesson', now: 'Watch and collect evidence', next: 'Compare examples', width: 30, fontSize: 28 };
            app.renderProjectControls(); app.saveStateImmediately();
        });
        await projector.waitForFunction(() => document.querySelector('#instruction-rail') && !document.querySelector('#instruction-rail').hidden);
        assert(await projector.evaluate(() => {
            const rail = document.getElementById('instruction-rail').getBoundingClientRect();
            const media = document.querySelector('.projector-presentation-fullscreen').getBoundingClientRect();
            return rail.width > 200 && media.width > 500 && media.right <= rail.left + 1 && Math.abs(media.width - innerWidth * .7) < 2;
        }), 'Expanded slides must fill only the media region when instructions are shown');
        for (const page of [teacher, projector]) await page.waitForFunction(() => {
            const image = document.querySelector('.reveal-inline-deck section.present img').getBoundingClientRect();
            const stage = document.querySelector('.reveal-inline-deck').getBoundingClientRect();
            return image.left >= stage.left - 1 && image.right <= stage.right + 1;
        });
        await teacher.screenshot({ path: path.join(output, 'teacher-slide-controls.png') });
        await projector.screenshot({ path: path.join(output, 'projector-slides-fullscreen.png') });
        await teacher.locator('.reveal-next-btn').click(); await expectSlide(2);
        await projector.reload();
        await projector.waitForFunction(() => window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.revealDeck?.isReady());
        await expectSlide(2);
        await projector.waitForSelector('.projector-presentation-fullscreen');
        await teacher.locator('.reveal-prev-btn').click(); await expectSlide(1);
        await teacher.locator('.reveal-more-btn').click();
        await teacher.locator('.reveal-projector-fullscreen-btn').click();
        await projector.waitForFunction(() => !document.querySelector('.projector-presentation-fullscreen'));
        await expectSlide(1);
        const failed = await teacher.evaluate(async () => {
            const widget = window.__syncWidget;
            const id = widget.activeDeck.storageId;
            const ok = await widget.loadExternalSource({ type: 'powerpoint', sourceUrl: 'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fexample.com%2Fprivate.pptx' });
            return { ok, preserved: widget.activeDeck.storageId === id, status: widget.statusLabel.textContent };
        });
        assert.equal(failed.ok, false); assert(failed.preserved); assert.match(failed.status, /current presentation has been kept/);
        await teacher.evaluate(async () => {
            const ok = await window.__syncWidget.loadExternalSource({ type: 'powerpoint', sourceUrl: 'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fexample.com%2Flesson.pptx' });
            if (!ok) throw new Error(window.__syncWidget.statusLabel.textContent);
        });
        await teacher.waitForFunction(() => window.__syncWidget.pptxFrame && window.__syncWidget.revealDeck?.isReady());
        await projector.waitForFunction(() => window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.pptxFrame && window.__TeacherScreenProjectorApp.getRevealWidgets()[0].revealDeck?.isReady());
        const expectPptxSlide = async h => {
            await teacher.waitForFunction(index => window.__syncWidget.currentIndices.h === index, h);
            await projector.waitForFunction(index => window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.currentIndices.h === index, h).catch(async error => {
                console.log('PPTX reconnect evidence', await projector.evaluate(() => { const w = window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]; return { indices: w?.currentIndices, frame: w?.pptxFrame?.src, ready: w?.revealDeck?.isReady(), status: w?.statusLabel.textContent }; }));
                throw error;
            });
            await projector.frameLocator('.reveal-pptx-frame').getByText(`PowerPoint slide ${h + 1}`, { exact: true }).waitFor();
        };
        await expectPptxSlide(0);
        await teacher.locator('.reveal-next-btn').click(); await expectPptxSlide(1);
        await teacher.locator('.reveal-prev-btn').click(); await expectPptxSlide(0);
        await teacher.locator('.reveal-slide-select').selectOption('2:0'); await expectPptxSlide(2);
        await teacher.locator('.reveal-more-btn').click();
        await teacher.locator('.reveal-projector-fullscreen-btn').click();
        await projector.waitForSelector('.projector-presentation-fullscreen');
        await expectPptxSlide(2);
        await projector.screenshot({ path: path.join(output, 'projector-powerpoint-controls.png') });
        await projector.reload();
        await projector.waitForFunction(() => window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.pptxFrame && window.__TeacherScreenProjectorApp.getRevealWidgets()[0].revealDeck?.isReady());
        await expectPptxSlide(2);
        await teacher.locator('.reveal-more-btn').click();
        await teacher.locator('.reveal-projector-fullscreen-btn').click();
        console.log('PASS: direct PowerPoint link import and native PPTX player teacher controls.');
        await teacher.evaluate(async () => {
            await window.__syncWidget.launchDeck({ id: 987654, type: 'html', name: 'Replacement', content: '<section><h1>Replacement one</h1></section><section><h1>Replacement two</h1></section>' });
        });
        await projector.waitForFunction(() => document.querySelector('.reveal-inline-deck .present')?.textContent.includes('Replacement one'));
        await teacher.locator('.reveal-next-btn').click();
        await projector.waitForFunction(() => document.querySelector('.reveal-inline-deck .present')?.textContent.includes('Replacement two'));
        await teacher.locator('.reveal-more-btn').click();
        await teacher.locator('.reveal-launch-btn').click();
        await projector.waitForFunction(() => !window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.activeDeck);
        assert.equal(await teacher.evaluate(() => window.__captureCalls), 0);
        assert.deepEqual(errors, []);
        console.log('PASS: linked PDF import; teacher Previous, Next and selection; projector-only fullscreen; mounted player stability; reconnect; deck replacement; close; restricted-link preservation; zero capture prompts.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
