"""The Scheduling Engine must stay a pure function: no I/O, no wall-clock, no RNG.

A reviewer's two-second grep, made automatic (IMPLEMENTATION.md §Phase 5).
"""

import ast
import pathlib

_PKG = pathlib.Path(__file__).resolve().parents[1] / "app" / "scheduling"
_FILES = ["types.py", "scoring.py", "explain.py", "engine.py"]

_FORBIDDEN_ROOTS = {
    "sqlalchemy", "redis", "httpx", "requests", "aiohttp", "fastapi", "starlette",
    "pydantic", "google", "googleapiclient", "psycopg", "psycopg2", "asyncpg", "alembic",
}
_FORBIDDEN_SNIPPETS = ("datetime.now(", ".now()", "time.time(", "import random", "random.")


def _import_modules(tree: ast.AST) -> list[str]:
    mods: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.extend(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            mods.append(node.module)
    return mods


def test_no_forbidden_or_cross_app_imports():
    for name in _FILES:
        tree = ast.parse((_PKG / name).read_text(encoding="utf-8"))
        for mod in _import_modules(tree):
            root = mod.split(".")[0]
            assert root not in _FORBIDDEN_ROOTS, f"{name}: forbidden import {mod!r}"
            if root == "app":
                assert mod.startswith("app.scheduling"), (
                    f"{name}: engine may only import app.scheduling.*, not {mod!r}"
                )


def test_no_wallclock_or_randomness():
    for name in _FILES:
        src = (_PKG / name).read_text(encoding="utf-8")
        for bad in _FORBIDDEN_SNIPPETS:
            assert bad not in src, f"{name}: contains forbidden snippet {bad!r}"
