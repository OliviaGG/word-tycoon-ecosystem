'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function writeAtomic(file,value){
 fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+crypto.randomUUID();let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temp,file);
  if(process.platform!=='win32'){const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
 }
 finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function createHintJournal({file,now=Date.now,maxEntries=20000,retentionMs=90*86400000}={}){
 let records={};
 if(fs.existsSync(file)){const stored=JSON.parse(fs.readFileSync(file,'utf8'));if(stored.version!==1||!stored.records||typeof stored.records!=='object'||Array.isArray(stored.records))throw Error('Hint application journal invalid');records=stored.records;}
 const key=identity=>crypto.createHash('sha256').update(JSON.stringify([identity.discordId,identity.game,identity.actionId])).digest('hex');
 const clone=value=>JSON.parse(JSON.stringify(value));
 const commit=draft=>{writeAtomic(file,{version:1,records:draft});records=draft;};
 function reserve(identity,purchase){
  const id=key(identity),old=records[id];
  if(old){if(old.purchase.roundKey!==purchase.roundKey||old.purchase.handle!==purchase.handle||JSON.stringify(old.purchase.hint)!==JSON.stringify(purchase.hint))throw Error('Hint application identity conflict');return clone(old);}
  const draft=clone(records),time=now();
  for(const [entry,row]of Object.entries(draft))if(row.state==='done'&&time-row.updatedAt>retentionMs)delete draft[entry];
  if(Object.keys(draft).length>=maxEntries)throw Error('Hint application journal full');
  draft[id]={identity:clone(identity),purchase:clone(purchase),state:'pending',createdAt:time,updatedAt:time};commit(draft);return clone(draft[id]);
 }
 function mark(identity,state){if(!['confirmed','done'].includes(state))throw Error('Invalid journal state');const id=key(identity);if(!records[id])throw Error('Missing application reservation');if(records[id].state==='done')return;
  const draft=clone(records);draft[id].state=state;draft[id].updatedAt=now();commit(draft);
 }
 return{reserve,mark,get:identity=>records[key(identity)]?clone(records[key(identity)]):null,pending:()=>Object.values(records).filter(row=>row.state!=='done').sort((a,b)=>a.updatedAt-b.updatedAt).slice(0,20).map(clone),summary:()=>({total:Object.keys(records).length,pending:Object.values(records).filter(row=>row.state!=='done').length})};
}
module.exports={createHintJournal,writeAtomic};
