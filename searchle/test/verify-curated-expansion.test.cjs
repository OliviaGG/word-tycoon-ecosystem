'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {verifyRanks,verifyIndex,verifyUnchangedBank,verifyServices,verifyDeployedSources}=require('../scripts/verify-curated-expansion.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('full ranking verification rejects answer corruption and duplicated ranks even with matching file hash',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ranking-verification-'));
  try{
    const file=path.join(directory,'pool_1_carpet.json');
    const rankings={carpet:1};for(let i=2;i<=100000;i++)rankings['word'+i]=i;
    const payload={targetWord:'carpet',rankings,totalRankedWords:100000};
    const put=()=>{const bytes=Buffer.from(JSON.stringify(payload));fs.writeFileSync(file,bytes);return{word:'carpet',sha256:hash(bytes),bytes:bytes.length,rankedWords:100000};};
    assert.equal(verifyRanks(file,put()),100000);
    payload.rankings.word2=3;
    assert.throws(()=>verifyRanks(file,put()),/complete permutation/);
    payload.rankings.word2=2;payload.rankings.carpet=2;
    assert.throws(()=>verifyRanks(file,put()),/not rank one/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('index preserves old completion IDs and pins, reuses historical IDs, and appends new IDs beyond old maximum',()=>{
  const baseline={nextNumber:21,words:{house:7,carpet:12},vacantNumbers:[2,8,30],weeklyNumbers:{jade:3},nextWeeklyNumber:4,
    weeklyAssignments:{'2026-10-05':'jade'},dailyAssignments:{'2026-10-09':'house'}};
  const current=structuredClone(baseline);current.words.sandwich=31;current.nextNumber=32;
  const additions=[{word:'carpet',historicalNumber:12},{word:'sandwich',historicalNumber:null}];
  const proof=verifyIndex(baseline,current,additions);
  assert.equal(proof.historicalIdsRetained,1);assert.equal(proof.appendedIds,1);
  const reassigned=structuredClone(current);reassigned.words.house=6;
  assert.throws(()=>verifyIndex(baseline,reassigned,additions),/completion ID changed/);
  const reused=structuredClone(current);reused.words.sandwich=8;
  assert.throws(()=>verifyIndex(baseline,reused,additions),/historical number/);
  const belowVacancy=structuredClone(current);belowVacancy.words.sandwich=21;
  assert.throws(()=>verifyIndex(baseline,belowVacancy,additions),/historical number/);
  const repinned=structuredClone(current);repinned.dailyAssignments['2026-10-09']='sandwich';
  assert.throws(()=>verifyIndex(baseline,repinned,additions),/puzzle pin changed/);
});

test('shared bank verification detects seeded target or whitelist changes',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bank-verification-'));
  try{
    const bank=path.join(directory,'data/word-bank');fs.mkdirSync(bank,{recursive:true});
    const snapshot={files:{}};
    for(const name of ['targets.json','searchle-easy-targets.json','searchle-very-easy-targets.json']){
      const bytes=Buffer.from('["house"]');fs.writeFileSync(path.join(bank,name),bytes);snapshot.files['relay/data/word-bank/'+name]=hash(bytes);
    }
    assert.equal(verifyUnchangedBank(snapshot,directory).length,3);
    fs.writeFileSync(path.join(bank,'targets.json'),'["house","carpet"]');
    assert.throws(()=>verifyUnchangedBank(snapshot,directory),/seeded target bank changed/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('PM2 verification accepts the intended restart and detects unrelated restarts',()=>{
  const before=[{name:'searchle-mobile',pid:10,status:'online',restarts:2},{name:'mobile-relay',pid:20,status:'online',restarts:5}];
  const after=structuredClone(before);after[0].pid=11;after[0].restarts=3;
  assert.deepEqual(verifyServices(before,after,1),['mobile-relay']);
  after[1].restarts++;
  assert.throws(()=>verifyServices(before,after,1),/unrelated service restarted/);
});

test('stopped-service start requires a new PID while retaining the PM2 restart counter',()=>{
  const before=[{name:'searchle-mobile',pid:10,status:'online',restarts:2},{name:'mobile-relay',pid:20,status:'online',restarts:5}];
  const after=structuredClone(before);after[0].pid=11;
  assert.deepEqual(verifyServices(before,after),['mobile-relay']);
  assert.throws(()=>verifyServices(before,before),/Subtextle did not restart/);
  after[0].restarts++;
  assert.throws(()=>verifyServices(before,after),/Unexpected Subtextle restart count/);
});

test('reviewed deployed-source manifest checks all four runtime modules and rejects byte drift',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'source-verification-'));
  try{
    fs.mkdirSync(path.join(directory,'server'));
    const manifest={version:1,files:[]};
    for(const name of ['curated-targets.js','game-manager.js','sp-manager.js','session-manager.js']){
      const file=path.join(directory,'server',name),bytes=Buffer.from('module.exports={};\n');fs.writeFileSync(file,bytes);
      manifest.files.push({target:file,afterSha256:hash(bytes),bytes:bytes.length});
    }
    assert.equal(verifyDeployedSources(manifest,directory).length,4);
    fs.writeFileSync(manifest.files[0].target,'module.exports={changed:true};\n');
    assert.throws(()=>verifyDeployedSources(manifest,directory),/reviewed release/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
