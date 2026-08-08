from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")


@dataclass(frozen=True, slots=True)
class EngineConfig:
    token: str
    port: int
    build_sha: str
    local_ai_root: Path
    local_ai_base_url: str
    profiles_root: Path


def bundled_profiles_root() -> Path:
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    candidate = bundle_root / "profiles"
    if candidate.is_dir():
        return candidate
    return Path(__file__).resolve().parents[1] / "profiles"


def read_startup_config() -> EngineConfig:
    line = sys.stdin.readline(65_537)
    if not line or len(line.encode("utf-8")) > 65_536:
        raise ValueError("A bounded JSON startup configuration is required on stdin.")
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as error:
        raise ValueError("The startup configuration is not valid JSON.") from error
    if not isinstance(payload, dict):
        raise ValueError("The startup configuration must be an object.")

    token = payload.get("token")
    port = payload.get("port")
    build_sha = payload.get("buildSha")
    root = payload.get("localAiRoot")
    base_url = payload.get("localAiBaseUrl", "http://127.0.0.1:8080")
    if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
        raise ValueError("The service token is invalid.")
    if not isinstance(port, int) or not 1024 <= port <= 65_535:
        raise ValueError("The loopback service port is invalid.")
    if not isinstance(build_sha, str) or not 1 <= len(build_sha) <= 128:
        raise ValueError("The build identifier is invalid.")
    if not isinstance(root, str) or not root:
        raise ValueError("The LocalAI root is required.")
    if not isinstance(base_url, str) or not base_url.startswith("http://127.0.0.1:"):
        raise ValueError("LocalAI must use a 127.0.0.1 loopback URL.")
    return EngineConfig(
        token=token,
        port=port,
        build_sha=build_sha,
        local_ai_root=Path(root).expanduser().resolve(),
        local_ai_base_url=base_url.rstrip("/"),
        profiles_root=bundled_profiles_root(),
    )
