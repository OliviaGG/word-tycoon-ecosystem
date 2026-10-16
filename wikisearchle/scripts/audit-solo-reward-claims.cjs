// Read-only evidence report. Never starts workers, writes claims, or posts rewards.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
async function auditSoloRewards(root,{receipt}={}) {
 const legacy=read(path.join(root,'data/solo-reward-claims.json'),{}),directory=path.join(root,'data/reward-outbox');
 const records=fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>read(path.join(directory,n))):[];
 const counts={pending:0,delivered:0,rejected:0,check:0},legacyCounts={awarded:0,pending:0,other:0},evidence=[];
 for(const row of records)if(row.payload?.soloMode)counts[row.state]=(counts[row.state]||0)+1;
 for(const [key,claim] of Object.entries(legacy)){
  legacyCounts[claim.status==='awarded'?'awarded':claim.status==='pending'?'pending':'other']++;
  if(claim.status==='awarded')continue;
  const match=/^discord:(.+):(\d{4}-\d{2}-\d{2}T.*)$/.exec(key),actor=match?.[1];
  // Candidates are hints for ledger review, not proof that this old generation
  // owns an event. Its original claim lacks generation/request metadata.
  const candidates=actor?records.filter(row=>{
   const p=row.payload||{},age=row.createdAt-claim.at;
   return ['wikisearchle','wikicontexto'].includes(p.game)&&p.platform==='discord'&&String(p.userId)===actor
    &&p.coins===claim.score&&['daily','weekly'].includes(p.soloMode)
    &&p.event===(p.soloMode==='daily'?'daily-win':'weekly-win')&&Number.isFinite(age)&&age>=-1000&&age<=60000;
  }):[];
  const item={claimRef:crypto.createHash('sha256').update(key).digest('hex'),status:claim.status,candidateCount:candidates.length,
    evidence:candidates.length===1?'candidate-needs-generation-review':candidates.length?'ambiguous':'no-durable-candidate'};
  if(receipt&&candidates.length===1){const row=candidates[0];try{
   const result=await receipt(row.payload.game,row.payload.eventId);
   item.receipt=result?.ok&&result.found&&result.result?.rewardEventId===row.payload.eventId?'confirmed':'absent-or-incompatible';
  }catch{item.receipt='unavailable';}}
  evidence.push(item);
 }
 return {readOnly:true,replaysAuthorized:0,queueCounts:counts,legacyCounts,evidence,
  note:'Candidate/receipt evidence does not attach the legacy generation automatically. Review the canonical ledger before any manual correction.'};
}
if(require.main===module)(async()=>{
 const root=path.resolve(__dirname,'..'),check=process.argv.slice(2).includes('--receipts');let receipt;
 if(process.argv.slice(2).some(arg=>arg!=='--receipts'))throw Error('Only --receipts is supported');
 if(check){const dotenv=require('dotenv'),env=fs.existsSync(path.join(root,'.env'))?dotenv.parse(fs.readFileSync(path.join(root,'.env'))):{},secret=process.env.GAME_API_SECRET||env.GAME_API_SECRET;
  if(!secret)throw Error('Service credential unavailable');const url=process.env.WORD_EMPIRES_URL||env.WORD_EMPIRES_URL||'http://127.0.0.1:3020';
  receipt=async(game,eventId)=>{const response=await fetch(url+'/api/reward/status/'+encodeURIComponent(game)+'/'+encodeURIComponent(eventId),{headers:{'x-api-key':secret},signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Receipt lookup unavailable');return response.json();};
 }
 console.log(JSON.stringify(await auditSoloRewards(root,{receipt}),null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={auditSoloRewards};
