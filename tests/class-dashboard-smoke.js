const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright-core');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route(/^https:\/\//,route=>route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager);
  const ids=await page.evaluate(()=>{
   const app=window.__TeacherScreenApp;const ids=[];
   for(const [name,className] of [['Pronouns','Synthetic A'],['Object forms','Synthetic A'],['Fractions','Synthetic B']]){
    app.createNewProject(name,{className});app.saveStateImmediately();ids.push(app.projectState.currentDeckId);
   }
   app.loadPreset(ids[0]);app.projectState.instructions={visible:true,html:'<h2>Pronouns</h2><p><strong>Explain the object form</strong></p>'};app.saveStateImmediately();
   app.dashboardSelectedClassName='Synthetic A';app.dashboardExpandedDeckId=ids[0];app.handleNavClick('dashboard');app.renderDashboard();return ids;
  });
  const card=id=>page.locator(`.dashboard-screen-card[data-deck-id="${id}"]`);
  const expand=async id=>{if(await card(id).locator('[data-deck-action="toggle"]').getAttribute('aria-expanded')!=='true')await card(id).locator('[data-deck-action="toggle"]').click();};
  assert.equal(await page.locator('.class-taught-history__entry').count(),0,'Opening a lesson never marks it taught');
  await card(ids[0]).locator('[data-lesson-stage]').selectOption('current');
  assert.equal(await page.locator('.class-lesson-summary__grid section').nth(0).getByRole('button').textContent(),'Pronouns');
  await expand(ids[1]);await card(ids[1]).locator('[data-lesson-stage]').selectOption('next');
  assert.equal(await page.locator('.class-lesson-summary__grid section').nth(1).getByRole('button').textContent(),'Object forms');
  await expand(ids[0]);await card(ids[0]).locator('.dashboard-deck-more > summary').click();
  const dialogs=['https://drive.google.com/drive/folders/synthetic','Class originals'];page.on('dialog',async dialog=>dialog.accept(dialogs.shift()));
  await card(ids[0]).locator('[data-deck-action="link"]').click();
  assert.equal(await page.locator('.class-lesson-summary__grid a').getAttribute('href'),'https://drive.google.com/drive/folders/synthetic');
  assert.equal(await page.locator('.class-lesson-summary__grid a').getAttribute('rel'),'noopener noreferrer');
  await expand(ids[0]);await card(ids[0]).locator('[data-deck-action="taught"]').click();
  assert.equal(await page.locator('.class-taught-history__entry').count(),1);
  const frozen=await page.evaluate(id=>window.__TeacherScreenApp.presets.find(p=>p.id===id).lessonRecord.taught,ids[0]);
  assert(frozen.outline.includes('<strong>Explain the object form</strong>'));assert.equal(frozen.links.length,1);
  await page.locator('[data-lesson-date]').fill('2026-10-20');await page.locator('[data-lesson-date]').dispatchEvent('change');
  assert.equal(await page.locator('[data-lesson-date]').inputValue(),'2026-10-20');
  assert(await page.locator('[data-lesson-date]').evaluate(node=>node===document.activeElement),'Date edit keeps keyboard focus');
  await page.evaluate(()=>{const app=window.__TeacherScreenApp;app.projectState.instructions.html='<p>Changed planning</p>';app.saveStateImmediately();app.renderDashboard();});
  assert.equal(await page.evaluate(id=>window.__TeacherScreenApp.presets.find(p=>p.id===id).lessonRecord.taught.outline,ids[0]),frozen.outline,'Taught outline is not overwritten by later planning');
  await page.reload();await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager);
  await page.evaluate(()=>{const app=window.__TeacherScreenApp;app.dashboardSelectedClassName='Synthetic A';app.renderDashboard();});
  assert.equal(await page.locator('[data-lesson-date]').inputValue(),'2026-10-20');
  const roundtrip=await page.evaluate(id=>{
   const app=window.__TeacherScreenApp;const payload=app.buildExportPayload();
   const plan=app.buildReplaceImportPlan(app.prepareImport(JSON.stringify(payload),'replace'));
   return {before:app.presets.find(p=>p.id===id).lessonRecord,after:plan.presets.find(p=>p.id===id).lessonRecord,publicState:app.buildProjectorStateSnapshot()};
  },ids[0]);assert.deepEqual(roundtrip.after,roundtrip.before);assert(!JSON.stringify(roundtrip.publicState).includes('Class originals'));
  await page.locator('.class-taught-history__entry > details > summary').click();
  fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});await page.screenshot({path:path.join(root,'output/playwright/class-dashboard-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dashboard fits narrow viewport');
  await page.screenshot({path:path.join(root,'output/playwright/class-dashboard-mobile.png'),fullPage:true});
  await page.locator('[data-lesson-undo]').click();assert.equal(await page.locator('.class-taught-history__entry').count(),0);
  await page.evaluate(()=>{const app=window.__TeacherScreenApp;app.dashboardSelectedClassName='Synthetic B';app.renderDashboard();});
  assert.equal(await page.locator('.class-lesson-summary__grid a').count(),0,'Resources stay in their class');
  assert.deepEqual(errors,[]);console.log('PASS: Explicit class Current/Next, original links, taught snapshot/date correction/undo, persistence/export/privacy and narrow dashboard');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
