#!/usr/bin/env python3
"""Private, stopped-writer fleet cohorts. Reports aggregate evidence only."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,time,shutil,sqlite3,fcntl,uuid,signal

SERVICES={'mobile-tycoon':'word-tycoon','mobile-relay':'chat-relay','discord-bot':'word-tycoon/discord-bot','word500':'word500','word1000':'word1000','colour500':'colour500','pixeletters':'pixeletters','spellingbee':'spellingbee','wordle':'wordle','searchle-mobile':'searchle','rectangled':'rectangled','betwixt':'betwixt','figural':'figural','unwordle':'unwordle','erectangled':'sproutle','triangled':'triangled','wikisearchle':'wikisearchle','wikirectangled':'wikirectangled','voice-tts':'voice'}
EXCLUDED={'logs','.git','output','tmp','.cache','.npm','__pycache__'}
BASE=Path('/opt');STORE=BASE/'_fleet-backups'

def digest(file):
 h=hashlib.sha256()
 with file.open('rb') as stream:
  for chunk in iter(lambda:stream.read(4*1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def allowed(project,relative):
 parts=relative.parts
 if 'node_modules' in parts:return '.git' not in parts
 if any(p in EXCLUDED for p in parts):return False
 if project=='word-tycoon' and parts[0]=='discord-bot':return False
 if 'data' in parts:
  if any(p in {'backups','backup'} for p in parts):return False
  if project=='chat-relay' and parts[:2]==('data','avatars'):return False
 else:
  if any(p in {'backups','backup'} for p in parts):return False
  if '.bak' in relative.name or relative.name.endswith(('.log','.tmp')):return False
 return True

def files(root,project):
 for directory,dirs,names in os.walk(root,followlinks=False):
  dirs[:]=[name for name in dirs if allowed(project,(Path(directory)/name).relative_to(root))]
  for name in list(dirs):
   file=Path(directory)/name
   if file.is_symlink():yield file,file.relative_to(root);dirs.remove(name)
  for name in names:
   file=Path(directory)/name;relative=file.relative_to(root)
   if allowed(project,relative):yield file,relative

def copyfile(source,dest,durable=True):
 dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if source.is_symlink():
  target=os.readlink(source)
  if dest.is_symlink() and os.readlink(dest)==target:return
  assert not dest.exists() and not dest.is_symlink(),'Conflicting snapshot symlink'
  dest.symlink_to(target);return
 assert source.is_file() and not dest.is_symlink()
 temporary=dest.with_name(dest.name+'.next-'+uuid.uuid4().hex)
 try:
  with source.open('rb') as original,temporary.open('xb') as output:
   shutil.copyfileobj(original,output,4*1024*1024);output.flush()
   if durable:os.fsync(output.fileno())
  shutil.copystat(source,temporary);os.replace(temporary,dest)
  if durable:
   fd=os.open(dest.parent,os.O_RDONLY)
   try:os.fsync(fd)
   finally:os.close(fd)
 finally:
  if temporary.exists():temporary.unlink()

def private_json(path,value):
 temporary=path.with_name(path.name+'.next-'+uuid.uuid4().hex)
 try:
  fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as stream:
   json.dump(value,stream,indent=2);stream.flush();os.fsync(stream.fileno())
  os.replace(temporary,path)
  fd=os.open(path.parent,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
 finally:
  if temporary.exists():temporary.unlink()


def pm():return json.loads(subprocess.check_output(['pm2','jlist']))
def control(action,names):
 subprocess.run(['pm2',action,*names],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=180)
def report(phase,**extra):print(json.dumps({'phase':phase,**extra}),flush=True)

def recover():
 file=STORE/'maintenance.json'
 if not file.exists():report('maintenance-recovery',restarted=0);return
 with (STORE/'writer.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  assert not file.is_symlink() and file.stat().st_mode&0o077==0
  plan=json.loads(file.read_text());assert plan['version']==1 and 0<=time.time()-plan['createdAt']<7200
  processes=pm();assert {p['name'] for p in processes}==set(SERVICES)
  assert all(plan['serviceIds'][p['name']]==p['pm_id'] for p in processes)
  # A surviving PM2 stop RPC can still be draining after its caller was killed.
  deadline=time.monotonic()+60
  while any(p['name'] in plan['stopped'] and p['pm2_env']['status']=='stopping' for p in processes):
   assert time.monotonic()<deadline,'Planned service is still stopping; retry recovery'
   time.sleep(1);processes=pm()
   assert {p['name'] for p in processes}==set(SERVICES)
   assert all(plan['serviceIds'][p['name']]==p['pm_id'] for p in processes)
  selected={p['name'] for p in processes if p['name'] in plan['stopped'] and p['pm2_env']['status']=='stopped'}
  order=['mobile-tycoon','mobile-relay','searchle-mobile',*[n for n in SERVICES if n not in {'mobile-tycoon','mobile-relay','searchle-mobile'}]]
  for name in order:
   if name in selected:control('restart',[name])
  file.unlink();report('maintenance-recovery',restarted=len(selected))

def verify(cohort,sql=True):
 cohort=cohort.resolve();assert cohort.parent==STORE.resolve() and cohort.name.startswith('cohort-')
 manifest=json.loads((cohort/'manifest.json').read_text());assert manifest['complete'] and manifest['version']==1
 count=total=databases=0
 for row in manifest['files']:
  file=cohort/'projects'/row['project']/row['file']
  assert str(file.absolute()).startswith(str(cohort/'projects')+'/') and '..' not in Path(row['file']).parts
  if 'link' in row:assert file.is_symlink() and os.readlink(file)==row['link'];continue
  assert not file.is_symlink() and file.stat().st_size==row['bytes'] and digest(file)==row['sha256']
  count+=1;total+=row['bytes']
  if sql and file.suffix in {'.db','.sqlite','.sqlite3'} and file.stat().st_size:
   with file.open('rb') as stream:header=stream.read(16)
   if header==b'SQLite format 3\x00':
    connection=sqlite3.connect(file.as_uri()+'?mode=ro&immutable=1',uri=True)
    try:assert connection.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    finally:connection.close()
    databases+=1
 result={'complete':True,'files':count,'bytes':total,'sqliteDatabasesChecked':databases,'projects':len(SERVICES),'privateDataExported':False}
 report('verified',**result);return result

def snapshot(resume=None):
 os.umask(0o077);STORE.mkdir(mode=0o700,exist_ok=True)
 with (STORE/'writer.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  processes=pm();assert {p['name'] for p in processes}==set(SERVICES) and all(p['pm2_env']['status']=='online' for p in processes)
  assert shutil.disk_usage(STORE).free>60*1024**3,'Less than 60 GiB free'
  cohort=Path(resume).resolve() if resume else STORE/('cohort-'+str(int(time.time()))+'-'+uuid.uuid4().hex[:8])
  assert cohort.parent.resolve()==STORE.resolve() and cohort.name.startswith('cohort-') and not cohort.is_symlink() and not (cohort/'manifest.json').exists()
  cohort.mkdir(mode=0o700,exist_ok=bool(resume))
  runtime=[];staged={};size=0
  for process in processes:
   project=SERVICES[process['name']];root=BASE/project
   assert root.is_dir() and not root.is_symlink()
   env={}
   for pair in (Path('/proc')/str(process['pid'])/'environ').read_bytes().split(b'\x00'):
    if b'=' in pair:
     key,value=pair.split(b'=',1);env[key.decode()]=value.decode()
   entry=Path(process['pm2_env']['pm_exec_path']);cwd=Path(process['pm2_env']['pm_cwd'])
   assert entry.is_relative_to(root) and cwd.is_relative_to(root)
   runtime.append({'name':process['name'],'project':project,'entry':str(entry.relative_to(root)),'cwd':str(cwd.relative_to(root)),'env':env,'args':process['pm2_env'].get('args',[])})
   copied=0
   for source,relative in files(root,project):
    dest=cohort/'projects'/project/relative
    same=dest.exists() and not dest.is_symlink() and not source.is_symlink() and dest.stat().st_size==source.stat().st_size and dest.stat().st_mtime_ns==source.stat().st_mtime_ns
    if not same:copyfile(source,dest,durable=False)
    stat=source.lstat();staged[(project,str(relative))]=(stat.st_size,stat.st_mtime_ns,stat.st_ino)
    if source.is_symlink() and 'data' in relative.parts:raise RuntimeError('Authoritative data symlink requires explicit coverage')
    if source.is_file() and not source.is_symlink() and 'data' not in relative.parts:
     staged[(project,str(relative),'sha256')]=digest(dest)
    if source.is_file() and not source.is_symlink():size+=stat.st_size
    copied+=1
   report('staged',project=project,files=copied)
  private_json(cohort/'runtime.json',runtime)
  producers=[name for name in SERVICES if name not in {'mobile-tycoon','mobile-relay'}]
  changed=0;records=[];start=time.monotonic();stopped=[]
  maintenance=STORE/'maintenance.json';assert not maintenance.exists(),'Interrupted maintenance requires recover first'
  plan={'version':1,'createdAt':int(time.time()),'cohort':cohort.name,'serviceIds':{p['name']:p['pm_id'] for p in processes},'stopped':[]}
  try:
   report('stopping-writers',stagedBytes=size)
   for names in [producers,['mobile-relay'],['mobile-tycoon']]:
    stopped.extend(names);plan['stopped']=stopped.copy();private_json(maintenance,plan);control('stop',names)
   assert all(p['pm2_env']['status']=='stopped' for p in pm())
   assert all(not (Path('/proc')/str(p['pid'])).exists() for p in processes)
   for name,project in SERVICES.items():
    root=BASE/project;seen=set()
    for source,relative in files(root,project):
     seen.add(str(relative));dest=cohort/'projects'/project/relative
     if source.is_symlink():
      copyfile(source,dest);records.append({'project':project,'file':str(relative),'link':os.readlink(source)});continue
     # Both immutable cohort bytes and stopped source bytes are hashed in full.
     stat=source.stat();fingerprint=(stat.st_size,stat.st_mtime_ns,stat.st_ino)
     immutable='data' not in relative.parts and staged.get((project,str(relative)))==fingerprint
     source_hash=staged[(project,str(relative),'sha256')] if immutable else digest(source)
     if immutable:
      records.append({'project':project,'file':str(relative),'bytes':stat.st_size,'sha256':source_hash});continue
     if not dest.exists() or dest.is_symlink() or digest(dest)!=source_hash:
      copyfile(source,dest);changed+=1
     assert digest(dest)==source_hash
     records.append({'project':project,'file':str(relative),'bytes':source.stat().st_size,'sha256':source_hash})
    for dest,relative in list(files(cohort/'projects'/project,project)):
     if str(relative) not in seen:dest.unlink()
    report('frozen',project=project)
   # syncfs persists every staged file and directory before publishing completeness.
   subprocess.run(['sync','-f',str(cohort)],check=True,timeout=180)
   private_json(cohort/'manifest.json',{'version':1,'complete':True,'createdAt':int(time.time()),'files':records,'services':SERVICES,'excluded':['directories named backup/backups','logs/git/output/temp caches','relay provider avatar cache'],'writersStopped':19,'changedFiles':changed})
  finally:
   # Restore every stopped service even when capture fails. Dependencies first.
   for names in [['mobile-tycoon'],['mobile-relay'],['searchle-mobile'],[n for n in producers if n!='searchle-mobile']]:
    selected=[n for n in names if n in stopped]
    if selected:control('restart',selected)
   report('writers-restarted',seconds=round(time.monotonic()-start,1))
   if maintenance.exists():maintenance.unlink()
  report('cohort-created',cohort=str(cohort),changedFiles=changed)
  verify(cohort)
  # Only cohorts created by this tool are eligible; never touch legacy backups.
  complete=[]
  for item in STORE.glob('cohort-*'):
   if item.is_symlink() or item.parent.resolve()!=STORE.resolve():continue
   try:
    meta=json.loads((item/'manifest.json').read_text())
    if meta.get('version')==1 and meta.get('complete') is True:complete.append((meta['createdAt'],item))
   except (OSError,ValueError,KeyError):continue
  complete.sort(reverse=True)
  for created,item in complete[7:]:
   if item!=cohort and created<time.time()-7*86400:shutil.rmtree(item)
  report('snapshot-finished',cohort=str(cohort),retentionDays=7,minimumCohortsKept=7)
  return cohort

if __name__=='__main__':
 def interrupted(signum,frame):raise SystemExit('Snapshot interrupted; restarting stopped writers')
 signal.signal(signal.SIGTERM,interrupted)
 parser=argparse.ArgumentParser();parser.add_argument('action',choices=['snapshot','verify','recover']);parser.add_argument('cohort',nargs='?');parser.add_argument('--resume');args=parser.parse_args()
 if args.action=='snapshot':snapshot(args.resume)
 elif args.action=='recover':recover()
 else:verify(Path(args.cohort))
