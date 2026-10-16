// Original-account progress and durable immutable completion retry.
import { soloOwner, soloStorage, soloContextHeaders } from './solo-owner.js?v=20261003-owner2';
const GAME_ID = 'word500-sp', LS_DAILY = 'word5000.next.daily';
function readDate() { try { return JSON.parse(soloStorage.getItem(LS_DAILY) || 'null')?.date || null; } catch { return null; } }
function writeDate(date) { try { soloStorage.setItem(LS_DAILY, JSON.stringify({date})); } catch {} }
export async function isDailyCompleted(date, loggedIn) {
  if (!date) return false;
  if (readDate() === date) return true;
  if (!loggedIn) return false;
  try {
    const response = await fetch('/api/sp-daily/status/' + GAME_ID, {credentials:'include',headers:soloContextHeaders(),signal:AbortSignal.timeout(10000)});
    const data = await response.json();
    if (response.ok && data.ok && data.completedDates?.includes(date)) { writeDate(date); return true; }
  } catch {}
  return false;
}
export async function markDailyComplete(date, loggedIn, evidence) {
  if (!date) return {ok:false,reason:'no-date'};
  writeDate(date);
  if (!loggedIn) return {ok:true,server:false};
  soloOwner.complete({date,evidence});
  return {ok:true,server:true,pending:true};
}
