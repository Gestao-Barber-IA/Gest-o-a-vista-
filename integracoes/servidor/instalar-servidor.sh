#!/usr/bin/env bash
# Gestão Barber IA — instala o servidor de sincronização (Ubuntu 22.04 ou 24.04).
# Uso (no console do servidor, como root):
#   curl -fsSL https://gest-o-a-vista.vercel.app/integracoes/servidor/instalar-servidor.sh | bash -s -- SEU_SYNC_TOKEN
set -euo pipefail
SITE="${SITE_URL:-https://gest-o-a-vista.vercel.app}"
TOKEN="${1:-}"
if [ "$(id -u)" != "0" ]; then echo "Rode como root (use sudo)."; exit 1; fi
if [ ${#TOKEN} -lt 32 ]; then echo "Informe o SYNC_TOKEN: ... | bash -s -- SEU_SYNC_TOKEN"; exit 1; fi

echo "==> Instalando o Node.js 20"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  apt-get update -y && apt-get install -y ca-certificates curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Baixando o programa"
id gbia >/dev/null 2>&1 || useradd --system --home /opt/gbia-sync --shell /usr/sbin/nologin gbia
mkdir -p /opt/gbia-sync/dados
curl -fsSL "$SITE/integracoes/servidor/sync-servidor.mjs" -o /opt/gbia-sync/sync-servidor.mjs
curl -fsSL "$SITE/integracoes/appbarber/sincronizar.mjs" -o /opt/gbia-sync/sincronizar.mjs
node --check /opt/gbia-sync/sync-servidor.mjs && node --check /opt/gbia-sync/sincronizar.mjs
chown -R gbia:gbia /opt/gbia-sync && chmod 700 /opt/gbia-sync/dados

umask 077
printf 'SYNC_TOKEN=%s\n' "$TOKEN" > /etc/gbia-sync.env
chmod 600 /etc/gbia-sync.env

echo "==> Criando o serviço (liga sozinho e reinicia se cair)"
cat > /etc/systemd/system/gbia-sync.service <<UNIT
[Unit]
Description=Gestão Barber IA - sincronização AppBarber
After=network-online.target
Wants=network-online.target

[Service]
User=gbia
WorkingDirectory=/opt/gbia-sync
EnvironmentFile=/etc/gbia-sync.env
Environment=TZ=America/Sao_Paulo
ExecStart=/usr/bin/node /opt/gbia-sync/sync-servidor.mjs
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now gbia-sync
sleep 5
IP="$(curl -4 -fsS https://api.ipify.org || echo '?')"
echo
echo "============================================================"
echo " Pronto! O servidor sincroniza a cada 10 minutos, 24h por dia."
echo " IP para cadastrar na AppBarber: $IP"
echo " Ver o funcionamento:  journalctl -u gbia-sync -f"
echo "============================================================"
