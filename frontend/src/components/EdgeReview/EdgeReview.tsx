import { useEffect, useMemo, useState } from 'react';
import type { Edge, MotionAttributes, TimePeriod } from '../../types';
import { useAppStore, useCurrentUser, useSelectedEdge, useNodes, useEdgeCreation } from '../../store';
import { getLargestBBoxFrame } from '../../utils/edgeFrame';
import { useAcceptEdge, useDeleteEdge, useEdgeHistory, useReextractJobs, useTriggerReextract } from '../../hooks';
import { EdgeEditor } from './EdgeEditor';
import { EdgeCreator } from './EdgeCreator';
import { ValidationReasoning } from './ValidationReasoning';
import { RevisionHistory } from './RevisionHistory';
import clsx from 'clsx';

interface EdgeReviewProps {
  videoId: string;
}

interface ReextractStatusPillProps {
  status: 'pending' | 'running' | 'done' | 'failed';
  prevType: string;
  newType: string;
  error?: string | null;
  onRetry: () => void;
}

// Pill showing the state of the latest Gemini reextraction job for the
// selected edge. "pending"/"running" indicate the backend is still
// working; "done"/"failed" reflect the terminal state of the latest job.
function ReextractStatusPill({ status, prevType, newType, error, onRetry }: ReextractStatusPillProps) {
  const typeFlow = prevType === newType ? '' : ` (${prevType}→${newType})`;
  if (status === 'pending' || status === 'running') {
    return (
      <span
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-200"
        title={`Gemini is re-extracting this edge${typeFlow}`}
      >
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {status === 'pending' ? 'queued' : 're-extracting'}
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span
        className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-green-300"
        title={`Re-extracted after node type flip${typeFlow}`}
      >
        re-extracted
      </span>
    );
  }
  // failed
  return (
    <span
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-300"
      title={error || 'Gemini re-extraction failed'}
    >
      re-extract failed
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRetry();
        }}
        className="underline hover:text-red-200"
      >
        retry
      </button>
    </span>
  );
}

export function EdgeReview({ videoId }: EdgeReviewProps) {
  const selectedEdge = useSelectedEdge();
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);
  const setEdges = useAppStore((state) => state.setEdges);
  const currentUser = useCurrentUser();
  const showValidationReasoning = useAppStore((state) => state.showValidationReasoning);
  const setShowValidationReasoning = useAppStore((state) => state.setShowValidationReasoning);
  const nodes = useNodes();
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const requestTrackletFocus = useAppStore((state) => state.requestTrackletFocus);

  // Edge creation state
  const edgeCreation = useEdgeCreation();
  const startEdgeCreation = useAppStore((state) => state.startEdgeCreation);
  const cancelEdgeCreation = useAppStore((state) => state.cancelEdgeCreation);

  const [showHistory, setShowHistory] = useState(false);
  const [showConfidence, setShowConfidence] = useState(false);
  const [showReviewNotes, setShowReviewNotes] = useState(false);
  const [isSavingEdge, setIsSavingEdge] = useState(false);
  const [edgeSaveError, setEdgeSaveError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const acceptMutation = useAcceptEdge();
  const deleteMutation = useDeleteEdge();

  const { data: history } = useEdgeHistory(
    videoId,
    selectedEdge?.edge_id
  );

  // Latest reextract job for this edge (for the header pill). These hooks
  // must sit above the early returns below — otherwise the hook count
  // changes between "no edge selected" and "edge selected" renders and
  // React throws "Rendered more hooks than during the previous render".
  const { data: allJobs } = useReextractJobs(videoId);
  const triggerReextract = useTriggerReextract();
  const latestJob = useMemo(() => {
    if (!allJobs || !selectedEdge) return undefined;
    return allJobs.find((j) => j.edge_id === selectedEdge.edge_id);
  }, [allJobs, selectedEdge?.edge_id]);

  // Reset panel UI state whenever a new edge is selected.
  useEffect(() => {
    if (selectedEdge) {
      setShowConfidence(false);
      setShowReviewNotes(false);
      setShowValidationReasoning(false);
      setEdgeSaveError(null);
    }
  }, [selectedEdge?.edge_id]);

  // Show EdgeCreator when in creation mode
  if (edgeCreation.isCreating) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full overflow-y-auto">
        <EdgeCreator videoId={videoId} onSuccess={cancelEdgeCreation} />
      </div>
    );
  }

  if (!selectedEdge) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">Select an edge to review</p>
        <button
          onClick={startEdgeCreation}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create New Edge
        </button>
      </div>
    );
  }

  const sources = Array.isArray(selectedEdge.source) ? selectedEdge.source : [selectedEdge.source];
  const targets = Array.isArray(selectedEdge.target) ? selectedEdge.target : [selectedEdge.target];
  const sourceCategories = Array.isArray(selectedEdge.source_category)
    ? selectedEdge.source_category
    : [selectedEdge.source_category];
  const targetCategories = Array.isArray(selectedEdge.target_category)
    ? selectedEdge.target_category
    : [selectedEdge.target_category];

  // node_id is immutable after a static/dynamic flip, so when a source/
  // target pill's id no longer matches its current type we render an
  // inline "(now static)" / "(now dynamic)" notice next to the id so the
  // reviewer can see the discrepancy at a glance.
  const getNodeTypeFlip = (nodeId: string): 'static' | 'dynamic' | null => {
    const node = nodes.find((n) => n.node_id === nodeId);
    if (!node) return null;
    if (node.original_is_static == null) return null;
    if (node.original_is_static === node.is_static) return null;
    return node.is_static ? 'static' : 'dynamic';
  };

  // Clicking a source/target pill jumps to that node's own best-bbox frame
  // while keeping the edge selected, so both subject (cyan) and target (magenta)
  // overlays remain colored by their edge roles. Also asks TrackletTimeline
  // to scroll that node into view so the user doesn't have to hunt for it.
  const handleNodeClick = (nodeId: string) => {
    const node = nodes.find(n => n.node_id === nodeId);
    if (!node) return;
    const frame = getLargestBBoxFrame(node);
    if (frame !== null) setCurrentFrame(frame);
    requestTrackletFocus(nodeId);
  };

  const mergeTimePeriods = (periods: TimePeriod[]) => {
    if (periods.length === 0) return { start_frame: 0, end_frame: 0 };
    return {
      start_frame: Math.min(...periods.map((p) => p.start_frame)),
      end_frame: Math.max(...periods.map((p) => p.end_frame)),
    };
  };

  const handleSaveAccept = async (changes: {
    predicate?: string;
    time_periods?: TimePeriod[];
    attributes?: MotionAttributes;
  }) => {
    if (!currentUser) {
      alert('Please select a user first');
      return;
    }
    if (isSavingEdge) {
      return;
    }

    // Every accept revision must snapshot the full effective state the
    // user is approving. The backend overlay only reads the latest
    // revision per edge, so an accept with null `new_*` fields masks
    // earlier modifies (e.g. an EdgeTimeline drag) and the next refetch
    // reverts to VSG. Falling back to `selectedEdge` — which already
    // reflects prior revisions via the overlay — keeps the drag's state
    // in the newly recorded accept.
    const effectivePeriods = changes.time_periods
      ?? (selectedEdge.time_periods && selectedEdge.time_periods.length > 0
        ? selectedEdge.time_periods
        : [selectedEdge.time_period]);
    const effectivePredicate = changes.predicate ?? selectedEdge.predicate;
    const effectiveAttributes = changes.attributes ?? selectedEdge.attributes;
    const mergedPeriod = mergeTimePeriods(effectivePeriods);

    setEdgeSaveError(null);
    setIsSavingEdge(true);
    try {
      await acceptMutation.mutateAsync({
        video_id: videoId,
        edge_id: selectedEdge.edge_id,
        edge_type: selectedEdge.edge_type,
        user_id: currentUser.id,
        new_predicate: effectivePredicate,
        new_time_periods: effectivePeriods,
        new_attributes: effectiveAttributes,
        notes: notes || undefined,
      });

      // Build and apply updated edge only after server confirms save+accept.
      const updatedEdge: Edge = {
        ...selectedEdge,
        predicate: effectivePredicate,
        time_period: mergedPeriod,
        time_periods: effectivePeriods,
        attributes: effectiveAttributes,
        has_revision: true,
        revision_action: 'accept',
      };

      setSelectedEdge(updatedEdge);
      const currentEdges = useAppStore.getState().edges;
      const updatedEdges = currentEdges.map(e =>
        e.edge_id === selectedEdge.edge_id ? updatedEdge : e
      );
      setEdges(updatedEdges);
      setNotes('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEdgeSaveError(message);
      // Re-throw so outer callers (e.g. the top-row SaveButton that
      // triggered a commit before its sync) can surface the failure
      // and skip the subsequent sync step.
      throw error;
    } finally {
      setIsSavingEdge(false);
    }
  };

  const handleDelete = async () => {
    if (!currentUser) {
      alert('Please select a user first');
      return;
    }

    if (!confirm('Are you sure you want to delete this edge? This action cannot be undone.')) {
      return;
    }

    await deleteMutation.mutateAsync({
      video_id: videoId,
      edge_id: selectedEdge.edge_id,
      edge_type: selectedEdge.edge_type,
      user_id: currentUser.id,
      review_notes: notes || undefined,
    });

    // Remove edge from store and clear selection
    const currentEdges = useAppStore.getState().edges;
    setEdges(currentEdges.filter(e => e.edge_id !== selectedEdge.edge_id));
    setSelectedEdge(null);
    setNotes('');
  };

  const edgeTypeColors = {
    static: 'bg-gray-500',
    dynamic: 'bg-orange-500',
    fg_bg: 'bg-purple-500',
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={clsx('px-2 py-1 rounded text-white text-sm', edgeTypeColors[selectedEdge.edge_type])}>
            {selectedEdge.edge_type}
          </span>
          <span className="text-white font-mono text-sm">{selectedEdge.edge_id}</span>
          {latestJob && (
            <ReextractStatusPill
              status={latestJob.status}
              prevType={latestJob.prev_edge_type}
              newType={latestJob.new_edge_type}
              error={latestJob.error}
              onRetry={() => triggerReextract.mutate({ videoId, edgeId: selectedEdge.edge_id })}
            />
          )}
        </div>
        <button
          onClick={() => setSelectedEdge(null)}
          className="text-gray-400 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Edge info */}
      <div className="space-y-4 mb-6">
        {/* Source/Target/Predicate */}
        <div className="bg-gray-700 rounded p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1">
              <div className="text-xs uppercase mb-1" style={{ color: '#00d4ff' }}>Source</div>
              <div className="text-white text-sm">
                {sourceCategories.map((cat, i) => {
                  const flip = getNodeTypeFlip(sources[i]);
                  return (
                    <span
                      key={sources[i]}
                      onClick={() => handleNodeClick(sources[i])}
                      className="inline-block px-2 py-1 rounded mr-1 mb-1 border cursor-pointer hover:opacity-80 transition-opacity"
                      style={{
                        backgroundColor: 'rgba(0, 212, 255, 0.15)',
                        borderColor: '#00d4ff',
                      }}
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#00d4ff' }} />
                      {cat} <span className="text-gray-400">({sources[i]})</span>
                      {flip && (
                        <span
                          className="ml-1.5 px-1 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-300 align-middle"
                          title={`node_id is kept immutable; this node is now ${flip}.`}
                        >
                          now {flip}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="text-orange-400 font-semibold px-3 text-center">
              <svg className="w-5 h-5 mx-auto mb-1 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {selectedEdge.predicate}
            </div>
            <div className="flex-1 text-right">
              <div className="text-xs uppercase mb-1" style={{ color: '#ff00d4' }}>Target</div>
              <div className="text-white text-sm">
                {targetCategories.map((cat, i) => {
                  const flip = getNodeTypeFlip(targets[i]);
                  return (
                    <span
                      key={targets[i]}
                      onClick={() => handleNodeClick(targets[i])}
                      className="inline-block px-2 py-1 rounded mr-1 mb-1 border cursor-pointer hover:opacity-80 transition-opacity"
                      style={{
                        backgroundColor: 'rgba(255, 0, 212, 0.15)',
                        borderColor: '#ff00d4',
                      }}
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#ff00d4' }} />
                      {cat} <span className="text-gray-400">({targets[i]})</span>
                      {flip && (
                        <span
                          className="ml-1.5 px-1 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-300 align-middle"
                          title={`node_id is kept immutable; this node is now ${flip}.`}
                        >
                          now {flip}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Time period */}
        <div className="bg-gray-700 rounded p-3">
          <div className="text-gray-400 text-xs uppercase mb-1">Time Period</div>
          <div className="text-white">
            {(selectedEdge.time_periods && selectedEdge.time_periods.length > 0
              ? selectedEdge.time_periods
              : [selectedEdge.time_period]
            ).map((tp, idx) => (
              <span key={`${tp.start_frame}-${tp.end_frame}-${idx}`} className="inline-block mr-2">
                Frame {tp.start_frame} - {tp.end_frame}
                <span className="text-gray-400 ml-1">
                  ({tp.end_frame - tp.start_frame + 1} frames)
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Confidence & validation */}
        <div className="bg-gray-700 rounded overflow-hidden">
          <button
            onClick={() => setShowConfidence(!showConfidence)}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-600 transition-colors"
          >
            <span className="text-gray-400 text-xs uppercase">Confidence</span>
            <svg
              className={clsx('w-4 h-4 text-gray-400 transition-transform', showConfidence && 'rotate-180')}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showConfidence && (
            <div className="px-3 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={clsx(
                  'px-2 py-0.5 rounded text-xs',
                  selectedEdge.validated ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                )}>
                  {selectedEdge.validated ? 'Validated' : 'Not Validated'}
                </span>
                <span className={clsx(
                  'px-2 py-0.5 rounded text-xs',
                  selectedEdge.extraction_round === 0 ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'
                )}>
                  {selectedEdge.extraction_round === 0 ? 'PVSG GT' : 'GPT Extracted'}
                </span>
              </div>
              <div className="flex gap-4">
                <div>
                  <span className="text-gray-400 text-xs">Overall:</span>
                  <span className="text-white ml-1 font-mono">{selectedEdge.confidence.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-400 text-xs">Round 1:</span>
                  <span className="text-white ml-1 font-mono">{selectedEdge.confidence_round1.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-400 text-xs">Round 2:</span>
                  <span className="text-white ml-1 font-mono">{selectedEdge.confidence_round2.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Validation Reasoning */}
        <ValidationReasoning
          round1={selectedEdge.validation_reasoning_round1}
          round2={selectedEdge.validation_reasoning_round2}
          isOpen={showValidationReasoning}
          onToggle={() => setShowValidationReasoning(!showValidationReasoning)}
        />

        {/* Revision status */}
        {selectedEdge.has_revision && (
          <div className={clsx(
            'rounded p-3',
            selectedEdge.revision_action === 'accept' && 'bg-green-500/20 border border-green-500',
            selectedEdge.revision_action === 'reject' && 'bg-red-500/20 border border-red-500',
            selectedEdge.revision_action === 'modify' && 'bg-yellow-500/20 border border-yellow-500'
          )}>
            <div className="text-white text-sm">
              This edge has been <span className="font-semibold">{selectedEdge.revision_action}ed</span>
            </div>
          </div>
        )}
      </div>

      {/* Notes input */}
      <div className="mb-4">
        <div className="bg-gray-700 rounded overflow-hidden">
          <button
            onClick={() => setShowReviewNotes(!showReviewNotes)}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-600 transition-colors"
          >
            <span className="text-gray-400 text-xs uppercase">Review Notes</span>
            <svg
              className={clsx('w-4 h-4 text-gray-400 transition-transform', showReviewNotes && 'rotate-180')}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showReviewNotes && (
            <div className="px-3 pb-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this review..."
                className="w-full bg-gray-700 text-white rounded p-2 text-sm resize-none border border-gray-600"
                rows={2}
              />
            </div>
          )}
        </div>
      </div>

      {/* Single-layer editing: Save both updates and accepts */}
      <EdgeEditor
        edge={selectedEdge}
        videoId={videoId}
        onSave={handleSaveAccept}
        onDelete={handleDelete}
        onCancel={() => {
          setEdgeSaveError(null);
          setSelectedEdge(null);
        }}
        isSaving={isSavingEdge}
        isDeleting={deleteMutation.isPending}
        saveError={edgeSaveError}
      />

      {/* History toggle */}
      <div className="mt-4">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
        >
          <svg
            className={clsx('w-4 h-4 transition-transform', showHistory && 'rotate-90')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Revision History ({history?.length || 0})
        </button>
        {showHistory && history && <RevisionHistory revisions={history} />}
      </div>
    </div>
  );
}
