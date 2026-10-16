/* Browser regression checks against the actual page renderers. Fixture hooks
   exist only in the HTTP responses below, never in deployed application files. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const assert = require('node:assert/strict');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/johnr/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(path.join(runtime, 'playwright'));
const {PNG} = require(path.join(runtime, 'pngjs'));
const root = path.resolve(__dirname, '..'), output = path.join(root, 'tmp/refined-verification');
fs.mkdirSync(output, {recursive: true});
const files = ['index.html', 'overlay.html', 'overlay-unified.html', 'solo/index.html'];
const fixtures = new Map();
for (const file of files) {
  let html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/.test(script[1])) new vm.Script(script[2], {filename: file});
  }
  if (!file.startsWith('solo')) {
    const marker = '  // ── Socket events';
    assert.ok(html.includes(marker), file);
    html = html.replace(marker, '  window.fixture = {render: renderCards, activate: setActive, guesses: _guessCards};\n' + marker);
  }
  fixtures.set('/' + file, html);
}
let solo = fs.readFileSync(path.join(root, 'public/solo/solo.js'), 'utf8');
solo = solo.replace('  init();', `  window.fixture = {
    render(top, user, restored = false) {
      state = {top: top.slice(0, TOP_N)}; wikiUser = user; gameAreaEl.hidden = false;
      document.body.classList.add('game-active');
      if (restored) _guessCards.snapshot(top);
      renderCards();
    }, guesses: _guessCards,
  };`);
fixtures.set('/solo/solo.js', solo);
const socketStub = `window.io = () => {const handlers = {}; window.testSocket = {on(n,f) {handlers[n]=f;return this;},emit(){}, trigger(n,d){handlers[n]?.(d);}};return window.testSocket;};`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'), name = url.pathname;
  let body = fixtures.get(name), type;
  if (name === '/socket.io/socket.io.js') body = socketStub;
  else if (name.startsWith('/api/')) {body = JSON.stringify({available: false}); type = 'application/json';}
  if (body === undefined) {
    const candidates = [path.join(root, 'public', name.replace(/^\//, '')), path.join(root, 'tmp/refined-canonical/public', name.replace(/^\//, ''))];
    const file = candidates.find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
    if (file) body = fs.readFileSync(file);
  }
  if (body === undefined) {res.writeHead(404);return res.end();}
  type ||= name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, {'content-type': type});res.end(body);
});
const catalogFile = process.env.COSMETICS_CATALOG;
function equipped(set) {
  const cos = {};
  const catalog = fs.readFileSync(catalogFile, 'utf8');
  for (const line of catalog.split('\n').filter(s => s.includes("id: 'set_" + set + '_'))) {
    const item = vm.runInNewContext('(' + line.trim().replace(/,$/, '') + ')');
    if (item.css) cos[item.category] = {...item.css, ...(item.render ? {render: item.render} : {})};
  }
  return cos;
}
const sets = catalogFile ? [equipped('sf'), equipped('dc')] : JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/refined-cosmetics.json'),'utf8'));
assert.ok(sets.every(c => c.hero_badge && c.word_color && c.word_glow && c.profile_border));
const report = [];
async function setup(page, file, size) {
  await page.setViewportSize(size);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' && url.port !== String(server.address().port)) {
      // The app's local asset base points to the hub; use the live shared
      // avatar applier and cosmetic animations during these fixtures.
      if (/pfp-cosmetics\.js|cosmetics-fx\.css/.test(url.pathname)) {
        const result = await page.request.get('https://wordtycoon.live' + url.pathname + url.search);
        return route.fulfill({status: result.status(), body: await result.body(), contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css'});
      }
      return route.fulfill({status: 200, body: '{}', contentType: 'application/json'});
    }
    if (!['localhost', 'fonts.googleapis.com', 'fonts.gstatic.com', 'wordtycoon.live'].includes(url.hostname)) return route.fulfill({status: 200, body: ''});
    if (url.hostname === 'wordtycoon.live' && !/pfp-cosmetics\.js|cosmetics-fx\.css|perk-badges\.js|\/cosmetics\//.test(url.pathname)) return route.fulfill({status: 200, body: ''});
    return route.continue();
  });
  const errors = [];page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${server.address().port}/${file}`, {waitUntil: 'load'});
  await page.waitForFunction(() => window.fixture && window.WikiGuessCards && window.WikiCosmetics);
  await page.evaluate(() => {
    const now=performance.now.bind(performance);let shift=0;
    window.advanceEntranceClock=()=>{shift+=10001;};
    Object.defineProperty(performance,'now',{value:()=>now()+shift});
    window.entranceLog=[];
    new MutationObserver(records=>records.forEach(r=>entranceLog.push([r.target.dataset.word,r.target.dataset.guessEntrance]))).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-guess-entrance']});
  });
  await page.evaluate(() => document.fonts.ready);
  return errors;
}
async function render(page, guesses, user, restored = false) {
  await page.evaluate(({guesses,user,restored}) => {
    if (fixture.activate) {fixture.activate();fixture.render(guesses, restored);}
    else fixture.render(guesses, user, restored);
  }, {guesses,user,restored});
  await page.waitForTimeout(160);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(60);
}
const user = {platform:'discord', platformUserId:'123456789', displayName:'Jorry', cosmetics:{}};
const guesses = () => ['stone', 'ocean', 'electroencephalographically', 'rain', 'architecture', 'sky'].map((word,i) => ({word, rank:[1,8,2000,7000,19000,70000][i],user:{...user, displayName: i === 4 ? 'A very long username' : user.displayName}}));
async function geometry(page) {
  return page.locator('.card[data-refined-guess]').evaluateAll(cards => cards.map(card => {
    const panel=card.querySelector('.who'), surface=card.querySelector('.guess-panel-surface'), word=card.querySelector('.word-lbl');
    const r=card.getBoundingClientRect(), p=panel.getBoundingClientRect(), s=surface.getBoundingClientRect();
    return {word:card.dataset.word,width:card.clientWidth,panelWidth:panel.offsetWidth,boundary:panel.offsetLeft,
      water:parseFloat(card.style.getPropertyValue('--guess-water-width')), compact:card.classList.contains('guess-panel-compact'),
      top:s.top-r.top,bottom:s.bottom-r.bottom,right:s.right-r.right, font:parseFloat(getComputedStyle(word).fontSize),
      textColor:getComputedStyle(word).color,overflow:word.scrollWidth-word.clientWidth, transform:getComputedStyle(panel).transform};
  }));
}
async function edgePixels(page, label, moving) {
  const card=page.locator('.card[data-refined-guess]').first();
  await card.evaluate((c,moving) => {
    c.classList.remove('guess-panel-painted');
    c.style.setProperty('--fill-pct','100%');
    c.querySelector('.fill').style.cssText='background:#00ff00 !important;opacity:1 !important;transition:none;';
    // Compare the actual plain background/rim, without asynchronous portrait
    // decoding or avatar antialiasing contributing unrelated pixel changes.
    c.querySelector('.avatar-fb').style.visibility='hidden';c.querySelector('.who-text').style.visibility='hidden';
    if(moving){ const a=c.animate([{translate:'0 0'},{translate:'0 7px'}],{duration:800,fill:'both'});a.pause();a.currentTime=350;window.testRowMotion=a; }
  }, moving);
  const bounds=await card.evaluate(c=> {
    const r=c.getBoundingClientRect(),panel=c.querySelector('.who'), p=panel.getBoundingClientRect();
    return {scale:r.width/c.offsetWidth, left:p.left-r.left, slant:parseFloat(getComputedStyle(c).getPropertyValue('--guess-slant'))};
  });
  const a=PNG.sync.read(await card.screenshot({animations:'allow'}));
  await card.locator('.fill').evaluate(el=>el.style.visibility='hidden');
  const b=PNG.sync.read(await card.screenshot({animations:'allow'}));
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  let changed=0;const changedPixels=[];
  for(let y=0;y<a.height;y++) for(let x=0;x<a.width;x++) {
    const panelEdge=bounds.left+bounds.slant*bounds.scale*(1-y/(a.height-1));
    if(x<Math.ceil(panelEdge)+1)continue;
    const i=(y*a.width+x)*4;
    if(Math.max(...[0,1,2].map(ch=>Math.abs(a.data[i+ch]-b.data[i+ch])))>3){changed++;changedPixels.push({x,y,before:[...a.data.slice(i,i+4)],after:[...b.data.slice(i,i+4)]});}
  }
  fs.writeFileSync(path.join(output,label+'.png'),PNG.sync.write(a));
  fs.writeFileSync(path.join(output,label+'-without-fill.png'),PNG.sync.write(b));
  if(changed)console.log({label,bounds,changedPixels});
  assert.equal(changed,0,label+' rank fill leaking under the plain panel');
  await card.evaluate(c=>{c.querySelector('.fill').style.cssText='';c.querySelector('.avatar-fb').style.visibility='';c.querySelector('.who-text').style.visibility='';window.testRowMotion?.cancel();});
  return {label,changed};
}
async function entrances(page) {
  const base=guesses();await render(page,base,user,true);
  assert.equal(await page.locator('[data-guess-entrance]').count(),0,'snapshot replay');
  const outcomes=[];
  for(const [index,kind] of ['glint','lift','pop'].entries()) {
    if(index)await page.evaluate(()=>advanceEntranceClock());
    await page.evaluate(() => fixture.guesses.reset());
    const g={word:'flourish'+index,rank:100,user};
    await page.evaluate(({word,roll})=>fixture.guesses.queue(word,()=>roll),{word:g.word,roll:[.01,.035,.065][index]});
    await render(page,[g,...base.slice(0,4)],user);
    await page.waitForFunction(k=>document.querySelector('[data-guess-entrance="'+k+'"]'),kind);
    await page.evaluate(() => {
      const panel=document.querySelector('[data-guess-entrance] .who');
      if(getComputedStyle(panel).transform!=='none')throw Error('plain background moved');
    });
    await page.waitForTimeout(1150);
    assert.equal(await page.locator('[data-guess-entrance], .guess-entrance-sheen').count(),0,'effect cleanup');
    await page.evaluate(word=>fixture.guesses.queue(word,()=>.01),g.word);
    await render(page,[g,...base.slice(0,4)],user);
    assert.equal(await page.locator('[data-guess-entrance]').count(),0,'same-word replay');
    if(index===0) {
      const next={word:'cooldown',rank:200,user};
      await page.evaluate(word=>fixture.guesses.queue(word,()=>.01),next.word);
      await render(page,[next,...base.slice(0,4)],user);
      assert.equal(await page.locator('[data-guess-entrance]').count(),0,'cooldown violated');
    }
    outcomes.push(kind);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(() => {fixture.guesses.reset();fixture.guesses.queue('reduced',()=>.01);});
  await render(page,[{word:'reduced',rank:100,user}],user);
  assert.equal(await page.locator('[data-guess-entrance]').count(),0,'reduced motion violated');
  await page.emulateMedia({reducedMotion:'no-preference'});
  // A choice for an offscreen first appearance survives without forcing the
  // row onscreen, then is consumed once. Subsequent scrolling cannot replay.
  await page.evaluate(() => {
    advanceEntranceClock();fixture.guesses.reset();
    document.querySelector('#cards').style.marginTop='1800px';
    fixture.guesses.queue('offscreen',()=>.01);
  });
  await render(page,[{word:'offscreen',rank:100,user}],user);
  assert.equal(await page.locator('[data-guess-entrance]').count(),0,'offscreen effect played');
  await page.locator('.card[data-word="offscreen"]').evaluate(c=>c.scrollIntoView({block:'center',behavior:'instant'}));
  try {await page.waitForFunction(()=>document.querySelector('[data-guess-entrance="glint"]'),null,{timeout:3000});}
  catch(e){console.log(await page.evaluate(async()=>{
    const card=document.querySelector('.card[data-word="offscreen"]');
    const intersection=await new Promise(resolve=>{const io=new IntersectionObserver(([v])=>{resolve({isIntersecting:v.isIntersecting,rect:v.intersectionRect.toJSON(),root:v.rootBounds.toJSON()});io.disconnect();});io.observe(card);});
    return {log:entranceLog,rect:card.getBoundingClientRect().toJSON(),height:innerHeight,hidden:document.hidden,intersection};
  }));throw e;}
  await page.evaluate(()=>{for(let p=document.querySelector('.card[data-word="offscreen"]').parentElement;p;p=p.parentElement)p.scrollTop=0;window.scrollTo(0,0);});
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-guess-entrance],.guess-entrance-sheen').count(),0,'offscreen cleanup');
  await page.locator('.card[data-word="offscreen"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  assert.equal(await page.locator('[data-guess-entrance]').count(),0,'scroll replay');
  await page.evaluate(()=>{document.querySelector('#cards').style.marginTop='';for(let p=document.querySelector('#cards');p;p=p.parentElement)p.scrollTop=0;window.scrollTo(0,0);});
  // Bounds of the probability interval, snapshot cancellation, and removal.
  await page.evaluate(()=>{fixture.guesses.reset();fixture.guesses.queue('ordinary',()=>.08);});
  await render(page,[{word:'ordinary',rank:100,user}],user);
  assert.equal(await page.locator('[data-guess-entrance]').count(),0,'8% boundary');
  await page.evaluate(()=>{advanceEntranceClock();fixture.guesses.queue('canceled',()=>.01);});
  await render(page,[{word:'canceled',rank:100,user}],user);
  await page.waitForFunction(()=>document.querySelector('[data-guess-entrance]'));
  await page.evaluate(()=>fixture.guesses.snapshot([{word:'canceled'}]));
  assert.equal(await page.locator('[data-guess-entrance],.guess-entrance-sheen').count(),0,'snapshot cancellation');
  await page.evaluate(()=>{advanceEntranceClock();fixture.guesses.queue('removed',()=>.01);});
  await render(page,[{word:'removed',rank:100,user}],user);
  await page.waitForFunction(()=>document.querySelector('[data-guess-entrance]'));
  await render(page,[],user);
  assert.equal(await page.locator('[data-guess-entrance],.guess-entrance-sheen').count(),0,'removed row cleanup');
  return outcomes;
}
(async()=> {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try {
    for(const file of files) for(const [sizeName,size] of [['desktop',{width:1100,height:1100}],['phone',{width:390,height:844}],['small-phone',{width:320,height:720}],['obs',{width:1080,height:1920}]]) {
      if(process.env.SURFACE && !file.startsWith(process.env.SURFACE))continue;
      if(file.startsWith('overlay')&&sizeName!=='obs')continue;
      if(file.startsWith('solo')&&sizeName==='obs')continue;
      const page=await browser.newPage();const errors=await setup(page,file+(sizeName==='obs'&&!file.startsWith('overlay')?'?obs=1':''),size);
      await render(page,guesses(),user,true);
      const layout=await geometry(page);
      fs.writeFileSync(path.join(output,'last-layout.json'),JSON.stringify({file,sizeName,layout},null,2));
      await page.screenshot({path:path.join(output,'last-page.png'),fullPage:true});
      assert.ok(layout.length>=5);
      for(const row of layout) {
        assert.ok(row.panelWidth<=row.width/2+1,'half-row cap');
        assert.equal(row.water,row.boundary,'measured slant boundary');
        assert.ok(Math.abs(row.top)<1&&Math.abs(row.bottom)<1&&Math.abs(row.right)<1,'flush edges');
        assert.equal(row.textColor,'rgb(255, 255, 255)');
        assert.ok(row.overflow<=1,'clipped guess text: '+row.word);
      }
      assert.ok(layout.some(row=>row.compact),'long guesses keep avatar-only layouts');
      const label=file.replaceAll('/','-').replace('.html','')+'-'+sizeName;
      await page.screenshot({path:path.join(output,label+'-page.png'),fullPage:true});
      const edges=[];
      for(const moving of [false,true]) edges.push(await edgePixels(page,label+(moving?'-moving':'-rest'),moving));
      for(const [i,cos] of sets.entries()) {
        await render(page,guesses().map(g=>({...g,user:{...user,cosmetics:cos}})),{...user,cosmetics:cos},true);
        const c=page.locator('.card[data-refined-guess]').first();
        assert.ok(await c.locator('.guess-panel-surface .wiki-hero-art').count(),'hero artwork missing');
        assert.ok(await c.locator('.guess-panel-frame').evaluate(el=>!!el.style.backgroundColor),'frame paint missing');
        assert.ok(await c.locator('.guess-panel-glow').evaluate(el=>!!el.style.filter),'frame glow missing');
        assert.ok(await c.locator('.cosmetic-title').count(),'title missing');
        assert.ok(await c.locator('.gname').evaluate(el=>!!el.style.color&&!!el.style.textShadow),'name effects missing');
        assert.ok(await c.locator('.avatar-fb').evaluate(el=>!!el.style.border||!!el.style.boxShadow||!!el.querySelector('.pfp-cosmetic-layer')),'avatar effects missing');
        assert.equal(await c.locator('.word-lbl').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
        await c.screenshot({path:path.join(output,label+'-cosmetic-'+i+'.png')});
        await c.locator('.wiki-hero-art').evaluate(el=>el.dataset.testArtwork='retained');
        const updates=guesses().map(g=>({...g,rank:g.rank+1,user:{...user,cosmetics:cos}}));
        await render(page,updates,{...user,cosmetics:cos});
        assert.equal(await c.locator('.wiki-hero-art').getAttribute('data-test-artwork'),'retained','rank update restarted artwork');
      }
      if(!file.startsWith('solo')) {
        await page.evaluate(id=>testSocket.trigger('cosmetics-updated',{platform:'discord',platformUserId:id,equipped:{}}),user.platformUserId);
        assert.equal(await page.locator('.wiki-hero-art,.wiki-hero-scrim').count(),0,'live unequip');
        assert.equal(await page.locator('.guess-panel-painted').count(),0,'live frame clear');
      }
      await render(page,guesses(),user,true);
      assert.equal(await page.locator('.wiki-hero-art,.wiki-hero-scrim').count(),0,'unequipped artwork persisted');
      assert.equal(await page.locator('.guess-panel-painted').count(),0,'unequipped frame persisted');
      await page.evaluate(() => {const first=document.querySelector('.card[data-word]');first.dataset.testIdentity='same';});
      const ranked=guesses();ranked[0].rank=9876;
      await render(page,ranked,user);
      assert.equal(await page.locator('.card[data-word]').first().getAttribute('data-test-identity'),'same','rank update recreated row');
      assert.equal(await page.locator('.card[data-word] .rank').first().textContent(),'#9.9k');
      const effects=await entrances(page);
      if(sizeName==='desktop') {
        await page.evaluate(()=>document.documentElement.classList.add('theme-light'));
        await render(page,guesses(),user,true);
        assert.ok((await geometry(page)).every(r=>r.textColor==='rgb(255, 255, 255)'),'light theme changed guess text');
        await page.screenshot({path:path.join(output,label+'-light.png'),fullPage:true});
      }
      assert.deepEqual(errors,[],'browser errors on '+label);
      report.push({surface:file,size:sizeName,layout,edges,effects});console.log('PASS',label);
      await page.close();
    }
    fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(report,null,2));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
