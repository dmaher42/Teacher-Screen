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
 const root=path.resolve(__dirname,'..');
 const output=path.join(root,'output/playwright');fs.mkdirSync(output,{recursive:true});
 const libraries=new Map(await Promise.all(['reveal.js','reveal.css'].map(async name=>{
  const url=`https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/${name}`;const response=await fetch(url);assert(response.ok);return [url,await response.text()];
 })));
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 const baseUrl=process.env.TEACHER_SCREEN_SMOKE_URL||`http://127.0.0.1:${server.address().port}`;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.route(/^https:\/\//,route=>libraries.has(route.request().url())?route.fulfill({contentType:route.request().url().endsWith('.css')?'text/css':'text/javascript',body:libraries.get(route.request().url())}):route.request().url().startsWith(baseUrl)?route.continue():route.abort());
  const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();await page.goto(baseUrl);await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager);
  await page.evaluate(async()=>{
   const app=window.__TeacherScreenApp;app.createNewProject('Synthetic compact lesson',{className:'Synthetic class'});app.handleNavClick('classroom');
   app.projectState.instructions={visible:true,width:30,fontSize:28,today:'Compare examples',now:'Collect evidence',next:'Explain the difference'};app.renderProjectControls();await app.ensureRevealManagerWidget();
   const widget=app.getPrimaryRevealManagerWidget();await widget.launchDeck({id:9321,type:'html',name:'Synthetic presentation',content:Array.from({length:6},(_,i)=>`<section><h1>Example ${i+1}</h1></section>`).join('')});
   window.__compactWidget=widget;app.saveStateImmediately();
  });
  const ready=()=>page.waitForFunction(()=>window.__compactWidget?.revealDeck?.isReady());const index=()=>page.evaluate(()=>window.__compactWidget.currentIndices.h);
  const more=page.locator('.reveal-more-btn');const menu=page.locator('.reveal-more-menu');await ready();
  assert.equal(await page.locator('.reveal-manager__topbar > button:visible').count(),3);assert((await page.locator('.reveal-manager__topbar').boundingBox()).height<=64);
  assert(!await page.locator('.reveal-projector-btn').isVisible());
  for(let n=0;n<3;n++)await page.getByRole('button',{name:'Next slide',exact:true}).click();assert.equal(await index(),3);
  for(let n=0;n<2;n++)await page.getByRole('button',{name:'Previous slide',exact:true}).click();assert.equal(await index(),1);
  await page.locator('.reveal-slide-select').selectOption('2:0');assert.equal(await index(),2);
  await more.focus();await page.keyboard.press('ArrowDown');assert(await menu.isVisible());assert.equal(await more.getAttribute('aria-expanded'),'true');
  await page.screenshot({path:path.join(output,'compact-presentation-more.png')});
  assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Open projector');
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Change presentation');
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');assert.equal(await index(),2);
  await page.keyboard.press('Escape');assert(!await menu.isVisible());assert(await more.evaluate(e=>document.activeElement===e));
  await more.click();await page.keyboard.press('Tab');assert(!await menu.isVisible());
  await more.click();await page.locator('#instruction-rail').click();await page.waitForFunction(()=>!document.querySelector('.reveal-more-menu').matches(':popover-open'));
  for(let n=0;n<3;n++){await page.locator('#sections-toggle').click();const before=await index();await page.keyboard.press('ArrowRight');assert.equal(await index(),before);await page.evaluate(()=>window.__TeacherScreenApp.handleNavClick('classroom'));}
  await page.locator('.reveal-manager-widget-content').focus();await page.keyboard.press('ArrowRight');assert.equal(await index(),3);
  console.log('PASS: One-row controls, repeated navigation/Home isolation, menu keyboard/Tab/Escape and outside click');
  await page.locator('#add-widget-btn').click();const beforeDialog=await index();await page.locator('#widget-modal .modal-close').focus();await page.keyboard.press('ArrowLeft');assert.equal(await index(),beforeDialog);await page.keyboard.press('Escape');
  await page.locator('#add-widget-btn').click();await page.locator('#widget-picker-teacher-controls-btn').click();await openInstructionSection(page);
  await page.locator('[data-instruction-size-preset]').selectOption('high-visibility');
  assert.deepEqual(await page.evaluate(()=>({width:window.__TeacherScreenApp.projectState.instructions.width,font:window.__TeacherScreenApp.projectState.instructions.fontSize})),{width:40,font:38});
  await page.locator('.instruction-fine-tuning > summary').click();await page.locator('[data-instruction-field="width"]').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-instruction-size-preset]').inputValue(),'custom');assert.equal(await index(),beforeDialog);
  await page.locator('[data-instruction-field="today"]').focus();await page.keyboard.press('ArrowLeft');assert.equal(await index(),beforeDialog);
  await page.locator('[data-instruction-size-preset]').selectOption('large');await page.locator('.instruction-fine-tuning > summary').click();
  await page.screenshot({path:path.join(output,'compact-instruction-selector.png')});await page.evaluate(()=>window.__TeacherScreenApp.saveStateImmediately());await page.reload();
  await page.waitForFunction(()=>window.__TeacherScreenApp?.projectState?.instructions?.fontSize===30);
  await page.evaluate(()=>{window.__TeacherScreenApp.handleNavClick('classroom');window.__compactWidget=window.__TeacherScreenApp.getPrimaryRevealManagerWidget();});await ready();
  await page.locator('#add-widget-btn').click();await page.locator('#widget-picker-teacher-controls-btn').click();await openInstructionSection(page);assert.equal(await page.locator('[data-instruction-size-preset]').inputValue(),'large');
  await openInstructionSection(page);
        await page.locator('[data-present-instructions="whole"]').click();await page.waitForFunction(()=>document.fullscreenElement?.id==='student-view');
  await more.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert(!await menu.isVisible());assert.equal(await page.evaluate(()=>document.fullscreenElement?.id),'student-view');
  await page.screenshot({path:path.join(output,'compact-presentation-fullscreen.png')});await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.fullscreenElement);
  console.log('PASS: Compact sizing selector/custom adjustments, edit/dialog guards, persistence and nested fullscreen Escape');
  await page.setViewportSize({width:390,height:844});
  // Allow the app's resize observer to finish fitting the canvas before measuring.
  await page.waitForFunction(()=>{
   const bar=document.querySelector('.reveal-manager__topbar');const outer=bar.getBoundingClientRect();
   return Array.from(bar.querySelectorAll('button,select')).filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().right<=outer.right+.5);
  });
  await more.click();const bounds=await menu.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=844);
  const narrowGeometry=await page.locator('.reveal-manager__topbar').evaluate(bar=>({outer:bar.getBoundingClientRect().toJSON(),controls:Array.from(bar.querySelectorAll('button,select')).filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent,box:e.getBoundingClientRect().toJSON()}))}));
  assert(await page.locator('.reveal-manager__topbar').evaluate(bar=>{
   const outer=bar.getBoundingClientRect();const boxes=Array.from(bar.querySelectorAll('button,select')).filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());
   return boxes.every(b=>b.height>=44&&b.left>=outer.left&&b.right<=outer.right+.5)&&boxes.every((a,i)=>boxes.every((b,j)=>i===j||a.right<=b.left+.5||b.right<=a.left+.5||a.bottom<=b.top+.5||b.bottom<=a.top+.5));
  }), `Narrow controls must stay within the toolbar with touch targets and no overlap: ${JSON.stringify(narrowGeometry)}`);await page.screenshot({path:path.join(output,'compact-controls-narrow.png')});
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:900});
  await more.click();const popup=context.waitForEvent('page');await menu.getByRole('menuitem',{name:'Open projector',exact:true}).click();const projector=await popup;
  await projector.waitForFunction(()=>window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.revealDeck?.isReady());
  assert.equal(await projector.getByRole('menu').count(),0);assert.equal(await projector.locator('#instruction-presentation-controls').count(),0);assert.equal(await projector.locator('#instruction-rail').evaluate(e=>getComputedStyle(e).fontSize),'30px');
  await more.click();await menu.getByRole('menuitem',{name:'Expand presentation on projector',exact:true}).click();await projector.waitForSelector('.projector-presentation-fullscreen');
  assert(await projector.evaluate(()=>document.querySelector('.projector-presentation-fullscreen').getBoundingClientRect().right<=document.getElementById('instruction-rail').getBoundingClientRect().left+1));
  await projector.screenshot({path:path.join(output,'compact-projector-media.png')});await projector.reload();await projector.waitForFunction(()=>window.__TeacherScreenProjectorApp?.getRevealWidgets()[0]?.revealDeck?.isReady());
  await page.locator('.reveal-slide-select').selectOption('4:0');await projector.waitForFunction(()=>window.__TeacherScreenProjectorApp.getRevealWidgets()[0].currentIndices.h===4);
  await more.click();await menu.getByRole('menuitem',{name:'Close presentation',exact:true}).click();await projector.waitForFunction(()=>!window.__TeacherScreenProjectorApp.getRevealWidgets()[0]?.activeDeck);
  assert(await page.locator('.reveal-toggle-controls-btn').isVisible());assert(await page.locator('.reveal-toggle-controls-btn').evaluate(e=>document.activeElement===e));
  console.log('PASS: Narrow menu bounds, projector separation/reconnect/navigation/expansion and Close focus recovery');assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
