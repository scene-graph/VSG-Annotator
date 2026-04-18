"""Schema-aligned prompt builders for edge re-extraction.

Each prompt lists the canonical predicate vocabulary for its edge type
(sourced from ``backend.core.predicate_vocab``) so Gemini's output stays
within the schema. Predicate aliases are resolved server-side after the
call — the prompt asks for a canonical predicate directly.
"""

from __future__ import annotations

from backend.core.predicate_vocab import (
    DYNAMIC_PREDICATES,
    FGBG_PREDICATES,
    STATIC_PREDICATES,
)

# Motion-attribute vocabulary from output_schema_standard.md §5.
MOTION_VELOCITY = ["stationary", "very_slow", "slow", "moderate", "fast", "very_fast"]
MOTION_DIRECTION = [
    "none", "up", "down", "left", "right", "forward", "backward",
    "toward_body", "away_from_body", "inward", "outward", "rotational",
]
MOTION_TRAJECTORY = [
    "stable", "straight", "curved", "arc", "circular",
    "zigzag", "oscillating", "irregular",
]

SYSTEM_PROMPT = (
    "You are a video scene-graph annotator. You must output valid JSON "
    "only — no prose, no markdown fences. Choose a predicate from the "
    "provided vocabulary only; if no vocabulary entry fits, return "
    "`\"predicate\": null`."
)


def _vocab_line(name: str, words: list[str]) -> str:
    return f"{name}: {', '.join(sorted(words))}"


def build_prompt(
    edge_type: str,
    source_label: str,
    target_label: str,
    start_frame: int,
    end_frame: int,
) -> str:
    """Build the extraction prompt for a single edge.

    ``source_label`` / ``target_label`` are human-readable strings like
    ``"car (dynamic_012)"``. The clip attached to the prompt covers
    ``[start_frame, end_frame]`` — the model should describe the
    relationship visible in that window.
    """
    header = (
        f"Describe the relationship between the SOURCE `{source_label}` "
        f"and the TARGET `{target_label}` as visible in the attached "
        f"video clip (frames {start_frame}-{end_frame})."
    )
    if edge_type == "static":
        vocab = _vocab_line("static_predicates", sorted(STATIC_PREDICATES))
        body = (
            f"{header}\n\n"
            "The relation is a STATIC spatial relation between two static "
            "objects. It holds for the entire video.\n\n"
            f"Pick exactly one predicate from this list:\n{vocab}\n\n"
            "Output schema:\n"
            "{\n"
            '  "predicate": "<one of the static_predicates>",\n'
            '  "confidence": <float 0..1>\n'
            "}\n"
        )
    elif edge_type == "dynamic":
        vocab = _vocab_line("dynamic_predicates", sorted(DYNAMIC_PREDICATES))
        body = (
            f"{header}\n\n"
            "The relation is a DYNAMIC action the source performs with "
            "respect to the target during this time window.\n\n"
            f"Pick exactly one predicate from:\n{vocab}\n\n"
            "Also annotate the motion profile with values drawn from:\n"
            f"- {_vocab_line('velocity', MOTION_VELOCITY)}\n"
            f"- {_vocab_line('direction', MOTION_DIRECTION)}\n"
            f"- {_vocab_line('trajectory', MOTION_TRAJECTORY)}\n\n"
            "Output schema:\n"
            "{\n"
            '  "predicate": "<one of the dynamic_predicates>",\n'
            '  "attributes": {\n'
            '    "velocity": "<velocity>",\n'
            '    "direction": "<direction>",\n'
            '    "trajectory": "<trajectory>"\n'
            "  },\n"
            '  "time_periods": [\n'
            '    {"start_frame": <int>, "end_frame": <int>}\n'
            "  ],\n"
            '  "confidence": <float 0..1>\n'
            "}\n"
            "Use one or more time_periods bounded within the clip range."
        )
    elif edge_type == "fg_bg":
        vocab = _vocab_line("fgbg_predicates", sorted(FGBG_PREDICATES))
        body = (
            f"{header}\n\n"
            "The relation is a FOREGROUND-BACKGROUND relation: a dynamic "
            "foreground object (or group) related to a static background "
            "surface/structure.\n\n"
            f"Pick exactly one predicate from:\n{vocab}\n\n"
            "Output schema:\n"
            "{\n"
            '  "predicate": "<one of the fgbg_predicates>",\n'
            '  "time_periods": [\n'
            '    {"start_frame": <int>, "end_frame": <int>}\n'
            "  ],\n"
            '  "confidence": <float 0..1>\n'
            "}\n"
        )
    else:
        body = header  # unknown type — let upstream decide how to handle

    return body


def predicate_set_for(edge_type: str) -> set[str]:
    if edge_type == "static":
        return set(STATIC_PREDICATES)
    if edge_type == "dynamic":
        return set(DYNAMIC_PREDICATES)
    if edge_type == "fg_bg":
        return set(FGBG_PREDICATES)
    return set()
