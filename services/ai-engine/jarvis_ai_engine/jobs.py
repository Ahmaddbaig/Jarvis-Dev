from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

ProgressCallback = Callable[[float, str], Awaitable[None]]
JobWork = Callable[[asyncio.Event, ProgressCallback], Awaitable[dict[str, Any] | None]]


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class Job:
    id: str
    kind: str
    profile: str | None
    state: str = "queued"
    progress: float = 0.0
    message: str = "Queued"
    created_at: str = field(default_factory=now_iso)
    started_at: str | None = None
    finished_at: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    task: asyncio.Task[None] | None = field(default=None, repr=False)
    events: list[dict[str, Any]] = field(default_factory=list, repr=False)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "profile": self.profile,
            "state": self.state,
            "progress": round(self.progress, 4),
            "message": self.message,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "result": self.result,
            "error": self.error,
            "cancellable": self.state in {"queued", "running"},
        }


class JobManager:
    def __init__(self, retention: int = 100) -> None:
        self._jobs: dict[str, Job] = {}
        self._retention = retention

    def create(self, kind: str, profile: str | None, work: JobWork) -> dict[str, Any]:
        self._prune()
        job = Job(id=f"job_{uuid.uuid4().hex}", kind=kind, profile=profile)
        self._jobs[job.id] = job
        job.task = asyncio.create_task(self._run(job, work), name=job.id)
        return job.public()

    async def _run(self, job: Job, work: JobWork) -> None:
        job.state = "running"
        job.started_at = now_iso()

        async def progress(value: float, message: str) -> None:
            if job.cancel_event.is_set():
                raise asyncio.CancelledError
            job.progress = max(job.progress, min(1.0, max(0.0, value)))
            job.message = message[:500]
            job.events.append({"at": now_iso(), "progress": job.progress, "message": job.message})
            if len(job.events) > 200:
                del job.events[:-200]

        try:
            job.result = await work(job.cancel_event, progress)
            job.state = "succeeded"
            job.progress = 1.0
            job.message = "Completed"
        except asyncio.CancelledError:
            job.state = "cancelled"
            job.message = "Cancelled"
        except Exception as error:  # The public error is intentionally message-only.
            job.state = "failed"
            job.error = str(error)[:1_000]
            job.message = "Failed"
        finally:
            job.finished_at = now_iso()

    def get(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        return job.public() if job else None

    def events(self, job_id: str) -> list[dict[str, Any]] | None:
        job = self._jobs.get(job_id)
        return list(job.events) if job else None

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        if not job:
            return None
        if job.state in {"queued", "running"}:
            job.cancel_event.set()
            if job.task and not job.task.done():
                job.task.cancel()
        return job.public()

    async def shutdown(self) -> None:
        tasks = []
        for job in self._jobs.values():
            if job.task and not job.task.done():
                job.cancel_event.set()
                job.task.cancel()
                tasks.append(job.task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _prune(self) -> None:
        finished = [job for job in self._jobs.values() if job.finished_at]
        if len(finished) <= self._retention:
            return
        finished.sort(key=lambda job: job.finished_at or "")
        for job in finished[: len(finished) - self._retention]:
            self._jobs.pop(job.id, None)
