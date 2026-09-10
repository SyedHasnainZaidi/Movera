"""Time-under-correct-alignment tracking, for exercises with no repetition.

Why this exists
---------------
Postural correction has no movement cycle. MovementMachine counts a repetition
by observing a full rest -> peak -> rest journey of one angle, which is exactly
right for a squat and meaningless for standing up straight: there is no point
at which one "rep" of good posture ends and the next begins.

The previous configuration worked around that by declaring a repetition to be
"slouch below 150 degrees, then straighten past 170". That produces a number,
but the number rewards the patient for *slouching between attempts* - the only
way to score a second repetition is to first undo the first one. It also means
a patient who simply stands correctly for two minutes scores zero.

So a HOLD exercise measures the thing the exercise is actually for: seconds
spent correctly aligned. The goal is a duration, and the session ends when that
duration is reached.

Accumulated, not consecutive
----------------------------
Time is added up across the whole session rather than requiring one unbroken
stretch. Postural work is corrective - the patient is expected to drift, be
told, and correct. Demanding 60 unbroken seconds would fail the exact patient
the exercise is prescribed for, and a single dropped frame would reset them to
zero. The longest unbroken stretch is tracked separately, because it is
clinically interesting even though it does not gate completion.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

#: Largest gap between two frames that may be credited as held time, in
#: seconds.
#:
#: Frames arrive at roughly 7 fps, so a normal gap is ~0.14 s. A much larger
#: one means something stopped delivering frames - a backgrounded tab, a stalled
#: socket, a laptop lid. Crediting that whole gap would let a patient earn a
#: 60-second goal by holding still, minimising the browser and coming back.
#: Capped rather than discarded, because a genuine 400 ms hiccup during real
#: exercise should still count for 400 ms.
MAX_CREDITED_GAP_SECONDS = 0.75

#: Tolerance on the goal comparison, in seconds.
#:
#: Held time is a running sum of floating-point intervals, so a patient who
#: holds exactly the prescribed duration can land a fraction of a microsecond
#: short and fail the `>=` test. Ten microseconds is far below anything a
#: camera can resolve and far above the accumulated rounding error, so it
#: cannot let a genuinely short hold pass.
GOAL_EPSILON_SECONDS = 1e-5


@dataclass(slots=True)
class HoldSnapshot:
    """What the browser is shown, and what the report is built from."""

    #: Cumulative seconds of correct alignment across the whole session.
    held_seconds: float
    #: Prescribed seconds. Zero when the exercise has no hold goal.
    target_seconds: float
    #: Whether alignment is correct right now.
    active: bool
    #: Seconds in the CURRENT unbroken stretch. Resets whenever the patient
    #: drifts out of alignment; used for live encouragement, not for scoring.
    streak_seconds: float
    #: Longest unbroken stretch this session.
    best_streak_seconds: float

    @property
    def progress(self) -> float:
        """Completion in [0, 1]. 1.0 when there is no goal to miss."""
        if self.target_seconds <= 0:
            return 1.0
        return min(1.0, self.held_seconds / self.target_seconds)

    @property
    def remaining_seconds(self) -> float:
        return max(0.0, self.target_seconds - self.held_seconds)

    def to_dict(self) -> dict[str, float | bool]:
        return {
            "heldSeconds": round(self.held_seconds, 1),
            "targetSeconds": round(self.target_seconds, 1),
            "remainingSeconds": round(self.remaining_seconds, 1),
            "progress": round(self.progress, 4),
            "active": self.active,
            "streakSeconds": round(self.streak_seconds, 1),
            "bestStreakSeconds": round(self.best_streak_seconds, 1),
        }


@dataclass(slots=True)
class HoldTracker:
    """Accumulates time spent correctly aligned. One per live session."""

    target_seconds: float
    #: Seconds already credited by the backend. Non-zero after a reconnect, so
    #: a dropped socket resumes at 40 s rather than restarting at 0 - the same
    #: guarantee MovementMachine gives repetitions.
    held_seconds: float = 0.0

    _active: bool = False
    _streak_seconds: float = 0.0
    _best_streak_seconds: float = 0.0
    _last_tick: Optional[float] = None
    #: Whether the PREVIOUS frame was creditable. Time is credited for the
    #: interval between two frames, and an interval only counts when the
    #: patient was aligned at both ends of it - see update().
    _was_credited: bool = False
    _goal_reached: bool = field(default=False, init=False)

    def update(
        self,
        *,
        aligned: bool,
        tracking_valid: bool,
        now: Optional[float] = None,
    ) -> HoldSnapshot:
        """Credit the time since the previous frame and return the new state.

        `aligned` is the analyzer's posture verdict for this frame; time accrues
        only when the patient is BOTH correctly aligned and reliably visible.
        A patient who walks out of frame is not holding a position, so an
        invalid frame stops the clock rather than freezing it - unlike
        MovementMachine, which freezes mid-repetition on purpose.
        """
        now = now if now is not None else time.monotonic()
        previous = self._last_tick
        self._last_tick = now

        credit_this_frame = aligned and tracking_valid

        # What is being credited is the INTERVAL between the previous frame and
        # this one, so it only counts when the patient was correctly aligned at
        # BOTH ends of it. Crediting on this frame alone would pay for the
        # interval that ended it - the stretch the patient spent slouched,
        # right up until the moment they corrected. That is precisely the time
        # a postural exercise must not reward.
        if previous is not None and credit_this_frame and self._was_credited:
            elapsed = min(max(0.0, now - previous), MAX_CREDITED_GAP_SECONDS)
            self.held_seconds += elapsed
            self._streak_seconds += elapsed
            self._best_streak_seconds = max(
                self._best_streak_seconds, self._streak_seconds
            )
        elif not credit_this_frame:
            self._streak_seconds = 0.0

        self._was_credited = credit_this_frame
        self._active = credit_this_frame
        if (
            self.target_seconds > 0
            and self.held_seconds >= self.target_seconds - GOAL_EPSILON_SECONDS
        ):
            self._goal_reached = True

        return self.snapshot()

    def snapshot(self) -> HoldSnapshot:
        return HoldSnapshot(
            held_seconds=self.held_seconds,
            target_seconds=self.target_seconds,
            active=self._active,
            streak_seconds=self._streak_seconds,
            best_streak_seconds=self._best_streak_seconds,
        )

    @property
    def goal_reached(self) -> bool:
        return self._goal_reached

    def reset_cycle(self) -> None:
        """Break the current streak WITHOUT discarding accumulated time.

        Called on reconnect and on an explicit pause. The elapsed-time gap
        across a reconnect is not the patient's hold, so the clock restarts;
        the seconds they already earned are theirs to keep.
        """
        self._streak_seconds = 0.0
        self._active = False
        self._last_tick = None
        self._was_credited = False


__all__ = ["HoldTracker", "HoldSnapshot", "MAX_CREDITED_GAP_SECONDS"]
