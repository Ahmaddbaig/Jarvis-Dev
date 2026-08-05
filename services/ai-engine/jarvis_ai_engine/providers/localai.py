from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx

from ..config import EngineConfig
from ..manifest import load_profile, verify_or_create_manifest
from .base import AIProvider, ProgressCallback

logger = logging.getLogger(__name__)


class LocalAIProvider(AIProvider):
    def __init__(self, config: EngineConfig) -> None:
        self.config = config
        self.process: asyncio.subprocess.Process | None = None
        self.owns_process = False
        self.warm_profile: str | None = None
        self.last_used_monotonic: float | None = None
        self.last_load_seconds: float | None = None
        self.last_validation: dict[str, Any] | None = None
        self._log_tasks: list[asyncio.Task[None]] = []
        self._lifecycle_lock = asyncio.Lock()

    def _installed_profile(self) -> str | None:
        try:
            value = (self.config.local_ai_root / "installed-profile").read_text(encoding="utf-8").strip()
            return value if value in {"m2", "m3", "m5"} else None
        except OSError:
            return None

    async def _ready(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=1.5, trust_env=False) as client:
                response = await client.get(f"{self.config.local_ai_base_url}/readyz")
                return response.is_success
        except httpx.HTTPError:
            return False

    async def health(self) -> dict[str, Any]:
        installed = self._installed_profile()
        idle_seconds = time.monotonic() - self.last_used_monotonic if self.last_used_monotonic is not None else None
        return {
            "id": "localai",
            "installed": installed is not None,
            "installedProfile": installed,
            "ready": await self._ready(),
            "ownedProcess": self.owns_process,
            "processId": self.process.pid if self.process and self.process.returncode is None else None,
            "warmProfile": self.warm_profile,
            "lastLoadSeconds": self.last_load_seconds,
            "idleSeconds": round(idle_seconds, 3) if idle_seconds is not None else None,
            "manifest": self.last_validation,
        }

    async def capabilities(self) -> dict[str, Any]:
        return {
            "provider": "localai",
            "respond": True,
            "transcribe": True,
            "speak": True,
            "vision": True,
            "embeddings": True,
            "modelLifecycle": True,
            "lowLatencyMediaPath": "direct-webrtc",
        }

    async def models(self) -> dict[str, Any]:
        installed = self._installed_profile()
        profiles = []
        for profile in ("m2", "m3", "m5"):
            definition = load_profile(self.config.profiles_root, profile)
            profiles.append({
                **definition,
                "installed": installed == profile,
                "warm": self.warm_profile == profile,
            })
        return {"installedProfile": installed, "warmProfile": self.warm_profile, "profiles": profiles}

    async def validate(self, profile: str, cancel: asyncio.Event, progress: ProgressCallback) -> dict[str, Any]:
        result = await verify_or_create_manifest(
            self.config.local_ai_root,
            self.config.profiles_root,
            profile,
            cancel,
            progress,
        )
        manifest = result["manifest"]
        self.last_validation = {
            "state": result["state"],
            "profile": profile,
            "manifestId": manifest["profileManifestId"],
            "files": len(manifest["files"]),
            "totalBytes": manifest["totalBytes"],
        }
        return self.last_validation

    async def _pipe_logs(self, stream: asyncio.StreamReader | None, level: int) -> None:
        if not stream:
            return
        while line := await stream.readline():
            logger.log(level, "localai: %s", line.decode("utf-8", errors="replace").rstrip()[:2_000])

    async def _start(self, progress: ProgressCallback, cancel: asyncio.Event) -> None:
        if await self._ready():
            return
        binary = self.config.local_ai_root / "bin" / ("local-ai.exe" if os.name == "nt" else "local-ai")
        if not binary.is_file():
            raise FileNotFoundError("LocalAI is not installed. Run the profile installer first.")
        await progress(0.45, "Starting LocalAI on loopback")
        env = {
            **os.environ,
            "LOCALAI_MODELS_PATH": str(self.config.local_ai_root / "models"),
            "LOCALAI_BACKENDS_PATH": str(self.config.local_ai_root / "backends"),
            "LOCALAI_DATA_PATH": str(self.config.local_ai_root / "data"),
            "LOCALAI_GENERATED_CONTENT_PATH": str(self.config.local_ai_root / "generated"),
        }
        for directory in ("data", "generated", "run"):
            (self.config.local_ai_root / directory).mkdir(parents=True, exist_ok=True)
        port = self.config.local_ai_base_url.rsplit(":", 1)[-1]
        self.process = await asyncio.create_subprocess_exec(
            str(binary), "run",
            f"--address=127.0.0.1:{port}",
            "--cors",
            "--cors-allow-origins=http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3100,http://localhost:3100",
            "--disable-web-ui", "--disable-local-ai-assistant", "--disable-agents", "--disable-mcp",
            "--f16", "--threads=8", "--context-size=8192", "--max-active-backends=6", "--log-level=info",
            env=env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self.owns_process = True
        self._log_tasks = [
            asyncio.create_task(self._pipe_logs(self.process.stdout, logging.INFO)),
            asyncio.create_task(self._pipe_logs(self.process.stderr, logging.WARNING)),
        ]
        for attempt in range(120):
            if cancel.is_set():
                raise asyncio.CancelledError
            if self.process.returncode is not None:
                raise RuntimeError(f"LocalAI exited during startup with code {self.process.returncode}.")
            if await self._ready():
                return
            await progress(0.45 + (attempt / 120) * 0.2, "Waiting for LocalAI readiness")
            await asyncio.sleep(1)
        raise TimeoutError("LocalAI did not become ready within 120 seconds.")

    async def warm(self, profile: str, cancel: asyncio.Event, progress: ProgressCallback) -> dict[str, Any]:
        async with self._lifecycle_lock:
            started = time.monotonic()
            await progress(0.01, f"Validating the {profile.upper()} profile")
            validation = await self.validate(profile, cancel, progress)
            await self._start(progress, cancel)
            if cancel.is_set():
                raise asyncio.CancelledError
            model = load_profile(self.config.profiles_root, profile)["models"]["pipeline"]
            await progress(0.7, f"Warming {model}")
            async with httpx.AsyncClient(timeout=300, trust_env=False) as client:
                response = await client.post(
                    f"{self.config.local_ai_base_url}/backend/load",
                    json={"model": model},
                )
                response.raise_for_status()
            self.warm_profile = profile
            self.last_used_monotonic = time.monotonic()
            self.last_load_seconds = round(time.monotonic() - started, 3)
            await progress(0.98, f"{profile.upper()} pipeline is warm")
            return {"profile": profile, "model": model, "validation": validation, "loadSeconds": self.last_load_seconds}

    async def unload(self, profile: str, cancel: asyncio.Event, progress: ProgressCallback) -> dict[str, Any]:
        async with self._lifecycle_lock:
            if self.warm_profile not in {None, profile}:
                raise ValueError(f"{profile.upper()} is not the warm profile.")
            model = load_profile(self.config.profiles_root, profile)["models"]["pipeline"]
            await progress(0.2, f"Unloading {model}")
            if await self._ready():
                async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
                    response = await client.post(
                        f"{self.config.local_ai_base_url}/backend/shutdown",
                        json={"model": model},
                    )
                    if response.status_code not in {200, 404, 405}:
                        response.raise_for_status()
            self.warm_profile = None
            self.last_used_monotonic = None
            await progress(0.95, f"{profile.upper()} pipeline unloaded")
            return {"profile": profile, "model": model}

    async def proxy_json(self, path: str, payload: dict[str, Any], timeout: float = 300) -> dict[str, Any]:
        if not await self._ready():
            raise RuntimeError("LocalAI is not ready. Warm the installed profile first.")
        self.last_used_monotonic = time.monotonic()
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            response = await client.post(f"{self.config.local_ai_base_url}{path}", json=payload)
            response.raise_for_status()
            return response.json()

    async def monitor_idle_unload(self) -> None:
        async def progress(_value: float, message: str) -> None:
            logger.info("Idle lifecycle: %s", message)

        while True:
            await asyncio.sleep(30)
            profile = self.warm_profile
            last_used = self.last_used_monotonic
            if profile is None or last_used is None:
                continue
            timeout = load_profile(self.config.profiles_root, profile).get("idleUnloadSeconds")
            if not isinstance(timeout, int) or time.monotonic() - last_used < timeout:
                continue
            logger.info("Unloading idle constrained profile %s after %d seconds", profile, timeout)
            try:
                await self.unload(profile, asyncio.Event(), progress)
            except Exception:
                logger.exception("Idle unload failed for profile %s", profile)

    async def shutdown(self) -> None:
        if self.process and self.process.returncode is None and self.owns_process:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=8)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
        for task in self._log_tasks:
            task.cancel()
        if self._log_tasks:
            await asyncio.gather(*self._log_tasks, return_exceptions=True)
        self.process = None
        self.owns_process = False
