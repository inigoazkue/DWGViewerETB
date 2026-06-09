import subprocess
import sys
import tempfile
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def cleanup_orphaned_svgs(base_path: Path, cache_dir: Path) -> int:
    """Elimina SVGs en cache cuyo DWG/DXF original ya no existe."""
    removed = 0
    for svg_path in cache_dir.rglob('*.svg'):
        rel = svg_path.relative_to(cache_dir)
        source_exists = any(
            (base_path / rel.with_suffix(ext)).exists()
            for ext in ('.dwg', '.dxf')
        )
        if not source_exists:
            svg_path.unlink(missing_ok=True)
            removed += 1
            logger.info(f"SVG huerfano eliminado: {rel}")
    return removed


def pregenerate_depth1(base_path: Path, cache_dir: Path) -> dict:
    """Pregera SVGs para DWGs del primer nivel de carpetas (no subcarpetas)."""
    stats = {'generados': 0, 'en_cache': 0, 'errores': 0}
    candidates = sorted(
        list(base_path.glob('*.dwg')) +
        list(base_path.glob('*.dxf')) +
        list(base_path.glob('*/*.dwg')) +
        list(base_path.glob('*/*.dxf'))
    )
    logger.info(f"Pregeneracion: {len(candidates)} planos en primer nivel")
    for file_path in candidates:
        rel = file_path.relative_to(base_path)
        svg_cache = cache_dir / rel.with_suffix('.svg')
        if svg_cache.exists() and svg_cache.stat().st_mtime >= file_path.stat().st_mtime:
            stats['en_cache'] += 1
            continue
        try:
            to_svg(file_path, cache_dir, base_path)
            stats['generados'] += 1
        except Exception as e:
            logger.error(f"Pregeneracion fallida [{rel}]: {e}")
            stats['errores'] += 1
    logger.info(f"Pregeneracion completada: {stats}")
    return stats


def to_svg(input_path: Path, cache_dir: Path, base_path: Path) -> str:
    rel = input_path.relative_to(base_path)
    svg_cache = cache_dir / rel.with_suffix('.svg')

    if svg_cache.exists() and svg_cache.stat().st_mtime >= input_path.stat().st_mtime:
        logger.info(f"Cache hit: {rel}")
        return svg_cache.read_text(encoding='utf-8')

    logger.info(f"Convirtiendo: {rel}")
    svg_cache.parent.mkdir(parents=True, exist_ok=True)

    suffix = input_path.suffix.lower()
    if suffix == '.dxf':
        dxf_path = input_path
    elif suffix == '.dwg':
        dxf_path = _dwg_to_dxf(input_path)
    else:
        raise ValueError(f"Formato no soportado: {suffix}")

    svg = _dxf_to_svg(dxf_path)
    svg_cache.write_text(svg, encoding='utf-8')
    return svg


def _dwg_to_dxf(dwg_path: Path) -> Path:
    tmp = Path(tempfile.mkdtemp())
    out = tmp / (dwg_path.stem + '.dxf')

    # LibreDWG (Linux — compilado desde fuente o apt install libredwg-utils)
    try:
        result = subprocess.run(
            ['dwg2dxf', str(dwg_path), '-o', str(out)],
            capture_output=True, timeout=120, check=False
        )
        if result.stderr:
            logger.warning(f"dwg2dxf: {result.stderr.decode('utf-8', errors='replace')[:500]}")
        if out.exists() and out.stat().st_size > 0:
            logger.info(f"DXF generado por LibreDWG: {out.stat().st_size} bytes")
            return out
        logger.warning("dwg2dxf no generó DXF o está vacío")
    except FileNotFoundError:
        logger.warning("dwg2dxf no encontrado")
    except subprocess.TimeoutExpired:
        raise RuntimeError("Timeout convirtiendo DWG (¿archivo muy grande?)")

    # ODA File Converter (Windows dev o Linux alternativo)
    for oda in _find_oda():
        try:
            subprocess.run(
                [oda, str(dwg_path.parent), str(tmp), 'ACAD2018', 'DXF', '0', '1'],
                capture_output=True, timeout=120, check=False
            )
            if out.exists() and out.stat().st_size > 0:
                return out
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue

    raise RuntimeError(
        "No se puede convertir el archivo DWG.\n"
        "En Ubuntu instala LibreDWG: sudo apt install libredwg-utils\n"
        "En Windows instala ODA File Converter (gratuito en opendesign.com)\n"
        "Alternativa para desarrollo: usa archivos .dxf en vez de .dwg"
    )


def _find_oda() -> list:
    if sys.platform == 'win32':
        candidates = [
            r'C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe',
            r'C:\Program Files (x86)\ODA\ODAFileConverter\ODAFileConverter.exe',
        ]
    else:
        candidates = [
            '/usr/bin/ODAFileConverter',
            '/usr/local/bin/ODAFileConverter',
            '/opt/ODA/ODAFileConverter',
        ]
    return [p for p in candidates if Path(p).exists()]


def _query_matches(text: str, query: str) -> bool:
    """Si la query es solo dígitos, busca como número completo (sin dígitos adyacentes).
    Si tiene letras/símbolos, busca como subcadena normal."""
    import re
    if query.isdigit():
        pattern = r'(?<!\d)' + re.escape(query) + r'(?!\d)'
        return bool(re.search(pattern, text, re.IGNORECASE))
    return query.lower() in text.lower()


def search_text(file_path: Path, query: str, cache_dir: Path, base_path: Path) -> list:
    """Busca texto en entidades TEXT/MTEXT del DXF. Devuelve [{text, x, y}]."""
    import ezdxf
    from ezdxf import recover

    suffix = file_path.suffix.lower()
    if suffix == '.dwg':
        dxf_path = _dwg_to_dxf(file_path)
    elif suffix == '.dxf':
        dxf_path = file_path
    else:
        return []

    try:
        doc = ezdxf.readfile(str(dxf_path))
    except Exception:
        try:
            doc, _ = recover.readfile(str(dxf_path))
        except Exception as e:
            raise RuntimeError(f"No se puede leer el DXF: {e}")

    results = []
    seen = set()

    def _collect(entities, dx=0.0, dy=0.0):
        for e in entities:
            try:
                t = e.dxftype()
                text = None
                ex, ey = dx, dy
                if t == 'TEXT':
                    text = e.dxf.text
                    ex = dx + e.dxf.insert.x
                    ey = dy + e.dxf.insert.y
                elif t == 'MTEXT':
                    try:
                        text = e.plain_mtext()
                    except Exception:
                        text = e.dxf.get('text', '')
                    ex = dx + e.dxf.insert.x
                    ey = dy + e.dxf.insert.y
                elif t in ('ATTRIB', 'ATTDEF'):
                    text = e.dxf.text
                    ex = dx + e.dxf.insert.x
                    ey = dy + e.dxf.insert.y
                elif t == 'INSERT':
                    block = doc.blocks.get(e.dxf.name)
                    if block:
                        _collect(block, dx + e.dxf.insert.x, dy + e.dxf.insert.y)
                if text and _query_matches(text, query):
                    key = (text.strip(), round(ex, 1), round(ey, 1))
                    if key not in seen:
                        seen.add(key)
                        results.append({'text': text.strip(), 'x': ex, 'y': ey})
            except Exception:
                continue

    _collect(doc.modelspace())
    logger.info(f"Busqueda '{query}' en {file_path.name}: {len(results)} resultados")
    return results


def _dxf_to_svg(dxf_path: Path) -> str:
    import ezdxf
    from ezdxf import recover
    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.svg import SVGBackend
    from ezdxf.addons.drawing.properties import LayoutProperties

    try:
        doc = ezdxf.readfile(str(dxf_path))
    except Exception:
        doc, _ = recover.readfile(str(dxf_path))

    msp = doc.modelspace()
    entity_count = sum(1 for _ in msp)
    logger.info(f"Entidades en modelspace: {entity_count}")

    # Forzar visibilidad completa: capas apagadas/congeladas y entidades invisibles
    n_layers_fixed = 0
    for layer in doc.layers:
        was_off = not layer.on
        was_frozen = layer.is_frozen
        layer.on = True
        layer.dxf.flags = 0
        try:
            layer.thaw()
        except Exception:
            pass
        # ezdxf también usa color negativo para indicar capa apagada
        try:
            if layer.dxf.color < 0:
                layer.dxf.color = abs(layer.dxf.color)
        except Exception:
            pass
        if was_off or was_frozen:
            n_layers_fixed += 1

    logger.info(f"Capas activadas: {n_layers_fixed} de {sum(1 for _ in doc.layers)}")

    n_entities_fixed = 0
    def _force_visible(entities):
        nonlocal n_entities_fixed
        for e in entities:
            try:
                if e.dxf.hasattr('invisible') and e.dxf.invisible:
                    e.dxf.invisible = 0
                    n_entities_fixed += 1
            except Exception:
                pass

    _force_visible(msp)
    for block in doc.blocks:
        _force_visible(block)

    logger.info(f"Flags invisible limpiados en entidades: {n_entities_fixed}")

    context = RenderContext(doc)

    # Forzar visibilidad en el cache interno del contexto de ezdxf
    try:
        layer_cache = (
            getattr(context, '_layers', None) or
            getattr(context, '_layer_properties', None)
        )
        if layer_cache:
            for props in layer_cache.values():
                if hasattr(props, 'is_visible'):
                    props.is_visible = True
            logger.info(f"Visibilidad forzada en contexto: {len(layer_cache)} capas")
    except Exception as e:
        logger.warning(f"Override de contexto no disponible: {e}")
    backend = SVGBackend()
    frontend = Frontend(context, backend)

    lp = LayoutProperties.from_layout(msp)
    # Fondo negro (aspecto AutoCAD en pantalla, mejor contraste para los colores de los planos)

    frontend.draw_layout(msp, finalize=True, layout_properties=lp)

    try:
        from ezdxf.addons.drawing.layout import Page
        return backend.get_string(Page(0, 0))
    except TypeError:
        return backend.get_string()
