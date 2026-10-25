const assert=require('node:assert/strict'),fs=require('fs'),http=require('http'),path=require('path');
const {chromium}=require('playwright-core');
(async()=>{
 const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.route(/^https:\/\//,route=>route.request().url().includes('cdn.jsdelivr.net/npm/quill@2.0.3/')?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager);
  const fixture=await page.evaluate(()=>{
   const app=window.__TeacherScreenApp;app.createNewProject('Synthetic rollback lesson',{className:'Synthetic A'});app.createNewPage('Media page');app.saveStateImmediately();
   const state=app.buildStateSnapshot();const source=state.pages[0];
   state.instructions={visible:true,width:30,fontSize:28,html:'<h2>Recovered outline</h2><p><strong>Keep this formatting</strong></p>',origin:{pageId:source.id,widget:{type:'RichTextWidget',x:40,y:40,width:520,height:340,visibleOnProjector:true,data:{customTitle:'My lesson outline'}},previous:{visible:true,width:30,fontSize:28,html:'<h2>Today</h2><p>Recovered legacy instruction</p><h2>Next</h2><p>Next activity</p>'}}};
   const record={stage:'next',links:[{name:'Original resource',url:'https://example.org/original'}],taught:{date:'2026-10-20',title:'PRIVATE RECORD SENTINEL',className:'Synthetic A',pageName:'Page 1',outline:'<p><em>Frozen taught outline</em></p>',links:[],resources:[{name:'Original.pdf'}]}};
   const presets=app.presets.map(preset=>preset.id===state.currentDeckId?{...preset,projectState:state,lessonRecord:record}:preset);
   return {state,presets,sourceId:source.id,record};
  });
  await page.addInitScript(fixture=>{if(!localStorage.getItem('__rollbackFixtureSeeded')){localStorage.setItem('classroomScreenState',JSON.stringify(fixture.state));localStorage.setItem('classroomLayoutPresets',JSON.stringify(fixture.presets));localStorage.setItem('__rollbackFixtureSeeded','1');}},fixture);
  await page.reload();await page.waitForFunction(()=>window.__TeacherScreenApp?.projectState?.projectName==='Synthetic rollback lesson');
  assert.equal(await page.locator('#class-lesson-dashboard').count(),0);assert.equal(await page.locator('[data-instruction-field="today"]').count(),1);assert.equal(await page.locator('#instruction-outline-editor').count(),0);
  const recovered=await page.evaluate(()=>window.__TeacherScreenApp.buildStateSnapshot());
  assert.equal(recovered.instructions.today,'Recovered legacy instruction');assert.equal(recovered.instructions.next,'Next activity');assert(!('html' in recovered.instructions));
  const source=recovered.pages.find(p=>p.id===fixture.sourceId);assert(source.snapshot.layout.widgets.some(widget=>widget.data?.content?.includes('<strong>Keep this formatting</strong>')));
  const recordPage=recovered.pages.find(p=>p.name==='Saved lesson record');assert(recordPage);assert.equal(recordPage.snapshot.layout.widgets[0].visibleOnProjector,false);
  await page.evaluate(async sourceId=>{const app=window.__TeacherScreenApp;app.handleNavClick('classroom');await app.switchToPage(sourceId);app.saveStateImmediately();},fixture.sourceId);
  await page.waitForFunction(()=>window.Quill);await page.waitForSelector('.rich-text-widget-inner .ql-editor[contenteditable=true]');
  await page.locator('.rich-text-widget-inner .ql-editor').fill('Edited recovered outline');await page.evaluate(()=>window.__TeacherScreenApp.saveStateImmediately());
  const projector=await context.newPage();await projector.goto(await page.evaluate(()=>window.__TeacherScreenApp.getPairedProjectorUrl()));await projector.waitForFunction(()=>document.querySelector('.rich-text-widget-inner')?.textContent.includes('Edited recovered outline'));
  await page.evaluate(async id=>{await window.__TeacherScreenApp.switchToPage(id);window.__TeacherScreenApp.saveStateImmediately();},recordPage.id);
  assert((await page.locator('.rich-text-widget-inner').textContent()).includes('PRIVATE RECORD SENTINEL'));
  const privacy=await page.evaluate(()=>JSON.stringify(window.__TeacherScreenApp.buildProjectorStateSnapshot()));assert(!privacy.includes('PRIVATE RECORD SENTINEL'));assert(!privacy.includes('Frozen taught outline'));
  const livePrivacy=await page.evaluate(()=>{
   const app=window.__TeacherScreenApp,messages=[],channel=app.projectorChannel,send=channel.postMessage.bind(channel);
   channel.postMessage=message=>{messages.push(message);send(message);};
   try {const widget=app.layoutManager.widgets[0].widget;app.handleWidgetStateChange({widget,action:'content-updated'});app.saveStateImmediately();return JSON.stringify(messages);} finally {channel.postMessage=send;}
  });assert(!livePrivacy.includes('PRIVATE RECORD SENTINEL'));assert(!livePrivacy.includes('Frozen taught outline'));
  const exported=await page.evaluate(()=>{const app=window.__TeacherScreenApp;const payload=app.buildExportPayload();const prepared=app.prepareImport(JSON.stringify(payload),'replace');return {payload,restored:app.buildReplaceImportPlan(prepared),merged:app.buildMergeImportPlan(app.prepareImport(JSON.stringify(payload),'merge'))};});
  const saved=exported.payload.presets.find(p=>p.id===fixture.state.currentDeckId);assert.deepEqual({...saved.lessonRecord,rollbackRecovered:undefined},{...fixture.record,rollbackRecovered:undefined});
  assert(exported.restored.state.pages.some(p=>p.name==='Saved lesson record'));assert(exported.merged.presets.some(p=>p.lessonRecord?.taught?.title==='PRIVATE RECORD SENTINEL'));
  const pageCount=recovered.pages.length;await page.reload();await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager);assert.equal(await page.evaluate(()=>window.__TeacherScreenApp.projectState.pages.length),pageCount);
  await page.evaluate(()=>window.__TeacherScreenApp.handleNavClick('dashboard'));fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});await page.screenshot({path:path.join(root,'output/playwright/rollback-dashboard.png')});
  assert.deepEqual(errors,[]);console.log('PASS: Prior UI, automatic saved-state/preset migration, editable rich outline, private record access, export/replace/merge, projector privacy and reload idempotence');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
