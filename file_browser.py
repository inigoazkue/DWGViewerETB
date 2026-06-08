from pathlib import Path
from typing import Optional

SUPPORTED = {'.dwg', '.dxf'}


def build_tree(base: Path) -> dict:
    def _node(path: Path) -> Optional[dict]:
        if path.is_dir():
            children = []
            for child in sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
                n = _node(child)
                if n:
                    children.append(n)
            if not children:
                return None
            return {"name": path.name, "type": "dir", "children": children}
        elif path.is_file() and path.suffix.lower() in SUPPORTED:
            return {
                "name": path.name,
                "type": "file",
                "path": path.relative_to(base).as_posix(),
            }
        return None

    result = _node(base)
    return result or {"name": base.name, "type": "dir", "children": []}
