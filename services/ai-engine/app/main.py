"""Entrypoint: run the FastAPI control API and the AudioSocket TCP server.

Both run concurrently in one asyncio loop:
  * uvicorn serves the HTTP control API on AI_ENGINE_PORT (8080).
  * a raw asyncio TCP server accepts AudioSocket connections on
    AUDIOSOCKET_PORT (9092) and hands each to the Engine's session handler.

The Engine singleton (DB pool, Claude brain, registry, store) is created once and
shared between both servers via FastAPI lifespan.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal

import uvicorn

try:  # load .env for local runs; harmless if absent
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # noqa: BLE001
    pass

from .api import create_app
from .audiosocket import AudioSocketServer
from .config import get_settings
from .engine import Engine

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("aipbx.main")


async def _run() -> None:
    settings = get_settings()
    engine = Engine(settings)
    await engine.startup()

    # HTTP control API (FastAPI/uvicorn).
    app = create_app(engine)
    config = uvicorn.Config(
        app,
        host=settings.ai_engine_host,
        port=settings.ai_engine_port,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
        lifespan="on",
    )
    server = uvicorn.Server(config)

    # AudioSocket TCP server.
    audiosocket = AudioSocketServer(
        settings.audiosocket_host,
        settings.audiosocket_port,
        engine.handle_connection,
    )
    await audiosocket.start()

    stop = asyncio.Event()

    def _signal() -> None:
        logger.info("shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, _signal)

    http_task = asyncio.create_task(server.serve(), name="http")
    audio_task = asyncio.create_task(
        audiosocket.serve_forever(), name="audiosocket"
    )

    await stop.wait()

    # Graceful shutdown.
    server.should_exit = True
    await audiosocket.stop()
    for task in (http_task, audio_task):
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    await engine.shutdown()
    logger.info("engine stopped")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
