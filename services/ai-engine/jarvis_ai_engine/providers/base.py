from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import Any

ProgressCallback = Callable[[float, str], Awaitable[None]]


class AIProvider(ABC):
    @abstractmethod
    async def health(self) -> dict[str, Any]: ...

    @abstractmethod
    async def capabilities(self) -> dict[str, Any]: ...

    @abstractmethod
    async def models(self) -> dict[str, Any]: ...

    @abstractmethod
    async def validate(self, profile: str, cancel: asyncio.Event, progress: ProgressCallback) -> dict[str, Any]: ...

    @abstractmethod
    async def warm(self, profile: str, cancel: asyncio.Event, progress: ProgressCallback) -> dict[str, Any]: ...

    @abstractmethod
    async def unload(self, profile: str, cancel: asyncio.Event, progress: ProgressCallback) -> dict[str, Any]: ...

    @abstractmethod
    async def shutdown(self) -> None: ...
