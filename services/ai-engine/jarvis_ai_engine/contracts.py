from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelActionRequest(StrictModel):
    action: Literal["warm", "unload", "validate"]
    profile: Literal["m2", "m3", "m5"] | None = None


class RespondMessage(StrictModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=200_000)


class RespondRequest(StrictModel):
    model: str | None = Field(default=None, max_length=200)
    messages: list[RespondMessage] = Field(min_length=1, max_length=200)
    tools: list[dict[str, Any]] = Field(default_factory=list, max_length=128)
    temperature: float | None = Field(default=None, ge=0, le=2)


class TranscribeRequest(StrictModel):
    audio_base64: str = Field(min_length=1, max_length=40_000_000)
    mime_type: str = Field(default="audio/webm", max_length=100)
    model: str | None = Field(default=None, max_length=200)


class SpeakRequest(StrictModel):
    text: str = Field(min_length=1, max_length=20_000)
    voice: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)


class VisionRequest(StrictModel):
    prompt: str = Field(min_length=1, max_length=20_000)
    image_base64: str = Field(min_length=1, max_length=40_000_000)
    mime_type: str = Field(default="image/jpeg", max_length=100)
    model: str | None = Field(default=None, max_length=200)
