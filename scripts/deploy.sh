#!/bin/bash
# Orion Cloud Deploy — runs gateway on remote Linux server
set -e

echo "Orion Deploy Script"
echo "==================="

# Check required env
if [ -z "$DEPLOY_HOST" ]; then
  echo "Set DEPLOY_HOST=user@your-server-ip"
  exit 1
fi

# Build orion-ts
echo "Building orion-ts..."
cd orion-ts
pnpm build
cd ..

# Sync files to server
echo "Syncing to $DEPLOY_HOST..."
rsync -avz --exclude node_modules \
  --exclude .env \
  --exclude "*.db" \
  --exclude logs/ \
  orion-ts/ $DEPLOY_HOST:~/orion/

# Install on server
echo "Installing on server..."
ssh $DEPLOY_HOST "cd ~/orion && pnpm install --prod"

# Setup systemd service on server
ssh $DEPLOY_HOST "cat > /etc/systemd/system/orion.service << EOF
[Unit]
Description=Orion AI Gateway
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER/orion
ExecStart=/usr/bin/node dist/main.js --mode gateway
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF"

ssh $DEPLOY_HOST "systemctl daemon-reload && \
  systemctl enable orion && \
  systemctl restart orion"

echo "Deploy complete."
echo "Gateway running at: ws://$DEPLOY_HOST:18789/ws"
echo "Check status: ssh $DEPLOY_HOST systemctl status orion"
