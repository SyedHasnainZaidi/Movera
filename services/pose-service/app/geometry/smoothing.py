"""Angle smoothing.

Raw pose estimates jitter by a few degrees frame to frame even when the patient
is still. Feeding that directly into a threshold comparison makes the movement
state flicker at the boundary, which is one of the two ways a naive rep counter
double-counts (the other is having no cooldown).

A rolling MEDIAN is used rather than a mean: median rejects the occasional
wildly-wrong landmark outright, where a mean would drag the value toward it.
The window is small (default 5 frames = 0.5 s at 10 fps) so that added latency
stays well under human reaction time.
"""

from __future__ import annotations

import statistics
from collections import defaultdict, deque
from typing import Optional


class AngleSmoother:
    """Per-angle rolling median with a bounded window."""

    def __init__(self, window: int = 5) -> None:
        if window < 1:
            raise ValueError("smoothing window must be >= 1")
        self._window = window
        self._buffers: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self._window)
        )

    def push(self, name: str, value: Optional[float]) -> Optional[float]:
        """Add a sample and return the smoothed value.

        A ``None`` sample (landmark not measurable) does NOT clear history:
        a brief occlusion should not discard the movement context built up over
        the previous half second. It simply returns the current smoothed value.
        """
        buffer = self._buffers[name]
        if value is not None:
            buffer.append(value)
        if not buffer:
            return None
        return float(statistics.median(buffer))

    def current(self, name: str) -> Optional[float]:
        buffer = self._buffers.get(name)
        if not buffer:
            return None
        return float(statistics.median(buffer))

    def reset(self) -> None:
        """Called between sessions - smoothing must never span two patients."""
        self._buffers.clear()


class AngleTracker:
    """Accumulates min/max/mean per named angle over a repetition.

    Feeds `RepResult.angleSummary`, which is what makes a report able to say
    "your deepest knee flexion this session was 84 degrees" rather than just
    counting repetitions.
    """

    def __init__(self) -> None:
        self._samples: dict[str, list[float]] = defaultdict(list)

    def observe(self, name: str, value: Optional[float]) -> None:
        if value is not None:
            self._samples[name].append(value)

    def summary(self) -> dict[str, dict[str, float]]:
        result: dict[str, dict[str, float]] = {}
        for name, values in self._samples.items():
            if not values:
                continue
            result[name] = {
                "min": round(min(values), 1),
                "max": round(max(values), 1),
                "mean": round(sum(values) / len(values), 1),
            }
        return result

    def sample_count(self) -> int:
        return sum(len(v) for v in self._samples.values())

    def reset(self) -> None:
        self._samples.clear()
