'use strict';
const fs = require('node:fs');
const path = require('node:path');

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function createDailyArchive({ directory, today, dateFor, handleFor, warn = () => {} }) {
  const records = new Map(), handles = new Map();
  function install(meta, date) {
    const previous = records.get(date);
    if (previous) handles.delete(handleFor(previous, date));
    records.set(date, meta);
    handles.set(handleFor(meta, date), date);
  }
  function validate(meta, date) {
    return validDate(date) && meta && typeof meta.setAt === 'string' &&
      typeof meta.cleanTitle === 'string' && meta.cleanTitle.length > 0 &&
      typeof meta.plaintext === 'string' && meta.plaintext.length > 0 &&
      Array.isArray(meta.titleWordNorms) && meta.titleWordNorms.length > 0 && dateFor(meta) === date;
  }
  try {
    for (const name of fs.readdirSync(directory)) {
      const date = name.replace(/\.json$/, '');
      if (name !== date + '.json' || !validDate(date)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (!validate(meta, date)) throw Error('Invalid snapshot');
        install(meta, date);
      } catch (_) { warn('Ignoring an unreadable daily archive snapshot for ' + date); }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {
    remember(meta) {
      const date = dateFor(meta);
      if (!validate(meta, date) || date > today()) throw Error('Invalid daily archive snapshot');
      const previous = records.get(date);
      // A completed day is immutable; today's regenerated puzzle can replace
      // today's snapshot until the Edmonton date rolls over.
      if (previous && (date < today() || JSON.stringify(previous) === JSON.stringify(meta))) return;
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const target = path.join(directory, date + '.json');
      const temp = target + '.' + process.pid + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(meta), { mode: 0o600 });
      fs.renameSync(temp, target);
      install(meta, date);
    },
    list(before) {
      return [...records.keys()].filter(date => date < today() && (!before || date < before))
        .sort().reverse().map(dateKey => ({ dateKey }));
    },
    get(date) { return validDate(date) && date < today() ? records.get(date) || null : null; },
    byHandle(handle) {
      const date = handles.get(handle);
      return date && date < today() ? { dateKey: date, meta: records.get(date) } : null;
    },
  };
}
module.exports = { createDailyArchive, validDate };
