'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function auditMultiplayerRewards(directory) {
  const counts = { pending: 0, delivered: 0, rejected: 0, check: 0 };
  let legacyWinRequests = 0, invalidRecords = 0;
  const attention = [], queue = path.join(directory, 'reward-outbox');
  if (fs.existsSync(queue)) for (const name of fs.readdirSync(queue)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    let row;
    try { row = JSON.parse(fs.readFileSync(path.join(queue, name), 'utf8')); } catch { invalidRecords++; continue; }
    const p = row.payload;
    if (!p?.eventId || crypto.createHash('sha256').update(p.eventId).digest('hex') + '.json' !== name) { invalidRecords++; continue; }
    if (!['wikisearchle', 'wikicontexto'].includes(p.game) || p.event !== 'win') continue;
    if (!p.eventId.startsWith('wiki-mp:')) { legacyWinRequests++; continue; }
    if (!(row.state in counts)) { invalidRecords++; continue; }
    counts[row.state]++;
    if (row.state !== 'delivered') attention.push({ reference: name.slice(0, 16), state: row.state,
      attempts: row.attempts, createdAt: row.createdAt, nextAttemptAt: row.nextAttemptAt });
  }
  let unfinishedReservations = 0;
  for (const [name, many] of [['round-state.json', false], ['sessions.json', true]]) {
    const file = path.join(directory, name); if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const round of many ? Object.values(data) : [data])
      if (round && !round.won && round.completionPending) unfinishedReservations++;
  }
  attention.sort((a, b) => a.createdAt - b.createdAt);
  return { readOnly: true, replaysAuthorized: 0, counts, legacyWinRequests, invalidRecords,
    unfinishedReservations, attention: attention.slice(0, 50) };
}
if (require.main === module) console.log(JSON.stringify(auditMultiplayerRewards(path.join(__dirname, '../data')), null, 2));
module.exports = { auditMultiplayerRewards };
