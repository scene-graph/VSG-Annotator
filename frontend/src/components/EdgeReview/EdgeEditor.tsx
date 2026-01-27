import { useState, useEffect } from 'react';
import type { Edge, MotionAttributes, TimePeriod } from '../../types';
import { usePredicates } from '../../hooks';

interface EdgeEditorProps {
  edge: Edge;
  videoId: string;
  onSave: (changes: {
    predicate?: string;
    time_period?: TimePeriod;
    attributes?: MotionAttributes;
  }) => void;
  onCancel: () => void;
}

const VELOCITY_VALUES = ['stationary', 'very_slow', 'slow', 'moderate', 'fast', 'very_fast'];
const DIRECTION_VALUES = ['none', 'up', 'down', 'left', 'right', 'forward', 'backward', 'toward_body', 'away_from_body', 'inward', 'outward', 'rotational'];
const TRAJECTORY_VALUES = ['stable', 'straight', 'curved', 'arc', 'circular', 'zigzag', 'oscillating', 'irregular'];

export function EdgeEditor({ edge, videoId, onSave, onCancel }: EdgeEditorProps) {
  const [predicate, setPredicate] = useState(edge.predicate);
  const [startFrame, setStartFrame] = useState(edge.time_period.start_frame);
  const [endFrame, setEndFrame] = useState(edge.time_period.end_frame);
  const [velocity, setVelocity] = useState(edge.attributes?.velocity || 'moderate');
  const [direction, setDirection] = useState(edge.attributes?.direction || 'none');
  const [trajectory, setTrajectory] = useState(edge.attributes?.trajectory || 'curved');

  const { data: predicatesData } = usePredicates(videoId, edge.edge_type);
  const predicates = predicatesData?.predicates || [];

  const handleSave = () => {
    const changes: {
      predicate?: string;
      time_period?: TimePeriod;
      attributes?: MotionAttributes;
    } = {};

    if (predicate !== edge.predicate) {
      changes.predicate = predicate;
    }

    if (startFrame !== edge.time_period.start_frame || endFrame !== edge.time_period.end_frame) {
      changes.time_period = { start_frame: startFrame, end_frame: endFrame };
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-gray-400 text-xs uppercase block mb-1">Start Frame</label>
          <input
            type="number"
            value={startFrame}
            onChange={(e) => setStartFrame(Number(e.target.value))}
            min={0}
            className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          />
        </div>
        <div>
          <label className="text-gray-400 text-xs uppercase block mb-1">End Frame</label>
          <input
            type="number"
            value={endFrame}
            onChange={(e) => setEndFrame(Number(e.target.value))}
            min={startFrame}
            className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          />
        </div>
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
