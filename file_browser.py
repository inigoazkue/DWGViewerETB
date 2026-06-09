from pathlib import Path
from typing import Optional

SUPPORTED = {'.dwg', '.dxf'}


def _has_supported_content(path: Path) -> bool:
    """Quick non-recursive check: does path contain supported files or subdirs?"""
    try:
        for child in path.iterdir():
            if child.is_dir() or child.suffix.lower() in SUPPORTED:
                return True
    except PermissionError:
        pass
    return False


def _node_shallow(path: Path, base: Path) -> Optional[dict]:
    if path.is_dir():
        if not _has_supported_content(path):
            return None
        return {
            "name": path.name,
            "type": "dir",
            "path": path.relative_to(base).as_posix(),
            "lazy": True,
        }
    elif path.is_file() and path.suffix.lower() in SUPPORTED:
        return {
            "name": path.name,
            "type": "file",
            "path": path.relative_to(base).as_posix(),
        }
    return None


def build_tree_shallow(base: Path, rel_path: str = '') -> dict:
    """Returns direct children only. Sub-dirs are marked lazy=True."""
    target = (base / rel_path).resolve() if rel_path else base
    children = []
    try:
        items = sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except PermissionError:
        items = []
    for child in items:
        node = _node_shallow(child, base)
        if node:
            children.append(node)
    return {"name": target.name, "type": "dir", "children": children}
