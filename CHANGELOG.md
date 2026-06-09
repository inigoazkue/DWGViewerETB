# Changelog

Todos los cambios relevantes de Planoen Bistaratzailea se documentan aquí.

---

## [v2.1.0] — 2026-06-09

### Añadido

**Búsqueda global en árbol**
- Campo de búsqueda en el sidebar que busca un texto en todos los planos a la vez
- Resalta los archivos con coincidencias con badge de conteo; abre automáticamente las carpetas que los contienen
- Cancela peticiones anteriores con `AbortController` para evitar resultados solapados
- Botón ↻ para re-indexado forzado (elimina BD y regenera desde cero)

**Índice SQLite FTS5**
- Nuevo módulo `search_index.py`: índice SQLite con tabla FTS5 y tokenizador trigrama (`case_sensitive 0`)
- ~250K entradas indexadas; búsqueda global instantánea mediante `MATCH '"query"'` (phrase search)
- Indexación incremental: detecta planos nuevos o modificados (por mtime) y actualiza solo los necesarios
- Limpia automáticamente las entradas de planos eliminados
- Migración automática de esquema: si la BD no tiene FTS5 trigrama, se borra y re-indexa
- `POST /api/reindex`: elimina el índice y lanza re-indexado completo en background
- `GET /api/index-status`: estado en tiempo real del indexado en curso

**Barra de progreso de indexación**
- Indicador en la parte inferior del sidebar: "Planoen datuak indexatzen...", barra de progreso y porcentaje `% XX`
- Se muestra solo mientras el indexado está en curso; desaparece al terminar

**Árbol de directorios lazy loading**
- `GET /api/tree` devuelve solo el primer nivel (shallow) con subdirectorios marcados `lazy: true`
- `GET /api/tree?path=carpeta` devuelve los hijos directos de esa carpeta bajo demanda
- La carga inicial del árbol es instantánea; cada carpeta se carga al expandirla por primera vez
- La búsqueda global fuerza la carga de las carpetas necesarias antes de resaltar archivos

### Corregido

- `doTreeSearch` abortaba su propia petición: el `AbortController` se creaba antes de `clearTreeSearch()`, que lo cancelaba inmediatamente; el fetch lanzaba `AbortError` silencioso y el estado quedaba bloqueado en "Planoetan bilatzen…"
- Texto corregido: "Bilatzen planoetan" → "Planoetan bilatzen…"
- Texto corregido: "Planoen datuan indexatzen" → "Planoen datuak indexatzen..."

---

## [v2.0.2] — 2026-06-09

### Cambiado

- Montaje SMB configurado con opción `ro` (solo lectura) en README, CLAUDE.md e install-ubuntu.sh

---

## [v2.0.1] — 2026-06-09

### Cambiado

- Versión movida a la esquina inferior derecha del encabezado del sidebar (junto a "Planoak")

---

## [v2.0.0] — 2026-06-09

### Añadido

**Búsqueda de texto**
- Endpoint `/api/search?path=&q=`: busca entidades TEXT, MTEXT y ATTRIB en el DXF fuente
- Búsqueda en backend con `ezdxf.recover.readfile()` — tolerante con DXFs malformados generados por LibreDWG (`Invalid ATTRIB.keep_duplicate_records`)
- Entidades ATTRIB accedidas como sub-entidades del INSERT (`e.attribs`), no iteradas desde la definición del bloque
- Recursión en bloques con límite de profundidad (8) para encontrar texto dentro de bloques anidados
- Normalización de coordenadas con `$EXTMIN`/`$EXTMAX` del header DXF → fracciones 0-1 independientes del sistema de unidades
- Caché del DXF junto al SVG (`_get_dxf_path`) — evita reconvertir en cada búsqueda
- Deduplicación: la misma tupla (texto, x, y) solo se reporta una vez

**UI de búsqueda**
- Botón lupa en la barra de herramientas para abrir/cerrar el panel de búsqueda
- El panel se superpone al visor (arriba a la derecha, `position: absolute`) — no redimensiona el plano
- La búsqueda se lanza con Enter o con el botón lupa interior del campo de texto
- Botón × pequeño dentro del input para vaciar el texto sin cerrar el panel
- Lista de resultados con el término resaltado en color acento; click navega al elemento
- Un solo resultado activo a la vez (`_activeSearchItem` al scope del módulo)
- Cancelación de peticiones en vuelo con `AbortController` — evita resultados duplicados por llamadas async solapadas
- Mensajes en euskera: "Bilatzen…", "Ez da emaitzarik aurkitu", "Ireki plano bat lehenengo"

**Navegación**
- `navigateToDxf(nx, ny)`: centra el elemento encontrado y hace zoom para mostrar el 3% del ancho del plano — zoom consistente independientemente del tamaño del dibujo
- Inversión del eje Y: `pxY = (1 − ny) × svgH` (ezdxf SVGBackend invierte el Y-up de DXF a Y-down de SVG)

### Corregido

- La posición del ATTRIB se reportaba en el origen del INSERT padre; ahora usa las coordenadas propias `dxf.insert` del ATTRIB
- La búsqueda se relanzaba en cada pulsación de tecla (cambiado a solo Enter + botón explícito)
- Múltiples llamadas concurrentes a `doSearch()` acumulaban resultados; AbortController garantiza que solo se muestra la respuesta más reciente

### Cambiado

- Número de versión mostrado discretamente junto a "Planoak" en el encabezado del sidebar
- `_fitScale` eliminado (ya no necesario tras el zoom de navegación por fracción fija)

---

## [v1.0.0] — 2026-06-08

### Añadido

**Visor principal**
- Backend FastAPI con endpoints `/api/tree` y `/api/svg`
- Pipeline de conversión DWG → DXF → SVG mediante LibreDWG (`dwg2dxf`) y ezdxf 1.3.4
- Caché SVG en disco indexada por mtime del archivo fuente, replicando la estructura de carpetas en `cache/`
- Invalidación automática de caché: el SVG se regenera cuando el DWG fuente es más reciente
- Protección contra path traversal en todos los endpoints de archivos

**Conversión**
- Forzado de visibilidad completa de capas: activa todas las capas apagadas o congeladas en AutoCAD
- Limpieza de flags invisible a nivel de entidad (gestiona entidades ocultas dentro de bloques)
- Override del caché interno de capas del RenderContext para propagar los cambios de visibilidad
- Cadena de fallback LibreDWG → ODA File Converter para mayor compatibilidad de formatos DWG

**Mantenimiento en segundo plano**
- Pre-generación de SVGs al arranque para los planos del primer nivel (profundidad 0 y 1)
- Limpieza al arranque de entradas de caché SVG huérfanas (DWG fuente eliminado)
- Bucle de mantenimiento periódico cada N horas (configurable con `refresh_interval_hours`)
- ThreadPoolExecutor para ejecutar el mantenimiento fuera del event loop async

**Frontend**
- HTML/CSS/JS puro — sin frameworks, sin paso de build, funciona sin conexión
- Árbol de carpetas colapsable con `<details>` / `<summary>`
- Paneo con arrastre de ratón y arrastre táctil
- Zoom con rueda del ratón, pinch-to-zoom y botones de la barra de herramientas
- Botón ajustar a pantalla y controles de zoom accesibles por teclado
- Zoom GPU bajo demanda: `will-change: transform` activo solo durante la interacción, eliminado tras 700 ms de inactividad
- Horneado de escala (`commitRenderQuality`): el SVG se redimensiona a las dimensiones visuales actuales al terminar la interacción — siempre nítido como vector, nunca pixelado
- `minScale` dinámico = fitScale × 0.5 para poder alejar hasta la mitad del tamaño de ajuste
- SVG renderizado a `min(viewport × 2, 8192)` px al cargar para una visualización inicial nítida
- Spinner de carga con mensaje de estado en euskera
- Panel de error para fallos de conversión

**UI / Marca**
- Paleta azul corporativa EiTB (`#009fdc`, fondos marino)
- Logo EiTB centrado en la barra de herramientas mediante posicionamiento absoluto
- Euskera (`lang="eu"`) en todos los textos de la interfaz
- Tema marino oscuro con acentos azul claro, optimizado para legibilidad en pantalla táctil
- Fondo negro para los planos SVG (aspecto pantalla AutoCAD, alto contraste)

**Configuración**
- `config.json` — valores por defecto comprometidos en git (rutas de desarrollo)
- `config.local.json` — overrides de producción, gitignoreado
- Soporte de montaje SMB mediante CIFS/fstab estándar de Linux

**Operaciones**
- `install-ubuntu.sh` — instalador automático para Ubuntu 26.04 LTS (dependencias, compilación de LibreDWG, venv, servicio systemd)
- Servicio systemd `dwgviewer` con reinicio automático ante fallos
- `run.py` — punto de entrada para desarrollo en Windows

**Nombre de la app:** Planoen Bistaratzailea (anteriormente Planoen Ikusgailua)
