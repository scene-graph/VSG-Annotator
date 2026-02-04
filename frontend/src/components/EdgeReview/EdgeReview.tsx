import { useState } from 'react';
import type { Edge, MotionAttributes, TimePeriod } from '../../types';
import { useAppStore, useCurrentUser, useSelectedEdge, useNodes } from '../../store';
import { useAcceptEdge, useRejectEdge, useModifyEdge, useEdgeHistory } from '../../hooks';
import { EdgeEditor } from './EdgeEditor';
import { ValidationReasoning } from './ValidationReasoning';
import { RevisionHistory } from './RevisionHistory';
import clsx from 'clsx';

interface EdgeReviewProps {
  videoId: string;
}

export function EdgeReview({ videoId }: EdgeReviewProps) {
  const selectedEdge = useSelectedEdge();
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);
  const setEdges = useAppStore((state) => state.setEdges);
  const currentUser = useCurrentUser();
  const showValidationReasoning = useAppStore((state) => state.showValidationReasoning);
  const setShowValidationReasoning = useAppStore((state) => state.setShowValidationReasoning);
  const nodes = useNodes();
  const setSelectedNode = useAppStore((state) => state.setSelectedNode);

  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notes, setNotes] = useState('');

  const acceptMutation = useAcceptEdge();
  const rejectMutation = useRejectEdge();
  const modifyMutation = useModifyEdge();

  const { data: history } = useEdgeHistory(
    videoId,
    selectedEdge?.edge_id
  );

  if (!selectedEdge) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <p className="text-gray-400">Select an edge to review</p>
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

  const handleNodeClick = (nodeId: string) => {
    const node = nodes.find(n => n.node_id === nodeId);
    if (node) {
      setSelectedNode(node);
    }
  };

  const handleAccept = async () => {
    if (!currentUser) {
      alert('Please select a user first');
      return;
    }

    await acceptMutation.mutateAsync({
      video_id: videoId,
      edge_id: selectedEdge.edge_id,
      edge_type: selectedEdge.edge_type,
      user_id: currentUser.id,
      notes: notes || undefined,
    });

    // Update selected edge to reflect accept action immediately
    const updatedEdge: Edge = {
      ...selectedEdge,
      has_revision: true,
      revision_action: 'accept',
    };
    setSelectedEdge(updatedEdge);

    // Also update the edges array so EdgeTimeline reflects changes immediately
    const currentEdges = useAppStore.getState().edges;
    const updatedEdges = currentEdges.map(e =>
      e.edge_id === selectedEdge.edge_id ? updatedEdge : e
    );
    setEdges(updatedEdges);

    setNotes('');
  };

  const handleReject = async () => {
    if (!currentUser) {
      alert('Please select a user first');
      return;
    }

    await rejectMutation.mutateAsync({
      video_id: videoId,
      edge_id: selectedEdge.edge_id,
      edge_type: selectedEdge.edge_type,
      user_id: currentUser.id,
      notes: notes || undefined,
    });

    // Update selected edge to reflect reject action immediately
    const updatedEdge: Edge = {
      ...selectedEdge,
      has_revision: true,
      revision_action: 'reject',
    };
    setSelectedEdge(updatedEdge);

    // Also update the edges array so EdgeTimeline reflects changes immediately
    const currentEdges = useAppStore.getState().edges;
    const updatedEdges = currentEdges.map(e =>
      e.edge_id === selectedEdge.edge_id ? updatedEdge : e
    );
    setEdges(updatedEdges);

    setNotes('');
  };

  const handleModify = async (changes: {
    predicate?: string;
    time_period?: TimePeriod;
    attributes?: MotionAttributes;
  }) => {
    if (!currentUser) {
      alert('Please select a user first');
      return;
    }

    await modifyMutation.mutateAsync({
      video_id: videoId,
      edge_id: selectedEdge.edge_id,
      edge_type: selectedEdge.edge_type,
      user_id: currentUser.id,
      new_predicate: changes.predicate,
      new_time_period: changes.time_period,
      new_attributes: changes.attributes,
      notes: notes || undefined,
    });

    // Update the selected edge in store with the new values so UI reflects changes immediately
    const updatedEdge: Edge = {
      ...selectedEdge,
      predicate: changes.predicate ?? selectedEdge.predicate,
      time_period: changes.time_period ?? selectedEdge.time_period,
      attributes: changes.attributes ?? selectedEdge.attributes,
      has_revision: true,
      revision_action: 'modify',
    };
    setSelectedEdge(updatedEdge);

    // Also update the edges array so EdgeTimeline reflects changes immediately
    const currentEdges = useAppStore.getState().edges;
    const updatedEdges = currentEdges.map(e =>
      e.edge_id === selectedEdge.edge_id ? updatedEdge : e
    );
    setEdges(updatedEdges);

    setIsEditing(false);
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
                {sourceCategories.map((cat, i) => (
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
                  </span>
                ))}
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
                {targetCategories.map((cat, i) => (
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
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Time period */}
        <div className="bg-gray-700 rounded p-3">
          <div className="text-gray-400 text-xs uppercase mb-1">Time Period</div>
          <div className="text-white">
            Frame {selectedEdge.time_period.start_frame} - {selectedEdge.time_period.end_frame}
            <span className="text-gray-400 ml-2">
              ({selectedEdge.time_period.end_frame - selectedEdge.time_period.start_frame + 1} frames)
            </span>
          </div>
        </div>

        {/* Motion attributes (for dynamic edges) */}
        {selectedEdge.attributes && (
          <div className="bg-gray-700 rounded p-3">
            <div className="text-gray-400 text-xs uppercase mb-2">Motion Attributes</div>
            <div className="space-y-2">
              {/* Velocity Row */}
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Velocity</span>
                <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-sm">
                  {selectedEdge.attributes.velocity}
                </span>
              </div>
              {/* Direction Row */}
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Direction</span>
                <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-sm">
                  {selectedEdge.attributes.direction}
                </span>
              </div>
              {/* Trajectory Row */}
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Trajectory</span>
                <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 text-sm">
                  {selectedEdge.attributes.trajectory}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Confidence & validation */}
        <div className="bg-gray-700 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-gray-400 text-xs uppercase">Confidence</div>
            <div className="flex items-center gap-2">
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
        <label className="text-gray-400 text-xs uppercase block mb-1">Review Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes about this review..."
          className="w-full bg-gray-700 text-white rounded p-2 text-sm resize-none"
          rows={2}
        />
      </div>

      {/* Action buttons */}
      {isEditing ? (
        <EdgeEditor
          edge={selectedEdge}
          videoId={videoId}
          onSave={handleModify}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleAccept}
            disabled={acceptMutation.isPending}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white py-2 rounded font-semibold"
          >
            Accept
          </button>
          <button
            onClick={handleReject}
            disabled={rejectMutation.isPending}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white py-2 rounded font-semibold"
          >
            Reject
          </button>
          <button
            onClick={() => setIsEditing(true)}
            className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white py-2 rounded font-semibold"
          >
            Modify
          </button>
        </div>
      )}

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
