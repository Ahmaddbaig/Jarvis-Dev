from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ProgressCallback = Callable[[float, str], Awaitable[None]]
PATH_PATTERN = re.compile(r"(?P<path>[A-Za-z0-9_./@+-]+\.(?:gguf|onnx|bin|json|txt|model|tiktoken))")


def load_profile(profiles_root: Path, profile: str) -> dict[str, Any]:
    profile_path = profiles_root / f"{profile}.json"
    payload = json.loads(profile_path.read_text(encoding="utf-8"))
    if payload.get("id") != profile:
        raise ValueError(f"Profile definition {profile_path.name} has the wrong id.")
    return payload


def _definition_files(root: Path, definition: dict[str, Any]) -> list[Path]:
    binary_name = "local-ai.exe" if os.name == "nt" else "local-ai"
    files = [root / "bin" / binary_name, root / "installed-profile"]
    models_root = root / "models"
    for model_name in definition["models"].values():
        files.append(models_root / f"{model_name}.yaml")
    discovered: list[Path] = []
    for config in list(files):
        if config.suffix != ".yaml" or not config.is_file():
            continue
        text = config.read_text(encoding="utf-8", errors="replace")
        for match in PATH_PATTERN.finditer(text):
            raw = match.group("path").lstrip("./")
            candidates = [models_root / raw, config.parent / raw]
            for candidate in candidates:
                resolved = candidate.resolve()
                try:
                    resolved.relative_to(root)
                except ValueError:
                    continue
                if resolved.is_file():
                    discovered.append(resolved)
                    if resolved.parent != models_root:
                        discovered.extend(item for item in resolved.parent.rglob("*") if item.is_file())
                    break
            else:
                matches = [item for item in models_root.rglob(Path(raw).name) if item.is_file()]
                if len(matches) == 1:
                    discovered.append(matches[0])
                    discovered.extend(item for item in matches[0].parent.rglob("*") if item.is_file())
    unique = {file.resolve() for file in [*files, *discovered]}
    return sorted(unique, key=str)


def _hash_file(path: Path, cancel: asyncio.Event) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            if cancel.is_set():
                raise asyncio.CancelledError
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


async def build_manifest(
    root: Path,
    profiles_root: Path,
    profile: str,
    cancel: asyncio.Event,
    progress: ProgressCallback,
) -> dict[str, Any]:
    definition = load_profile(profiles_root, profile)
    files = _definition_files(root, definition)
    missing = [str(path.relative_to(root)) for path in files if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"The {profile} installation is incomplete: {', '.join(missing)}")
    total = sum(path.stat().st_size for path in files) or 1
    complete = 0
    entries = []
    for path in files:
        if cancel.is_set():
            raise asyncio.CancelledError
        relative = path.relative_to(root).as_posix()
        await progress(0.05 + (complete / total) * 0.85, f"Validating {relative}")
        digest, size = await asyncio.to_thread(_hash_file, path, cancel)
        stat = path.stat()
        entries.append({
            "path": relative,
            "sha256": digest,
            "size": size,
            "mtimeNs": stat.st_mtime_ns,
        })
        complete += size
    template_bytes = (profiles_root / f"{profile}.json").read_bytes()
    return {
        "schemaVersion": 1,
        "profile": profile,
        "profileManifestId": definition["manifestId"],
        "profileTemplateSha256": hashlib.sha256(template_bytes).hexdigest(),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "totalBytes": complete,
        "files": entries,
    }


async def write_manifest_atomic(root: Path, manifest: dict[str, Any]) -> Path:
    target = root / "install-manifest.json"
    temporary = root / f".install-manifest.{os.getpid()}.tmp"
    payload = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    await asyncio.to_thread(temporary.write_text, payload, encoding="utf-8")
    await asyncio.to_thread(os.chmod, temporary, 0o600)
    await asyncio.to_thread(os.replace, temporary, target)
    return target


async def verify_or_create_manifest(
    root: Path,
    profiles_root: Path,
    profile: str,
    cancel: asyncio.Event,
    progress: ProgressCallback,
) -> dict[str, Any]:
    installed = (root / "installed-profile").read_text(encoding="utf-8").strip()
    if installed != profile:
        raise ValueError(f"Installed profile is {installed!r}; refusing to activate {profile!r}.")
    candidate = await build_manifest(root, profiles_root, profile, cancel, progress)
    target = root / "install-manifest.json"
    state = "created"
    if target.is_file():
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
            comparable = lambda item: (item["path"], item["sha256"], item["size"])
            if (
                existing.get("profile") != profile
                or existing.get("profileManifestId") != candidate["profileManifestId"]
                or sorted(map(comparable, existing.get("files", []))) != sorted(map(comparable, candidate["files"]))
            ):
                raise ValueError("The installed model manifest does not match the selected files.")
            state = "valid"
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise ValueError("The installed model manifest is invalid.") from error
    else:
        await write_manifest_atomic(root, candidate)
    await progress(0.95, f"Manifest {state}")
    return {"state": state, "manifest": candidate}
