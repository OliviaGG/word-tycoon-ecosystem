// Scope the fill to the actual plain player panel boundary. Retain all other
// canonical code, including rare entrances, cosmetics and recovery.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {parseAst}=require('rollup/dist/parseAst.js');
const [input,output]=process.argv.slice(2);
if(!input||!output||path.resolve(input)===path.resolve(output))throw new Error('Usage: node tools/build-guess-edge-seal-production.cjs <fresh-canonical-root> <separate-output>');
cp.execFileSync(process.execPath,[path.join(__dirname,'build-refined-guesses-production.cjs'),input,output],{stdio:'inherit'});
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const sourceFile='client/src/utils/GuessPanelSize.js';
const originalSource=fs.readFileSync(path.join(input,sourceFile));
const source=fs.readFileSync(path.join(__dirname,'..',sourceFile));
if(!source.toString().includes("element.style.setProperty('--guess-water-width', waterWidth)"))throw new Error('Missing source water boundary');
fs.mkdirSync(path.join(output,path.dirname(sourceFile)),{recursive:true});fs.writeFileSync(path.join(output,sourceFile),source);
fs.appendFileSync(path.join(output,'baseline-sha256.txt'),hash(originalSource)+'  '+sourceFile+'\n');
const insertion=`\n      // Match the actual flex boundary, keeping rank color out of plain artwork.\n      const waterWidth = \`${'${Math.max(0, panel.offsetLeft)}'}px\`;\n      if (element.style.getPropertyValue('--guess-water-width') !== waterWidth) {\n        element.style.setProperty('--guess-water-width', waterWidth);\n      }`;
function visit(node,cb){if(!node||typeof node!=='object')return;if(node.type)cb(node);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(v=>visit(v,cb));else if(value&&typeof value==='object')visit(value,cb);}}
const changes=[];
for(const mode of ['index','sp']){
  const htmlFile=path.join(output,'dist',mode+'.html'),html=fs.readFileSync(htmlFile,'utf8');
  const oldAsset=[...html.matchAll(/<script[^>]*type="module"[^>]*src="\/assets\/([^"/]+)"/g)].at(-1)[1];
  const before=fs.readFileSync(path.join(input,'dist/assets',oldAsset),'utf8'),ast=parseAst(before);
  if(before.includes('--guess-water-width'))throw new Error('Canonical already has water boundary; use the stylesheet-only patcher');
  const helpers=ast.body.filter(n=>n.type==='FunctionDeclaration'&&n.id.name==='observeGuessPanelSize');
  if(helpers.length!==1)throw new Error('Ambiguous panel sizing helper');
  const statements=[];visit(helpers[0],n=>{
    if(n.type==='IfStatement'&&before.slice(n.start,n.end).includes("panel.style.setProperty('--guess-panel-width', value)"))statements.push(n);
  });
  if(statements.length!==1||helpers[0].params[1]?.name!=='element')throw new Error('Unexpected panel sizing helper');
  const position=statements[0].end;
  const after=before.slice(0,position)+insertion+before.slice(position);parseAst(after);
  if(after.replace(insertion,'')!==before)throw new Error('Unrelated bundle bytes changed');
  const asset='guess-edge-seal-'+(mode==='index'?'mp':'sp')+'-'+hash(after).slice(0,12)+'.js';
  fs.writeFileSync(path.join(output,'dist/assets',asset),after);
  fs.writeFileSync(htmlFile,html.replaceAll('/assets/'+oldAsset,'/assets/'+asset));
  changes.push({mode,oldAsset,asset});
}
const cssAsset=fs.readdirSync(path.join(output,'dist/assets')).filter(n=>n.startsWith('refined-guesses-')).find(n=>fs.readFileSync(path.join(output,'dist/index.html'),'utf8').includes('/assets/'+n));
const result={changes,cssAsset};fs.writeFileSync(path.join(output,'release.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
