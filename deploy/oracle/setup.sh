#!/usr/bin/env bash
# Instala o ChatApp num servidor Ubuntu (Oracle Cloud Always Free ou outro).
# Uso, já ligado ao servidor por SSH:
#   curl -fsSL https://raw.githubusercontent.com/Nadcv/chatapp-realtime/main/deploy/oracle/setup.sh | sudo bash
# Opcional, a seguir ao sudo (ex.: ... | sudo DOMAIN=meu-chat.duckdns.org bash):
#   DOMAIN=...   domínio próprio (por omissão usa <ip-público>.sslip.io)
#   BRANCH=...   ramo do GitHub a publicar (por omissão main)
# Pode ser corrido de novo sem problema: atualiza em vez de duplicar.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Nadcv/chatapp-realtime.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/chatapp
APP_USER=chatapp
ENV_FILE=/etc/chatapp.env

[ "$(id -u)" -eq 0 ] || { echo "Corre com sudo."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Pacotes base"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "==> Node.js 20"
if ! node -v 2>/dev/null | grep -q '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Caddy (HTTPS automático com Let's Encrypt)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Firewall do servidor: abrir portas 80 e 443"
# As imagens Ubuntu da Oracle bloqueiam tudo menos SSH no iptables local.
for p in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null; then
    # Tem de ficar ANTES da regra REJECT final, senão não tem efeito.
    n=$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')
    if [ -n "$n" ]; then iptables -I INPUT "$n" -p tcp --dport "$p" -j ACCEPT
    else iptables -A INPUT -p tcp --dport "$p" -j ACCEPT; fi
  fi
done
netfilter-persistent save

echo "==> Utilizador e código da app"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --depth=1 origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  mkdir -p "$APP_DIR"; chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund

echo "==> Variáveis de ambiente ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENVEOF'
# Variáveis da app. Depois de editar: sudo systemctl restart chatapp
PORT=3000
NODE_ENV=production
# Opcional: o disco deste servidor não se apaga, por isso a app funciona sem
# MongoDB. Com MONGO_URI, contas/mensagens/grupos vão para o MongoDB.
# MONGO_URI=
# ADMIN_PHONE=
ENVEOF
fi
chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

echo "==> Serviço systemd (arranca sozinho e reinicia se falhar)"
cat > /etc/systemd/system/chatapp.service <<UNITEOF
[Unit]
Description=ChatApp em tempo real
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node --max-old-space-size=4096 server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable chatapp
systemctl restart chatapp

echo "==> Domínio e HTTPS"
if [ -z "${DOMAIN:-}" ]; then
  IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
  DOMAIN="${IP//./-}.sslip.io"
fi
cat > /etc/caddy/Caddyfile <<CADDYEOF
$DOMAIN {
	encode gzip
	reverse_proxy localhost:3000
}
CADDYEOF
systemctl reload caddy || systemctl restart caddy

echo
echo "✅ Instalado. Abre: https://$DOMAIN"
echo "   (o certificado HTTPS pode demorar 1 minuto a ser emitido)"
echo "   Logs da app:   sudo journalctl -u chatapp -f"
echo "   Variáveis:     sudo nano $ENV_FILE && sudo systemctl restart chatapp"
echo "   Atualizar:     corre este mesmo comando outra vez"
