import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import type { Edge, MotionAttributes, TimePeriod } from '../../types';
import { usePredicates } from '../../hooks';
import { useAIEdgeSuggestions } from '../../hooks/useAI';
import { useAppStore } from '../../store';
import type { EdgeSuggestionResponse } from '../../services/ai';
import { EdgeAIDebugModal } from './EdgeAIDebugModal';

interface EdgeEditorProps {
  edge: Edge;
  videoId: string;
  onSave: (changes: {
    predicate?: string;
    time_periods?: TimePeriod[];
    attributes?: MotionAttributes;
  }) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onCancel: () => void;
  isSaving?: boolean;
  isDeleting?: boolean;
  saveError?: string | null;
}

const VELOCITY_VALUES = ['stationary', 'very_slow', 'slow', 'moderate', 'fast', 'very_fast'];
const DIRECTION_VALUES = ['none', 'up', 'down', 'left', 'right', 'forward', 'backward', 'toward_body', 'away_from_body', 'inward', 'outward', 'rotational'];
const TRAJECTORY_VALUES = ['stable', 'straight', 'curved', 'arc', 'circular', 'zigzag', 'oscillating', 'irregular'];

export function EdgeEditor({
  edge,
  videoId,
  onSave,
  onDelete,
  onCancel,
  isSaving = false,
  isDeleting = false,
  saveError = null,
}: EdgeEditorProps) {
  const [predicate, setPredicate] = useState(edge.predicate);
  const [segments, setSegments] = useState<TimePeriod[]>([]);
  const [velocity, setVelocity] = useState(edge.attributes?.velocity || 'moderate');
  const [direction, setDirection] = useState(edge.attributes?.direction || 'none');
  const [trajectory, setTrajectory] = useState(edge.attributes?.trajectory || 'curved');
  const [aiFrame, setAiFrame] = useState(0);
  const [aiSuggestion, setAiSuggestion] = useState<EdgeSuggestionResponse | null>(null);
  const [debugMode, setDebugMode] = useState(true);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  // Tracks whether the user has actually modified a field in this panel
  // since the last reset/save. While false, any prop-level change to the
  // edge (e.g. EdgeTimeline drag, edges query refetch) is synced into
  // local state so "Save" reflects the current server view. Once the
  // user starts typing we stop syncing, so their in-flight edits are
  // never silently overwritten by a background update.
  const [userTouched, setUserTouched] = useState(false);

  const aiProvider = useAppStore((state) => state.aiProvider);
  const currentFrame = useAppStore((state) => state.currentFrame);
  const setPendingEdgeEdit = useAppStore((state) => state.setPendingEdgeEdit);
  const aiMutation = useAIEdgeSuggestions();
  const abortRef = useRef<AbortController | null>(null);

  const normalizeSegments = (list: TimePeriod[]) => {
    const safe = list.length > 0 ? list : [edge.time_period];
    return [...safe]
      .map((seg) => ({
        start_frame: seg.start_frame,
        end_frame: seg.end_frame,
      }))
      .sort((a, b) => a.start_frame - b.start_frame);
  };

  const syncLocalStateFromEdge = () => {
    setPredicate(edge.predicate);
    const initialSegments = edge.time_periods && edge.time_periods.length > 0
      ? edge.time_periods
      : [edge.time_period];
    setSegments(normalizeSegments(initialSegments));
    setVelocity(edge.attributes?.velocity || 'moderate');
    setDirection(edge.attributes?.direction || 'none');
    setTrajectory(edge.attributes?.trajectory || 'curved');
  };

  // On edge switch: fully reset local state and clear the touched flag.
  useEffect(() => {
    syncLocalStateFromEdge();
    setAiSuggestion(null);
    setUserTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edge.edge_id]);

  // On same-edge prop updates (EdgeTimeline drag, query refetch, store
  // optimistic update): pull the new values into local state only while
  // the user hasn't started editing. This is what lets a drag-then-Save
  // work — otherwise the untouched local "segments" would still hold the
  // pre-drag values and Save would commit them, reverting the drag.
  useEffect(() => {
    if (userTouched) return;
    syncLocalStateFromEdge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    edge.predicate,
    edge.time_period.start_frame,
    edge.time_period.end_frame,
    edge.time_periods,
    edge.attributes?.velocity,
    edge.attributes?.direction,
    edge.attributes?.trajectory,
    userTouched,
  ]);

  useEffect(() => {
    setAiFrame(currentFrame);
  }, [edge.edge_id, currentFrame]);

  const { data: predicatesData } = usePredicates(videoId, edge.edge_type);
  const predicates = predicatesData?.predicates || [];
  const showSuggestionPanel = Boolean(aiSuggestion && !aiSuggestion.error);

  const handleGetAISuggestions = async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await aiMutation.mutateAsync({
        request: {
          video_id: videoId,
          edge_id: edge.edge_id,
          frame_idx: aiFrame,
          provider: aiProvider,
          debug: debugMode,
        },
        signal: controller.signal,
      });
      setAiSuggestion(result);
      if (debugMode) {
        setDebugInfo({
          request: {
            video_id: videoId,
            edge_id: edge.edge_id,
            edge_type: edge.edge_type,
            frame_idx: aiFrame,
            provider: aiProvider,
            resolved_frame_idx: result.resolved_frame_idx,
            context_frames: result.context_frames,
          },
          context_images: result.context_images,
          raw_request: result.raw_request,
          raw_response: result.raw_response,
          response_content: result.response_content,
          processed_suggestions: !result.error
            ? {
                predicate: result.predicate,
                confidence: result.confidence,
                attributes: result.attributes,
              }
            : undefined,
          error: result.error,
          debug_info: result.debug_info,
        });
        setShowDebugModal(true);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      if (debugMode) {
        setDebugInfo({
          request: {
            video_id: videoId,
            edge_id: edge.edge_id,
            edge_type: edge.edge_type,
            frame_idx: aiFrame,
            provider: aiProvider,
          },
          error: String(error),
        });
        setShowDebugModal(true);
      }
      alert(`Failed to get edge AI suggestions: ${error}`);
    }
  };

  const applyAISuggestion = (attribute: 'predicate' | 'velocity' | 'direction' | 'trajectory', value: string) => {
    setUserTouched(true);
    if (attribute === 'predicate') {
      setPredicate(value);
      return;
    }
    if (attribute === 'velocity') {
      setVelocity(value);
      return;
    }
    if (attribute === 'direction') {
      setDirection(value);
      return;
    }
    setTrajectory(value);
  };

  const handleCancelAISuggestionRequest = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  const handleDismissSuggestions = () => {
    setAiSuggestion(null);
  };

  const computeChanges = (): {
    predicate?: string;
    time_periods?: TimePeriod[];
    attributes?: MotionAttributes;
  } => {
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

    return changes;
  };

  const handleSave = async (): Promise<void> => {
    if (isSaving) {
      return;
    }
    await Promise.resolve(onSave(computeChanges()));
    // After a successful save, local state matches the server; clearing
    // touched lets subsequent drag/refetch updates sync again.
    setUserTouched(false);
  };

  const isDirty = useMemo(() => {
    const changes = computeChanges();
    return (
      changes.predicate !== undefined ||
      changes.time_periods !== undefined ||
      changes.attributes !== undefined
    );
    // computeChanges is stable within a render; deps track every input it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predicate, segments, velocity, direction, trajectory, edge]);

  // Expose the current edit to the top-row SaveButton via the store so
  // clicking either Save persists the same in-flight changes. The ref
  // lets the commit closure always invoke the latest handleSave.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    // Only register a pending edit when the user has actually edited a
    // field AND the local state still differs from the edge prop. This
    // prevents a transient dirty window (where a drag updated the edge
    // prop but the sync effect hasn't caught up yet) from surfacing as
    // a pending commit — which previously caused top-row Save to revert
    // the drag.
    if (userTouched && isDirty) {
      setPendingEdgeEdit({
        edgeId: edge.edge_id,
        commit: () => handleSaveRef.current(),
      });
    } else {
      setPendingEdgeEdit(null);
    }
  }, [userTouched, isDirty, edge.edge_id, setPendingEdgeEdit]);

  useEffect(
    () => () => {
      setPendingEdgeEdit(null);
    },
    [setPendingEdgeEdit]
  );

  const updateSegment = (index: number, updates: Partial<TimePeriod>) => {
    setUserTouched(true);
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
    setUserTouched(true);
    setSegments((prev) => {
      const last = prev[prev.length - 1];
      const start = last ? last.end_frame + 1 : 0;
      return [...prev, { start_frame: start, end_frame: start }];
    });
  };

  const removeSegment = (index: number) => {
    setUserTouched(true);
    setSegments((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  return (
    <>
      <EdgeAIDebugModal
        isOpen={showDebugModal}
        onClose={() => setShowDebugModal(false)}
        debugInfo={debugInfo}
      />

      <div className="space-y-4">
      {/* Predicate */}
      <div>
        <label className="text-gray-400 text-xs uppercase block mb-1">Predicate</label>
        <select
          value={predicate}
          onChange={(e) => {
            setUserTouched(true);
            setPredicate(e.target.value);
          }}
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

      {/* AI Suggestions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => setDebugMode(e.target.checked)}
              className="rounded"
            />
            Debug Mode
          </label>
          {debugInfo && (
            <button
              onClick={() => setShowDebugModal(true)}
              className="text-xs text-purple-400 hover:text-purple-300"
            >
              View Last Debug Info
            </button>
          )}
        </div>

        <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-gray-500 text-xs block mb-1">Center Frame</label>
                <input
                  type="number"
                  min={0}
                  value={aiFrame}
                  onChange={(e) => setAiFrame(Number(e.target.value))}
                  className="w-full bg-gray-700 text-white rounded p-2 text-sm"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setAiFrame(currentFrame)}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded text-sm"
                >
                  Use Current Frame ({currentFrame})
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGetAISuggestions}
              disabled={aiMutation.isPending}
              className="mt-2 w-full bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {aiMutation.isPending ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Getting AI Suggestions...
                </>
              ) : (
                <>
                  <span className="text-lg">✨</span>
                  Get AI Suggestions
                </>
              )}
            </button>
            {aiMutation.isPending && (
              <button
                type="button"
                onClick={handleCancelAISuggestionRequest}
                className="mt-2 w-full bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg transition-colors"
              >
                Cancel AI Request
              </button>
            )}

            <div className="mt-2 text-xs text-gray-400">
              Using AI model: {aiProvider} (configured default). Please review suggestions before saving.
            </div>
            <div className="mt-2 text-xs text-gray-400">
              {edge.edge_type === 'static'
                ? 'Static edge timeline is fixed to full video.'
                : edge.edge_type === 'fg_bg'
                ? 'Foreground-background edge timeline is fixed to full video.'
                : 'Dynamic edge timeline is clamped to frames where both objects are visible.'}
            </div>
            <div className="text-xs text-gray-500">
              AI uses the selected center frame shown above.
            </div>

            {aiSuggestion?.error && (
              <div className="mt-2 text-xs text-red-400 bg-red-900/20 border border-red-700 rounded p-2">
                Error: {aiSuggestion.error}
              </div>
            )}

            <div className="mt-3 p-3 bg-gray-800/60 border border-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-200">
                  {showSuggestionPanel && aiSuggestion
                    ? `AI Suggestions (Confidence: ${(aiSuggestion.confidence * 100).toFixed(0)}%)`
                    : 'Original Only'}
                </span>
              </div>
              {showSuggestionPanel && (
                <div className="text-xs text-gray-400 mb-2">
                  Click an AI value to apply it. Edit original values directly in the middle column.
                </div>
              )}
              <div className={`grid ${showSuggestionPanel ? 'grid-cols-3' : 'grid-cols-2'} gap-2 text-xs`}>
                <div className="text-gray-500">Attribute</div>
                <div className="text-gray-400">Original</div>
                {showSuggestionPanel && <div className="text-purple-300">AI</div>}
                {[
                  {
                    label: 'predicate',
                    value: predicate,
                    setValue: setPredicate,
                    options: predicates,
                    ai: aiSuggestion?.predicate,
                  },
                  ...(edge.edge_type === 'dynamic'
                    ? [
                        {
                          label: 'velocity',
                          value: velocity,
                          setValue: setVelocity,
                          options: VELOCITY_VALUES,
                          ai: aiSuggestion?.attributes?.velocity,
                        },
                        {
                          label: 'direction',
                          value: direction,
                          setValue: setDirection,
                          options: DIRECTION_VALUES,
                          ai: aiSuggestion?.attributes?.direction,
                        },
                        {
                          label: 'trajectory',
                          value: trajectory,
                          setValue: setTrajectory,
                          options: TRAJECTORY_VALUES,
                          ai: aiSuggestion?.attributes?.trajectory,
                        },
                      ]
                    : []),
                ].map((row) => {
                  const hasAi = Boolean(showSuggestionPanel && row.ai);
                  const different = hasAi ? row.value !== row.ai : false;
                  return (
                    <Fragment key={row.label}>
                      <div className="text-gray-500">{row.label}</div>
                      <div>
                        <select
                          value={row.value}
                          onChange={(e) => {
                            setUserTouched(true);
                            row.setValue(e.target.value);
                          }}
                          className="w-full bg-gray-700 text-white rounded p-1.5 text-sm"
                        >
                          {row.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                          {!row.options.includes(row.value) && (
                            <option value={row.value}>{row.value}</option>
                          )}
                        </select>
                      </div>
                      {hasAi && (
                        <button
                          type="button"
                          onClick={() => applyAISuggestion(row.label as 'predicate' | 'velocity' | 'direction' | 'trajectory', row.ai as string)}
                          className={different
                            ? 'text-purple-200 bg-purple-900/30 rounded px-2 py-1 text-left'
                            : 'text-gray-400 px-2 py-1 text-left'}
                          title="Click to apply AI value"
                        >
                          {row.ai}
                        </button>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </div>

            {showSuggestionPanel && aiSuggestion && (
              <div className="mt-2 text-xs text-gray-400">
                AI frame: {aiSuggestion.resolved_frame_idx ?? aiFrame}
                {aiSuggestion.context_frames?.length
                  ? ` | Context: ${aiSuggestion.context_frames.join(', ')}`
                  : ''}
              </div>
            )}
        </>
      </div>

      {/* Action buttons */}
      {saveError && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-700 rounded p-2">
          Save failed: {saveError}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => {
            // Swallow rejection: EdgeReview already surfaces the error
            // via the saveError banner.
            handleSave().catch(() => {});
          }}
          disabled={isSaving || isDeleting}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white py-2 rounded font-semibold"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {aiSuggestion && (
          <button
            type="button"
            onClick={handleDismissSuggestions}
            disabled={isSaving || isDeleting}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded font-semibold"
          >
            Dismiss AI Suggestions
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={isSaving || isDeleting}
          className="px-3 py-2 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 rounded font-semibold transition-colors"
          title="Permanently delete this edge"
        >
          {isDeleting ? 'Deleting...' : 'Delete'}
        </button>
        <button
          onClick={onCancel}
          disabled={isSaving || isDeleting}
          className="flex-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-800 text-white py-2 rounded font-semibold"
        >
          Cancel
        </button>
      </div>
      </div>
    </>
  );
}
