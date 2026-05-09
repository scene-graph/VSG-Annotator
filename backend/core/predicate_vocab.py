"""Authoritative predicate vocabulary for validating edge_type ↔ predicate fit.

Mirrors the upstream harness vocabulary; consumed by the reclassification pass
in `annotation_service._reclassify_edges_by_nodes` to drop edges whose stored
predicate no longer belongs to the edge's reclassified vocabulary (e.g. a
fg_bg `driving_on` edge that flipped to `static` would otherwise emit an
invalid static-edge predicate).
"""

from __future__ import annotations

STATIC_PREDICATES: frozenset[str] = frozenset({
    "on", "under", "over", "in", "around", "beside",
    "left_of", "right_of", "in_front_of", "behind",
    "near", "between", "along", "across",
})

DYNAMIC_PREDICATES: frozenset[str] = frozenset({
    # Manipulation
    "picking", "placing", "putting", "holding", "grabbing", "grasping",
    "releasing", "dropping", "lifting", "lowering", "carrying", "moving",
    # Force / motion
    "throwing", "tossing", "pushing", "pulling", "dragging", "sliding",
    "rolling", "spinning", "twisting", "turning", "shaking", "waving",
    "swinging", "hitting", "kicking", "catching",
    # Gestural
    "pointing", "looking at", "watching", "touching", "reaching",
    # Consumptive
    "eating", "drinking", "biting", "chewing", "blowing", "licking",
    # Spatial / positional
    "sitting on", "standing on", "lying on", "leaning on", "riding",
    # Operational
    "opening", "closing", "using", "operating", "pressing", "typing",
    "writing", "cutting", "wiping", "cleaning", "stirring", "pouring",
    "folding", "inserting", "removing", "attaching", "detaching",
    "tightening", "loosening", "adjusting", "covering", "wrapping", "taping",
    # Driving / traffic
    "following", "overtaking", "approaching", "parking",
    # Pedestrian / crowd
    "walking_toward", "walking_away_from", "passing_by",
    "crossing_in_front_of", "facing", "conversing_with", "gathering_around",
})

FGBG_PREDICATES: frozenset[str] = frozenset({
    "sitting_on", "standing_on", "lying_on", "placed_on",
    "holding", "inside", "beside", "behind", "in_front_of",
    "leaning_on", "surrounding", "aligned_beside",
    "clustered_around", "distributed_across",
    # Driving / traffic
    "driving_on", "parked_on",
    # Crowd / pedestrian
    "walking_on", "crossing", "passing_in_front_of", "gathered_on",
})

# Alias resolution: GT annotations may use variant spellings. We only need
# the canonicalized target to live in the canonical set above; aliases are
# collapsed before the membership check.
_DYNAMIC_ALIASES: dict[str, str] = {
    "hold": "holding", "pick_up": "picking", "picking up": "picking",
    "picking_up": "picking", "put_down": "placing", "putting down": "placing",
    "putting_down": "placing", "grab": "grabbing", "grasp": "grasping",
    "pour": "pouring", "lift": "lifting", "lower": "lowering",
    "push": "pushing", "pull": "pulling", "touch": "touching",
    "wipe": "wiping", "stir": "stirring", "open": "opening", "close": "closing",
    "cut": "cutting", "move": "moving", "drop": "dropping", "throw": "throwing",
    "catch": "catching", "drag": "dragging", "slide": "sliding",
    "roll": "rolling", "spin": "spinning", "shake": "shaking",
    "swing": "swinging", "fold": "folding", "press": "pressing",
    "wave": "waving", "eat": "eating", "drink": "drinking", "bite": "biting",
    "chew": "chewing", "lick": "licking", "place": "placing",
    "carry": "carrying", "reach": "reaching", "point_at": "pointing",
    "approach": "approaching", "follow": "following", "overtake": "overtaking",
    "park": "parking", "drive": "moving", "tailgate": "following",
    "pass": "overtaking",
    "walk_toward": "walking_toward", "walking_towards": "walking_toward",
    "walk_towards": "walking_toward", "walk_away": "walking_away_from",
    "walking_away": "walking_away_from", "walk_past": "passing_by",
    "pass_by": "passing_by", "passing": "passing_by",
    "walk_across": "crossing_in_front_of", "cross": "crossing_in_front_of",
    "crossing": "crossing_in_front_of", "face": "facing",
    "face_toward": "facing", "chat_with": "conversing_with",
    "talking_with": "conversing_with", "talk_with": "conversing_with",
    "chatting_with": "conversing_with", "gathering": "gathering_around",
    "gather_around": "gathering_around", "group_around": "gathering_around",
    "meeting": "gathering_around", "stand_with": "facing",
    "standing_with": "facing", "lead": "walking_toward",
}

_FGBG_ALIASES: dict[str, str] = {
    "on": "placed_on", "in": "inside", "near": "beside",
    "moving_on": "driving_on", "traveling_on": "driving_on",
    "stopped_on": "parked_on",
    "walking_along": "walking_on", "strolling_on": "walking_on",
    "walk_on": "walking_on", "walk_along": "walking_on",
    "stroll_on": "walking_on",
    "crossing_on": "crossing", "cross_on": "crossing",
    "walking_across": "crossing",
    "walking_past": "passing_in_front_of",
    "walking_in_front_of": "passing_in_front_of",
    "pass_in_front_of": "passing_in_front_of",
    "passing_front": "passing_in_front_of",
    "gathered_around": "gathered_on", "queuing_on": "gathered_on",
    "standing_on_together": "gathered_on",
}


def _canonical(predicate: str, aliases: dict[str, str]) -> str:
    """Lowercase + alias-resolve a predicate for membership testing."""
    p = (predicate or "").strip().lower()
    return aliases.get(p, p)


def predicate_valid_for_type(predicate: str, edge_type: str) -> bool:
    """True if ``predicate`` (after alias resolution) belongs to ``edge_type``.

    Unknown edge_type returns True (unrestrictive) so future edge types
    don't accidentally get their predicates pruned by this guard.
    """
    if not predicate:
        return False
    if edge_type == "static":
        return _canonical(predicate, {}) in STATIC_PREDICATES
    if edge_type == "dynamic":
        return _canonical(predicate, _DYNAMIC_ALIASES) in DYNAMIC_PREDICATES
    if edge_type == "fg_bg":
        return _canonical(predicate, _FGBG_ALIASES) in FGBG_PREDICATES
    return True
