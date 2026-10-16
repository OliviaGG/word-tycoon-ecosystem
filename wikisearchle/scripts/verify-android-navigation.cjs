'use strict';
// Local browser QA with fixture accounts/puzzles; no provider sign-in or
// production guesses/rewards are submitted. Set NODE_PATH to Playwright.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {Server}=require('socket.io');
const root=path.resolve(__dirname,'..'),publicDir=path.join(root,'public');
const out=process.env.WIKICONTEXTO_QA_OUTPUT || path.join(root,'android/app/build/navigation-qa');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
function slice(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const scope={...require('../lib/redactor'),crypto,SOLO_HANDLE_KEY:'fixture-key'};
vm.runInNewContext(slice('function soloHandle(', 'const gameShared =')+slice('function buildWeeklyPublic(', 'async function buildSoloEntryFromTitle('),scope);
const meta={dateKey:'2026-10-03',setAt:'2026-10-03T18:00:00.000Z',cleanTitle:'Quartz Nebula',plaintext:'Quartz nebula stone oak. Quartz is a nebula.',titleWordNorms:['quartz','nebula'],totalRankedWords:100};
const puzzle=scope.buildSoloEntryFromMeta(meta).public.snapshot;
const pages=new Map();require('../src/seo-middleware').attach({get:(route,handler)=>pages.set(route,handler)});
let soloAvailable=true;
const requests=[],server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
 const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(url.pathname==='/api/auth/exchange'){assert.equal(url.searchParams.get('token'),'fixture-token');res.setHeader('Set-Cookie','qa-session=verified; HttpOnly; SameSite=Lax; Path=/');return send({ok:true});}
 if(url.pathname==='/api/me/session')return send(req.headers.cookie?.includes('qa-session=verified')?{ok:true,user:{id:'fixture-account',username:'Explorer'}}:{ok:false,user:null});
 if(url.pathname==='/api/solo/status')return send({daily:{available:true,dateKey:'2026-10-04'},weekly:{available:false},random:{available:true}});
 if(url.pathname==='/api/solo/archive')return send({today:'2026-10-04',puzzles:[{dateKey:meta.dateKey}],hasMore:false,nextBefore:null});
 if(url.pathname==='/api/solo/archive/'+meta.dateKey)return send({available:true,...puzzle,setAt:'archive:'+meta.dateKey+':'+meta.setAt,dateKey:meta.dateKey,isArchive:true,isDaily:false,isWeekly:false});
 if(['/api/solo/daily','/api/solo/random'].includes(url.pathname))return send(soloAvailable?{available:true,...puzzle,isDaily:url.pathname.endsWith('daily'),isWeekly:false}:{available:false});
 if(url.pathname.startsWith('/api/'))return send({ok:false,user:null,equipped:{}});
 const handler=pages.get(url.pathname);
 if(handler)return handler({method:'GET',query:Object.fromEntries(url.searchParams),headers:req.headers},{set:(name,value)=>res.setHeader(name,value),send:html=>res.end(html)},error=>{res.statusCode=500;res.end(String(error));});
 const file=path.resolve(publicDir,'.'+url.pathname);if(!file.startsWith(publicDir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(fs.readFileSync(file));
});
const realtime=new Server(server);
realtime.on('connection',socket=>{
 socket.emit('wikisearchle-state',{targetWord:'(active)',topGuesses:[],scoreboard:[],guessCount:0,lastAnnounce:null});
 socket.emit('wikiword-state',{...puzzle,startedAt:1791079200000,won:false});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://wordtycoon.live/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:false,user:null,equipped:{}})}));
  await page.goto(origin+'/?source=play&auth_token=fixture-token#home',{waitUntil:'load'});
  await page.locator('#accountStatus').filter({hasText:'Hi, Explorer'}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('auth_token'),null);assert.equal(new URL(page.url()).searchParams.get('source'),'play');assert.equal(new URL(page.url()).hash,'#home');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wt_user')).id),'fixture-account');
  assert.deepEqual(await page.locator('.bubble-label').allTextContents(),['Solo','Online','Profile','Cosmetics','Daily','Previousdaily games']);
  await page.locator('.bubble-daily').click();await page.locator('#modeBar [data-mode=daily].active').waitFor();
  await page.locator('#soloHelpDialog').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>localStorage.getItem('wikicontexto-solo-tutorial-v1')),null);
  assert.ok(await page.locator('#soloHelpDialog').evaluate(el=>el.matches(':modal')));
  await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.getElementById('soloHelpDialog').contains(document.activeElement)));
  await page.screenshot({path:path.join(out,'solo-help-390.png'),fullPage:true});
  await page.locator('#soloHelpStart').click();await page.locator('#soloHelpDialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>localStorage.getItem('wikicontexto-solo-tutorial-v1')),'seen');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wt_user')).id),'fixture-account');
  await page.goBack({waitUntil:'load'});await page.locator('.bubble-menu').waitFor();
  await page.locator('.bubble-solo').click();await page.locator('#modeBar [data-mode=random].active').waitFor();
  assert.equal(await page.locator('#soloHelpDialog').isVisible(),false);
  await page.locator('#soloHelpToggle').click();await page.locator('#soloHelpDialog').waitFor({state:'visible'});
  await page.locator('#soloHelpClose').click();await page.locator('#soloHelpDialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'soloHelpToggle');
  await page.locator('#soloHelpToggle').click();await page.keyboard.press('Escape');await page.locator('#soloHelpDialog').waitFor({state:'hidden'});
  await page.locator('#soloHelpToggle').click();await page.locator('#soloHelpGuide').click();await page.locator('h1').filter({hasText:'How to play'}).waitFor();
  assert.deepEqual(await page.locator('.wk-guide-mode').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),['/solo','/online','/daily','/previous-dailies']);
  assert.equal(await page.locator('meta[name=theme-color]').getAttribute('content'),'#020a25');
  await page.screenshot({path:path.join(out,'how-to-play-390.png'),fullPage:true});
  await page.locator('.wk-guide-hero .wk-help-primary').click();await page.locator('#modeBar [data-mode=random].active').waitFor();
  assert.equal(await page.locator('#soloHelpDialog').isVisible(),false);
  await page.reload();await page.locator('#modeBar [data-mode=random].active').waitFor();assert.equal(await page.locator('#soloHelpDialog').isVisible(),false);
  await page.locator('.brand-link').click();await page.locator('.bubble-menu').waitFor();
  await page.locator('.bubble-history').click();await page.locator('.archive-game').click();await page.locator('#archiveReplayNote').waitFor();await page.goBack();await page.locator('.archive-game').waitFor();await page.goBack();await page.locator('.bubble-menu').waitFor();
  for(const shortcut of JSON.parse(fs.readFileSync(path.join(root,'android/twa-manifest.json'))).shortcuts){
   const u=new URL(shortcut.url);await page.goto(origin+u.pathname+u.search,{waitUntil:'load'});
   if(u.pathname==='/online')await page.locator('.site-header .brand-link').waitFor();else if(u.pathname==='/previous-dailies')await page.locator('.archive-game').waitFor();else await page.locator('#modeBar [data-mode='+ (u.pathname==='/daily'?'daily':'random')+'].active').waitFor();
  }
  for(const [label,width,height,light] of [['small',320,568,false],['tablet',768,1024,false],['desktop',1280,900,false],['light',390,844,true]]){
   const fresh=await browser.newContext({viewport:{width,height},isMobile:width<720,hasTouch:width<720});const p=await fresh.newPage();
   p.on('pageerror',e=>errors.push(e.message));
   await p.route('https://wordtycoon.live/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:false,user:null,equipped:{}})}));
   if(light)await p.addInitScript(()=>localStorage.setItem('wikisearchle-theme','light'));
   await p.goto(origin+'/solo');await p.locator('#soloHelpDialog').waitFor({state:'visible'});
   const box=await p.locator('#soloHelpDialog').boundingBox(),button=await p.locator('#soloHelpStart').boundingBox();
   assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,label+' dialog clipped');
   assert.ok(button.y>=0&&button.y+button.height<=height,label+' start button clipped');
   assert.ok(await p.locator('.wk-help-dialog-body').evaluate(el=>el.scrollWidth<=el.clientWidth),label+' tutorial overflow');
   await p.screenshot({path:path.join(out,'solo-help-'+label+'.png')});
   await p.locator('#soloHelpStart').click();await p.goto(origin+'/about');await p.locator('h1').waitFor();
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' guide overflow');
   await p.screenshot({path:path.join(out,'how-to-play-'+label+'.png'),fullPage:true});await fresh.close();
  }
  const restricted=await browser.newContext({viewport:{width:390,height:844}}),r=await restricted.newPage();r.on('pageerror',e=>errors.push(e.message));
  await r.addInitScript(()=>{
   const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
   Storage.prototype.getItem=function(key){if(this===localStorage&&key==='wikicontexto-solo-tutorial-v1')throw new DOMException('Blocked','SecurityError');return get.call(this,key);};
   Storage.prototype.setItem=function(key,value){if(this===localStorage&&key==='wikicontexto-solo-tutorial-v1')throw new DOMException('Blocked','SecurityError');return set.call(this,key,value);};
  });
  await r.goto(origin+'/solo');await r.locator('#soloHelpDialog').waitFor({state:'visible'});await r.locator('#soloHelpStart').click();
  assert.equal(await r.evaluate(()=>sessionStorage.getItem('wikicontexto-solo-tutorial-v1')),'seen');await r.reload();await r.locator('#modeBar [data-mode=random].active').waitFor();assert.equal(await r.locator('#soloHelpDialog').isVisible(),false);await restricted.close();
  const retry=await browser.newContext(),f=await retry.newPage();f.on('pageerror',e=>errors.push(e.message));soloAvailable=false;
  await f.goto(origin+'/solo');await f.locator('#gameLoadingTitle').filter({hasText:'Couldn’t load the game'}).waitFor();assert.equal(await f.locator('#soloHelpDialog').isVisible(),false);
  assert.equal(await f.evaluate(()=>localStorage.getItem('wikicontexto-solo-tutorial-v1')),null);soloAvailable=true;
  await f.reload();await f.locator('#soloHelpDialog').waitFor({state:'visible'});await retry.close();
  await page.goto(origin+'/?source=play');await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Let’s reconnect'}).waitFor();await context.setOffline(false);await page.getByRole('button',{name:'Try again'}).click();await page.locator('.bubble-menu').waitFor();
  assert.ok(!requests.includes('/api/solo/guess')&&!requests.includes('/api/solo/complete'));assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,'home-390.png'),fullPage:true});
  const result={fixtureSignInReturn:true,callbackTokenRemoved:true,androidSourcePreserved:true,homeOrder:true,browserBackAndHomeLinks:true,nativeShortcutDestinations:true,firstPlayTutorial:true,tutorialRememberedOnReload:true,manualHelpAndEscape:true,dialogFocusTrap:true,guideLinks:true,mobileDesktopAndLightLayouts:true,storageFallback:true,failedLoadDoesNotConsumeTutorial:true,offlineReconnect:true,productionAccountTests:false,pageErrors:errors};
  fs.writeFileSync(path.join(out,'navigation-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();realtime.close();server.close();}
})().catch(error=>{console.error(error);realtime.close();server.close();process.exitCode=1;});
