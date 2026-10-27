const assert=require('node:assert/strict');const fs=require('node:fs');const http=require('node:http');const path=require('node:path');const {chromium}=require('playwright-core');
async function openInstructionSection(page) {
 const section=page.locator('#instruction-controls-section');
 if(await section.getAttribute('open')===null) await section.locator(':scope > summary').click();
}
async function run() {
 const root=path.resolve(__dirname,'..');
 // Cache the exact old asset URLs. Sentinel responses make reuse observable,
 // without copying an old app or requiring Git history in a shallow checkout.
 const stale=new Set(['/js/index.js?v=76','/js/main.js?v=76','/js/utils/instruction-rail.js','/js/widgets/reveal-manager-widget.js?v=76','/js/widgets/reveal-manager-widget.js?v=51','/css/instruction-rail.css','/js/projector.js?v=24','/css/main.css?v=62','/css/main.css?v=46','/js/index.js?v=78','/js/main.js?v=78','/js/utils/layout-manager.js?v=78','/js/projector.js?v=26','/js/index.js?v=79','/js/main.js?v=79','/js/utils/layout-manager.js?v=79','/js/index.js?v=80','/js/main.js?v=80','/js/utils/layout-manager.js?v=80','/js/projector.js?v=27','/js/projector.js?v=28','/css/main.css?v=63','/css/main.css?v=64','/css/instruction-rail.css?v=3','/css/instruction-rail.css?v=4','/js/utils/instruction-rail.js?v=4','/js/index.js?v=81','/js/main.js?v=81','/css/instruction-rail.css?v=5','/js/projector.js?v=29','/js/index.js?v=82','/js/main.js?v=82','/js/projector.js?v=30','/css/instruction-rail.css?v=6','/js/utils/instruction-rail.js?v=5','/js/index.js?v=83','/js/main.js?v=83','/js/projector.js?v=31','/css/instruction-rail.css?v=7','/js/utils/instruction-rail.js?v=6','/js/index.js?v=84','/js/main.js?v=84','/js/projector.js?v=32','/css/instruction-rail.css?v=8','/js/utils/instruction-rail.js?v=7','/js/widgets/rich-text-widget.js?v=84','/js/index.js?v=85','/js/main.js?v=85','/js/projector.js?v=33','/css/instruction-rail.css?v=9','/js/widgets/rich-text-widget.js?v=85','/js/utils/layout-manager.js?v=85','/js/index.js?v=86','/js/main.js?v=86','/js/projector.js?v=34','/css/main.css?v=65','/js/widgets/rich-text-widget.js?v=86','/js/index.js?v=87','/js/main.js?v=87','/js/projector.js?v=35','/css/main.css?v=66','/js/widgets/rich-text-widget.js?v=87']);
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
  await page.evaluate(async()=>{const app=window.__TeacherScreenApp;app.createNewProject('Synthetic cache upgrade');app.handleNavClick('classroom');await app.ensureRevealManagerWidget();app.addWidget('rich-text',{initialData:{content:'<p>Cache upgrade check</p>',showOnEveryPage:true,keepInFront:true}});app.renderProjectControls();app.toggleTeacherPanel(true);});
  assert(await page.getByLabel('Show on every page',{exact:true}).isChecked());
  assert(await page.getByLabel('Keep in front of presentations',{exact:true}).isChecked());
  assert(await page.evaluate(()=>typeof window.RevealManagerWidget.prototype.toggleMoreMenu==='function'));
  await page.evaluate(()=>window.__TeacherScreenApp.saveStateImmediately());
  const projector=await context.newPage();await blockExternal(projector);await projector.goto(await page.evaluate(()=>window.__TeacherScreenApp.getPairedProjectorUrl()));
  await projector.waitForFunction(()=>document.querySelector('.text-board-front-layer .widget.rich-text-widget')?.textContent.includes('Cache upgrade check'));
  assert.equal(await projector.locator('.text-board-front-layer .widget.rich-text-widget').count(),1);
  for(const url of stale)assert.equal(requests.get(url),1,'New app must not request the stale URL: '+url);
  assert([...requests.keys()].some(url=>url.startsWith('/js/utils/instruction-rail.js?v=')));
  assert([...requests.keys()].some(url=>url.startsWith('/css/instruction-rail.css?v=')));
  assert(requests.has('/css/main.css?v=67'),'Timer menu fix must bypass the cached stylesheet');
  assert(requests.has('/js/utils/layout-manager.js?v=88'),'Menu Escape fix must bypass the cached layout manager');
  assert.deepEqual(errors,[]);console.log('PASS: Mixed-cache upgrade bypasses old bootstrap, module, widget, CSS and projector URLs; selector and public sync work');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
