'use strict';

function createPersistenceState() {
  let unsafeReason = null;

  return {
    canFlush() {
      return unsafeReason === null;
    },

    markUnsafe(reason) {
      if (unsafeReason !== null) return false;
      unsafeReason = String(reason && reason.message ? reason.message : reason || 'unknown database failure');
      return true;
    },

    snapshot() {
      return {
        canFlush: unsafeReason === null,
        unsafeReason,
      };
    },
  };
}

module.exports = { createPersistenceState };
