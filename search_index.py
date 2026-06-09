import sqlite3
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# entries: datos completos (para search_in_file con filtro por path, ya rapido con indice)
# entries_fts: tabla FTS5 con tokenizador trigrama para search_all instantaneo
_SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY,
    path        TEXT NOT NULL,
    path_mtime  REAL NOT NULL,
    text        TEXT NOT NULL,
    nx          REAL,
    ny          REAL
);
CREATE INDEX IF NOT EXISTS idx_entries_path ON entries(path);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    path UNINDEXED,
    text,
    tokenize = 'trigram case_sensitive 0'
);
"""

_SCHEMA_VERSION = 2  # incrementar si cambia el esquema


def _check_migration(db_path: Path):
    """Elimina la BD si el esquema es antiguo (sin entries_fts trigram)."""
    if not db_path.exists():
        return
    try:
        with sqlite3.connect(str(db_path)) as conn:
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' OR type='shadow'"
            ).fetchall()}
            if 'entries_fts' not in tables:
                raise ValueError("esquema antiguo sin FTS")
            # Verificar que entries_fts usa trigrama
            info = conn.execute(
                "SELECT sql FROM sqlite_master WHERE name='entries_fts'"
            ).fetchone()
            if not info or 'trigram' not in (info[0] or ''):
                raise ValueError("FTS sin trigrama")
    except Exception as e:
        logger.info(f"Index: migracion de esquema ({e}), eliminando BD antigua")
        db_path.unlink()


def init(db_path: Path):
    _check_migration(db_path)
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
        conn.execute("DELETE FROM entries_fts WHERE path = ?", (rel_path,))
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
        conn.execute("DELETE FROM entries_fts WHERE path = ?", (rel,))
        conn.executemany(
            "INSERT INTO entries (path, path_mtime, text, nx, ny) VALUES (?,?,?,?,?)",
            [(rel, mtime, r['text'], r.get('nx'), r.get('ny')) for r in results]
        )
        conn.executemany(
            "INSERT INTO entries_fts (path, text) VALUES (?,?)",
            [(rel, r['text']) for r in results]
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
    """Busca en un archivo indexado. Rapido gracias al indice por path."""
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            "SELECT text, nx, ny FROM entries WHERE path = ? AND text LIKE ? COLLATE NOCASE",
            (rel_path, f'%{query}%')
        ).fetchall()
    return [{'text': r[0], 'nx': r[1], 'ny': r[2]} for r in rows]


def search_all(db_path: Path, query: str) -> list:
    """Busca en todos los archivos via FTS5 trigrama. Instantaneo."""
    # Envolver en comillas para phrase search: evita que FTS5 interprete
    # caracteres como '-' como operadores (NOT, etc.)
    phrase = '"' + query.replace('"', '""') + '"'
    with sqlite3.connect(str(db_path)) as conn:
        try:
            rows = conn.execute(
                """SELECT path, COUNT(*) FROM entries_fts
                   WHERE text MATCH ?
                   GROUP BY path ORDER BY path""",
                (phrase,)
            ).fetchall()
            logger.debug(f"FTS5 search '{query}': {len(rows)} planos")
        except Exception as e:
            # Fallback a LIKE si FTS5 no esta disponible o falla
            logger.warning(f"FTS5 MATCH fallo ({e}), usando LIKE como fallback")
            rows = conn.execute(
                """SELECT path, COUNT(*) FROM entries
                   WHERE text LIKE ? COLLATE NOCASE
                   GROUP BY path ORDER BY path""",
                (f'%{query}%',)
            ).fetchall()
    return [{'path': r[0], 'count': r[1]} for r in rows]
