from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from jarvis_ai_engine import PROTOCOL_VERSION
from jarvis_ai_engine.app import create_app
from jarvis_ai_engine.config import EngineConfig

TOKEN = "A" * 43


def config(tmp_path: Path) -> EngineConfig:
    return EngineConfig(
        token=TOKEN,
        port=43123,
        build_sha="test-build",
        local_ai_root=tmp_path / ".local-ai",
        local_ai_base_url="http://127.0.0.1:65534",
        profiles_root=Path(__file__).resolve().parents[1] / "profiles",
    )


@pytest.mark.asyncio
async def test_health_is_authenticated_and_reports_protocol(tmp_path: Path) -> None:
    app = create_app(config(tmp_path))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/v1/health")).status_code == 401
        response = await client.get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    assert response.json()["protocol"] == PROTOCOL_VERSION
    assert response.json()["buildSha"] == "test-build"


@pytest.mark.asyncio
async def test_models_never_selects_or_downloads_a_profile(tmp_path: Path) -> None:
    app = create_app(config(tmp_path))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/v1/models", headers={"Authorization": f"Bearer {TOKEN}"})
        action = await client.post(
            "/v1/models",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"action": "warm"},
        )
    assert response.json()["installedProfile"] is None
    assert [item["id"] for item in response.json()["profiles"]] == ["m2", "m3", "m5"]
    assert action.status_code == 409
    assert not (tmp_path / ".local-ai").exists()


@pytest.mark.asyncio
async def test_jobs_are_cancellable(tmp_path: Path) -> None:
    root = tmp_path / ".local-ai"
    root.mkdir()
    (root / "installed-profile").write_text("m2\n", encoding="utf-8")
    app = create_app(config(tmp_path))
    headers = {"Authorization": f"Bearer {TOKEN}"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/v1/models", headers=headers, json={"action": "validate", "profile": "m2"})
        job_id = response.json()["id"]
        cancelled = await client.delete(f"/v1/jobs/{job_id}", headers=headers)
    assert response.status_code == 202
    assert cancelled.status_code == 200
    assert cancelled.json()["id"] == job_id
