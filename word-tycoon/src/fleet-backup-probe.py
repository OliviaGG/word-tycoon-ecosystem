"""Bounded aggregate metadata scan; full hashes and boot are separate drills."""
from pathlib import Path
import json,os,re,stat,subprocess,sys,time
store=Path(sys.argv[1]);now=time.time();result={'completeCohorts':0,'incompleteCohorts':0,'staleIncompleteCohorts':0,'invalid':0,'lastCompleteAt':None,'lastFileCount':0,'lastBytes':0,'maintenancePending':False,'maintenanceStale':False,'timerActive':None,'timerEnabled':None,'lastServiceSucceeded':None,'complete':True}
try:
 if store.is_symlink() or not store.is_dir():raise ValueError('unsafe store')
 entries=sorted(store.iterdir());assert len(entries)<=200
 for directory in entries:
  if not re.fullmatch(r'cohort-\d+-[a-f0-9]{8}',directory.name):continue
  if directory.is_symlink() or not directory.is_dir():result['invalid']+=1;continue
  manifest=directory/'manifest.json'
  if not manifest.exists():
   result['incompleteCohorts']+=1;result['staleIncompleteCohorts']+=now-directory.stat().st_mtime>7200;continue
  try:
   info=manifest.lstat();assert stat.S_ISREG(info.st_mode) and not manifest.is_symlink() and info.st_size<=64*1024*1024 and not info.st_mode&0o077
   fd=os.open(manifest,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
   with os.fdopen(fd) as stream:value=json.load(stream)
   assert value['version']==1 and value['complete'] is True and value['writersStopped']==19 and len(value['services'])==19 and isinstance(value['files'],list) and len(value['files'])<=250000
   created=value['createdAt'];assert isinstance(created,int) and 0<created<=now+60
   result['completeCohorts']+=1
   if created>(result['lastCompleteAt'] or 0):
    result['lastCompleteAt']=created;result['lastFileCount']=sum('bytes' in row for row in value['files']);result['lastBytes']=sum(row.get('bytes',0) for row in value['files'])
  except Exception:result['invalid']+=1
 plan=store/'maintenance.json'
 if plan.exists():
  result['maintenancePending']=True;info=plan.lstat();assert not plan.is_symlink() and stat.S_ISREG(info.st_mode) and info.st_size<65536 and not info.st_mode&0o077
  value=json.loads(plan.read_text());result['maintenanceStale']=now-value['createdAt']>7200
 if '--skip-timer' not in sys.argv:
  for field,command in [('timerActive',['systemctl','is-active','word-tycoon-fleet-backup.timer']),('timerEnabled',['systemctl','is-enabled','word-tycoon-fleet-backup.timer']),('lastServiceSucceeded',['systemctl','show','word-tycoon-fleet-backup.service','--property=Result','--value'])]:
   probe=subprocess.run(command,capture_output=True,text=True,timeout=3);expected={'timerActive':'active','timerEnabled':'enabled','lastServiceSucceeded':'success'}[field];result[field]=probe.returncode==0 and probe.stdout.strip()==expected
except Exception:result['complete']=False;result['invalid']+=1
print(json.dumps(result))
