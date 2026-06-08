# DWGViewer — Visor web de planos AutoCAD

Visor web interno para que operadores consulten planos de instalación DWG desde una pantalla táctil en la sala de racks. Los ingenieros son quienes tienen acceso a los planos originales; este visor da acceso de solo lectura al resto.

## Arquitectura

```
[Servidor Linux con planos DWG]
        │  SMB (CIFS)
        ▼
[Ubuntu 26.04 LTS — este servidor]
  ├── /mnt/planos         ← mount SMB
  ├── app.py              ← FastAPI: API + sirve frontend
  ├── converter.py        ← DWG→DXF (LibreDWG) + DXF→SVG (ezdxf)
  ├── file_browser.py     ← árbol de carpetas
  ├── cache/              ← SVGs cacheados en disco
  └── frontend/           ← HTML+CSS+JS puro, sin build step
        ├── index.html
        ├── style.css
        └── app.js
```

**Pipeline de conversión:**
`archivo.dwg` → `dwg2dxf` (LibreDWG) → `archivo.dxf` → `ezdxf` → `archivo.svg` → navegador

El SVG se cachea en `cache/` con la misma estructura de carpetas que los planos originales. Si el DWG cambia (mtime más reciente), se regenera.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3 + FastAPI + uvicorn |
| Conversión DWG→DXF | LibreDWG (`dwg2dxf`) — `apt install libredwg-utils` |
| Conversión DXF→SVG | ezdxf 1.3.4 |
| Frontend | HTML/CSS/JS puro, sin frameworks ni dependencias CDN |
| Pan/zoom táctil | Implementación propia con CSS transforms |

## Archivos clave

- **[app.py](app.py)** — Punto de entrada FastAPI. Define `/api/tree` y `/api/svg`. Monta el frontend como StaticFiles.
- **[converter.py](converter.py)** — Toda la lógica de conversión. `to_svg()` es la función principal. Intenta LibreDWG primero, ODA File Converter como fallback.
- **[file_browser.py](file_browser.py)** — `build_tree()` recorre la carpeta de planos recursivamente y devuelve JSON con la jerarquía. Solo incluye `.dwg` y `.dxf`.
- **[config.json](config.json)** — Configuración de rutas y puerto. **Editar `planos_path` en Ubuntu** para apuntar al SMB.
- **[frontend/app.js](frontend/app.js)** — Toda la lógica del cliente: carga el árbol, gestiona pan/zoom (mouse + touch), carga SVGs.
- **[install-ubuntu.sh](install-ubuntu.sh)** — Instala dependencias, crea venv, registra servicio systemd. Ejecutar con `sudo`.

## API

| Endpoint | Descripción |
|---|---|
| `GET /api/tree` | Árbol completo de carpetas/archivos como JSON |
| `GET /api/svg?path=rel/ruta.dwg` | SVG del plano (convierte si no está en caché) |
| `GET /` | Sirve el frontend (index.html) |

La ruta en `/api/svg` es relativa a `planos_path`. Hay validación contra path traversal (`relative_to()` raises si sale del directorio base).

## Desarrollo en Windows

Arrancar: `python run.py` desde la raíz del proyecto.

**Limitación**: la conversión DWG→SVG no funciona en Windows sin ODA File Converter instalado (LibreDWG es Linux only). Opciones:
1. Instalar ODA File Converter (gratuito, opendesign.com) — se detecta automáticamente en `C:\Program Files\ODA\...`
2. Poner archivos `.dxf` en `Planoak/` para probar la visualización completa
3. Desarrollar la UI contra el árbol de carpetas y probar conversión en Ubuntu

La carpeta `Planoak/` contiene los planos reales (sincronizados desde el servidor SMB para desarrollo).

## Despliegue en Ubuntu 26.04

```bash
# 1. Copiar proyecto al servidor
# 2. Montar SMB en /etc/fstab:
#    //SERVIDOR/carpeta /mnt/planos cifs credentials=/etc/smb-creds,uid=USER,_netdev 0 0
# 3. Editar config.json: "planos_path": "/mnt/planos"
# 4. Ejecutar instalador:
sudo bash install-ubuntu.sh
# 5. El servicio systemd 'dwgviewer' queda habilitado y arranca solo
```

Logs: `journalctl -u dwgviewer -f`
Reiniciar: `systemctl restart dwgviewer`

## Estructura de planos (Planoak/)

Los planos están organizados en carpetas por sistema/zona. Máximo 2 niveles de subcarpetas. Los archivos `.bak` y `plot.log` de AutoCAD se ignoran automáticamente.

Ejemplo de estructura real:
```
Planoak/
└── 01_E21/
    ├── _ZAHARRAK/          ← planos antiguos (zaharra = viejo en euskera)
    │   ├── E21 AUDIO/
    │   ├── E21 BIDEO/
    │   └── ROTULAZIOA/
    └── PLATO 21/           ← plano 21 (estudio de producción)
```

## Notas de diseño

- **Sin login**: acceso libre en LAN, pensado para pantalla táctil en sala de racks.
- **Sin framework JS**: el frontend es HTML/CSS/JS puro para no requerir build ni npm. Todo funciona offline.
- **Caché por mtime**: los SVGs se regeneran solo si el DWG original es más nuevo. No hay invalidación manual.
- **Fondo blanco en SVG**: `lp.set_colors('#ffffff')` en ezdxf da aspecto de plano impreso, más legible en pantalla táctil.
- **Touch**: pinch-to-zoom y drag implementados con eventos touch nativos. Sin librerías externas.
