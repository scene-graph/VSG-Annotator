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

// For an edge click, jump to the source node's best frame (the subject's best view).
// Falls back to target's best frame, then the edge's start frame.
export const getEdgeSubjectFrame = (edge: Edge, nodes: Node[]): number => {
  const startFallback = edge.time_periods && edge.time_periods.length > 0
    ? edge.time_periods[0].start_frame
    : edge.time_period.start_frame;

  const sourceIds = new Set(Array.isArray(edge.source) ? edge.source : [edge.source]);
  const targetIds = new Set(Array.isArray(edge.target) ? edge.target : [edge.target]);

  const pickBestAcross = (ids: Set<string>): number | null => {
    let best: number | null = null;
    let bestArea = -1;
    for (const n of nodes) {
      if (!ids.has(n.node_id)) continue;
      for (const [frameStr, bbox] of Object.entries(n.bboxes_by_frame || {})) {
        const f = Number(frameStr);
        if (Number.isNaN(f)) continue;
        const area = (bbox.width ?? 0) * (bbox.height ?? 0);
        if (area > bestArea || (area === bestArea && (best === null || f < best))) {
          bestArea = area;
          best = f;
        }
      }
    }
    return best;
  };

  return pickBestAcross(sourceIds) ?? pickBestAcross(targetIds) ?? startFallback;
};
