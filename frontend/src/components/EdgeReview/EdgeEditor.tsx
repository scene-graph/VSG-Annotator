import { useState, useEffect } from 'react';
import type { Edge, MotionAttributes, TimePeriod } from '../../types';
import { usePredicates } from '../../hooks';

interface EdgeEditorProps {
  edge: Edge;
  videoId: string;
  onSave: (changes: {
    predicate?: string;
    time_periods?: TimePeriod[];
    attributes?: MotionAttributes;
  }) => void;
  onCancel: () => void;
}

const VELOCITY_VALUES = ['stationary', 'very_slow', 'slow', 'moderate', 'fast', 'very_fast'];
const DIRECTION_VALUES = ['none', 'up', 'down', 'left', 'right', 'forward', 'backward', 'toward_body', 'away_from_body', 'inward', 'outward', 'rotational'];
const TRAJECTORY_VALUES = ['stable', 'straight', 'curved', 'arc', 'circular', 'zigzag', 'oscillating', 'irregular'];

export function EdgeEditor({ edge, videoId, onSave, onCancel }: EdgeEditorProps) {
  const [predicate, setPredicate] = useState(edge.predicate);
  const [segments, setSegments] = useState<TimePeriod[]>([]);
  const [velocity, setVelocity] = useState(edge.attributes?.velocity || 'moderate');
  const [direction, setDirection] = useState(edge.attributes?.direction || 'none');
  const [trajectory, setTrajectory] = useState(edge.attributes?.trajectory || 'curved');

  const normalizeSegments = (list: TimePeriod[]) => {
    const safe = list.length > 0 ? list : [edge.time_period];
    return [...safe]
      .map((seg) => ({
        start_frame: seg.start_frame,
        end_frame: seg.end_frame,
      }))
      .sort((a, b) => a.start_frame - b.start_frame);
  };

  // Sync local state when edge prop changes (fixes stale state after modifications)
  useEffect(() => {
    setPredicate(edge.predicate);
    const initialSegments = edge.time_periods && edge.time_periods.length > 0
      ? edge.time_periods
      : [edge.time_period];
    setSegments(normalizeSegments(initialSegments));
    setVelocity(edge.attributes?.velocity || 'moderate');
    setDirection(edge.attributes?.direction || 'none');
    setTrajectory(edge.attributes?.trajectory || 'curved');
  }, [edge.edge_id, edge.predicate, edge.time_period.start_frame, edge.time_period.end_frame,
      edge.time_periods,
      edge.attributes?.velocity, edge.attributes?.direction, edge.attributes?.trajectory]);

  const { data: predicatesData } = usePredicates(videoId, edge.edge_type);
  const predicates = predicatesData?.predicates || [];

  const handleSave = () => {
    const changes: {
      predicate?: string;
      time_periods?: TimePeriod[];
      attributes?: MotionAttributes;
    } = {};

    if (predicate !== edge.predicate) {
      changes.predicate = predicate;
    }

    const normalizedSegments = normalizeSegments(segments);
    const originalSegments = normalizeSegments(
      edge.time_periods && edge.time_periods.length > 0
        ? edge.time_periods
        : [edge.time_period]
    );
    if (JSON.stringify(normalizedSegments) !== JSON.stringify(originalSegments)) {
      changes.time_periods = normalizedSegments;
    }

    if (edge.edge_type === 'dynamic') {
      const origAttrs = edge.attributes || { velocity: 'moderate', direction: 'none', trajectory: 'curved' };
      if (velocity !== origAttrs.velocity || direction !== origAttrs.direction || trajectory !== origAttrs.trajectory) {
        changes.attributes = { velocity, direction, trajectory };
      }
    }

    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }

    onSave(changes);
  };

  const updateSegment = (index: number, updates: Partial<TimePeriod>) => {
    setSegments((prev) => {
      const next = prev.map((seg, i) => {
        if (i !== index) return seg;
        const updated = { ...seg, ...updates };
        if (updated.end_frame < updated.start_frame) {
          if (updates.start_frame !== undefined) {
            updated.end_frame = updated.start_frame;
          } else {
            updated.start_frame = updated.end_frame;
          }
        }
        return updated;
      });
      return next;
    });
  };

  const addSegment = () => {
    setSegments((prev) => {
      const last = prev[prev.length - 1];
      const start = last ? last.end_frame + 1 : 0;
      return [...prev, { start_frame: start, end_frame: start }];
    });
  };

  const removeSegment = (index: number) => {
    setSegments((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  return (
    <div className="space-y-4">
      {/* Predicate */}
      <div>
        <label className="text-gray-400 text-xs uppercase block mb-1">Predicate</label>
        <select
          value={predicate}
          onChange={(e) => setPredicate(e.target.value)}
          className="w-full bg-gray-700 text-white rounded p-2 text-sm"
        >
          {predicates.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {!predicates.includes(predicate) && (
            <option value={predicate}>{predicate}</option>
          )}
        </select>
      </div>

      {/* Time period */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-gray-400 text-xs uppercase">Time Periods</label>
          <button
            type="button"
            onClick={addSegment}
            className="text-xs text-blue-300 hover:text-blue-200"
          >
            + Add Segment
          </button>
        </div>
        {segments.map((segment, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div>
              <label className="text-gray-400 text-xs uppercase block mb-1">Start</label>
              <input
                type="number"
                value={segment.start_frame}
                onChange={(e) => updateSegment(index, { start_frame: Number(e.target.value) })}
                min={0}
                className="w-full bg-gray-700 text-white rounded p-2 text-sm"
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs uppercase block mb-1">End</label>
              <input
                type="number"
                value={segment.end_frame}
                onChange={(e) => updateSegment(index, { end_frame: Number(e.target.value) })}
                min={segment.start_frame}
                className="w-full bg-gray-700 text-white rounded p-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => removeSegment(index)}
              disabled={segments.length <= 1}
              className="h-9 px-2 rounded bg-gray-600 text-gray-200 hover:bg-gray-500 disabled:opacity-40"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Motion attributes (for dynamic edges) */}
      {edge.edge_type === 'dynamic' && (
        <div className="space-y-2">
          <div className="text-gray-400 text-xs uppercase">Motion Attributes</div>

          <div>
            <label className="text-gray-500 text-xs block mb-1">Velocity</label>
            <select
              value={velocity}
              onChange={(e) => setVelocity(e.target.value)}
              className="w-full bg-gray-700 text-white rounded p-2 text-sm"
            >
              {VELOCITY_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-gray-500 text-xs block mb-1">Direction</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="w-full bg-gray-700 text-white rounded p-2 text-sm"
            >
              {DIRECTION_VALUES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-gray-500 text-xs block mb-1">Trajectory</label>
            <select
              value={trajectory}
              onChange={(e) => setTrajectory(e.target.value)}
              className="w-full bg-gray-700 text-white rounded p-2 text-sm"
            >
              {TRAJECTORY_VALUES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-semibold"
        >
          Save Changes
        </button>
        <button
          onClick={onCancel}
          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
