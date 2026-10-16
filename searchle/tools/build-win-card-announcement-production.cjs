// Patch a fresh canonical capture; never rebuild or replace compiled UI modules.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [input,out,manifestPath]=process.argv.slice(2);
if(!input||!out||!manifestPath)throw Error('Usage: node tools/build-win-card-announcement-production.cjs <canonical> <new-output> <canonical-hashes.json>');
if(fs.existsSync(out))throw Error('Output already exists; preserve unrelated work');
const hashes=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
for(const [file,expected] of Object.entries(hashes))if(sha(fs.readFileSync(path.join(input,file)))!==expected)throw Error('Canonical capture changed: '+file);
const url='https://wordtycoon.live/js/win-card.js?v=result-announcement-20261003';
const tag='<script src="'+url+'"></script>\n';
const planned=[];
for(const file of ['dist/index.html','dist/sp.html','dist/alt.html']){
  const original=fs.readFileSync(path.join(input,file),'utf8');
  if(original.includes('win-card.js'))throw Error('Unexpected pre-existing shared-card bootstrap: '+file);
  const match=original.match(/<script\b[^>]*type="module"[^>]*>/);
  if(!match)throw Error('Missing canonical module entry: '+file);
  const updated=original.slice(0,match.index)+tag+'  '+original.slice(match.index);
  if(updated.replace(tag+'  ','')!==original)throw Error('Unexpected HTML mutation');
  planned.push({file,data:updated});
}
const adapter='client/src/ui/WinOverlay.js';
const original=fs.readFileSync(path.join(input,adapter),'utf8');
const old='https://wordtycoon.live/js/win-card.js?v=subtextle-media-20261003';
if(original.split(old).length!==2)throw Error('Unexpected canonical source adapter');
planned.push({file:adapter,data:original.replace(old,url)});
const changes=planned.map(({file,data})=>({file,oldSha:hashes[file],newSha:sha(data)}));
for(const {file,data}of planned){const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data)}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({changes,canonicalHashes:hashes,compiledJavaScriptUnchanged:true,cssUnchanged:true,bootstrapUrl:url},null,2));
console.log(JSON.stringify({changedFiles:changes.length,compiledJavaScriptUnchanged:true,cssUnchanged:true,canonicalFilesVerified:Object.keys(hashes).length}));
