const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
 const root = path.resolve(__dirname, '..');
 const server = http.createServer((req,res) => {
  const file = path.resolve(root, '.' + (new URL(req.url,'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url,'http://localhost').pathname));
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser = await chromium.launch({channel:'msedge',headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  await context.route(/^https:\/\//, route => process.env.TEST_REAL_QUILL && /cdn\.jsdelivr\.net\/npm\/quill@2\.0\.3\//.test(route.request().url()) ? route.continue() : route.abort());
  const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager);
  if (process.env.TEST_REAL_QUILL) await page.waitForFunction(()=>window.Quill,null,{timeout:15000});
  const original = '<h2 class="ql-align-center">Mentor sentence</h2><p><strong>Read closely</strong></p><ol><li data-list="bullet"><span class="ql-ui"></span>Find the pronoun</li><li><em>Explain its job</em></li></ol>';
  await page.evaluate(html=>{
   const app=window.__TeacherScreenApp; app.createNewProject('Synthetic pinned outline',{className:'Synthetic A'}); app.handleNavClick('classroom');
   app.projectState.instructions={visible:true,today:'Legacy <literal>',now:'Earlier work',next:'Later work'};
   app.addWidget('rich-text',{initialData:{content:html,customTitle:'Outline'}});
  },original);
  await page.locator('.widget-header-menu > summary').click();
  await page.getByRole('button',{name:'Pin as instructions',exact:true}).click();
  await page.evaluate(()=>window.__TeacherScreenApp.saveStateImmediately());
  assert.equal(await page.locator('#widgets-container .rich-text-widget-inner').count(),0,'Pinned source is not duplicated on canvas');
  assert.equal(await page.locator('#instruction-outline strong').textContent(),'Read closely');
  assert.equal(await page.locator('#instruction-outline h2').getAttribute('class'),'ql-align-center');
  assert.equal(await page.locator('#instruction-outline li[data-list="bullet"] .ql-ui').count(),1);
  assert(await page.locator('#instruction-outline h2').evaluate(node=>getComputedStyle(node).color===getComputedStyle(document.getElementById('instruction-rail')).color),'Default headings remain readable on the rail');
  const pinned=await page.evaluate(()=>window.__TeacherScreenApp.buildStateSnapshot().instructions);
  assert(!('content' in pinned.origin.widget.data),'Only one authoritative copy of outline');
  const projector=await context.newPage(); await projector.goto(await page.evaluate(()=>window.__TeacherScreenApp.getPairedProjectorUrl()));
  await projector.waitForFunction(()=>document.querySelector('#instruction-outline strong')?.textContent==='Read closely');
  fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});
  await projector.screenshot({path:path.join(root,'output/playwright/pinned-outline-projector.png')});
  const publicState=await page.evaluate(()=>window.__TeacherScreenApp.buildProjectorStateSnapshot());
  assert(!publicState.instructions.origin); assert(!JSON.stringify(publicState).includes('Legacy &lt;literal&gt;'));
  await page.evaluate(()=>{const app=window.__TeacherScreenApp;app.toggleTeacherPanel(true);document.getElementById('instruction-controls-section').open=true;});
  await page.waitForSelector('#instruction-outline-editor [contenteditable=true]');
  await page.locator('#instruction-outline-editor [contenteditable=true]').fill('Edited once');
  await projector.waitForFunction(()=>document.querySelector('#instruction-outline')?.textContent==='Edited once');
  await page.evaluate(()=>{window.__TeacherScreenApp.createNewPage('Media');window.__TeacherScreenApp.saveStateImmediately();});
  assert.equal(await page.locator('#instruction-outline').textContent(),'Edited once');
  await page.reload(); await page.waitForFunction(()=>window.__TeacherScreenApp?.projectState?.instructions?.origin);
  await projector.reload();await projector.waitForFunction(()=>document.querySelector('#instruction-outline')?.textContent==='Edited once');
  await page.evaluate(()=>{
   const app=window.__TeacherScreenApp; const payload=app.buildExportPayload();
   window.__outlineRoundtrip=app.buildReplaceImportPlan(app.prepareImport(JSON.stringify(payload),'replace')).state.instructions;
  });
  assert.deepEqual(await page.evaluate(()=>window.__outlineRoundtrip),await page.evaluate(()=>window.__TeacherScreenApp.buildStateSnapshot().instructions));
  await page.evaluate(()=>document.querySelector('[data-unpin-outline]').click());
  const restored=await page.evaluate(()=>window.__TeacherScreenApp.buildStateSnapshot());
  assert(restored.instructions.html.includes('Legacy &lt;literal&gt;'),'Unpin restores all previous instructions');
  const boards=restored.pages.flatMap(p=>p.snapshot.layout.widgets).filter(w=>w.type==='RichTextWidget');
  assert.equal(boards.length,1);assert(boards[0].data.content.includes('Edited once'));
  // A deleted source page must not delete the deck outline or strand Unpin.
  await page.evaluate(async()=>{
   const app=window.__TeacherScreenApp;
   const source=app.projectState.pages.find(p=>p.snapshot.layout.widgets.some(w=>w.type==='RichTextWidget'));
   await app.switchToPage(source.id);
   const board=app.layoutManager.widgets.find(info=>info.widget.constructor.name==='RichTextWidget').widget;
   board.getHeaderMenuActions().find(action=>action.label==='Pin as instructions').onSelect();
   const other=app.projectState.pages.find(p=>p.id!==source.id);await app.switchToPage(other.id);
   app.projectState.pages=app.projectState.pages.filter(p=>p.id!==source.id);
   document.querySelector('[data-unpin-outline]').click();app.saveStateImmediately();
  });
  assert.equal(await page.locator('#widgets-container .rich-text-widget-inner').count(),1,'Unpin falls back to current page when source page was deleted');
  await page.evaluate(()=>{const app=window.__TeacherScreenApp;app.createNewProject('Synthetic B',{className:'Synthetic B'});app.saveStateImmediately();});
  await projector.waitForFunction(()=>document.querySelector('#instruction-rail').hidden && document.querySelector('#instruction-outline').textContent==='');
  await page.evaluate(()=>{
   const app=window.__TeacherScreenApp;
   app.handleNavClick('classroom');
   app.projectState.instructions={visible:true,html:'<p style="position:fixed;inset:0" onclick="alert(1)"><b>Safe outline</b><script>alert(1)</script></p>'};
   app.renderProjectControls();
  });
  assert.equal(await page.locator('#instruction-outline script').count(),0);
  assert.equal(await page.locator('#instruction-outline [onclick]').count(),0);
  assert.equal(await page.locator('#instruction-outline p').evaluate(e=>e.style.position),'');
  fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});
  await page.screenshot({path:path.join(root,'output/playwright/pinned-outline.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: Pin/edit/page changes/reload/projector/export/unpin/legacy restoration/empty deck/sanitization');
 } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
