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


        const page = teacher;
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.evaluate(() => {
            const app = window.__TeacherScreenApp;
            app.createNewProject('Synthetic Text Board formatting'); app.handleNavClick('classroom');
            window.__formatBoard = app.addWidget('rich-text', { initialData: { content: '<p>Alpha beta</p><p>Second line</p>', showOnEveryPage: true, keepInFront: true } });
        });
        await page.waitForFunction(() => window.__formatBoard?.quill);
        const board = page.locator('.widget.rich-text-widget');
        const toolbar = board.locator('.rich-text-editor-toolbar');
        const more = toolbar.locator('.rich-text-toolbar-more');
        const output = path.join(root, 'output/playwright'); fs.mkdirSync(output, { recursive: true });
        const reset = async (text = 'Alpha beta\nSecond line\n', index = 0, length = 5) => page.evaluate(({ text, index, length }) => {
            const q = window.__formatBoard.quill;
            q.setText(text); q.history.clear(); q.setSelection(index, length);
        }, { text: text.replace(/\\n/g, '\n'), index, length });
        const formats = (index = 0, length = 5) => page.evaluate(({ index, length }) => window.__formatBoard.quill.getFormat(index, length), { index, length });
        const openMore = async () => { if (!await more.evaluate(el => el.open)) await more.getByLabel('More formatting tools', { exact: true }).click(); };
        const closeMore = () => more.evaluate(el => { el.open = false; });
        const core = name => toolbar.getByRole('button', { name, exact: true });
        await reset();
        for (const [name, key] of [['Bold', 'bold'], ['Italic', 'italic'], ['Underline', 'underline']]) {
            await core(name).click(); assert.equal((await formats())[key], true, `${name} applies to the selection`);
            assert.equal((await formats(11, 5))[key], undefined, `${name} leaves other text alone`);
            assert.equal(await core(name).getAttribute('aria-pressed'), 'true');
            await core(name).click(); assert.equal((await formats())[key], undefined, `${name} toggles off`);
        }
        await toolbar.getByLabel('Text style', { exact: true }).selectOption('2'); assert.equal((await formats()).header, 2);
        await toolbar.getByLabel('Text style', { exact: true }).selectOption('small'); assert.equal((await formats()).size, 'small'); assert.equal((await formats()).header, undefined);
        await toolbar.getByLabel('Text style', { exact: true }).selectOption('');
        await core('Bullet list').click(); assert.equal((await formats()).list, 'bullet');
        await core('Numbered list').click(); assert.equal((await formats()).list, 'ordered');
        await core('Numbered list').click(); assert.equal((await formats()).list, undefined);
        console.log('PASS: Emphasis, text styles and list buttons apply and toggle correctly without changing other text.');
        assert(!await more.evaluate(el => el.open));
        assert.equal(await more.locator('[data-format="size"]').count(), 0);
        assert(await toolbar.locator('.rich-text-toolbar-main [data-format="size"]').isVisible());
        await toolbar.getByLabel('Text size', { exact: true }).selectOption('36px'); assert.equal((await formats()).size, '36px');
        assert(!await more.evaluate(el => el.open), 'Text size works without opening More');
        await toolbar.getByLabel('Text size', { exact: true }).selectOption(''); assert.equal((await formats()).size, undefined);
        await toolbar.getByLabel('Text size', { exact: true }).selectOption('36px'); assert.equal((await formats()).size, '36px');
        await openMore();
        await toolbar.getByLabel('Alignment', { exact: true }).selectOption('center'); assert.equal((await formats()).align, 'center');
        await toolbar.getByLabel('Line spacing', { exact: true }).selectOption('relaxed'); assert.equal((await formats()).lineSpacing, 'relaxed');
        await toolbar.getByLabel('Text colour', { exact: true }).click(); await core('Red text').click(); assert.equal((await formats()).color, '#dc2626');
        await toolbar.getByLabel('Highlight colour', { exact: true }).click(); await core('Yellow highlight').click(); assert.equal((await formats()).background, '#fef08a');
        await toolbar.getByLabel('Text colour', { exact: true }).click(); await core('White text').click(); assert.equal((await formats()).color, '#ffffff');
        assert.equal((await formats(11, 5)).size, undefined);
        page.once('dialog', dialog => dialog.accept('example.com/lesson')); await core('Add link').click(); assert.equal((await formats()).link, 'https://example.com/lesson');
        page.once('dialog', dialog => dialog.accept('')); await core('Add link').click(); assert.equal((await formats()).link, undefined);
        page.once('dialog', dialog => dialog.accept('javascript:alert(1)')); await core('Add link').click();
        assert.equal((await formats()).link, undefined); assert(await toolbar.getByRole('status').isVisible());
        await closeMore(); await reset(); await core('Bold').click(); await openMore();
        await core('Undo').click(); assert.equal((await formats()).bold, undefined);
        await core('Redo').click(); assert.equal((await formats()).bold, true);
        console.log('PASS: Size, alignment, spacing, colours, highlights, links and undo/redo retain the selected text.');
        const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
        await page.evaluate(picture => {
            const q = window.__formatBoard.quill;
            q.setContents([{ insert: 'Picture stays ', attributes: { bold: true, color: '#dc2626' } }, { insert: { image: picture }, attributes: { width: '80' } }, { insert: ' ending' }, { insert: '\n', attributes: { header: 2, align: 'center' } }]);
            q.history.clear(); q.setSelection(0, q.getLength() - 1);
        }, picture);
        const beforeClear = await page.evaluate(() => window.__formatBoard.quill.getText());
        await openMore(); await core('Clear formatting').click();
        assert.equal(await board.locator('.ql-editor img').count(), 1, 'Clearing formatting must preserve pictures');
        assert.equal(await board.locator('.ql-editor img').getAttribute('width'), '80', 'Picture dimensions stay intact');
        assert.equal(await page.evaluate(() => window.__formatBoard.quill.getText()), beforeClear);
        assert.equal((await formats()).bold, undefined); assert.equal((await formats()).header, undefined);
        await core('Undo').click(); assert.equal((await formats()).bold, true); assert.equal(await board.locator('.ql-editor img').count(), 1);
        await reset('Alpha\nBeta\n', 2, 0);
        await page.evaluate(() => { const q=window.__formatBoard.quill; q.formatText(0,5,'bold',true); q.formatText(6,4,'italic',true); q.setSelection(2,0); });
        await core('Clear formatting').click(); assert.equal((await formats(0,5)).bold, undefined); assert.equal((await formats(6,4)).italic, true);
        console.log('PASS: Clear formatting preserves words and pictures, supports one-step undo and clears the current paragraph when nothing is selected.');
        for (const [key, expected] of [['learning-intention','Learning Intention'],['success-criteria','Success Criteria'],['warm-up','Warm-up'],['discussion-question','Discussion Question'],['exit-ticket','Exit Ticket'],['tip','Tip'],['remember','Remember'],['important','Important'],['question','Question'],['answer','Answer']]) {
            await closeMore(); await reset('BEFORE\nAFTER\n', 7, 0); await openMore();
            await toolbar.locator('.rich-text-toolbar-more-section--teaching > summary').click();
            await toolbar.locator(`[data-insert="${key}"]`).click();
            const result = await page.evaluate(() => ({ text:window.__formatBoard.quill.getText(), index:window.__formatBoard.quill.getSelection()?.index }));
            assert(result.text.includes('BEFORE') && result.text.includes('AFTER') && result.text.includes(expected), `${key} inserts without replacing existing text`);
            assert(result.index < result.text.length - 2, 'Caret stays by the inserted block rather than jumping to document end');
            await openMore(); await core('Undo').click();
            assert.equal(await page.evaluate(() => window.__formatBoard.quill.getText()), 'BEFORE\nAFTER\n');
        }
        await closeMore(); await reset('Existing tail\n', 0, 0); await openMore(); await core('Insert two columns').click();
        await page.waitForFunction(() => document.querySelectorAll('.ql-editor table td').length === 4);
        assert.equal(await board.locator('.ql-editor table tr').count(), 2); assert((await board.locator('.ql-editor').innerText()).includes('Existing tail'));
        await core('Undo').click(); assert.equal(await board.locator('.ql-editor table').count(), 0);
        await core('Insert two columns').click();
        await board.locator('.ql-editor td').first().click();
        await page.keyboard.type('Cell survives reload');
        await page.evaluate(() => { const q=window.__formatBoard.quill; q.setSelection(0,q.getLength()-1); });
        await core('Clear formatting').click();
        assert.equal(await board.locator('.ql-editor table td').count(), 4, 'Clearing text formatting preserves table structure');
        await page.evaluate(() => window.__TeacherScreenApp.saveStateImmediately());
        const projector=await context.newPage();
        await projector.goto(await page.evaluate(()=>window.__TeacherScreenApp.getPairedProjectorUrl()));
        await projector.waitForFunction(()=>document.querySelector('.ql-editor table')?.textContent.includes('Cell survives reload'));
        await projector.close();
        await page.reload();
        await page.waitForFunction(()=>{const info=window.__TeacherScreenApp?.layoutManager?.widgets?.find(info=>info.widget.quill);if(!info)return false;window.__formatBoard=info.widget;return !!info.widget.quill.root.querySelector('table');});
        await page.evaluate(()=>window.__TeacherScreenApp.handleNavClick('classroom'));
        assert((await board.locator('.ql-editor table').innerText()).includes('Cell survives reload'));
        await page.bringToFront();
        console.log('PASS: Teaching blocks insert at the caret with one-step undo; columns create a real editable 2×2 table.');
        await closeMore(); await reset();
        for (const width of [520, 432, 360, 260]) {
            await page.evaluate(width => {
                const app=window.__TeacherScreenApp, info=app.layoutManager.widgets.find(info=>info.widget===window.__formatBoard);
                Object.assign(info,{x:40,y:40,width,height:500});app.layoutManager.mountWidgetElement(info);info.widget.syncEditorLayout();
            }, width);
            const geometry = await toolbar.evaluate(el => {
                const bounds=el.getBoundingClientRect();const controls=[...el.querySelectorAll('.rich-text-toolbar-main button,.rich-text-toolbar-main select,.rich-text-toolbar-secondary > button,.rich-text-toolbar-more > summary')];
                return { height:bounds.height,overflow:el.querySelector('.rich-text-toolbar-main').scrollWidth>el.querySelector('.rich-text-toolbar-main').clientWidth+1,
                    fits:controls.every(c=>{const b=c.getBoundingClientRect();return b.left>=bounds.left-1&&b.right<=bounds.right+1;}),
                    boxes:controls.map(c=>({name:c.getAttribute('aria-label'),...c.getBoundingClientRect().toJSON()})) };
            });
            assert(geometry.fits && !geometry.overflow, `All primary controls fit at ${width}px: ${JSON.stringify(geometry)}`);
            if(width===260) assert(geometry.height<=80, `Two tidy rows at 260px: ${JSON.stringify(geometry)}`);
            if(width>=432) assert(geometry.height<=44, `One compact row at ${width}px: ${JSON.stringify(geometry)}`);
            await toolbar.screenshot({path:path.join(output,`text-toolbar-${width}.png`)});
            await openMore();
            assert(await more.locator('.rich-text-toolbar-more-panel').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight;}));
            assert(await more.locator('.rich-text-toolbar-more-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1), `No hidden horizontal tools in More at ${width}px`);
            if (width === 260 || width === 520) await more.locator('.rich-text-toolbar-more-panel').screenshot({path:path.join(output,`text-toolbar-more-${width}.png`)});
            await closeMore();
        }
        await openMore(); await more.getByLabel('More formatting tools',{exact:true}).focus(); await page.keyboard.press('Escape'); assert(!await more.evaluate(el=>el.open));
        await core('Finish editing').click(); assert(await toolbar.isHidden());
        await board.getByRole('button',{name:'Show text toolbar',exact:true}).click(); assert(await toolbar.isVisible());
        assert.equal(await toolbar.locator('.rich-text-scope-options').count(),0);
        await page.evaluate(()=>window.__TeacherScreenApp.saveStateImmediately());
        const saved = await page.evaluate(()=>window.__formatBoard.serialize().content);
        await page.reload(); await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager?.widgets?.some(info=>info.widget.constructor.name==='RichTextWidget'));
        assert.equal(await page.evaluate(()=>window.__TeacherScreenApp.layoutManager.widgets.find(info=>info.widget.constructor.name==='RichTextWidget').widget.serialize().content),saved);
        assert.deepEqual(errors,[]);
        console.log('PASS: Compact and narrow toolbars fit; SVG icons work without icon fonts; Escape, Finish/Edit and saved content work.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
