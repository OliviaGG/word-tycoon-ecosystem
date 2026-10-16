'use strict';
// Active summaries retain timing and dimensions without the hidden answer.
function publicRoundSummaries(rows) {
  return rows.map(row => row.status === 'active' ? { ...row, article_title: null, article_key: null } : { ...row });
}
module.exports = { publicRoundSummaries };
