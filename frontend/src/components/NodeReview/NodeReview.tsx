import { useMemo, useState, useEffect } from 'react';
import type { Node, Edge, NodeVisualAttributes, NodePhysicalAttributes } from '../../types';
import { useAppStore, useSelectedNode, useEdges, useCurrentUser, useNodes, useAiSuggestionFrameByNode, useAiSuggestionStatusByNode } from '../../store';
import { useModifyNode } from '../../hooks/useVideo';
import { NodeEditor } from './NodeEditor';
import clsx from 'clsx';

interface NodeReviewProps {
  videoId: string;
}

// Get tracklet range from node's bboxes_by_frame
function getTrackletRange(node: Node): { start: number; end: number } {
  const frames = Object.keys(node.bboxes_by_frame).map(Number);
  if (frames.length === 0) {
    return { start: 0, end: 0 };
  }
  return {
    start: Math.min(...frames),
    end: Math.max(...frames),
  };
}

// Color scheme matching tracklet timeline
const COLORS = {
  static: '#6b7280',   // Gray for static nodes
  dynamic: '#f97316',  // Orange for dynamic nodes
  selected: '#22c55e', // Green for selected
};

export function NodeReview({ videoId }: NodeReviewProps) {
  const selectedNode = useSelectedNode();
  const setSelectedNode = useAppStore((state) => state.setSelectedNode);
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const edges = useEdges();
  const nodes = useNodes();
  const setNodes = useAppStore((state) => state.setNodes);
  const currentUser = useCurrentUser();
  const currentFrame = useAppStore((state) => state.currentFrame);
  const aiSuggestionFrameByNode = useAiSuggestionFrameByNode();
  const aiSuggestionStatusByNode = useAiSuggestionStatusByNode();

  const [isEditing, setIsEditing] = useState(true);
  const modifyMutation = useModifyNode();

  // Find related edges where this node is source OR target
  const relatedEdges = useMemo(() => {
    if (!selectedNode) return [];

    return edges.filter((edge) => {
      const sources = Array.isArray(edge.source) ? edge.source : [edge.source];
      const targets = Array.isArray(edge.target) ? edge.target : [edge.target];
      return sources.includes(selectedNode.node_id) || targets.includes(selectedNode.node_id);
    });
  }, [selectedNode, edges]);

  const [lastAutoJumpNodeId, setLastAutoJumpNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedNode) return;
    const selectedFrame = aiSuggestionFrameByNode[selectedNode.node_id];
    if (selectedFrame !== undefined && lastAutoJumpNodeId !== selectedNode.node_id) {
      setCurrentFrame(selectedFrame);
      setLastAutoJumpNodeId(selectedNode.node_id);
    }
  }, [selectedNode, aiSuggestionFrameByNode, lastAutoJumpNodeId, setCurrentFrame]);

  useEffect(() => {
    if (selectedNode) {
      setIsEditing(true);
    }
  }, [selectedNode]);

  // Handle saving node attribute changes
  const handleSaveChanges = async (changes: {
    visual?: NodeVisualAttributes;
    physical?: NodePhysicalAttributes;
    is_static?: boolean;
  }) => {
    if (!currentUser || !selectedNode) return;

    try {
      await modifyMutation.mutateAsync({
        video_id: videoId,
        node_id: selectedNode.node_id,
        user_id: currentUser.id,
        new_visual_attributes: changes.visual,
        new_physical_attributes: changes.physical,
        new_is_static: changes.is_static,
      });

      // Optimistic update: update the node in the store
      const updatedNode: Node = {
        ...selectedNode,
        is_static: changes.is_static ?? selectedNode.is_static,
        attributes: {
          visual: changes.visual || selectedNode.attributes.visual,
          physical: changes.physical || selectedNode.attributes.physical,
        },
        has_revision: true,
        revision_action: 'modify',
      };

      // Update nodes in store
      setNodes(nodes.map(n => n.node_id === selectedNode.node_id ? updatedNode : n));
      // Update selected node
      setSelectedNode(updatedNode);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to modify node:', error);
    }
  };

  if (!selectedNode) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white text-sm font-semibold">Nodes</span>
        </div>
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-400">Select a node to review</p>
        </div>
      </div>
    );
  }

  const range = getTrackletRange(selectedNode);
  const nodeTypeColor = selectedNode.is_static ? COLORS.static : COLORS.dynamic;
  const nodeTypeBgColor = selectedNode.is_static ? 'bg-gray-500' : 'bg-orange-500';
  const selectedNodeAiStatus = aiSuggestionStatusByNode[selectedNode.node_id] ?? 'idle';

  // Handle clicking a related edge
  const handleEdgeClick = (edge: Edge) => {
    setSelectedEdge(edge);
    // Jump to the start of the edge
    const edgePeriods = edge.time_periods && edge.time_periods.length > 0
      ? edge.time_periods
      : [edge.time_period];
    const startFrame = edgePeriods[0]?.start_frame ?? edge.time_period.start_frame;
    setCurrentFrame(startFrame);
  };

  // Determine role of selected node in an edge
  const getNodeRole = (edge: Edge): 'source' | 'target' | 'both' => {
    const sources = Array.isArray(edge.source) ? edge.source : [edge.source];
    const targets = Array.isArray(edge.target) ? edge.target : [edge.target];
    const isSource = sources.includes(selectedNode.node_id);
    const isTarget = targets.includes(selectedNode.node_id);
    if (isSource && isTarget) return 'both';
    if (isSource) return 'source';
    return 'target';
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={clsx('px-2 py-1 rounded text-white text-sm', nodeTypeBgColor)}>
            {selectedNode.is_static ? 'static' : 'dynamic'}
          </span>
          <span className="text-white font-mono text-sm">{selectedNode.node_id}</span>
          {selectedNodeAiStatus !== 'idle' && (
            <span
              className={clsx(
                'px-2 py-0.5 rounded text-xs',
                selectedNodeAiStatus === 'done' && 'bg-green-500/20 text-green-300',
                selectedNodeAiStatus === 'pending' && 'bg-yellow-500/20 text-yellow-300',
                selectedNodeAiStatus === 'error' && 'bg-red-500/20 text-red-300'
              )}
            >
              AI: {selectedNodeAiStatus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && currentUser && (
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded border-2 border-blue-400 shadow-md hover:shadow-lg transition-all"
            >
              Edit Attributes
            </button>
          )}
          <button
            onClick={() => {
              setSelectedNode(null);
              setIsEditing(false);
            }}
            className="text-gray-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Show user selection warning if no user */}
      {!currentUser && (
        <div className="mb-4 p-2 bg-yellow-600/20 border border-yellow-600 rounded text-yellow-400 text-sm">
          Select a user to edit node attributes
        </div>
      )}

      {/* Node info */}
      <div className="space-y-4 mb-6">
        {/* Category section */}
        <div className="bg-gray-700 rounded p-3">
          <div className="text-gray-400 text-xs uppercase mb-1">Category</div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: nodeTypeColor }}
            />
            <span className="text-white text-lg font-semibold">{selectedNode.category}</span>
            <span className="text-gray-400 text-sm">(object_id: {selectedNode.object_id})</span>
          </div>
        </div>

        {/* Time Period */}
        <div className="bg-gray-700 rounded p-3">
          <div className="text-gray-400 text-xs uppercase mb-1">Time Period</div>
          <div className="text-white">
            Frame {range.start} - {range.end}
            <span className="text-gray-400 ml-2">
              ({range.end - range.start + 1} frames)
            </span>
          </div>
        </div>

        {/* Node Editor or Attribute Display */}
        {isEditing ? (
          <div className="bg-gray-700 rounded p-3">
            <div className="text-gray-400 text-xs uppercase mb-2">Edit Attributes</div>
            <NodeEditor
              node={selectedNode}
              videoId={videoId}
              onSave={handleSaveChanges}
              onCancel={() => setIsEditing(false)}
            />
          </div>
        ) : (
          <>
            {/* Visual Attributes */}
            {selectedNode.attributes?.visual && (
              <div className="bg-gray-700 rounded p-3">
                <div className="text-gray-400 text-xs uppercase mb-2">Visual Attributes</div>
                <div className="flex flex-wrap gap-2">
                  {selectedNode.attributes.visual.color && (
                    <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 text-base">
                      {selectedNode.attributes.visual.color}
                    </span>
                  )}
                  {selectedNode.attributes.visual.texture && (
                    <span className="px-2 py-1 rounded bg-green-500/20 text-green-300 text-base">
                      {selectedNode.attributes.visual.texture}
                    </span>
                  )}
                  {selectedNode.attributes.visual.material && (
                    <span className="px-2 py-1 rounded bg-purple-500/20 text-purple-300 text-base">
                      {selectedNode.attributes.visual.material}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Physical Attributes */}
            {selectedNode.attributes?.physical && (
              <div className="bg-gray-700 rounded p-3">
                <div className="text-gray-400 text-xs uppercase mb-2">Physical Attributes</div>
                <div className="flex flex-wrap gap-2">
                  {selectedNode.attributes.physical.size && (
                    <span className="px-2 py-1 rounded bg-yellow-500/20 text-yellow-300 text-base">
                      {selectedNode.attributes.physical.size}
                    </span>
                  )}
                  {selectedNode.attributes.physical.shape && (
                    <span className="px-2 py-1 rounded bg-pink-500/20 text-pink-300 text-base">
                      {selectedNode.attributes.physical.shape}
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Related Edges */}
        <div className="bg-gray-700 rounded p-3">
          <div className="text-gray-400 text-xs uppercase mb-2">
            Related Edges ({relatedEdges.length})
          </div>
          {relatedEdges.length === 0 ? (
            <div className="text-gray-500 text-sm">No edges connected to this node</div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {relatedEdges.map((edge) => {
                const role = getNodeRole(edge);
                const edgeTypeColor = edge.edge_type === 'static' ? 'bg-gray-500' :
                                      edge.edge_type === 'dynamic' ? 'bg-orange-500' : 'bg-purple-500';
                const roleColor = role === 'source' ? '#00d4ff' :
                                  role === 'target' ? '#ff00d4' : '#22c55e';

                // Get categories for display
                const sourceCategories = Array.isArray(edge.source_category)
                  ? edge.source_category
                  : [edge.source_category];
                const targetCategories = Array.isArray(edge.target_category)
                  ? edge.target_category
                  : [edge.target_category];

                return (
                  <div
                    key={edge.edge_id}
                    onClick={() => handleEdgeClick(edge)}
                    className="p-2 bg-gray-600 rounded cursor-pointer hover:bg-gray-500 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx('px-1.5 py-0.5 rounded text-white text-xs', edgeTypeColor)}>
                        {edge.edge_type}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded text-xs font-semibold"
                        style={{
                          backgroundColor: `${roleColor}20`,
                          color: roleColor,
                        }}
                      >
                        {role === 'both' ? 'BOTH' : role.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-200 flex items-center gap-1 flex-wrap">
                      <span style={{ color: '#00d4ff' }}>{sourceCategories.join(', ')}</span>
                      <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <span className="text-orange-400 font-medium">{edge.predicate}</span>
                      <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <span style={{ color: '#ff00d4' }}>{targetCategories.join(', ')}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Frames {(edge.time_periods && edge.time_periods.length > 0
                        ? edge.time_periods
                        : [edge.time_period]
                      )
                        .map((tp) => `${tp.start_frame}-${tp.end_frame}`)
                        .join(', ')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
