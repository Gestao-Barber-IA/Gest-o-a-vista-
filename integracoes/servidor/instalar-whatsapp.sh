#!/usr/bin/env bash
# Gestão Barber IA — instala os lembretes no WhatsApp no servidor de sincronização (já instalado).
# Leve: sem Docker e sem banco de dados. Cria também 1 GB de memória reserva no disco (swap) para os picos.
# Uso (no console do servidor, como root):
#   curl -fsSL https://gestaoperformance.vercel.app/integracoes/servidor/instalar-whatsapp.sh | bash
set -euo pipefail
SITE="${SITE_URL:-https://gestaoperformance.vercel.app}"
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

echo "==> Criando os serviços (ligam sozinhos e reiniciam se caírem)"
# Dois números: gbia-whatsapp (equipe, checklist) e gbia-whatsapp-clientes (lembrete de agendamento dos clientes).
servico() { # $1 = nome do serviço, $2 = papel, $3 = descrição
cat > /etc/systemd/system/$1.service <<UNIT
[Unit]
Description=Gestão Barber IA - $3
After=network-online.target
Wants=network-online.target

[Service]
User=gbia
WorkingDirectory=$DIR
EnvironmentFile=/etc/gbia-sync.env
Environment=TZ=America/Sao_Paulo
Environment=WA_PAPEL=$2
Environment=NODE_OPTIONS=--max-old-space-size=200
ExecStart=/usr/bin/node $DIR/whatsapp.mjs
Restart=always
RestartSec=30
MemoryMax=400M

[Install]
WantedBy=multi-user.target
UNIT
}
servico gbia-whatsapp equipe "lembretes da equipe no WhatsApp"
servico gbia-whatsapp-clientes clientes "lembrete de agendamento dos clientes no WhatsApp"

# Atalhos: conectar cada número (QR code ou código) e mandar um teste.
atalho() { # $1 = comando, $2 = serviço, $3 = papel, $4 = opção do node (--conectar ou --teste)
cat > /usr/local/bin/$1 <<CMD
#!/usr/bin/env bash
systemctl stop $2
if [ "$4" = "--teste" ]; then sudo -u gbia env \$(cat /etc/gbia-sync.env | xargs) TZ=America/Sao_Paulo WA_PAPEL=$3 node $DIR/whatsapp.mjs --teste "\$1"
elif [ -n "\${1:-}" ]; then sudo -u gbia env \$(cat /etc/gbia-sync.env | xargs) TZ=America/Sao_Paulo WA_PAPEL=$3 node $DIR/whatsapp.mjs --codigo "\$1"
else sudo -u gbia env \$(cat /etc/gbia-sync.env | xargs) TZ=America/Sao_Paulo WA_PAPEL=$3 node $DIR/whatsapp.mjs --conectar; fi
systemctl start $2
CMD
chmod 755 /usr/local/bin/$1
}
atalho gbia-whatsapp-conectar gbia-whatsapp equipe --conectar
atalho gbia-whatsapp-teste gbia-whatsapp equipe --teste
atalho gbia-whatsapp-conectar-clientes gbia-whatsapp-clientes clientes --conectar
atalho gbia-whatsapp-teste-clientes gbia-whatsapp-clientes clientes --teste
systemctl daemon-reload
systemctl enable gbia-whatsapp gbia-whatsapp-clientes >/dev/null
systemctl restart gbia-whatsapp gbia-whatsapp-clientes

echo
echo "============================================================"
echo " Instalado! Dois números de WhatsApp:"
echo "  • Equipe (checklist):     gbia-whatsapp-conectar"
echo "                            gbia-whatsapp-teste 55DDDNUMERO"
echo "  • Clientes (agendamento): gbia-whatsapp-conectar-clientes"
echo "                            gbia-whatsapp-teste-clientes 55DDDNUMERO"
echo " (aparece um QR code: no celular do chip, WhatsApp ›"
echo "  Aparelhos conectados › Conectar um aparelho)"
echo " Ver o funcionamento:  journalctl -u gbia-whatsapp-clientes -f"
echo "============================================================"
