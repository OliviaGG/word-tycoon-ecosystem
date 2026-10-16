// PM2 process manager config — used on the droplet.
//
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 logs wikirectangled
//
// Single-instance — sql.js holds DB state in-process so we can't horizontally
// scale without first migrating to a real DB.

module.exports = {
  apps: [
    {
      name: 'wikirectangled',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '2500M',
      node_args: '--max-old-space-size=768',
      kill_timeout: 30000,
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
