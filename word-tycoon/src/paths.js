'use strict';

const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_DIR = path.resolve(process.env.WORD_TYCOON_DATA_DIR || DEFAULT_DATA_DIR);

module.exports = {
  DATA_DIR,
  BACKUP_DIR: path.join(DATA_DIR, 'backups'),
  DB_PATH: path.join(DATA_DIR, 'word-tycoon.db'),
  LEDGER_DB_PATH: path.join(DATA_DIR, 'player-ledger.db'),
  LEDGER_ARCHIVE_DB_PATH: process.env.LEDGER_ARCHIVE_DB_PATH
    ? path.resolve(process.env.LEDGER_ARCHIVE_DB_PATH)
    : path.join(DATA_DIR, 'player-ledger-archive.db')
};
