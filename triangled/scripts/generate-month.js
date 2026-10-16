const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const daily = require('../src/daily');

async function main() {
  const startDate = process.argv[2] || daily.dateKey();
  const parsedDays = parseInt(process.argv[3], 10);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
  const overwriteExisting = process.argv.includes('--overwrite');
  const apiKey = process.env.OPENROUTER_API_KEY || '';

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  console.log(`Generating ${days} Triangled day(s) starting ${startDate}...`);
  const summary = await daily.generatePuzzleBatch(startDate, apiKey, {
    days,
    puzzleCount: 1,
    overwriteExisting
  });

  const generated = summary.results.filter(result => result.status === 'generated');
  const skipped = summary.results.filter(result => result.status === 'skipped');
  const failed = summary.results.filter(result => result.status === 'failed');

  console.log(`Generated: ${generated.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Failed: ${failed.length}`);

  for (const result of summary.results) {
    const suffix = result.theme
      ? ` - ${result.theme}`
      : result.reason
        ? ` (${result.reason})`
        : result.error
          ? ` (${result.error})`
          : '';
    console.log(`[${result.status}] ${result.date}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
