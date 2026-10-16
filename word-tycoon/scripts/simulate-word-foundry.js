'use strict';

const { runBaseline } = require('../src/word-foundry-simulator');

function duration(milliseconds) {
  if (milliseconds === null) return 'not reached';
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const baseline = runBaseline();
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
} else {
  console.log('Word Foundry deterministic economy baseline');
  console.table(baseline.report.map(item => ({
    scenario: item.name,
    cash: item.cash,
    rate_per_sec: item.rate,
    edition: item.edition,
    fame: item.fame,
    words: item.words,
    discoveries: item.discoveries,
    manager: item.managerLevel,
    auto_upgrades: item.automaticUpgrades,
    first_edition: duration(item.milestones.firstEditionAt)
  })));
  for (const check of baseline.evaluation.checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
}

if (!baseline.evaluation.pass) process.exitCode = 1;
