import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parent
config = json.loads((ROOT / "config.json").read_text())
local_cfg = ROOT / "config.local.json"
if local_cfg.exists():
    config.update(json.loads(local_cfg.read_text()))

PLANOS_PATH = Path(config["planos_path"])
if not PLANOS_PATH.is_absolute():
    PLANOS_PATH = (ROOT / PLANOS_PATH).resolve()

CACHE_PATH = Path(config["cache_path"])
if not CACHE_PATH.is_absolute():
    CACHE_PATH = (ROOT / CACHE_PATH).resolve()

CACHE_PATH.mkdir(parents=True, exist_ok=True)

INDEX_DB = CACHE_PATH / 'search_index.db'

REFRESH_INTERVAL = int(config.get("refresh_interval_hours", 4)) * 3600

_executor = ThreadPoolExecutor(max_workers=1)

_index_progress = {'running': False, 'total': 0, 'done': 0, 'current': '', 'pct': 0}


def _update_search_index():
    search_index.init(INDEX_DB)

    candidates = sorted(
        list(PLANOS_PATH.glob('*.dwg'))   + list(PLANOS_PATH.glob('*.dxf')) +
        list(PLANOS_PATH.glob('*/*.dwg')) + list(PLANOS_PATH.glob('*/*.dxf'))
    )

    indexed_mtimes = search_index.get_indexed_mtimes(INDEX_DB)

    # Eliminar entradas de archivos borrados
    current_rels = {fp.relative_to(PLANOS_PATH).as_posix() for fp in candidates}
    for rel in list(indexed_mtimes.keys()):
        if rel not in current_rels:
            search_index.remove_path(INDEX_DB, rel)

    # Determinar qué archivos necesitan (re)indexarse
    to_index = []
    for fp in candidates:
        rel = fp.relative_to(PLANOS_PATH).as_posix()
        if rel not in indexed_mtimes or indexed_mtimes[rel] < fp.stat().st_mtime:
            to_index.append(fp)

    if not to_index:
        logger.info("Index: todo actualizado, nada que indexar")
        return

    logger.info(f"Index: indexando {len(to_index)} archivos")
    _index_progress['running'] = True
    _index_progress['total']   = len(to_index)
    _index_progress['done']    = 0
    _index_progress['current'] = ''
    _index_progress['pct']     = 0

    for fp in to_index:
        _index_progress['current'] = fp.name
        search_index.index_file(INDEX_DB, fp, PLANOS_PATH, CACHE_PATH)
        _index_progress['done'] += 1
        _index_progress['pct']   = round(_index_progress['done'] / _index_progress['total'] * 100)

    _index_progress['running'] = False
    _index_progress['current'] = ''
    logger.info(f"Index: {len(to_index)} archivos indexados")


def _maintenance_task():
    removed = converter.cleanup_orphaned_svgs(PLANOS_PATH, CACHE_PATH)
    if removed:
        logger.info(f"Cache: {removed} SVGs huerfanos eliminados")
    converter.pregenerate_depth1(PLANOS_PATH, CACHE_PATH)
    _update_search_index()


async def _maintenance_loop():
    while True:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(_executor, _maintenance_task)
        logger.info(f"Proxima revision de cache en {REFRESH_INTERVAL // 3600}h")
        await asyncio.sleep(REFRESH_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Planos: {PLANOS_PATH}")
    logger.info(f"Cache:  {CACHE_PATH}")
    if not PLANOS_PATH.exists():
        logger.warning(f"ADVERTENCIA: la ruta de planos no existe: {PLANOS_PATH}")
    task = asyncio.create_task(_maintenance_loop())
    yield
    task.cancel()
    _executor.shutdown(wait=False)


import converter
import file_browser
import search_index

app = FastAPI(title="Planoen Bistaratzailea", lifespan=lifespan)


@app.get("/api/tree")
def get_tree(path: str = Query(default='')):
    if path:
        try:
            target = (PLANOS_PATH / path).resolve()
            target.relative_to(PLANOS_PATH)
        except ValueError:
            raise HTTPException(status_code=403, detail="Ruta no permitida")
        if not target.is_dir():
            raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    return file_browser.build_tree_shallow(PLANOS_PATH, path)


@app.get("/api/svg")
def get_svg(path: str = Query(...)):
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Ruta vacía")
    try:
        target = (PLANOS_PATH / path).resolve()
        target.relative_to(PLANOS_PATH)
    except ValueError:
        raise HTTPException(status_code=403, detail="Ruta no permitida")

    if not target.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    if target.suffix.lower() not in ('.dwg', '.dxf'):
        raise HTTPException(status_code=400, detail="Formato no soportado")

    try:
        svg = converter.to_svg(target, CACHE_PATH, PLANOS_PATH)
        return Response(content=svg, media_type="image/svg+xml")
    except Exception as e:
        logger.error(f"Error convirtiendo {target.name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/debug-index")
def debug_index():
    import sqlite3 as _sq
    if not INDEX_DB.exists():
        return {"error": "DB no existe", "path": str(INDEX_DB)}
    with _sq.connect(str(INDEX_DB)) as conn:
        try:
            entries = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        except Exception as e:
            entries = f"error: {e}"
        try:
            fts = conn.execute("SELECT COUNT(*) FROM entries_fts").fetchone()[0]
        except Exception as e:
            fts = f"error: {e}"
        try:
            distinct_paths = conn.execute(
                "SELECT COUNT(DISTINCT path) FROM entries"
            ).fetchone()[0]
        except Exception as e:
            distinct_paths = f"error: {e}"
        try:
            paths = [r[0] for r in conn.execute(
                "SELECT DISTINCT path FROM entries ORDER BY path"
            ).fetchall()]
        except Exception as e:
            paths = [f"error: {e}"]
    return {
        "entries": entries, "entries_fts": fts,
        "distinct_paths": distinct_paths,
        "all_paths": paths,
        "db": str(INDEX_DB)
    }


def _force_reindex():
    if INDEX_DB.exists():
        INDEX_DB.unlink()
        logger.info("Reindex forzado: BD eliminada")
    _update_search_index()


@app.post("/api/reindex")
def trigger_reindex():
    """Elimina el indice existente y lo regenera completamente."""
    if _index_progress.get('running'):
        return {"status": "already_running"}
    _executor.submit(_force_reindex)
    return {"status": "started"}


@app.get("/api/index-status")
def index_status():
    return _index_progress


@app.get("/api/search")
def search_svg(path: str = Query(...), q: str = Query(...)):
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Ruta vacía")
    if not q or not q.strip():
        return []
    try:
        target = (PLANOS_PATH / path).resolve()
        target.relative_to(PLANOS_PATH)
    except ValueError:
        raise HTTPException(status_code=403, detail="Ruta no permitida")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    if target.suffix.lower() not in ('.dwg', '.dxf'):
        raise HTTPException(status_code=400, detail="Formato no soportado")

    rel = target.relative_to(PLANOS_PATH).as_posix()
    query = q.strip()

    # Usar índice si el archivo está indexado; si no, parsear DXF directamente
    if search_index.is_indexed(INDEX_DB, rel):
        return search_index.search_in_file(INDEX_DB, rel, query)
    try:
        return converter.search_text(target, query, CACHE_PATH, PLANOS_PATH)
    except Exception as e:
        logger.error(f"Error buscando en {target.name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search-tree")
def search_tree_endpoint(q: str = Query(...)):
    if not q or not q.strip():
        return []
    query = q.strip()
    try:
        results = search_index.search_all(INDEX_DB, query)
        logger.info(f"search-tree '{query}': {len(results)} planos")
        return results
    except Exception as e:
        logger.error(f"search-tree error '{query}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


app.mount("/", StaticFiles(directory=str(ROOT / "frontend"), html=True), name="static")
