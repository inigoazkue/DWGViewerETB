# Planoen Bistaratzailea — DWG Plan Viewer

Web-based viewer for AutoCAD installation plans. Designed for operators to consult DWG plans from a touchscreen terminal in the rack room, with read-only access to plans stored on a remote Linux server via SMB.

---

## Architecture

```
[Remote Linux server with DWG plans]
        │  SMB (CIFS)
        ▼
[Ubuntu 26.04 LTS — this server]
  ├── /mnt/Planoak_MIR     ← SMB mount point
  ├── app.py               ← FastAPI: API + serves frontend
  ├── converter.py         ← DWG→DXF (LibreDWG) + DXF→SVG (ezdxf)
  ├── file_browser.py      ← folder tree builder
  ├── cache/               ← disk-cached SVGs
  └── frontend/            ← pure HTML + CSS + JS, no build step
```

**Conversion pipeline:**
`file.dwg` → `dwg2dxf` (LibreDWG) → `file.dxf` → ezdxf → `file.svg` → browser

SVGs are cached in `cache/` mirroring the folder structure. If the source DWG changes (newer mtime), the SVG is automatically regenerated on next access.

---

## Features

- Folder tree sidebar with collapsible directories
- SVG rendering of AutoCAD DWG/DXF plans with full layer visibility
- Smooth GPU-accelerated pan and zoom (mouse wheel + pinch-to-zoom + drag)
- Vector-quality rendering at rest (no pixelation)
- Automatic SVG pre-generation on startup for first-level plans
- Automatic cleanup of orphaned SVG cache files
- Periodic background maintenance (configurable interval)
- No login required — open LAN access
- No JavaScript frameworks, no CDN dependencies, works fully offline

---

## Requirements

| Component | Version |
|---|---|
| Ubuntu | 26.04 LTS |
| Python | 3.12+ |
| LibreDWG | latest (compiled from source on Ubuntu 26.04) |
| ezdxf | 1.3.4 |
| FastAPI | 0.115.5 |
| uvicorn | 0.32.1 |
| Pillow | latest |

---

## Installation on Ubuntu 26.04

### 1. Clone the repository

```bash
cd /srv/SW
git clone https://github.com/inigoazkue/DWGViewerETB.git DWGViewerETB
cd DWGViewerETB
```

### 2. Run the install script

The script installs all dependencies, compiles LibreDWG from source (not yet packaged for Ubuntu 26.04), creates the Python virtual environment, and registers the systemd service.

```bash
sudo bash install-ubuntu.sh
```

What the script does:
- Installs system dependencies: `python3`, `python3-venv`, `cifs-utils`, `build-essential`, `autoconf`, `automake`, `libtool`, `pkg-config`, `git`
- Attempts `apt install libredwg-utils`; if unavailable, compiles LibreDWG from source
- Creates Python venv at `venv/` and installs `requirements.txt`
- Creates `cache/` directory
- Registers and starts the `dwgviewer` systemd service

> **Note on LibreDWG compilation:** The first compile takes ~10–15 minutes and requires at least 1 GB of RAM. If the server has less than 1 GB free RAM, create a swapfile first:
> ```bash
> sudo fallocate -l 1G /swapfile
> sudo chmod 600 /swapfile
> sudo mkswap /swapfile
> sudo swapon /swapfile
> ```
> Then compile with a single job to avoid OOM:
> ```bash
> cd /path/to/libredwg-source
> sh autogen.sh
> ./configure --disable-docs --disable-tests
> make -j1
> sudo make install
> sudo ldconfig
> ```

### 3. Mount the SMB share

Add to `/etc/fstab`:

```
//10.114.150.102/dwg/_planos_MIRAMON /mnt/Planoak_MIR cifs credentials=/etc/smb-creds,uid=ingprod,_netdev 0 0
```

Create the credentials file:

```bash
sudo nano /etc/smb-creds
```

```
username=dwg
password=YOUR_PASSWORD
```

```bash
sudo chmod 600 /etc/smb-creds
sudo mkdir -p /mnt/Planoak_MIR
sudo mount -a
```

### 4. Configure the plan path

Create `config.local.json` in the project directory (this file is gitignored and never committed):

```bash
echo '{"planos_path": "/mnt/Planoak_MIR"}' > /srv/SW/DWGViewerETB/config.local.json
```

### 5. Restart the service

```bash
sudo systemctl restart dwgviewer
```

The viewer will be available at `http://<server-ip>:8000`

---

## Configuration

Settings are loaded from `config.json` (committed defaults) and overridden by `config.local.json` (local, gitignored).

| Key | Default | Description |
|---|---|---|
| `planos_path` | `"Planoak"` | Path to the DWG folder (relative or absolute) |
| `cache_path` | `"cache"` | Path to the SVG cache folder |
| `host` | `"0.0.0.0"` | Bind address |
| `port` | `8000` | HTTP port |
| `refresh_interval_hours` | `4` | Hours between automatic cache maintenance cycles |

---

## Service management

```bash
# View logs (live)
sudo journalctl -u dwgviewer -f

# Restart
sudo systemctl restart dwgviewer

# Stop / Start
sudo systemctl stop dwgviewer
sudo systemctl start dwgviewer

# Check status
sudo systemctl status dwgviewer
```

---

## Updating

```bash
git -C /srv/SW/DWGViewerETB pull
sudo systemctl restart dwgviewer
```

If `requirements.txt` changed:

```bash
source /srv/SW/DWGViewerETB/venv/bin/activate
pip install -r /srv/SW/DWGViewerETB/requirements.txt
deactivate
sudo systemctl restart dwgviewer
```

---

## API

| Endpoint | Description |
|---|---|
| `GET /api/tree` | Full folder/file tree as JSON |
| `GET /api/svg?path=rel/path.dwg` | SVG of the plan (converts and caches if needed) |
| `GET /` | Frontend (index.html) |

The `path` parameter in `/api/svg` is relative to `planos_path`. Path traversal is blocked via `resolve()` + `relative_to()`.

---

## Cache behaviour

- SVGs are stored in `cache/` mirroring the source folder structure
- On each request, the source file mtime is compared to the cached SVG mtime — if the source is newer, the SVG is regenerated
- On server startup: orphaned SVGs (source DWG deleted) are removed, and SVGs for first-level plans are pre-generated in the background
- Every `refresh_interval_hours` hours: the same maintenance cycle runs automatically

---

## Development on Windows

```bash
python run.py
```

DWG→SVG conversion requires LibreDWG (Linux-only) or ODA File Converter. For Windows development:
- Install ODA File Converter (free, opendesign.com) — auto-detected in `C:\Program Files\ODA\...`
- Or place `.dxf` files directly in `Planoak/` to test rendering without conversion

---

## Folder structure

```
Planoak/
└── 01_E21/
    ├── file.dwg           ← pre-generated on startup (first level)
    ├── _ZAHARRAK/
    │   └── old.dwg        ← generated on demand (second level)
    └── PLATO 21/
        └── plan.dwg       ← generated on demand (second level)
```
