# Changelog

All notable changes to Planoen Bistaratzailea are documented here.

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
