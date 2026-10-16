'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const HEAVY=['history','savedGames','playerStats','puzzles'];
function createPublicMetadataStore({directory,fsImpl=fs,maxBytes=12*1024*1024}){
 let cached=null,blocked=false,lastPrune=0;
 function regular(file,dir=false){const stat=fsImpl.lstatSync(file);if(stat.isSymbolicLink()||!(dir?stat.isDirectory():stat.isFile())||!dir&&stat.size>maxBytes||process.platform!=='win32'&&(stat.mode&0o077))throw Error('Unsafe Spelling Bee metadata');}
 if(!fsImpl.existsSync(directory))fsImpl.mkdirSync(directory,{recursive:true,mode:0o700});regular(directory,true);
 const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 function read(reference){if(blocked)throw Error('Spelling Bee metadata needs storage recovery');if(!/^[a-f0-9]{64}$/.test(reference||''))throw Error('Invalid Spelling Bee metadata reference');
  if(cached?.reference===reference)return cached.value;
  const file=path.join(directory,reference+'.json');regular(file);const bytes=fsImpl.readFileSync(file,'utf8');if(sha(bytes)!==reference)throw Error('Spelling Bee metadata checksum mismatch');const value=JSON.parse(bytes);
  if(!Array.isArray(value.history)||value.history.length>200||!Array.isArray(value.savedGames)||value.savedGames.length>50||!Array.isArray(value.puzzles)||value.puzzles.length>200||!value.playerStats||typeof value.playerStats!=='object'||Array.isArray(value.playerStats))throw Error('Invalid Spelling Bee metadata');
  cached={reference,value,refs:null};return value;
 }
 function store(data){if(blocked)throw Error('Spelling Bee metadata needs storage recovery');
  if(cached?.refs && HEAVY.every(key=>cached.refs[key]===data[key]))return cached.reference;
  const value=Object.fromEntries(HEAVY.map(key=>[key,data[key]])),bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>maxBytes)throw Error('Spelling Bee metadata archival required');const reference=sha(bytes),file=path.join(directory,reference+'.json');
  if(fsImpl.existsSync(file)){regular(file);if(sha(fsImpl.readFileSync(file))!==reference)throw Error('Spelling Bee metadata checksum mismatch');}
  else {const temporary=file+'.'+crypto.randomUUID()+'.tmp';let fd,renamed=false;
   try{regular(directory,true);fd=fsImpl.openSync(temporary,'wx',0o600);fsImpl.writeFileSync(fd,bytes);fsImpl.fsyncSync(fd);fsImpl.closeSync(fd);fd=undefined;fsImpl.renameSync(temporary,file);renamed=true;
    if(process.platform!=='win32'){const dirFd=fsImpl.openSync(directory,'r');try{fsImpl.fsyncSync(dirFd);}finally{fsImpl.closeSync(dirFd);}}
   }catch(error){if(renamed)blocked=true;throw error;}
   finally{if(fd!==undefined)fsImpl.closeSync(fd);if(fsImpl.existsSync(temporary))fsImpl.unlinkSync(temporary);}
  }
  cached={reference,value:JSON.parse(bytes),refs:Object.fromEntries(HEAVY.map(key=>[key,data[key]]))};return reference;
 }
 function metadata(data){const publicDataRef=store(data),publicData={...data};for(const key of HEAVY)delete publicData[key];return{publicDataRef,publicData};}
 function expand(meta){return{...read(meta.publicDataRef),...meta.publicData};}
 function prune(reference){
  if(Date.now()-lastPrune<300000)return;
  // Only the accepted current reference is load-bearing. Keep one day's
  // immutable predecessors for diagnosis; bound orphan retention to 128 files.
  const files=[];for(const name of fsImpl.readdirSync(directory))if(/^[a-f0-9]{64}\.json$/.test(name)&&name!==reference+'.json'){const file=path.join(directory,name);regular(file);files.push({file,time:fsImpl.statSync(file).mtimeMs});}
  files.sort((a,b)=>b.time-a.time);for(let i=0;i<files.length;i++)if(i>=127||Date.now()-files[i].time>86400000)fsImpl.unlinkSync(files[i].file);
  if(process.platform!=='win32'){const fd=fsImpl.openSync(directory,'r');try{fsImpl.fsyncSync(fd);}finally{fsImpl.closeSync(fd);}}
  lastPrune=Date.now();
 }
 return{metadata,expand,read,prune};
}
module.exports={createPublicMetadataStore};
