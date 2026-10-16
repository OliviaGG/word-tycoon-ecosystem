'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { SERVICES } = require('./operations-probe');
function evaluate(snapshot, history, now = Date.now()) {
  const alarms = [];
  for (const service of snapshot.services) {
    if (!Object.hasOwn(SERVICES, service.name)) continue;
    if (service.status !== 'online') alarms.push({ code: 'service-unavailable', service: service.name });
    const samples = history.filter(row => now - row.capturedAt <= 600000)
      .map(row => row.services.find(p => p.name === service.name)).filter(Boolean);
    let previous = samples[0];
    for (let i = 1; i < samples.length; i++) if (samples[i].restarts < samples[i - 1].restarts) previous = samples[i];
    if (previous && service.restarts - previous.restarts >= 3) alarms.push({ code: 'restart-burst', service: service.name });
    // Economy legitimately holds large sql.js databases; thresholds reflect that architecture.
    const maxRSS = service.name === 'mobile-tycoon' ? 4096 : service.name === 'mobile-relay' ? 2048 : 1024;
    if (service.rssMB > maxRSS) alarms.push({ code: 'memory-high', service: service.name });
  }
  for (const [service, queue] of Object.entries(snapshot.queues || {})) {
    if (queue.stalePending) alarms.push({ code: 'reward-stalled', service });
    if (queue.rejected || queue.check || queue.invalid) alarms.push({ code: 'reward-needs-review', service });
    if (!queue.complete) alarms.push({ code: 'reward-scan-incomplete', service });
    if (queue.records >= 40000) alarms.push({ code: 'reward-retention-needed', service });
  }
  if (snapshot.backups) {
    const b = snapshot.backups;
    if (!b.lastHourlyAt || now - b.lastHourlyAt > 21600000) alarms.push({ code: 'hourly-backup-stale', service: 'mobile-tycoon' });
    if (!b.lastCohortAt || b.incompleteCohorts) alarms.push({ code: 'cohort-needs-review', service: 'mobile-tycoon' });
    if (b.completeCohorts >= 8) alarms.push({ code: 'cohort-retention-needed', service: 'mobile-tycoon' });
    if (b.freeDiskBytes != null && b.freeDiskBytes < 21474836480) alarms.push({ code: 'disk-space-low', service: 'mobile-tycoon' });
    if (b.fleet) {
      const fleet = b.fleet;
      if (!fleet.complete || fleet.invalid || fleet.staleIncompleteCohorts || fleet.maintenanceStale) alarms.push({ code: 'fleet-backup-needs-review', service: 'mobile-tycoon' });
      if (!fleet.lastCompleteAt || now - fleet.lastCompleteAt * 1000 > 30 * 3600000) alarms.push({ code: 'fleet-backup-stale', service: 'mobile-tycoon' });
      if (fleet.timerActive === false || fleet.timerEnabled === false || fleet.lastServiceSucceeded === false) alarms.push({ code: 'fleet-backup-schedule-failed', service: 'mobile-tycoon' });
      if (b.freeDiskBytes != null && b.freeDiskBytes < 60 * 1024 ** 3) alarms.push({ code: 'fleet-backup-space-low', service: 'mobile-tycoon' });
    }
  }
  if (snapshot.billing?.available === false) alarms.push({ code: 'billing-store-unavailable', service: 'searchle-mobile' });
  if (snapshot.billing?.stalePending) alarms.push({ code: 'billing-ack-stalled', service: 'searchle-mobile' });
  return alarms.sort((a, b) => (a.service + a.code).localeCompare(b.service + b.code));
}
function createOperationsMonitor({ directory, now = Date.now, probe, log = console.warn, intervalMs = 60000 } = {}) {
  const filename = path.join(directory, 'operations-health.json');
  let snapshot = null, history = [], events = [], signature = '', timer = null, busy = false;
  let queuesAt = 0, previousQueues = null, previousBackups = null, previousBilling = null, started = false;
  const runProbe = probe || (async queues => {
    const args = [path.join(__dirname, 'operations-probe.js'), ...(queues ? [] : ['--status-only'])];
    const { stdout } = await promisify(execFile)(process.execPath, args,
      { timeout: 45000, maxBuffer: 131072, windowsHide: true });
    return JSON.parse(stdout);
  });
  async function persist() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const tmp = filename + '.tmp', file = await fs.open(tmp, 'w', 0o600);
    try { await file.writeFile(JSON.stringify({ version: 1, snapshot, events })); await file.sync(); }
    finally { await file.close(); }
    await fs.rename(tmp, filename);
  }
  async function tick() {
    if (busy) return; busy = true;
    try {
      const time = now(), queues = !previousQueues || time - queuesAt >= 300000;
      const sample = await runProbe(queues);
      if (!Array.isArray(sample.services) || sample.services.length !== Object.keys(SERVICES).length ||
          sample.services.some(p => !Object.hasOwn(SERVICES, p.name))) throw Error('Invalid probe');
      if (queues) { previousQueues = sample.queues; previousBackups = sample.backups; previousBilling = sample.billing; queuesAt = time; }
      sample.queues = previousQueues;
      sample.backups = previousBackups;
      sample.billing = previousBilling;
      sample.queueCapturedAt = queuesAt;
      sample.alarms = evaluate(sample, history, time);
      history = [...history.filter(row => time - row.capturedAt <= 600000),
        { capturedAt: time, services: sample.services }].slice(-12);
      snapshot = sample;
      const next = JSON.stringify(sample.alarms);
      if (next !== signature) {
        if (sample.alarms.length || signature) {
          events.push({ at: time, alarms: sample.alarms }); events = events.slice(-100);
          log('[Operations] ' + (sample.alarms.length ? next : 'All monitored alarms cleared'));
        }
        signature = next;
      }
      await persist();
    } catch {
      snapshot = { ...(snapshot || {}), probeFailedAt: now() };
      if (signature !== 'probe-unavailable') { signature = 'probe-unavailable'; log('[Operations] Probe unavailable'); }
    } finally { busy = false; }
  }
  function summary() {
    return { ok: !!snapshot && !snapshot.probeFailedAt && now() - snapshot.capturedAt <= 180000,
      ...snapshot, events, retention: { rewardReceipts: 'Keep for replay protection; review at 40000 records per queue',
        historySamples: 12, alertTransitions: 100 } };
  }
  async function start() {
    if (started) return; started = true;
    // Persist only safe aggregate history; old process baselines are never reused after restart.
    try {
      const stat = await fs.stat(filename);
      if (stat.size <= 262144) {
        const old = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (old.version === 1 && Array.isArray(old.events)) events = old.events.slice(-100);
      }
    } catch {}
    await tick(); timer = setInterval(tick, intervalMs); timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; started = false; }
  return { start, stop, tick, summary };
}
module.exports = { createOperationsMonitor, evaluate };
