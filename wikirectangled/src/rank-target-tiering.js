// rank-target-tiering.js — thin re-export of the chat-relay shared module.
//
// The actual tiering logic lives in chat-relay so WikiSearchle and
// WikiRec stay in sync without copy-paste maintenance. This file
// preserves the local require path (`./rank-target-tiering`) used by
// src/round-runner.js so the require site doesn't need to change.
//
// See:
//   /opt/chat-relay/src/rank-target-tiering.js — the actual module
//   ContextKeep memory `wordbank_wordnet_consolidation` — migration notes
//   ContextKeep memory `wikirectangled_rank_target_tiering` — behavior

const path = require('path');

const RELAY_DIR = process.env.CHAT_RELAY_DIR
  || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');

module.exports = require(path.join(RELAY_DIR, 'src', 'rank-target-tiering'));
