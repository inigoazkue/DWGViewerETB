# DWGViewer — Visor web de planos AutoCAD

Visor web interno para que operadores consulten planos de instalación DWG desde una pantalla táctil en la sala de racks. Los ingenieros son quienes tienen acceso a los planos originales; este visor da acceso de solo lectura al resto.

**Versión actual: v2.0.0**

## Arquitectura

```
[Servidor Linux con planos DWG]
        │  SMB (CIFS)
        ▼
[Ubuntu 26.04 LTS — este servidor]
  ├── /mnt/Planoak_MIR    ← mount SMB real
  ├── app.py              ← FastAPI: API + sirve frontend
  ├── converter.py        ← DWG→DXF (LibreDWG) + DXF→SVG (ezdxf)
  ├── file_browser.py     ← árbol de carpetas
  ├── cache/              ← SVGs y DXFs cacheados en disco
  └── frontend/           ← HTML+CSS+JS puro, sin build step
        ├── index.html
        ├── style.css
        └── app.js
```

**Pipeline de conversión:**
`archivo.dwg` → `dwg2dxf` (LibreDWG) → `archivo.dxf` → `ezdxf` → `archivo.svg` → navegador

El SVG se cachea en `cache/` con la misma estructura de carpetas que los planos originales. Si el DWG cambia (mtime más reciente), se regenera. El DXF intermedio también se cachea para que la búsqueda no requiera reconvertir.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3 + FastAPI + uvicorn |
| Conversión DWG→DXF | LibreDWG (`dwg2dxf`) — compilado desde fuente en Ubuntu 26.04 |
| Conversión DXF→SVG | ezdxf 1.3.4 |
| Frontend | HTML/CSS/JS puro, sin frameworks ni dependencias CDN |
| Pan/zoom táctil | Implementación propia con CSS transforms |

## Archivos clave

- **[app.py](app.py)** — FastAPI. Define `/api/tree`, `/api/svg`, `/api/search`. Monta el frontend como StaticFiles.
- **[converter.py](converter.py)** — Toda la lógica de conversión y búsqueda. `to_svg()` para renderizar, `search_text()` para buscar texto en entidades DXF.
- **[file_browser.py](file_browser.py)** — `build_tree()` recorre la carpeta de planos recursivamente. Solo incluye `.dwg` y `.dxf`.
- **[config.json](config.json)** — Configuración por defecto (rutas de desarrollo en Windows).
- **[config.local.json](config.local.json)** — Overrides de producción, **gitignoreado**. En Ubuntu: `{"planos_path": "/mnt/Planoak_MIR"}`.
- **[frontend/app.js](frontend/app.js)** — Toda la lógica del cliente: árbol, pan/zoom, carga SVG, búsqueda.
- **[install-ubuntu.sh](install-ubuntu.sh)** — Instala dependencias, compila LibreDWG, crea venv, registra servicio systemd. Ejecutar con `sudo`.

## API

| Endpoint | Descripción |
|---|---|
| `GET /api/tree` | Árbol completo de carpetas/archivos como JSON |
| `GET /api/svg?path=rel/ruta.dwg` | SVG del plano (convierte si no está en caché) |
| `GET /api/search?path=rel/ruta.dwg&q=texto` | Busca texto en entidades DXF del plano |
| `GET /` | Sirve el frontend (index.html) |

La ruta en todos los endpoints es relativa a `planos_path`. Hay validación contra path traversal (`relative_to()` raises si sale del directorio base).

### Formato de respuesta de `/api/search`

```json
[{"text": "049201", "x": 156.5, "y": 405.8, "nx": 0.312, "ny": 0.671}]
```
- `x`, `y`: coordenadas DXF en mm
- `nx`, `ny`: fracción 0-1 normalizada con `$EXTMIN`/`$EXTMAX` del header DXF — usadas por el frontend para navegar sin conocer las unidades del plano

## Sistema de búsqueda de texto

**Problema clave**: ezdxf SVGBackend renderiza todo el texto como `<path>` (glifos vectoriales), no como elementos `<text>`. Por tanto la búsqueda DOM es imposible — hay que buscar en el DXF fuente.

**Implementación** (`converter.py:search_text`):
- Usa `ezdxf.recover.readfile()` (tolerante con DXFs malformados de LibreDWG — errores `Invalid ATTRIB.keep_duplicate_records`)
- Busca entidades: TEXT, MTEXT, ATTRIB
- ATTRIBs: sub-entidades del INSERT, accedidas via `e.attribs`. Su posición es `ox + attrib.dxf.insert.x/y` (NO el origen del INSERT)
- Recursión en bloques referenciados, con límite de profundidad 8
- Deduplicación por `(text, round(x,1), round(y,1))`
- Normalización de coordenadas con `$EXTMIN`/`$EXTMAX`

**Sistema de coordenadas**:
- DXF: unidades en mm, Y hacia arriba
- SVG viewBox de ezdxf: en micrómetros (1mm = 1000 unidades), Y invertido
- Frontend usa fracciones normalizadas: `pxX = nx * svgW`, `pxY = (1 - ny) * svgH`
- Zoom de navegación: `scale = viewer.clientWidth / (0.03 * svgW)` — muestra el 3% del ancho del plano, consistente entre planos

**Frontend** (`app.js:doSearch`):
- Dispara en Enter o click en botón lupa interior
- Cancela petición anterior con `AbortController` — evita resultados duplicados de llamadas async solapadas
- `_activeSearchItem` al scope del módulo — garantiza que solo un resultado queda marcado como activo
- Botón X interior al input para vaciar sin cerrar el panel

## Desarrollo en Windows

Arrancar: `python run.py` desde la raíz del proyecto.

**Limitación**: la conversión DWG→SVG no funciona en Windows sin ODA File Converter instalado (LibreDWG es Linux only). Opciones:
1. Instalar ODA File Converter (gratuito, opendesign.com) — se detecta automáticamente en `C:\Program Files\ODA\...`
2. Poner archivos `.dxf` en `Planoak/` para probar la visualización completa
3. Desarrollar la UI contra el árbol de carpetas y probar conversión en Ubuntu

La carpeta `Planoak/` contiene los planos reales (sincronizados desde el servidor SMB para desarrollo).

## Despliegue en Ubuntu 26.04

```bash
# 1. Clonar en el servidor
cd /srv/SW
git clone https://github.com/inigoazkue/DWGViewerETB.git DWGViewerETB

# 2. Montar SMB en /etc/fstab:
#    //10.114.150.102/dwg/_planos_MIRAMON /mnt/Planoak_MIR cifs credentials=/etc/smb-creds,uid=ingprod,ro,_netdev 0 0

# 3. Crear config local:
echo '{"planos_path": "/mnt/Planoak_MIR"}' > /srv/SW/DWGViewerETB/config.local.json

# 4. Ejecutar instalador (compila LibreDWG si apt no lo tiene):
sudo bash install-ubuntu.sh

# 5. El servicio systemd 'dwgviewer' queda habilitado y arranca solo
```

Actualizar: `git -C /srv/SW/DWGViewerETB pull && sudo systemctl restart dwgviewer`

Logs: `sudo journalctl -u dwgviewer -f`

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
- **Fondo negro en SVG**: aspecto AutoCAD en pantalla, mejor contraste que el blanco para los colores de capa.
- **Touch**: pinch-to-zoom y drag implementados con eventos touch nativos. Sin librerías externas.
- **GPU on-demand**: `will-change: transform` solo durante la interacción; 700ms después se borra y el SVG se re-rasteriza como vector puro al tamaño visual actual (commitRenderQuality).
- **Búsqueda en backend**: ezdxf renderiza texto como paths SVG, no como `<text>`. La búsqueda se hace sobre el DXF fuente con la API Python de ezdxf.
- **recover.readfile**: LibreDWG genera DXFs con errores (`Invalid ATTRIB.keep_duplicate_records`). Se usa `ezdxf.recover.readfile()` que es tolerante; `ezdxf.readfile()` rechazaría esas entidades.

## Git / Despliegue

- **Repositorio remoto**: `https://github.com/inigoazkue/DWGViewerETB.git`
- **Proyecto en Ubuntu**: `/srv/SW/DWGViewerETB`
- **config.local.json** gitignoreado — no se commitea nunca
- Comandos git **sin sudo**; el resto de comandos de Ubuntu **con sudo**
