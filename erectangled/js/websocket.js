// websocket.js - Chat Relay Socket.IO client (Discord, TikTok, YouTube)

export class WebSocketClient {
    constructor(url, onGuess, onStatusChange, onCosmeticsUpdated) {
        this.url = url;
        this.onGuess = onGuess;
        this.onStatusChange = onStatusChange;
        this.onCosmeticsUpdated = onCosmeticsUpdated || null;
        this.socket = null;
        this.connect();
    }

    connect() {
        if (typeof io === 'undefined') {
            console.warn('Socket.IO client not loaded. Chat Relay may be offline.');
            this.onStatusChange(false);
            // Retry loading after delay
            setTimeout(() => this.connect(), 5000);
            return;
        }

        this.socket = io(this.url, {
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 30000,
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            console.log('Connected to Chat Relay at', this.url);
            this.onStatusChange(true);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from Chat Relay');
            this.onStatusChange(false);
        });

        this.socket.on('connect_error', () => {
            this.onStatusChange(false);
        });

        // Cosmetics update — invalidate client-side cache
        this.socket.on('cosmetics-updated', (data) => {
            if (this.onCosmeticsUpdated && data && data.platform && data.platformUserId) {
                this.onCosmeticsUpdated(data.platform, data.platformUserId, data.equipped);
            }
        });

        // Chat Relay broadcasts normalized messages on 'chat-message'
        this.socket.on('chat-message', (msg) => {
            if (!msg || !msg.message || msg.isJoin) return;

            const raw = msg.message.trim();
            if (!raw || raw.startsWith('/') || raw.startsWith('!') || raw.startsWith('@')) return;
            const word = raw.split(/\s+/)[0].replace(/[./]|\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, '');
            const user = msg.user || {};
            const username = user.displayName || user.username || user.nickname || 'anonymous';
            const profileImage = user.profilePictureUrl || user.profileImageUrl
                || user.avatarUrl || user.avatarURL || user.profilePicUrl
                || user.profilePicture || user.profileImage || user.avatar
                || user.thumbnail?.url || user.thumbnail || user.photo
                || user.image || null;

            if (word.length > 0) {
                if (!profileImage && user) {
                    console.log(`[${msg.platform}] ${username}: ${word} (user fields: ${Object.keys(user).join(', ')})`);
                } else {
                    console.log(`[${msg.platform}] ${username}: ${word}`);
                }
                this.onGuess(word, username, profileImage, msg.platform || 'unknown');
            }
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    reconnectTo(url) {
        this.disconnect();
        this.url = url;
        this.connect();
    }
}
