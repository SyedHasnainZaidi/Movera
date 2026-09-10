"""Exercise slug -> analyzer class.

Every exercise uses BaseExerciseAnalyzer unchanged, because the analysis is
fully data-driven: the five exercises differ only in their ExerciseRuleConfig
rows (required joints, angle definitions, state thresholds, posture rules).

That is the intended design - adding an exercise should be a seed row, not a
new class. This registry exists so that an exercise which genuinely needs
bespoke Python (one whose rule cannot be expressed declaratively) can be
registered here without changing any call site.

The five slugs below are the exercises implemented in the project's YOLOv8
prototype (`FYP/FYP/physio_backend/analysis/`), one per analyzer class it
defined:

    bicep_curl.py         -> bicep-curl
    squat.py              -> squat
    shoulder_abduction.py -> shoulder-abduction
    straight_leg_raise.py -> straight-leg-raise
    posture.py            -> static-posture

static-posture is the one that is not a repetition exercise. Like the
prototype's PostureAnalyzer it counts nothing; its goal is seconds held in
correct alignment. That is a property of the exercise carried in the analyzer
context (goalType), not a special case in this registry - the same
BaseExerciseAnalyzer handles both.
"""

from __future__ import annotations

from app.exercises.base import BaseExerciseAnalyzer, RuleConfig

SUPPORTED_SLUGS: frozenset[str] = frozenset(
    {
        "squat",
        "bicep-curl",
        "shoulder-abduction",
        "straight-leg-raise",
        "static-posture",
    }
)

_OVERRIDES: dict[str, type[BaseExerciseAnalyzer]] = {
    # e.g. "gait-analysis": GaitAnalyzer
}


def build_analyzer(
    config: RuleConfig,
    initial_rep_count: int = 0,
    initial_held_seconds: float = 0.0,
) -> BaseExerciseAnalyzer:
    analyzer_cls = _OVERRIDES.get(config.exercise_slug, BaseExerciseAnalyzer)
    return analyzer_cls(
        config,
        initial_rep_count=initial_rep_count,
        initial_held_seconds=initial_held_seconds,
    )


def is_supported(slug: str) -> bool:
    return slug in SUPPORTED_SLUGS or slug in _OVERRIDES
