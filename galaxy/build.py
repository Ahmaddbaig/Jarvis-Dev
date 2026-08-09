#!/usr/bin/env python3
"""Build the knowledge-galaxy dataset from markdown notes.

Scans every .md file under a root folder (default: the repository root, i.e.
this script's grandparent) and writes viewer/graph-data.js containing:

    const GRAPH = {nodes: [...], links: [...]};

Each node gets:
  - id      numeric, equal to its POSITION in the nodes array (later features
            depend on looking nodes up by index — do not change this)
  - label   the filename without extension (disambiguated with the parent
            folder when two notes share a name)
  - group   the note's immediate parent folder
  - excerpt roughly the first 700 characters of the cleaned note text

Two notes are linked when one's text mentions the other's title, or when they
share at least one [[wikilink]] target.

Standard library only. Usage:  python3 build.py [root]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

EXCERPT_CHARS = 700
MIN_TITLE_LEN = 4  # skip mention-matching on ultra-short titles ("AI", "V5")
MAX_FILE_BYTES = 2_000_000  # anything bigger is not a "note"

# Directories that contain generated/vendored markdown, not the user's notes.
EXCLUDED_DIRS = {
    ".git", "node_modules", "dist-electron", "dist", "out", "build",
    "coverage", ".next", "__pycache__", ".venv", "venv",
    "migration-backups", "migration-quarantine",
}

# Filename stems so generic that "mentions the title" would wire everything
# to everything (the word "readme" appears in half the repo). They still get
# nodes and wikilink-based links — just no mention-matching.
GENERIC_TITLES = {"readme", "index", "notes", "todo", "changelog", "license"}

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.S)
FENCED_CODE_RE = re.compile(r"```.*?```", re.S)


def norm(title: str) -> str:
    return re.sub(r"\s+", " ", title).strip().lower()


def clean_text(raw: str) -> str:
    """Markdown → readable prose for the excerpt panel."""
    text = FRONTMATTER_RE.sub("", raw)
    text = FENCED_CODE_RE.sub(" ", text)
    text = re.sub(r"`([^`\n]*)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)            # images
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)         # md links
    text = WIKILINK_RE.sub(r"\1", text)                          # wikilinks
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.M)           # headings
    text = re.sub(r"^[\s>*+-]{1,4}(?=\S)", "", text, flags=re.M) # list/quote
    text = re.sub(r"[*_]{1,3}(\S[^*_]*?)[*_]{1,3}", r"\1", text) # emphasis
    text = re.sub(r"\|", " ", text)                              # tables
    return re.sub(r"\s+", " ", text).strip()


def iter_markdown(root: Path):
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        parts = rel.parts[:-1]
        if any(p in EXCLUDED_DIRS or p.startswith(".") for p in parts):
            continue
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
        except OSError:
            continue
        yield path


def build(root: Path) -> dict:
    notes = []
    for path in iter_markdown(root):
        raw = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(root)
        cleaned = clean_text(raw)
        excerpt = cleaned[:EXCERPT_CHARS]
        if len(cleaned) > EXCERPT_CHARS:
            excerpt = excerpt.rsplit(" ", 1)[0] + " …"
        notes.append({
            "label": path.stem,
            "group": rel.parent.name if len(rel.parts) > 1 else root.name,
            "path": str(rel),
            "excerpt": excerpt,
            "blob": raw.lower(),
            "wikilinks": {norm(t) for t in WIKILINK_RE.findall(raw)},
        })

    # Disambiguate duplicate labels ("README" x30) for display only.
    by_label: dict[str, int] = {}
    for note in notes:
        by_label[note["label"]] = by_label.get(note["label"], 0) + 1
    for note in notes:
        if by_label[note["label"]] > 1:
            note["label"] = f'{note["label"]} ({note["group"]})'

    # One compiled mention-pattern per note title, matched with soft word
    # boundaries so "voicebox" does not match inside "voiceboxes-are-great".
    patterns = []
    for note in notes:
        title = norm(re.sub(r"\s*\([^)]*\)$", "", note["label"]))
        if len(title) < MIN_TITLE_LEN or title in GENERIC_TITLES:
            patterns.append(None)
        else:
            patterns.append(
                re.compile(rf"(?<![a-z0-9]){re.escape(title)}(?![a-z0-9])")
            )

    links = []
    for i, a in enumerate(notes):
        for j in range(i + 1, len(notes)):
            b = notes[j]
            shared = a["wikilinks"] & b["wikilinks"]
            mentions = bool(
                (patterns[j] and patterns[j].search(a["blob"]))
                or (patterns[i] and patterns[i].search(b["blob"]))
            )
            if shared or mentions:
                links.append({
                    "source": i,
                    "target": j,
                    "kind": "wikilink" if shared else "mention",
                    "weight": 1 + len(shared),
                })

    nodes = [
        {
            # id === index in this array; later features rely on it.
            "id": i,
            "label": n["label"],
            "group": n["group"],
            "path": n["path"],
            "excerpt": n["excerpt"],
        }
        for i, n in enumerate(notes)
    ]
    return {"nodes": nodes, "links": links}


def main() -> None:
    root = (
        Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else Path(__file__).resolve().parent.parent
    )
    if not root.is_dir():
        sys.exit(f"Not a directory: {root}")

    graph = build(root)
    out = Path(__file__).resolve().parent / "viewer" / "graph-data.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(graph, indent=2, ensure_ascii=False)
    out.write_text(
        f"// Generated by build.py — do not edit. Root: {root}\n"
        f"const GRAPH = {payload};\n",
        encoding="utf-8",
    )

    groups = {n["group"] for n in graph["nodes"]}
    print(
        f"Scanned {root}\n"
        f"  {len(graph['nodes'])} notes in {len(groups)} groups, "
        f"{len(graph['links'])} links → {out.relative_to(Path.cwd()) if out.is_relative_to(Path.cwd()) else out}"
    )


if __name__ == "__main__":
    main()
