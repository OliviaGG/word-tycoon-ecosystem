import { AUTH_BASE } from './auth.js?v=3';
import '../solo-account.js?v=20261003-owner2';
export const soloOwner = window.WordTycoonSoloAccount.create({ game: 'word500-sp', authBase: AUTH_BASE });
export const soloStorage = soloOwner.storage;
let user = null;
export function bindSoloOwner(value) { user = value || null; soloOwner.bind(user); }
export function soloContextHeaders() { return user ? { 'x-solo-session-context': JSON.stringify({id:String(user.id),provider:user.provider || 'discord',anchorId:String(user.anchorId || user.id)}) } : {}; }
