#!/usr/bin/env bash
# Gestão Barber IA — instala os lembretes no WhatsApp no servidor de sincronização (já instalado).
# Leve: sem Docker e sem banco de dados. Cria também 1 GB de memória reserva no disco (swap) para os picos.
# Uso (no console do servidor, como root):
#   curl -fsSL https://gest-o-a-vista.vercel.app/integracoes/servidor/instalar-whatsapp.sh | bash
set -euo pipefail
SITE="${SITE_URL:-https://gest-o-a-vista.vercel.app}"
DIR=/opt/gbia-sync/whatsapp
if [ "$(id -u)" != "0" ]; then echo "Rode como root (use sudo)."; exit 1; fi
if [ ! -f /etc/gbia-sync.env ]; then echo "Instale primeiro o servidor de sincronização (instalar-servidor.sh)."; exit 1; fi

echo "==> Memória reserva no disco (swap de 1 GB)"
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=20 && (grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=20' >> /etc/sysctl.conf)
fi

echo "==> Baixando o programa e o motor do WhatsApp (Baileys)"
mkdir -p "$DIR"
curl -fsSL "$SITE/integracoes/servidor/whatsapp.mjs" -o "$DIR/whatsapp.mjs"
cat > "$DIR/package.json" <<'PKG'
{ "name": "gbia-whatsapp", "private": true, "type": "module",
  "dependencies": { "baileys": "7.0.0-rc14", "pino": "9.6.0", "qrcode-terminal": "0.12.0" } }
PKG
(cd "$DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
node --check "$DIR/whatsapp.mjs"
chown -R gbia:gbia "$DIR" && chmod 700 "$DIR"

echo "==> Criando o serviço (liga sozinho e reinicia se cair)"
cat > /etc/systemd/system/gbia-whatsapp.service <<UNIT
[Unit]
Description=Gestão Barber IA - lembretes no WhatsApp
After=network-online.target
Wants=network-online.target

[Service]
User=gbia
WorkingDirectory=$DIR
EnvironmentFile=/etc/gbia-sync.env
Environment=TZ=America/Sao_Paulo
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=/usr/bin/node $DIR/whatsapp.mjs
Restart=always
RestartSec=30
MemoryMax=450M

[Install]
WantedBy=multi-user.target
UNIT

# Atalhos: conectar o número (QR code ou código) e mandar um teste.
cat > /usr/local/bin/gbia-whatsapp-conectar <<CMD
#!/usr/bin/env bash
systemctl stop gbia-whatsapp
if [ -n "\${1:-}" ]; then sudo -u gbia env \$(cat /etc/gbia-sync.env | xargs) TZ=America/Sao_Paulo node $DIR/whatsapp.mjs --codigo "\$1"
else sudo -u gbia env \$(cat /etc/gbia-sync.env | xargs) TZ=America/Sao_Paulo node $DIR/whatsapp.mjs --conectar; fi
systemctl start gbia-whatsapp
CMD
cat > /usr/local/bin/gbia-whatsapp-teste <<CMD
#!/usr/bin/env bash
systemctl stop gbia-whatsapp
sudo -u gbia env \$(cat /etc/gbia-sync.env | xargs) TZ=America/Sao_Paulo node $DIR/whatsapp.mjs --teste "\$1"
systemctl start gbia-whatsapp
CMD
chmod 755 /usr/local/bin/gbia-whatsapp-conectar /usr/local/bin/gbia-whatsapp-teste
systemctl daemon-reload
systemctl enable gbia-whatsapp >/dev/null

echo
echo "============================================================"
echo " Instalado! Agora conecte o chip:"
echo "   gbia-whatsapp-conectar"
echo " (vai aparecer um QR code: no celular do chip, WhatsApp ›"
echo "  Aparelhos conectados › Conectar um aparelho)"
echo " Depois, teste com o seu número:  gbia-whatsapp-teste 5511999998888"
echo " Ver o funcionamento:  journalctl -u gbia-whatsapp -f"
echo "============================================================"
