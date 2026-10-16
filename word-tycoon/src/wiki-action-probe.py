"""Read-only, aggregate-only scan of WikiRecTangled's durable SQLite intentions."""
import json, os, re, sqlite3, stat, sys, time
from pathlib import Path

counts = dict(records=0, pending=0, delivered=0, handedOff=0, rejected=0,
              check=0, invalid=0, stalePending=0, oldestPendingSeconds=0,
              bytes=0, complete=True)
try:
    filename = Path(sys.argv[1])
    info = filename.lstat()
    if filename.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_size > 536870912:
        raise ValueError('unsafe database')
    counts['bytes'] = info.st_size
    connection = sqlite3.connect(filename.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
    connection.execute('PRAGMA query_only = ON')
    connection.execute('BEGIN')
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'reward_intentions' in tables:
        counts['records'], counts['pending'] = connection.execute(
            'SELECT COUNT(*),COALESCE(SUM(queued_at IS NULL),0) FROM reward_intentions').fetchone()
        counts['handedOff'] = counts['records'] - counts['pending']
        if counts['pending'] > 50000:
            counts['complete'] = False
        now = time.time() * 1000
        for event_id, text, accepted_at in connection.execute(
                'SELECT event_id,payload_json,accepted_at FROM reward_intentions WHERE queued_at IS NULL LIMIT 50000'):
            try:
                if len(text) > 1048576 or not re.fullmatch(r'wiki-action:[a-f0-9]{64}', event_id):
                    raise ValueError('invalid intention')
                payload = json.loads(text)
                if (payload.get('eventId') != event_id or payload.get('game') != 'wikirectangled'
                        or payload.get('event') not in ('word', 'title', 'win')
                        or type(payload.get('coins')) is not int or payload['coins'] < 1
                        or not isinstance(accepted_at, (int, float)) or accepted_at > now + 60000):
                    raise ValueError('invalid intention')
                age = max(0, int((now - accepted_at) / 1000))
                counts['oldestPendingSeconds'] = max(counts['oldestPendingSeconds'], age)
                counts['stalePending'] += age > 600
            except (ValueError, TypeError, KeyError):
                counts['invalid'] += 1
    connection.rollback()
    connection.close()
except FileNotFoundError:
    pass
except Exception:
    counts['complete'] = False
    counts['invalid'] += 1
print(json.dumps(counts))
