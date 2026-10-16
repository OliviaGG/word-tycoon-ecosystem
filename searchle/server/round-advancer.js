'use strict';

// The saved deadline belongs to one accepted round. Replacement/retirement
// invalidates its timer, including a replacement while preparation awaits I/O.
function createRoundAdvancer({ current, isCurrent, advance, onError = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const timers = new Map();
  function schedule(game, retry = false) {
    const record = current(game);
    if (!record?.completion || record.meta.ended || !isCurrent(game)) return false;
    const previous = timers.get(record.scope);
    if (previous?.roundId === record.roundId && !retry) return true;
    if (previous) clearTimer(previous.timer);
    const entry = { roundId: record.roundId, timer: null };
    const delay = retry ? 5000 : Math.max(0, record.completion.nextRoundAt - now());
    entry.timer = setTimer(async () => {
      if (timers.get(record.scope) !== entry) return;
      timers.delete(record.scope);
      try {
        if (!isCurrent(game)) return;
        const accepted = current(game);
        if (accepted?.roundId !== record.roundId || accepted.meta.ended || !accepted.completion) return;
        await advance(game, accepted);
      } catch (error) {
        onError(error);
        try { if (isCurrent(game) && current(game)?.roundId === record.roundId) schedule(game, true); } catch (ignored) { onError(ignored); }
      }
    }, delay);
    entry.timer?.unref?.();
    timers.set(record.scope, entry);
    return true;
  }
  return { schedule, stop() { for (const entry of timers.values()) clearTimer(entry.timer); timers.clear(); } };
}
module.exports = { createRoundAdvancer };
