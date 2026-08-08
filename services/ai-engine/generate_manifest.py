from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from jarvis_ai_engine.manifest import build_manifest, write_manifest_atomic


async def run(root: Path, profile: str) -> None:
    cancel = asyncio.Event()

    async def progress(value: float, message: str) -> None:
        print(f"[{value * 100:5.1f}%] {message}", flush=True)

    manifest = await build_manifest(root, Path(__file__).resolve().parent / "profiles", profile, cancel, progress)
    target = await write_manifest_atomic(root, manifest)
    print(f"Wrote verified install manifest: {target}")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in {"m2", "m3", "m5"}:
        raise SystemExit("Usage: generate_manifest.py LOCAL_AI_ROOT m2|m3|m5")
    asyncio.run(run(Path(sys.argv[1]).expanduser().resolve(), sys.argv[2]))
