# Changelog

All notable changes to Planoen Bistaratzailea are documented here.

---

## [v2.0.0] — 2026-06-09

### Added

**Text search**
- `/api/search?path=&q=` endpoint: searches TEXT, MTEXT and ATTRIB entities in the DXF source
- Backend search via `ezdxf.recover.readfile()` — tolerant of malformed DXF output from LibreDWG (`Invalid ATTRIB.keep_duplicate_records`)
- ATTRIB entities accessed as sub-entities of INSERT (`e.attribs`), not iterated from block definitions
- Recursive block traversal with depth limit (8) to find text inside nested blocks
- Coordinate normalisation using `$EXTMIN`/`$EXTMAX` from the DXF header → 0–1 fractions independent of unit system
- DXF cache alongside SVG cache (`_get_dxf_path`) — avoids re-converting on every search request
- Duplicate suppression: same (text, x, y) tuple only reported once

**Search UI**
- Magnifying glass toolbar button opens/closes the search panel
- Search panel overlays the viewer (top-right, `position: absolute`) — does not resize the plan
- Search fires on Enter keypress or click on the new in-bar magnifying glass button
- Small × button inside the input clears the text without closing the panel
- Results list with term highlighted in accent colour; click navigates to the element
- Single active result highlighted at a time (`_activeSearchItem` module-scoped)
- In-flight request cancellation via `AbortController` — prevents duplicate results from concurrent async calls
- Basque-language status messages: "Bilatzen…", "Ez da emaitzarik aurkitu", "Ireki plano bat lehenengo"

**Navigation**
- `navigateToDxf(nx, ny)`: centres the found element and zooms to show 3% of the drawing width — consistent zoom regardless of drawing size
- Y-axis inversion: `pxY = (1 − ny) × svgH` (ezdxf SVGBackend flips DXF Y-up to SVG Y-down)

### Fixed

- ATTRIB position was reported at the parent INSERT origin; now uses the ATTRIB's own `dxf.insert` coordinates
- Search was re-triggering on every keystroke (changed to Enter-only + explicit button)
- Multiple concurrent `doSearch()` calls accumulated results; AbortController ensures only the latest response is shown

### Changed

- Version number shown discretely next to "Planoak" in the sidebar header
- `_fitScale` removed (no longer needed after fixed-fraction navigation zoom)

---

## [v1.0.0] — 2026-06-08

### Added

**Core viewer**
- FastAPI backend with `/api/tree` and `/api/svg` endpoints
- DWG → DXF → SVG conversion pipeline via LibreDWG (`dwg2dxf`) and ezdxf 1.3.4
- SVG disk cache keyed by source file mtime, mirroring folder structure in `cache/`
- Automatic cache invalidation: SVG regenerated when source DWG is newer
- Path traversal protection on all file endpoints

**Conversion**
- Full layer visibility forcing: turns on all layers flagged off or frozen in AutoCAD
- Entity-level invisible flag clearing (handles entities hidden inside blocks)
- RenderContext internal layer cache override to propagate visibility changes
- LibreDWG → ODA File Converter fallback chain for broader DWG format support

**Background maintenance**
- Startup pre-generation of SVGs for first-level plans (depth 0 and depth 1)
- Startup cleanup of orphaned SVG cache entries (source DWG deleted)
- Periodic maintenance loop every N hours (configurable via `refresh_interval_hours`)
- ThreadPoolExecutor to run maintenance off the async event loop

**Frontend**
- Pure HTML/CSS/JS — no frameworks, no build step, works offline
- Collapsible folder tree sidebar with `<details>` / `<summary>` expand/collapse
- Pan with mouse drag and touch drag
- Zoom with mouse wheel, pinch-to-zoom, and toolbar buttons
- Fit-to-screen button and keyboard-accessible zoom controls
- GPU-on-demand zoom: `will-change: transform` active only during interaction, removed after 700 ms idle
- Scale baking (`commitRenderQuality`): SVG resized to current visual dimensions after interaction ends — always vector-sharp, never pixelated
- Dynamic `minScale = fitScale × 0.5` to allow zooming out to half the fit size
- SVG rendered at `min(viewport × 2, 8192)` px on load for crisp initial display
- Loading spinner with Basque-language status message
- Error panel for conversion failures

**UI / Branding**
- EiTB corporate blue palette (`#009fdc`, navy backgrounds)
- EiTB logo centered in toolbar via absolute positioning
- Basque language (`lang="eu"`) for all UI strings
- Dark navy theme with light blue accents, optimised for touchscreen readability
- Black background for SVG plans (AutoCAD screen look, high contrast)

**Configuration**
- `config.json` — committed defaults (development paths)
- `config.local.json` — production overrides, gitignored
- SMB mount support via standard Linux CIFS/fstab

**Operations**
- `install-ubuntu.sh` — automated installer for Ubuntu 26.04 LTS (dependencies, LibreDWG compile, venv, systemd service)
- systemd service `dwgviewer` with automatic restart on failure
- `run.py` — development entry point for Windows

**App name:** Planoen Bistaratzailea (previously Planoen Ikusgailua)
