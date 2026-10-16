# Deploying WiKirecTangled

Target: `wikirectangled.com` on `deploy@wordtycoon.live` (the WordTycoon-family
Hetzner server), behind PM2 + nginx, TLS via Let's Encrypt. Same pattern as
WikiSearchle / RecTangled.

> **Always use the hostname `deploy@wordtycoon.live`, never an IP.** Old
> droplet IPs from DigitalOcean days (e.g. `64.23.145.183`) are stale and
> hit unrelated hosts.

The whole repo is checked in; no build step. Deploys are `git pull && pm2 restart`.

---

## One-time setup (first deploy only)

### 1. DNS

Point both records at the Hetzner server (same IP `wordtycoon.live` resolves to):

```
A     wikirectangled.com       → <Hetzner IP>
A     www.wikirectangled.com   → <Hetzner IP>
```

(Or `www` as a CNAME → `wikirectangled.com` — either works. Easier: `dig +short wordtycoon.live`
to read the current IP, then point both records at it.) Wait for propagation:
`dig +short wikirectangled.com` should return the same IP.

### 2. GitHub repo

From the local working dir:

```bash
cd /c/WiKirecTangled
git init
git add .
git commit -m "Initial WiKirecTangled"
gh repo create johnrstanley11-gif/wikirectangled --private --source=. --push
```

### 3. Server directory + clone

```bash
ssh deploy@wordtycoon.live
sudo mkdir -p /opt/wikirectangled
sudo chown deploy:deploy /opt/wikirectangled
cd /opt
git clone git@github.com:johnrstanley11-gif/wikirectangled.git
cd wikirectangled
npm ci
mkdir -p logs data
```

### 4. Environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:
- `GAME_API_SECRET` — copy from `/opt/chat-relay/.env` (must match)
- `WIKI_COVERAGE_PATH=/opt/chat-relay/data/wikipedia-coverage.json` (already
  the default — only override if your Chat Relay isn't at `/opt/chat-relay`)
- `DB_PATH=/opt/wikirectangled/data/wikirectangled.db`

If Chat Relay's word-bank API actually serves a non-empty dictionary, leave
`CHAT_RELAY_URL=http://localhost:3000`. If it returns `[]` (current state on
the server during setup), the local `data/dictionary.json` fallback kicks in
automatically.

### 5. PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # one-time — generates the systemd unit, prints a sudo cmd to run
```

Verify locally on the server:

```bash
curl http://localhost:3031/api/health
# {"ok":true,"hasGame":true,"wordCount":177106,"article":"...","roundId":1,"streamerRooms":0}
```

### 6. nginx

The repo ships two files in `nginx/`:

```bash
# 1. Map block (lives in http context — only need it once per server)
sudo cp /opt/wikirectangled/nginx/connection-upgrade-map.conf \
        /etc/nginx/conf.d/

# 2. The vhost
sudo cp /opt/wikirectangled/nginx/wikirectangled.conf \
        /etc/nginx/sites-available/wikirectangled
sudo ln -sf /etc/nginx/sites-available/wikirectangled \
            /etc/nginx/sites-enabled/wikirectangled

sudo nginx -t                 # must say "syntax is ok" + "test is successful"
sudo systemctl reload nginx
```

Sanity check (still HTTP only):

```bash
curl -I http://wikirectangled.com/
# HTTP/1.1 200 OK
```

If you get `Cannot read property '$connection_upgrade'` or similar, the map
file in step 6.1 didn't load — check `sudo nginx -T | grep connection_upgrade`.

### 7. TLS via Let's Encrypt

```bash
sudo certbot --nginx -d wikirectangled.com -d www.wikirectangled.com
# answer prompts; choose redirect HTTP→HTTPS
```

Certbot rewrites `/etc/nginx/sites-available/wikirectangled` in place — it
adds a `listen 443 ssl;` block + cert paths and converts the port-80 server
to a redirect. After it finishes:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Auto-renewal is already wired by certbot's systemd timer; verify:

```bash
sudo systemctl list-timers | grep certbot
```

### 8. Post-deploy verification (the global "verified live" rule)

```bash
curl -I https://wikirectangled.com/                         # 200
curl -I https://wikirectangled.com/css/style.css?v=2        # 200, content-type: text/css
curl -I https://wikirectangled.com/js/main.js?v=4           # 200, content-type: application/javascript
curl -I https://wikirectangled.com/img/logo.png             # 200, content-type: image/png
curl https://wikirectangled.com/api/health                  # JSON: hasGame:true, wordCount > 100k
curl https://wikirectangled.com/api/relay-status            # connected:true, registered:true
```

Then in a browser: visit `/`, submit a guess. Visit `/solo`, start practice,
guess. Visit `/streamer/test` (will create a room).

```bash
pm2 logs wikirectangled --lines 50 --nostream
```

Look for: `[Boot] Initializing database...`, `[Boot] Loading word list...`,
`[Boot] WiKirecTangled listening`, `[Round] Opened`, `[Relay] Registered: OK`.

---

## Subsequent deploys

```bash
# Local: commit + push
git add . && git commit -m "..." && git push

# Server:
ssh deploy@wordtycoon.live "cd /opt/wikirectangled && git pull && npm ci --production && pm2 restart wikirectangled && pm2 logs wikirectangled --lines 20 --nostream"
```

Then the post-deploy verify (step 8) — every time, no skipping.

---

## Hotfix flow (single-file urgent patch)

```bash
# 1. Local edit + smoke test
# 2. SCP straight in
scp src/round-runner.js deploy@wordtycoon.live:/tmp/wkt-rr.js
ssh deploy@wordtycoon.live "cp /opt/wikirectangled/src/round-runner.js /opt/wikirectangled/src/round-runner.js.bak-$(date +%s) && cp /tmp/wkt-rr.js /opt/wikirectangled/src/round-runner.js && pm2 restart wikirectangled && pm2 logs wikirectangled --lines 20 --nostream"
# 3. Commit + push so server and GitHub stay aligned
git add src/round-runner.js && git commit -m "hotfix: ..." && git push
```

---

## Rollback

```bash
ssh deploy@wordtycoon.live "cd /opt/wikirectangled && git log --oneline -5"
# pick a known-good SHA
ssh deploy@wordtycoon.live "cd /opt/wikirectangled && git checkout <sha> && pm2 restart wikirectangled"
```

To roll back to a `.bak-<ts>` from the hotfix flow:

```bash
ssh deploy@wordtycoon.live "ls -t /opt/wikirectangled/src/*.bak-* | head -5"
ssh deploy@wordtycoon.live "cp /opt/wikirectangled/src/round-runner.js.bak-1778039999 /opt/wikirectangled/src/round-runner.js && pm2 restart wikirectangled"
```

---

## Operational notes

- **DB files:** `/opt/wikirectangled/data/wikirectangled.db` is live and
  `/opt/wikirectangled/data/wikirectangled.db.bak` is the validated
  last-known-good boot snapshot. Keep separate dated off-host snapshots too.
- **Logs:** `/opt/wikirectangled/logs/{out,err}.log` (rotated by PM2). Tail
  with `pm2 logs wikirectangled`.
- **Memory:** PM2 restarts at 2500 MB with a 30-second shutdown timeout
  (configured in `ecosystem.config.js`).
  sql.js holds the DB in RAM, so memory grows with DB size.
- **Wikipedia API:** every round fetches a live article. If you start seeing
  `[Article] fetch ... failed` in logs, you're rate-limited — back off the
  round-build pace or add a per-key disk cache (see Gotchas in AGENTS.md).
- **Edmonton TZ:** daily puzzle uses `Intl.DateTimeFormat` with explicit
  `timeZone: 'America/Edmonton'`, so server system TZ doesn't matter.

---

## Update AGENTS.md after first deploy

Once steps 1–8 succeed, update `AGENTS.md`'s **Source of Truth** table so it
reads:

```
| Local dev   | C:\WiKirecTangled\                            | working copy
| GitHub      | johnrstanley11-gif/wikirectangled (master)     | mirror
| Server      | /opt/wikirectangled/ on deploy@wordtycoon.live | CANONICAL
```

And remove the "(none yet)" placeholders.
