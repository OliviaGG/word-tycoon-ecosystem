// Preserve production-only header/identity fixes while applying the source row
// change to the deployed bundles. Input files are captured from canonical /opt.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {parseAst}=require('rollup/dist/parseAst.js');
const root=process.argv[2],out=process.argv[3];
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const emit=(prefix,code,ext='js')=>{parseAst(ext==='js'?code:'');const name=prefix+'-'+crypto.createHash('sha256').update(code).digest('hex').slice(0,12)+'.'+ext;fs.writeFileSync(path.join(out,'assets',name),code);return name;};
const applyEdits=(s,edits)=>edits.sort((a,b)=>b.start-a.start).reduce((s,e)=>s.slice(0,e.start)+e.text+s.slice(e.end),s);
function walk(n,fn){if(!n||typeof n!=='object')return;fn(n);for(const [k,v] of Object.entries(n)){if(k==='parent')continue;if(Array.isArray(v))v.forEach(x=>walk(x,fn));else if(v&&typeof v==='object')walk(v,fn);}}
function patchShared(s){const ast=parseAst(s),exports=ast.body.find(n=>n.type==='ExportNamedDeclaration').specifiers;const fn=key=>ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===exports.find(e=>e.exported.name===key).local.name);const apply=fn('a'),visibility=fn('s');if(!apply||!visibility)throw Error('Cosmetic exports missing');
const [els,cos]=apply.params.map(n=>n.name),vis=visibility.params[0].name;
let source=fs.readFileSync(path.join(__dirname,'../client/src/utils/CosmeticsApplier.js'),'utf8');
let frame=source.slice(source.indexOf('  if (els.wordFrameEl) {'),source.indexOf('  // Get avatar size'));
frame=frame.replace(/\b_?viewerPanelVisibility\b/g,'__guessPanelVisibility').replace(/\bscaleCosmeticPx\b/g,'__guessPanelScale').replace(/\bels\b/g,els).replace(/\bcos\b/g,cos);
return applyEdits(s,[{start:apply.body.start+1,end:apply.body.start+1,text:`if(${cos}){${cos}={...${cos}};${frame}}`},{start:visibility.body.start+1,end:visibility.body.start+1,text:`__guessPanelVisibility=${vis}&&typeof ${vis}==='object'?{...${vis}}:{};`}])+`\nlet __guessPanelVisibility={};function __guessPanelScale(s,size){return s.replace(/(\\d+(?:\\.\\d+)?)px/g,(_,n)=>Math.max(1,Math.round(Number(n)*size/80))+'px')}`;
}
function patchMain(s,sharedName){const ast=parseAst(s);const imp=ast.body.find(n=>n.type==='ImportDeclaration'&&n.source.value.includes('AudioSettingsButton'));const alias=key=>imp.specifiers.find(n=>n.imported.name===key).local.name;const applier=alias('a'),rankColor=alias('e'),flash=alias('d');const cls=ast.body.find(n=>n.type==='ClassDeclaration'&&n.body.body.some(m=>m.key.name==='applyCosmeticsRetro'));if(!cls)throw Error('Guess class missing');const build=cls.body.body.find(m=>m.key.name==='_buildElement'),retro=cls.body.body.find(m=>m.key.name==='applyCosmeticsRetro'),rank=cls.body.body.find(m=>m.key.name==='updateRank');const ret=build.value.body.body.filter(n=>n.type==='ReturnStatement').at(-1);const edits=[{start:imp.source.start,end:imp.source.end,text:JSON.stringify('./'+sharedName)}, {start:ret.start,end:ret.start,text:`__applyGuessPanel(this,${ret.argument.name},${build.value.params[0].name}.user.cosmetics);`},{start:retro.value.body.end-1,end:retro.value.body.end-1,text:`;__applyGuessPanel(this,this.element,${retro.value.params[0].name});`},{start:rank.value.body.end-1,end:rank.value.body.end-1,text:`;this.element.style.setProperty('--rank-end',${rankColor}(this.rank,this._lastTotalRankedWords));`}];
walk(cls,n=>{if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name===flash)edits.push({start:n.start,end:n.end,text:'void 0'});});
// Same-word pinned rows must also refresh when equipped cosmetics change.
for(const c of ast.body.filter(n=>n.type==='ClassDeclaration'&&n!==cls)){const m=c.body.body.find(m=>m.key.name==='update');if(!m)continue;walk(m,n=>{if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name==='updateRank'&&s.slice(n.callee.object.start,n.callee.object.end)==='this._entry'){const p=m.value.params[0].name;edits.push({start:n.start,end:n.end,text:`(${s.slice(n.start,n.end)},__refreshGuessPanel(this._entry,${p}[${p}.length-1]?.user?.cosmetics))`});}});}
return applyEdits(s,edits)+`\nfunction __refreshGuessPanel(entry,cos){if(entry._lastCosSignature!==${cls.id.name}._cosmeticsSignature(cos))entry.applyCosmeticsRetro(cos||{});}
function __applyGuessPanel(entry,el,cos){
el.classList.add('guess-entry-panel');el.style.setProperty('--rank-end',${rankColor}(entry.rank,entry._lastTotalRankedWords));
const user=el.querySelector('.guess-user');let glow=user.querySelector('.guess-panel-glow');
if(!glow){glow=document.createElement('span');glow.className='guess-panel-glow';glow.setAttribute('aria-hidden','true');const frame=document.createElement('span');frame.className='guess-panel-frame';const surface=document.createElement('span');surface.className='guess-panel-surface';glow.append(frame,surface);user.prepend(glow);}
const word=el.querySelector('.guess-word');word.style.color='';word.style.textShadow='';word.style.animation='';
${applier}({surfaceEl:glow.querySelector('.guess-panel-surface'),wordFrameEl:glow.querySelector('.guess-panel-frame'),wordGlowEl:glow},cos||{});
}`;
}
const cssSource=fs.readFileSync(path.join(__dirname,'../client/styles/main.css'),'utf8');const css=emit('guess-panel',read('live.css')+'\n'+cssSource.slice(cssSource.indexOf('/* Guess rows: glass word pill')), 'css');
for(const [kind,main,shared,html] of [['mp','live-main.js','live-header-shared.js','live-index.html'],['sp','live-sp-main.js','live-sp-shared.js','live-sp.html']]){
const sharedName=emit('guess-panel-shared-'+kind,patchShared(read(shared)));
const mainName=emit('guess-panel-main-'+kind,patchMain(read(main),sharedName));
let h=read(html);h=h.replace(/(<script type="module" crossorigin src=")\/assets\/main-header-[^"]+("[^>]*>)/,`$1/assets/${mainName}$2`).replace(/(<link rel="stylesheet" crossorigin href=")\/assets\/AudioSettingsButton-[^"]+("[^>]*>)/,`$1/assets/${css}$2`);
fs.writeFileSync(path.join(out,kind==='mp'?'index.html':'sp.html'),h);
}
console.log('Prepared production row patch:',fs.readdirSync(path.join(out,'assets')));
