// Remove all generated cosmetics for player 13 (Jorry)
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', 'data', 'word-tycoon.db');
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  // Count before
  let s = db.prepare("SELECT COUNT(*) as c FROM player_cosmetics WHERE player_id=13 AND cosmetic_id LIKE 'gen_%'");
  s.step(); console.log('player_cosmetics gen_:', s.getAsObject().c); s.free();

  s = db.prepare("SELECT COUNT(*) as c FROM generated_cosmetics WHERE player_id=13");
  s.step(); console.log('generated_cosmetics:', s.getAsObject().c); s.free();

  s = db.prepare("SELECT COUNT(*) as c FROM cosmetics WHERE id LIKE 'gen_%'");
  s.step(); console.log('cosmetics gen_:', s.getAsObject().c); s.free();

  // Delete from all 3 tables
  db.run("DELETE FROM player_cosmetics WHERE player_id=13 AND cosmetic_id LIKE 'gen_%'");
  db.run("DELETE FROM generated_cosmetics WHERE player_id=13");
  db.run("DELETE FROM cosmetics WHERE id LIKE 'gen_%'");
  console.log('All gen_ items removed for player 13');

  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('Saved');
  db.close();
})();
