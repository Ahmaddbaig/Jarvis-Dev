from __future__ import annotations

import logging

import uvicorn

from .app import create_app
from .config import read_startup_config
from .logging import configure_logging


def main() -> None:
    configure_logging()
    config = read_startup_config()
    logging.getLogger(__name__).info("Starting Jarvis AI engine on 127.0.0.1:%d", config.port)
    uvicorn.run(
        create_app(config),
        host="127.0.0.1",
        port=config.port,
        log_config=None,
        access_log=False,
        server_header=False,
        timeout_graceful_shutdown=10,
    )


if __name__ == "__main__":
    main()
