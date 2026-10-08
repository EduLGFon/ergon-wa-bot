#!/usr/bin/env bash
# PM2 log rotation setup - run once on the prod host.
# Keeps conf/gen/out.log under 50M with 7 compressed rotations.
set -euo pipefail
deno run -A --unsafe-proto npm:pm2 install pm2-logrotate
deno run -A --unsafe-proto npm:pm2 set pm2-logrotate:max_size 50M
deno run -A --unsafe-proto npm:pm2 set pm2-logrotate:retain 7
deno run -A --unsafe-proto npm:pm2 set pm2-logrotate:compress true
deno run -A --unsafe-proto npm:pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
echo "logrotate configured"
