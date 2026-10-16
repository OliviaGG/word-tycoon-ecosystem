#!/bin/bash
# Archive player-ledger rows older than 7 days
# Runs as a cron job to prevent memory bloat in mobile-tycoon

cd /opt/word-tycoon

# Stop mobile-tycoon to release DB lock
pm2 stop mobile-tycoon --silent 2>/dev/null
sleep 2

node -e "
const fs = require('fs');
const initSqlJs = require('/opt/word-tycoon/node_modules/sql.js');
(async () => {
  const SQL = await initSqlJs();
  const dbBuf = fs.readFileSync('/opt/word-tycoon/data/player-ledger.db');
  const db = new SQL.Database(dbBuf);
  const before = db.exec('SELECT COUNT(*) FROM player_ledger')[0].values[0][0];
  db.run(\"DELETE FROM player_ledger WHERE created_at < datetime('now', '-7 days')\");
  db.run('VACUUM');
  const after = db.exec('SELECT COUNT(*) FROM player_ledger')[0].values[0][0];
  const data = db.export();
  fs.writeFileSync('/opt/word-tycoon/data/player-ledger.db', Buffer.from(data));
  console.log('[Ledger Archive] ' + new Date().toISOString() + ' | Rows: ' + before + ' -> ' + after + ' (deleted ' + (before-after) + ') | Size: ' + Math.round(data.length/1024/1024) + 'MB');
  db.close();
})();
"

# Restart mobile-tycoon
pm2 start /opt/ecosystem.config.js --only mobile-tycoon --update-env --silent 2>/dev/null

