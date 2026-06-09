# Planoen Bistaratzailea — Visor de planos DWG

**v2.0.0**

Visor web de planos AutoCAD para uso interno. Diseñado para que los operadores consulten planos de instalación DWG desde una terminal táctil en la sala de racks, con acceso de solo lectura a los planos almacenados en un servidor Linux remoto vía SMB.

---

## Arquitectura

```
[Servidor Linux remoto con planos DWG]
        │  SMB (CIFS)
        ▼
[Ubuntu 26.04 LTS — este servidor]
  ├── /mnt/Planoak_MIR     ← punto de montaje SMB
  ├── app.py               ← FastAPI: API + sirve el frontend
  ├── converter.py         ← DWG→DXF (LibreDWG) + DXF→SVG (ezdxf)
  ├── file_browser.py      ← constructor del árbol de carpetas
  ├── cache/               ← SVGs y DXFs cacheados en disco
  └── frontend/            ← HTML + CSS + JS puro, sin paso de build
```

**Pipeline de conversión:**
`archivo.dwg` → `dwg2dxf` (LibreDWG) → `archivo.dxf` → ezdxf → `archivo.svg` → navegador

Los SVGs se cachean en `cache/` replicando la estructura de carpetas. Si el DWG fuente cambia (mtime más reciente), el SVG se regenera automáticamente en el siguiente acceso.

---

## Funcionalidades

- Árbol de carpetas en sidebar con directorios colapsables
- Renderizado SVG de planos AutoCAD DWG/DXF con visibilidad completa de capas
- Paneo y zoom fluidos con aceleración GPU (rueda del ratón + pinch-to-zoom + arrastre)
- Renderizado vectorial de calidad en reposo (sin pixelado)
- **Búsqueda de texto**: localiza números de cable y etiquetas dentro del plano cargado; al hacer click en un resultado navega directamente a él en el dibujo
- Pre-generación automática de SVGs al arranque para los planos del primer nivel
- Limpieza automática de archivos SVG huérfanos en caché
- Mantenimiento periódico en segundo plano (intervalo configurable)
- Sin login — acceso abierto en LAN
- Sin frameworks JavaScript, sin dependencias CDN, funciona completamente sin conexión

---

## Requisitos

| Componente | Versión |
|---|---|
| Ubuntu | 26.04 LTS |
| Python | 3.12+ |
| LibreDWG | última (compilada desde fuente en Ubuntu 26.04) |
| ezdxf | 1.3.4 |
| FastAPI | 0.115.5 |
| uvicorn | 0.32.1 |
| Pillow | última |

---

## Instalación en Ubuntu 26.04

### 1. Clonar el repositorio

```bash
cd /srv/SW
git clone https://github.com/inigoazkue/DWGViewerETB.git DWGViewerETB
cd DWGViewerETB
```

### 2. Ejecutar el script de instalación

El script instala todas las dependencias, compila LibreDWG desde fuente (aún no empaquetado para Ubuntu 26.04), crea el entorno virtual Python y registra el servicio systemd.

```bash
sudo bash install-ubuntu.sh
```

Lo que hace el script:
- Instala dependencias del sistema: `python3`, `python3-venv`, `cifs-utils`, `build-essential`, `autoconf`, `automake`, `libtool`, `pkg-config`, `git`
- Intenta `apt install libredwg-utils`; si no está disponible, compila LibreDWG desde fuente
- Crea el venv Python en `venv/` e instala `requirements.txt`
- Crea el directorio `cache/`
- Registra e inicia el servicio systemd `dwgviewer`

> **Nota sobre la compilación de LibreDWG:** La primera compilación tarda entre 10 y 15 minutos y requiere al menos 1 GB de RAM libre. Si el servidor tiene menos, crea un swapfile primero:
> ```bash
> sudo fallocate -l 1G /swapfile
> sudo chmod 600 /swapfile
> sudo mkswap /swapfile
> sudo swapon /swapfile
> ```
> Luego compila con un solo hilo para evitar OOM:
> ```bash
> cd /ruta/a/libredwg-fuente
> sh autogen.sh
> ./configure --disable-docs --disable-tests
> make -j1
> sudo make install
> sudo ldconfig
> ```

### 3. Montar el recurso SMB

Añadir a `/etc/fstab`:

```
//10.114.150.102/dwg/_planos_MIRAMON /mnt/Planoak_MIR cifs credentials=/etc/smb-creds,uid=ingprod,ro,_netdev 0 0
```

Crear el archivo de credenciales:

```bash
sudo nano /etc/smb-creds
```

```
username=dwg
password=TU_CONTRASEÑA
```

```bash
sudo chmod 600 /etc/smb-creds
sudo mkdir -p /mnt/Planoak_MIR
sudo mount -a
```

### 4. Configurar la ruta de los planos

Crear `config.local.json` en el directorio del proyecto (este archivo está gitignoreado y nunca se commitea):

```bash
echo '{"planos_path": "/mnt/Planoak_MIR"}' > /srv/SW/DWGViewerETB/config.local.json
```

### 5. Reiniciar el servicio

```bash
sudo systemctl restart dwgviewer
```

El visor estará disponible en `http://<ip-del-servidor>:8000`

---

## Configuración

Los ajustes se cargan desde `config.json` (valores por defecto en git) y se sobreescriben con `config.local.json` (local, gitignoreado).

| Clave | Por defecto | Descripción |
|---|---|---|
| `planos_path` | `"Planoak"` | Ruta a la carpeta de planos DWG (relativa o absoluta) |
| `cache_path` | `"cache"` | Ruta a la carpeta de caché SVG |
| `host` | `"0.0.0.0"` | Dirección de escucha |
| `port` | `8000` | Puerto HTTP |
| `refresh_interval_hours` | `4` | Horas entre ciclos automáticos de mantenimiento de caché |

---

## Gestión del servicio

```bash
# Ver logs en tiempo real
sudo journalctl -u dwgviewer -f

# Reiniciar
sudo systemctl restart dwgviewer

# Parar / Arrancar
sudo systemctl stop dwgviewer
sudo systemctl start dwgviewer

# Ver estado
sudo systemctl status dwgviewer
```

---

## Actualizar

```bash
git -C /srv/SW/DWGViewerETB pull
sudo systemctl restart dwgviewer
```

Si ha cambiado `requirements.txt`:

```bash
source /srv/SW/DWGViewerETB/venv/bin/activate
pip install -r /srv/SW/DWGViewerETB/requirements.txt
deactivate
sudo systemctl restart dwgviewer
```

---

## API

| Endpoint | Descripción |
|---|---|
| `GET /api/tree` | Árbol completo de carpetas/archivos como JSON |
| `GET /api/svg?path=rel/ruta.dwg` | SVG del plano (convierte y cachea si es necesario) |
| `GET /api/search?path=rel/ruta.dwg&q=texto` | Busca texto en entidades DXF; devuelve `[{text, x, y, nx, ny}]` |
| `GET /` | Frontend (index.html) |

Todos los parámetros `path` son relativos a `planos_path`. El path traversal está bloqueado mediante `resolve()` + `relative_to()`.

### Formato de respuesta de `/api/search`

```json
[
  { "text": "049201", "x": 156.5, "y": 405.8, "nx": 0.312, "ny": 0.671 }
]
```

- `x`, `y`: coordenadas en el espacio modelo DXF (mm)
- `nx`, `ny`: fracciones 0-1 normalizadas respecto a `$EXTMIN`/`$EXTMAX` — usadas por el frontend para navegar sin conocer las unidades del dibujo

---

## Comportamiento de la caché

- Los SVGs y DXFs se almacenan en `cache/` replicando la estructura de carpetas fuente
- En cada petición se compara el mtime del archivo fuente con el del archivo cacheado — si el fuente es más reciente, la caché se regenera
- Al arrancar el servidor: se eliminan los SVGs huérfanos (DWG fuente borrado) y se pre-generan los SVGs de los planos del primer nivel en segundo plano
- Cada `refresh_interval_hours` horas: se repite el mismo ciclo de mantenimiento automáticamente

---

## Desarrollo en Windows

```bash
python run.py
```

La conversión DWG→SVG requiere LibreDWG (solo Linux) o ODA File Converter. Para desarrollo en Windows:
- Instalar ODA File Converter (gratuito, opendesign.com) — se detecta automáticamente en `C:\Program Files\ODA\...`
- O colocar archivos `.dxf` directamente en `Planoak/` para probar el renderizado sin conversión

---

## Estructura de carpetas

```
Planoak/
└── 01_E21/
    ├── archivo.dwg        ← pre-generado al arranque (primer nivel)
    ├── _ZAHARRAK/
    │   └── antiguo.dwg   ← generado bajo demanda (segundo nivel)
    └── PLATO 21/
        └── plano.dwg     ← generado bajo demanda (segundo nivel)
```
