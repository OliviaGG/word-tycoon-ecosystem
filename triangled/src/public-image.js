'use strict';
const path = require('node:path');
const fs = require('node:fs');
function createPublicImageRoute({ directory, getPuzzle, today, filesystem = fs }) {
  return function publicImage(req, res) {
    const name = req.params.file;
    const match = typeof name === 'string' && /^(\d{4}-\d{2}-\d{2})\.(jpg|jpeg|png|webp)$/i.exec(name);
    if (!match || name !== path.basename(name)) return res.sendStatus(404);
    const date = match[1], parsed = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today()) return res.sendStatus(404);
    let record;
    try { record = getPuzzle(date); } catch { return res.sendStatus(404); }
    if (record?.status !== 'approved' || record.puzzle?.imageFile !== name) return res.sendStatus(404);
    const filename = path.join(directory, name);
    try {
      const stat = filesystem.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) return res.sendStatus(404);
    } catch { return res.sendStatus(404); }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.sendFile(filename);
  };
}
module.exports = { createPublicImageRoute };
