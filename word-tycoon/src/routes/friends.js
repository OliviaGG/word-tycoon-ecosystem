/**
 * Friends routes — /api/friends/*
 * All friend routes are internal — called by Chat Relay's session-gated proxy.
 * requireApiKey ensures they cannot be called directly by untrusted clients.
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const express = require('express');

function registerFriendsRoutes(app, { db, requireApiKey }) {

  app.get('/api/friends/list', requireApiKey, (req, res) => {
    const discordId = req.query.discordId;
    if (!discordId) return res.json({ ok: false, error: 'Missing discordId' });
    const friends = db.getFriends(discordId);
    const pending = db.getPendingRequests(discordId);
    res.json({ ok: true, friends, pending, friendCount: friends.length, pendingCount: pending.length });
  });

  app.post('/api/friends/request', requireApiKey, express.json(), (req, res) => {
    const { requesterDiscordId, targetDiscordId } = req.body;
    if (!requesterDiscordId || !targetDiscordId) return res.json({ ok: false, error: 'Missing IDs' });
    const result = db.sendFriendRequest(requesterDiscordId, targetDiscordId);
    res.json(result);
  });

  app.post('/api/friends/accept', requireApiKey, express.json(), (req, res) => {
    const { requestId, discordId } = req.body;
    if (!requestId || !discordId) return res.json({ ok: false, error: 'Missing params' });
    const result = db.acceptFriendRequest(requestId, discordId);
    res.json(result);
  });

  app.post('/api/friends/decline', requireApiKey, express.json(), (req, res) => {
    const { requestId, discordId } = req.body;
    if (!requestId || !discordId) return res.json({ ok: false, error: 'Missing params' });
    const result = db.declineFriendRequest(requestId, discordId);
    res.json(result);
  });

  app.post('/api/friends/remove', requireApiKey, express.json(), (req, res) => {
    const { discordId, friendDiscordId } = req.body;
    if (!discordId || !friendDiscordId) return res.json({ ok: false, error: 'Missing params' });
    const result = db.removeFriend(discordId, friendDiscordId);
    res.json(result);
  });

  app.get('/api/friends/search', requireApiKey, (req, res) => {
    const q = req.query.q || '';
    const exclude = req.query.exclude || '';
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    const results = db.searchPlayersForFriend(q, exclude, limit);
    res.json({ ok: true, results });
  });

  app.get('/api/friends/profile/:discordId', requireApiKey, (req, res) => {
    const profile = db.getFriendProfile(req.params.discordId);
    if (!profile) return res.json({ ok: false, error: 'Player not found' });
    res.json({ ok: true, profile });
  });
}

module.exports = { registerFriendsRoutes };
