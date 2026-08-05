from __future__ import annotations

import asyncio
import importlib.metadata
import os
import platform
import secrets
import sys
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from fastapi.responses import JSONResponse

from . import ENGINE_VERSION, PROTOCOL_VERSION
from .config import EngineConfig
from .contracts import ModelActionRequest, RespondRequest, SpeakRequest, TranscribeRequest, VisionRequest
from .jobs import JobManager
from .providers import LocalAIProvider


def memory_bytes() -> int | None:
    try:
        if hasattr(os, "sysconf"):
            return int(os.sysconf("SC_PAGE_SIZE")) * int(os.sysconf("SC_PHYS_PAGES"))
    except (ValueError, OSError):
        pass
    return None


def create_app(config: EngineConfig) -> FastAPI:
    provider = LocalAIProvider(config)
    jobs = JobManager()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        idle_monitor = asyncio.create_task(provider.monitor_idle_unload(), name="localai-idle-unload")
        try:
            yield
        finally:
            idle_monitor.cancel()
            await asyncio.gather(idle_monitor, return_exceptions=True)
            await jobs.shutdown()
            await provider.shutdown()

    app = FastAPI(
        title="Jarvis AI Engine",
        version=ENGINE_VERSION,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.config = config
    app.state.provider = provider
    app.state.jobs = jobs

    def authorize(authorization: str | None = Header(default=None)) -> None:
        supplied = authorization.removeprefix("Bearer ") if authorization else ""
        if not supplied or not secrets.compare_digest(supplied, config.token):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service credential.")

    @app.exception_handler(Exception)
    async def safe_error(_request: Any, error: Exception):
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "ai_engine_error", "message": str(error)[:1_000]}},
        )

    @app.get("/v1/health", dependencies=[Depends(authorize)])
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "protocol": PROTOCOL_VERSION,
            "engineVersion": ENGINE_VERSION,
            "buildSha": config.build_sha,
            "python": platform.python_version(),
            "runtime": {
                "platform": platform.system().lower(),
                "architecture": platform.machine().lower(),
                "memoryBytes": memory_bytes(),
                "frozen": bool(getattr(sys, "frozen", False)),
            },
            "packages": {
                name: importlib.metadata.version(name)
                for name in ("fastapi", "pydantic", "uvicorn", "httpx")
            },
            "providers": {"localai": await provider.health(), "openai": {"configured": False, "requiredToBoot": False}},
        }

    @app.get("/v1/capabilities", dependencies=[Depends(authorize)])
    async def capabilities() -> dict[str, Any]:
        return {
            "protocol": PROTOCOL_VERSION,
            "providers": [await provider.capabilities()],
            "toolPolicy": "proposal-only",
            "jobs": {"cancellable": True, "progressEvents": True},
        }

    @app.get("/v1/models", dependencies=[Depends(authorize)])
    async def models() -> dict[str, Any]:
        return await provider.models()

    @app.post("/v1/models", status_code=202, dependencies=[Depends(authorize)])
    async def model_action(request: ModelActionRequest) -> dict[str, Any]:
        profile = request.profile or provider._installed_profile()
        if profile is None:
            raise HTTPException(status_code=409, detail="No supported LocalAI profile is installed.")
        work = {
            "warm": provider.warm,
            "unload": provider.unload,
            "validate": provider.validate,
        }[request.action]
        return jobs.create(request.action, profile, lambda cancel, progress: work(profile, cancel, progress))

    @app.get("/v1/jobs/{job_id}", dependencies=[Depends(authorize)])
    async def job_status(job_id: str) -> dict[str, Any]:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job

    @app.get("/v1/jobs/{job_id}/events", dependencies=[Depends(authorize)])
    async def job_events(job_id: str) -> dict[str, Any]:
        events = jobs.events(job_id)
        if events is None:
            raise HTTPException(status_code=404, detail="Job not found.")
        return {"jobId": job_id, "events": events}

    @app.delete("/v1/jobs/{job_id}", dependencies=[Depends(authorize)])
    async def cancel_job(job_id: str) -> dict[str, Any]:
        job = jobs.cancel(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job

    @app.post("/v1/respond", dependencies=[Depends(authorize)])
    async def respond(request: RespondRequest) -> dict[str, Any]:
        payload = request.model_dump(exclude_none=True)
        upstream = await provider.proxy_json("/v1/chat/completions", payload)
        choice = (upstream.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        return {
            "content": message.get("content") or "",
            "toolProposals": message.get("tool_calls") or [],
            "finishReason": choice.get("finish_reason"),
            "usage": upstream.get("usage"),
        }

    @app.post("/v1/transcribe", dependencies=[Depends(authorize)])
    async def transcribe(_request: TranscribeRequest) -> Response:
        raise HTTPException(status_code=501, detail="Transcription remains on the direct LocalAI WebRTC path in this migration.")

    @app.post("/v1/speak", dependencies=[Depends(authorize)])
    async def speak(_request: SpeakRequest) -> Response:
        raise HTTPException(status_code=501, detail="Speech remains on the direct LocalAI WebRTC path in this migration.")

    @app.post("/v1/vision", dependencies=[Depends(authorize)])
    async def vision(request: VisionRequest) -> dict[str, Any]:
        image_url = f"data:{request.mime_type};base64,{request.image_base64}"
        messages = [{"role": "user", "content": [
            {"type": "text", "text": request.prompt},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]}]
        upstream = await provider.proxy_json("/v1/chat/completions", {
            "model": request.model,
            "messages": messages,
        })
        choice = (upstream.get("choices") or [{}])[0]
        return {"content": (choice.get("message") or {}).get("content") or "", "usage": upstream.get("usage")}

    return app
