#!/usr/bin/env bash
# Instalacion de DWG Viewer en Ubuntu 26.04 LTS
# Ejecutar como root: sudo bash install-ubuntu.sh
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-$USER}"

echo "========================================"
echo "  Instalando DWG Viewer"
echo "  Directorio: $APP_DIR"
echo "  Usuario:    $RUN_USER"
echo "========================================"

# Dependencias del sistema
apt-get update
apt-get install -y python3 python3-pip python3-venv libredwg-utils cifs-utils

# Entorno virtual Python
cd "$APP_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

# Directorio de cache
mkdir -p "$APP_DIR/cache"
chown "$RUN_USER":"$RUN_USER" "$APP_DIR/cache"

# Servicio systemd
cat > /etc/systemd/system/dwgviewer.service << EOF
[Unit]
Description=Visor de Planos DWG
After=network.target remote-fs.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5
User=$RUN_USER
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dwgviewer
systemctl start dwgviewer

IP=$(hostname -I | awk '{print $1}')

echo ""
echo "========================================"
echo "  Instalacion completa"
echo "  Visor disponible en: http://${IP}:8000"
echo "========================================"
echo ""
echo "PASOS SIGUIENTES:"
echo ""
echo "1. Monta el recurso SMB. Agrega a /etc/fstab:"
echo "   //SERVIDOR/carpeta /mnt/planos cifs credentials=/etc/smb-creds,uid=$RUN_USER,_netdev 0 0"
echo ""
echo "   Crea /etc/smb-creds con:"
echo "   username=tu_usuario"
echo "   password=tu_password"
echo "   chmod 600 /etc/smb-creds"
echo ""
echo "2. Edita config.json y cambia 'planos_path':"
echo "   \"planos_path\": \"/mnt/planos\""
echo ""
echo "3. Reinicia el servicio:"
echo "   systemctl restart dwgviewer"
echo ""
echo "Logs: journalctl -u dwgviewer -f"
