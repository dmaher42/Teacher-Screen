const assert=require('node:assert/strict');const fs=require('node:fs');const http=require('node:http');const path=require('node:path');const {chromium}=require('playwright-core');
async function openInstructionSection(page) {
 const section=page.locator('#instruction-controls-section');
 if(await section.getAttribute('open')===null) await section.locator(':scope > summary').click();
}
async function run() {
 const root=path.resolve(__dirname,'..');
 // Cache the exact old asset URLs. Sentinel responses make reuse observable,
 // without copying an old app or requiring Git history in a shallow checkout.
 const stale=new Set(['/js/index.js?v=76','/js/main.js?v=76','/js/utils/instruction-rail.js','/js/widgets/reveal-manager-widget.js?v=76','/js/widgets/reveal-manager-widget.js?v=51','/css/instruction-rail.css','/js/projector.js?v=24']);
 const requests=new Map();
 const server=http.createServer((req,res)=>{
  requests.set(req.url,(requests.get(req.url)||0)+1);
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/warm-cache.html')return res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<!doctype html><title>Synthetic cache warmup</title>');
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  const css=pathname.endsWith('.css');res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
  res.setHeader('Cache-Control',pathname==='/'||pathname.endsWith('.html')?'no-store':'public, max-age=600');
  if(stale.has(req.url))return res.end(css?'#instruction-rail { display: none !important; }':'throw new Error("Stale cache asset executed");');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const page=await context.newPage();
  const blockExternal=async p=>{const session=await context.newCDPSession(p);await session.send('Network.enable');await session.send('Network.setBlockedURLs',{urls:['https://*']});};
  await blockExternal(page);const base=`http://127.0.0.1:${server.address().port}`;await page.goto(base+'/warm-cache.html');
  await page.evaluate(async urls=>{for(const url of urls){await(await fetch(url)).text();await(await fetch(url)).text();}},[...stale]);
  for(const url of stale)assert.equal(requests.get(url),1,'Warmup must actually reuse HTTP cache: '+url);
  await page.goto(base);await page.waitForFunction(()=>window.__TeacherScreenApp?.layoutManager);
  await page.evaluate(async()=>{const app=window.__TeacherScreenApp;app.createNewProject('Synthetic cache upgrade');app.handleNavClick('classroom');await app.ensureRevealManagerWidget();app.projectState.instructions={visible:true,today:'Cache upgrade check',now:'Synthetic evidence',next:'Explain',width:30,fontSize:28};app.renderProjectControls();app.toggleTeacherPanel(true);});
  await openInstructionSection(page);await page.locator('[data-instruction-size-preset]').selectOption('high-visibility');
  assert.deepEqual(await page.evaluate(()=>({width:window.__TeacherScreenApp.projectState.instructions.width,font:window.__TeacherScreenApp.projectState.instructions.fontSize})),{width:40,font:38});
  assert(await page.evaluate(()=>typeof window.RevealManagerWidget.prototype.toggleMoreMenu==='function'));
  await page.evaluate(()=>window.__TeacherScreenApp.saveStateImmediately());
  const projector=await context.newPage();await blockExternal(projector);await projector.goto(await page.evaluate(()=>window.__TeacherScreenApp.getPairedProjectorUrl()));
  await projector.waitForFunction(()=>document.querySelector('[data-instruction="today"]')?.textContent==='Cache upgrade check');
  assert.equal(await projector.locator('#instruction-rail').evaluate(e=>getComputedStyle(e).fontSize),'38px');
  for(const url of stale)assert.equal(requests.get(url),1,'New app must not request the stale URL: '+url);
  assert([...requests.keys()].some(url=>url.startsWith('/js/utils/instruction-rail.js?v=')));
  assert([...requests.keys()].some(url=>url.startsWith('/css/instruction-rail.css?v=')));
  assert.deepEqual(errors,[]);console.log('PASS: Mixed-cache upgrade bypasses old bootstrap, module, widget, CSS and projector URLs; selector and public sync work');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
