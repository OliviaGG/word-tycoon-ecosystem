'use strict';
const fs = require('node:fs'), path = require('node:path');
function ensureNoInterruptedRestore(directory) {
  if (fs.existsSync(path.join(directory, 'economy-restore-in-progress.json')))
    throw Error('Interrupted offline restore. Keep the economy stopped and complete the original cohort restore.');
}
module.exports = { ensureNoInterruptedRestore };
