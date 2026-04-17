import type { Edge, Node } from '../types';

// Frame where the node's bbox has the largest area (ties broken by earliest frame).
export const getLargestBBoxFrame = (node: Node): number | null => {
  let best: number | null = null;
  let bestArea = -1;
  for (const [frameStr, bbox] of Object.entries(node.bboxes_by_frame || {})) {
    const f = Number(frameStr);
    if (Number.isNaN(f)) continue;
    const area = (bbox.width ?? 0) * (bbox.height ?? 0);
    if (area > bestArea || (area === bestArea && (best === null || f < best))) {
      bestArea = area;
      best = f;
    }
  }
  return best;
};

// Earliest start_frame across the edge's annotated lifespan. Prefers
// the segmented `time_periods`; falls back to the legacy merged
// `time_period`. Used as the default seek target on edge clicks so the
// playhead lands at the beginning of the relation, not inside it.
export const getEdgeStartFrame = (edge: Edge): number => {
  if (edge.time_periods && edge.time_periods.length > 0) {
    return Math.min(...edge.time_periods.map((p) => p.start_frame));
  }
  return edge.time_period.start_frame;
};
