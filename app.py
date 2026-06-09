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


REFRESH_INTERVAL = int(config.get("refresh_interval_hours", 4)) * 3600

_executor = ThreadPoolExecutor(max_workers=1)


def _maintenance_task():
    removed = converter.cleanup_orphaned_svgs(PLANOS_PATH, CACHE_PATH)
    if removed:
        logger.info(f"Cache: {removed} SVGs huerfanos eliminados")
    converter.pregenerate_depth1(PLANOS_PATH, CACHE_PATH)


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

app = FastAPI(title="Planoen Bistaratzailea", lifespan=lifespan)


@app.get("/api/tree")
def get_tree():
    return file_browser.build_tree(PLANOS_PATH)


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


app.mount("/", StaticFiles(directory=str(ROOT / "frontend"), html=True), name="static")
