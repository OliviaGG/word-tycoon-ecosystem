// Apply a source-level cosmetic compatibility fix to canonical deployed bundles
// while preserving production-only changes elsewhere in the existing client.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {parseAst}=require('rollup/dist/parseAst.js');
const input=process.argv[2],out=process.argv[3];
const helper=fs.readFileSync(path.join(__dirname,'../client/src/utils/AvatarGradientBorder.js'),'utf8').replace(/export function /g,'function ');
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
const edits=(s,changes)=>changes.sort((a,b)=>b.start-a.start).reduce((text,e)=>text.slice(0,e.start)+e.text+text.slice(e.end),s);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const mapping=new Map(),checks={},patched=[];
function processModule(name){if(mapping.has(name))return mapping.get(name);const file=path.join(input,'assets',name),source=fs.readFileSync(file,'utf8');checks['dist/assets/'+name]=hash(source);const ast=parseAst(source),changes=[];
for(const node of ast.body){if((node.type==='ImportDeclaration'||node.type==='ExportNamedDeclaration')&&node.source?.value?.startsWith('./')&&node.source.value.endsWith('.js')){const old=node.source.value.slice(2),next=processModule(old);if(next!==old)changes.push({start:node.source.start,end:node.source.end,text:JSON.stringify('./'+next)});}}
const appliers=ast.body.filter(n=>n.type==='FunctionDeclaration'&&n.params.length===2&&source.slice(n.start,n.end).includes('.profile_border')&&source.slice(n.start,n.end).includes('.word_color')&&source.slice(n.start,n.end).includes('.avatarEl'));
if(appliers.length>1)throw Error('Ambiguous cosmetic renderer in '+name);
if(appliers.length){const fn=appliers[0],[els,cos]=fn.params.map(p=>p.name);changes.push({start:fn.body.start+1,end:fn.body.start+1,text:`if(${cos})resetAvatarGradientBorder(${els}.avatarEl);`},{start:fn.body.end-1,end:fn.body.end-1,text:`;applyAvatarGradientBorder(${els}.avatarEl,${cos}.profile_border);`});patched.push(name);}
if(!changes.length){mapping.set(name,name);return name;}const code=edits(source,changes)+(appliers.length?'\n'+helper:'');parseAst(code);const next='avatar-border-'+hash(code).slice(0,12)+'.js';fs.writeFileSync(path.join(out,'assets',next),code);mapping.set(name,next);return next;}
const sourceCss=fs.readFileSync(path.join(__dirname,'../client/styles/main.css'),'utf8');const start=sourceCss.indexOf('.guess-entry-panel .guess-rank {'),end=sourceCss.indexOf('.guess-entry-panel .guess-user {',start);const rankCss=sourceCss.slice(start,end);
for(const name of ['index.html','sp.html','alt.html']){let html=fs.readFileSync(path.join(input,name),'utf8');checks['dist/'+name]=hash(html);for(const match of [...html.matchAll(/<script[^>]*type="module"[^>]*src="\/assets\/([^"/]+)"/g)]){const old=match[1],next=processModule(old);html=html.replaceAll('/assets/'+old,'/assets/'+next);}if(name!=='alt.html'){const old=html.match(/href="\/assets\/(guess-panel-[^"]+\.css)"/)[1];const original=fs.readFileSync(path.join(input,'assets',old),'utf8');checks['dist/assets/'+old]=hash(original);const css=original+'\n/* Rank number background: +15 percentage points of opacity. */\n'+rankCss;const next='guess-panel-'+hash(css).slice(0,12)+'.css';fs.writeFileSync(path.join(out,'assets',next),css);html=html.replaceAll(old,next);}fs.writeFileSync(path.join(out,name),html);}
if(!patched.length)throw Error('No cosmetic renderers patched');fs.writeFileSync(path.join(out,'baseline-sha256.txt'),Object.entries(checks).map(([f,h])=>h+'  '+f).join('\n')+'\n');console.log(JSON.stringify({patched,outputs:fs.readdirSync(path.join(out,'assets'))},null,2));
