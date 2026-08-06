from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest

from jarvis_ai_engine.manifest import verify_or_create_manifest


def fake_install(tmp_path: Path, profiles_root: Path) -> Path:
    root = tmp_path / ".local-ai"
    (root / "bin").mkdir(parents=True)
    (root / "models" / "weights").mkdir(parents=True)
    (root / "bin" / ("local-ai.exe" if os.name == "nt" else "local-ai")).write_bytes(b"binary")
    (root / "installed-profile").write_text("m2\n", encoding="utf-8")
    definition = json.loads((profiles_root / "m2.json").read_text(encoding="utf-8"))
    for name in definition["models"].values():
        (root / "models" / f"{name}.yaml").write_text(
            f"name: {name}\nparameters:\n  model: weights/{name}.gguf\n",
            encoding="utf-8",
        )
        (root / "models" / "weights" / f"{name}.gguf").write_bytes(name.encode())
    return root


@pytest.mark.asyncio
async def test_manifest_is_atomic_and_detects_tampering(tmp_path: Path) -> None:
    profiles = Path(__file__).resolve().parents[1] / "profiles"
    root = fake_install(tmp_path, profiles)

    async def progress(_value: float, _message: str) -> None:
        pass

    created = await verify_or_create_manifest(root, profiles, "m2", asyncio.Event(), progress)
    assert created["state"] == "created"
    manifest_path = root / "install-manifest.json"
    assert manifest_path.is_file()
    assert not list(root.glob(".install-manifest.*.tmp"))

    valid = await verify_or_create_manifest(root, profiles, "m2", asyncio.Event(), progress)
    assert valid["state"] == "valid"

    (root / "models" / "weights" / "jarvis-local-m2.gguf").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="does not match"):
        await verify_or_create_manifest(root, profiles, "m2", asyncio.Event(), progress)


@pytest.mark.asyncio
async def test_manifest_refuses_profile_substitution(tmp_path: Path) -> None:
    profiles = Path(__file__).resolve().parents[1] / "profiles"
    root = fake_install(tmp_path, profiles)

    async def progress(_value: float, _message: str) -> None:
        pass

    with pytest.raises(ValueError, match="refusing to activate"):
        await verify_or_create_manifest(root, profiles, "m3", asyncio.Event(), progress)
