'use strict';
function createWebGuessHandler({ socket, gate, current, dispatch, context, pageEnabled = () => true }) {
  let pending = false;
  return async function submit(data, acknowledge) {
    const finish = value => {
      socket.emit('guess-status', value);
      if (typeof acknowledge === 'function') acknowledge(value);
      return value;
    };
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.message !== 'string' ||
        !data.message.trim() || data.message.length > 160 || !data.user || typeof data.user !== 'object' || Array.isArray(data.user)) {
      return finish({ valid: false, result: 'bad_request' });
    }
    if (!pageEnabled()) return finish({ valid: false, result: 'watch_only' });
    if (pending) return finish({ valid: false, result: 'busy', retryable: true });
    pending = true;
    try {
      const before = current();
      if (!before) return finish({ valid: false, result: 'unavailable', retryable: true });
      if (!await gate(data, socket, context)) return finish({ valid: false, result: 'premium_required' });
      if (!socket.connected || current() !== before) return finish({ valid: false, result: 'round_changed', retryable: true });
      const result = await dispatch(data);
      return finish(result || { valid: false, result: 'unavailable', retryable: true });
    } catch {
      return finish({ valid: false, result: 'unavailable', retryable: true });
    } finally { pending = false; }
  };
}
module.exports = { createWebGuessHandler };
