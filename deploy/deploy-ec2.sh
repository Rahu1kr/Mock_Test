#!/usr/bin/env bash
# Deploys backend + frontend to a single Ubuntu EC2 box behind nginx + pm2.
#
#   deploy/deploy-ec2.sh                # build locally, sync, restart
#   deploy/deploy-ec2.sh --setup        # also (re)install nginx config + pm2 boot hook
#
# Env overrides: EC2_HOST, EC2_USER (ubuntu), EC2_KEY (~/.ssh/mock-test-ssh.pem)
#
# The frontend is built here (the server's 1 GB RAM is too small for `next build`)
# with NEXT_PUBLIC_API_BASE_URL="" so it calls /api on its own origin, which nginx
# forwards to the backend. Only .next, public and package files are uploaded.
set -euo pipefail

HOST="${EC2_HOST:-ec2-13-60-227-129.eu-north-1.compute.amazonaws.com}"
USER="${EC2_USER:-ubuntu}"
KEY="${EC2_KEY:-$HOME/.ssh/mock-test-ssh.pem}"
REMOTE_DIR="/home/$USER/geo-app"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$USER@$HOST")
RSYNC_SSH="ssh -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f backend/.env ]; then
  echo "backend/.env is missing — it is copied to the server on first deploy" >&2
  exit 1
fi

echo "▶ building frontend"
(cd frontend && NEXT_PUBLIC_API_BASE_URL= npm run build >/dev/null)

echo "▶ syncing files"
"${SSH[@]}" "mkdir -p $REMOTE_DIR/backend $REMOTE_DIR/frontend $REMOTE_DIR/deploy"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude node_modules --exclude dist --exclude .env \
  backend/ "$USER@$HOST:$REMOTE_DIR/backend/"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude cache --exclude 'dev' \
  frontend/.next/ "$USER@$HOST:$REMOTE_DIR/frontend/.next/"
rsync -az --delete -e "$RSYNC_SSH" frontend/public/ "$USER@$HOST:$REMOTE_DIR/frontend/public/"
rsync -az -e "$RSYNC_SSH" frontend/package.json frontend/package-lock.json frontend/next.config.ts \
  "$USER@$HOST:$REMOTE_DIR/frontend/"
rsync -az -e "$RSYNC_SSH" deploy/ "$USER@$HOST:$REMOTE_DIR/deploy/"

# Secrets travel once; after that the server's copy is the source of truth.
if ! "${SSH[@]}" "test -f $REMOTE_DIR/backend/.env"; then
  echo "▶ uploading backend/.env (first deploy)"
  rsync -az -e "$RSYNC_SSH" backend/.env "$USER@$HOST:$REMOTE_DIR/backend/.env"
  "${SSH[@]}" "cd $REMOTE_DIR/backend && sed -i \
    -e 's#^CORS_ORIGIN=.*#CORS_ORIGIN=http://$HOST#' \
    -e 's#^PORT=.*#PORT=4000#' \
    -e 's#^NODE_ENV=.*#NODE_ENV=production#' \
    -e '/^NPM_CONFIG_PRODUCTION=/d' .env"
fi

echo "▶ installing + building on the server"
"${SSH[@]}" bash -s <<EOF
set -euo pipefail
cd $REMOTE_DIR/backend
npm ci --no-audit --no-fund --loglevel=error
npm run build
npm prune --omit=dev --no-audit --no-fund --loglevel=error
cd $REMOTE_DIR/frontend
# The server's npm rejects this lock file over a nested picomatch version that
# the local npm accepts; `install` resolves it instead of refusing.
npm install --omit=dev --no-audit --no-fund --loglevel=error
EOF

if [ "${1:-}" = "--setup" ]; then
  echo "▶ nginx + pm2 boot hook"
  "${SSH[@]}" bash -s <<EOF
set -euo pipefail
sudo cp $REMOTE_DIR/deploy/nginx.conf /etc/nginx/sites-available/geo-app
sudo ln -sf /etc/nginx/sites-available/geo-app /etc/nginx/sites-enabled/geo-app
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER >/dev/null
EOF
fi

echo "▶ restarting apps"
"${SSH[@]}" "cd $REMOTE_DIR && pm2 startOrReload deploy/ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null && sleep 3 && pm2 ls"

echo "▶ smoke test"
curl -fsS -m 20 "http://$HOST/api/health" && echo
curl -fsS -m 20 -o /dev/null -w "frontend: HTTP %{http_code}\n" "http://$HOST/login"
echo "✓ deployed: http://$HOST"
