from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

_BEARER = re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~-]+")
_SECRET_FIELD = re.compile(r'(?i)("(?:token|authorization|api[_-]?key)"\s*:\s*")[^"]+')


def redact(value: object) -> str:
    text = value if isinstance(value, str) else repr(value)
    text = _BEARER.sub(r"\1[REDACTED]", text)
    return _SECRET_FIELD.sub(r"\1[REDACTED]", text)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        if record.exc_info:
            payload["exception"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
