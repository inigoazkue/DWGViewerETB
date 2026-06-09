import sqlite3
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY,
    path        TEXT    NOT NULL,
    path_mtime  REAL    NOT NULL,
    text        TEXT    NOT NULL,
    nx          REAL,
    ny          REAL
);
CREATE INDEX IF NOT EXISTS idx_entries_path ON entries(path);
CREATE INDEX IF NOT EXISTS idx_entries_text ON entries(text);
"""


def init(db_path: Path):
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(_SCHEMA)


def get_indexed_mtimes(db_path: Path) -> dict:
    """Devuelve {rel_path: mtime} para todos los archivos indexados."""
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            "SELECT DISTINCT path, path_mtime FROM entries"
        ).fetchall()
    return {r[0]: r[1] for r in rows}


def remove_path(db_path: Path, rel_path: str):
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("DELETE FROM entries WHERE path = ?", (rel_path,))
    logger.info(f"Index: entradas eliminadas para {rel_path}")


def index_file(db_path: Path, file_path: Path, base_path: Path, cache_dir: Path) -> int:
    """Indexa todas las entidades de texto de un DWG/DXF. Devuelve el número de entradas."""
    import converter
    rel = file_path.relative_to(base_path).as_posix()
    mtime = file_path.stat().st_mtime
    try:
        # query='' devuelve todas las entidades de texto ('' in any_string == True)
        results = converter.search_text(file_path, '', cache_dir, base_path)
    except Exception as e:
        logger.warning(f"Index: error indexando {file_path.name}: {e}")
        return 0
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("DELETE FROM entries WHERE path = ?", (rel,))
        conn.executemany(
            "INSERT INTO entries (path, path_mtime, text, nx, ny) VALUES (?,?,?,?,?)",
            [(rel, mtime, r['text'], r.get('nx'), r.get('ny')) for r in results]
        )
    logger.info(f"Index: {len(results)} entradas para {file_path.name}")
    return len(results)


def is_indexed(db_path: Path, rel_path: str) -> bool:
    with sqlite3.connect(str(db_path)) as conn:
        row = conn.execute(
            "SELECT 1 FROM entries WHERE path = ? LIMIT 1", (rel_path,)
        ).fetchone()
    return row is not None


def search_in_file(db_path: Path, rel_path: str, query: str) -> list:
    """Busca en un archivo indexado. Devuelve [{text, nx, ny}]."""
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            "SELECT text, nx, ny FROM entries WHERE path = ? AND text LIKE ? COLLATE NOCASE",
            (rel_path, f'%{query}%')
        ).fetchall()
    return [{'text': r[0], 'nx': r[1], 'ny': r[2]} for r in rows]


def search_all(db_path: Path, query: str) -> list:
    """Busca en todos los archivos indexados. Devuelve [{path, count}]."""
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            """SELECT path, COUNT(*) FROM entries
               WHERE text LIKE ? COLLATE NOCASE
               GROUP BY path ORDER BY path""",
            (f'%{query}%',)
        ).fetchall()
    return [{'path': r[0], 'count': r[1]} for r in rows]
