'use strict';

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function parseDfPk(output, checkedPath = '/opt/word-tycoon') {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('df returned no filesystem row');
  const fields = lines[lines.length - 1].trim().split(/\s+/);
  if (fields.length < 6) throw new Error(`Unexpected df output: ${lines[lines.length - 1]}`);

  const totalKB = Number(fields[1]);
  const usedKB = Number(fields[2]);
  const availableKB = Number(fields[3]);
  const usedPercent = Number(String(fields[4]).replace('%', ''));
  if (![totalKB, usedKB, availableKB, usedPercent].every(Number.isFinite) || totalKB <= 0) {
    throw new Error(`Invalid df capacity values: ${lines[lines.length - 1]}`);
  }

  return {
    path: checkedPath,
    filesystem: fields[0],
    mount: fields.slice(5).join(' '),
    totalGB: round(totalKB / (1024 * 1024)),
    usedGB: round(usedKB / (1024 * 1024)),
    availableGB: round(availableKB / (1024 * 1024)),
    usedPercent,
    freePercent: round((availableKB / totalKB) * 100)
  };
}

function calculateBackupGrowth(currentGB, previous, nowMs = Date.now(), minSampleHours = 6, maxSampleDays = 45) {
  const current = Number(currentGB);
  const prior = Number(previous?.backupsGB);
  const priorTime = Date.parse(previous?.savedAt || '');
  if (!Number.isFinite(current) || !Number.isFinite(prior) || !Number.isFinite(priorTime)) return null;

  const sampleHours = (Number(nowMs) - priorTime) / (60 * 60 * 1000);
  if (!Number.isFinite(sampleHours) || sampleHours < minSampleHours || sampleHours > maxSampleDays * 24) return null;

  const deltaGB = current - prior;
  return {
    previousGB: round(prior),
    currentGB: round(current),
    deltaGB: round(deltaGB),
    sampleHours: round(sampleHours),
    growthGBPerDay: round((deltaGB * 24) / sampleHours)
  };
}

module.exports = { parseDfPk, calculateBackupGrowth };
