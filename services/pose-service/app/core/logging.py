"""Logging setup.

Rules enforced by convention throughout this service:

* NEVER log a full WebSocket URL - it carries the pose ticket in its query.
* NEVER log frame bytes, or anything derived from the video itself.
* NEVER log the service token.
* Do not log per-frame: at 10 fps a single session would emit 600 lines a
  minute. Connection, activation, repetition and failure are logged; frames
  are counted, not narrated.
"""

from __future__ import annotations

import logging
import sys


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # ultralytics logs a line per inference at INFO; absl is chatty too.
    logging.getLogger("absl").setLevel(logging.ERROR)
    logging.getLogger("ultralytics").setLevel(logging.ERROR)


def redact_ticket(url: str) -> str:
    """Strip the query string so a ticket can never reach a log line."""
    return url.split("?", 1)[0] + "?<redacted>"
