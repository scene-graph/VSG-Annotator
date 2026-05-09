import { useState, useEffect, useMemo } from 'react';
import type { Edge, EdgeType, MotionAttributes, TimePeriod, Node } from '../../types';
import { useAppStore, useNodes, useEdgeCreation } from '../../store';
import { usePredicates, useCreateEdge } from '../../hooks';
import clsx from 'clsx';

interface EdgeCreatorProps {
  videoId: string;
  onSuccess: () => void;
}

const VELOCITY_VALUES = ['stationary', 'very_slow', 'slow', 'moderate', 'fast', 'very_fast'];
const DIRECTION_VALUES = ['none', 'up', 'down', 'left', 'right', 'forward', 'backward', 'toward_body', 'away_from_body', 'inward', 'outward', 'rotational'];
const TRAJECTORY_VALUES = ['stable', 'straight', 'curved', 'arc', 'circular', 'zigzag', 'oscillating', 'irregular'];

// Determine edge type based on selected source and target nodes
function determineEdgeType(sourceNodes: Node[], targetNodes: Node[]): EdgeType | null {
  if (sourceNodes.length === 0 || targetNodes.length === 0) return null;

  const allSourcesStatic = sourceNodes.every((n) => n.node_id.startsWith('static_'));
  const anySourceDynamic = sourceNodes.some((n) => n.node_id.startsWith('dynamic_'));
  const allTargetsStatic = targetNodes.every((n) => n.node_id.startsWith('static_'));
  const allTargetsDynamic = targetNodes.every((n) => n.node_id.startsWith('dynamic_'));

  // Static edge: exactly 1 static → 1 static
  if (allSourcesStatic && allTargetsStatic && sourceNodes.length === 1 && targetNodes.length === 1) {
    return 'static';
  }
  // Dynamic edge: exactly 1 dynamic → 1 dynamic
  if (anySourceDynamic && allTargetsDynamic && sourceNodes.length === 1 && targetNodes.length === 1
      && sourceNodes[0].node_id.startsWith('dynamic_')) {
    return 'dynamic';
  }
  // fg_bg edge: at least 1 dynamic in source → all static targets
  if (anySourceDynamic && allTargetsStatic) {
    return 'fg_bg';
  }
  return null; // Invalid combination
}

// Check if we should auto-swap source and target for a valid fg_bg edge
function shouldAutoSwap(sourceNodes: Node[], targetNodes: Node[]): boolean {
  const allSourcesStatic = sourceNodes.every((n) => n.node_id.startsWith('static_'));
  const anyTargetDynamic = targetNodes.some((n) => n.node_id.startsWith('dynamic_'));
  return allSourcesStatic && anyTargetDynamic && sourceNodes.length > 0 && targetNodes.length > 0;
}

// Calculate default time period as intersection of all selected nodes' visibility
function getDefaultTimePeriod(sourceNodes: Node[], targetNodes: Node[]): TimePeriod {
  const allNodes = [...sourceNodes, ...targetNodes];
  if (allNodes.length === 0) {
    return { start_frame: 0, end_frame: 0 };
  }

  let maxStart = 0;
  let minEnd = Infinity;

  for (const node of allNodes) {
    const frames = Object.keys(node.bboxes_by_frame).map(Number);
    if (frames.length > 0) {
      const nodeStart = Math.min(...frames);
      const nodeEnd = Math.max(...frames);
      maxStart = Math.max(maxStart, nodeStart);
      minEnd = Math.min(minEnd, nodeEnd);
    }
  }

  return {
    start_frame: maxStart,
    end_frame: minEnd > maxStart ? minEnd : maxStart,
  };
}

// Get validation warnings for the current selection
function getValidationWarnings(
  sourceNodes: Node[],
  targetNodes: Node[],
  edgeType: EdgeType | null
): string[] {
  const warnings: string[] = [];

  // Check if any source is also a target
  const sourceIds = sourceNodes.map((n) => n.node_id);
  const targetIds = targetNodes.map((n) => n.node_id);
  const overlap = sourceIds.filter((id) => targetIds.includes(id));
  if (overlap.length > 0) {
    warnings.push('A node cannot be both source and target');
  }

  if (edgeType === null && sourceNodes.length > 0 && targetNodes.length > 0) {
    const allSourcesStatic = sourceNodes.every((n) => n.node_id.startsWith('static_'));
    const allSourcesDynamic = sourceNodes.every((n) => n.node_id.startsWith('dynamic_'));
    const allTargetsStatic = targetNodes.every((n) => n.node_id.startsWith('static_'));
    const allTargetsDynamic = targetNodes.every((n) => n.node_id.startsWith('dynamic_'));

    if (allSourcesStatic && allTargetsStatic && (sourceNodes.length > 1 || targetNodes.length > 1)) {
      warnings.push('Static edges require exactly 1 source and 1 target node');
    } else if (allSourcesDynamic && allTargetsDynamic && (sourceNodes.length > 1 || targetNodes.length > 1)) {
      warnings.push('Dynamic edges require exactly 1 source and 1 target node');
    } else if (allTargetsDynamic && !allSourcesDynamic) {
      warnings.push('No edge type supports this combination - dynamic targets require dynamic source');
    } else {
      warnings.push('Invalid node combination - cannot determine edge type');
    }
  }

  return warnings;
}

export function EdgeCreator({ videoId, onSuccess }: EdgeCreatorProps) {
  const nodes = useNodes();
  const edgeCreation = useEdgeCreation();
  const cancelEdgeCreation = useAppStore((state) => state.cancelEdgeCreation);
  const proceedToTarget = useAppStore((state) => state.proceedToTarget);
  const proceedToConfigure = useAppStore((state) => state.proceedToConfigure);
  const setEdgeCreationType = useAppStore((state) => state.setEdgeCreationType);
  const toggleSourceNode = useAppStore((state) => state.toggleSourceNode);
  const toggleTargetNode = useAppStore((state) => state.toggleTargetNode);
  const currentUser = useAppStore((state) => state.currentUser);
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);

  const createEdgeMutation = useCreateEdge();

  // Track if auto-swap was performed
  const [autoSwapped, setAutoSwapped] = useState(false);

  // Get selected source and target nodes
  const sourceNodes = useMemo(
    () => nodes.filter((n) => edgeCreation.sourceNodeIds.includes(n.node_id)),
    [nodes, edgeCreation.sourceNodeIds]
  );
  const targetNodes = useMemo(
    () => nodes.filter((n) => edgeCreation.targetNodeIds.includes(n.node_id)),
    [nodes, edgeCreation.targetNodeIds]
  );

  // Auto-determine edge type
  const detectedEdgeType = useMemo(
    () => determineEdgeType(sourceNodes, targetNodes),
    [sourceNodes, targetNodes]
  );

  // Update store with detected edge type
  useEffect(() => {
    setEdgeCreationType(detectedEdgeType);
  }, [detectedEdgeType, setEdgeCreationType]);

  // Get default time period
  const defaultTimePeriod = useMemo(
    () => getDefaultTimePeriod(sourceNodes, targetNodes),
    [sourceNodes, targetNodes]
  );

  // Form state
  const [predicate, setPredicate] = useState('');
  const [startFrame, setStartFrame] = useState(defaultTimePeriod.start_frame);
  const [endFrame, setEndFrame] = useState(defaultTimePeriod.end_frame);
  const [velocity, setVelocity] = useState('moderate');
  const [direction, setDirection] = useState('none');
  const [trajectory, setTrajectory] = useState('curved');
  const [notes, setNotes] = useState('');

  // Update time period when nodes change
  useEffect(() => {
    setStartFrame(defaultTimePeriod.start_frame);
    setEndFrame(defaultTimePeriod.end_frame);
  }, [defaultTimePeriod]);

  // Fetch predicates based on detected edge type
  const { data: predicatesData } = usePredicates(videoId, detectedEdgeType || undefined);
  const predicates = predicatesData?.predicates || [];

  // Set default predicate when predicates load
  useEffect(() => {
    if (predicates.length > 0 && !predicate) {
      setPredicate(predicates[0]);
    }
  }, [predicates, predicate]);

  // Get validation warnings
  const warnings = getValidationWarnings(sourceNodes, targetNodes, detectedEdgeType);

  const edgeTypeColors: Record<EdgeType, string> = {
    static: 'bg-gray-500',
    dynamic: 'bg-orange-500',
    fg_bg: 'bg-purple-500',
  };

  const handleCreate = async () => {
    if (!currentUser) {
      alert('Please select a user first');
      return;
    }

    if (!detectedEdgeType) {
      alert('Invalid node combination - cannot determine edge type');
      return;
    }

    if (!predicate) {
      alert('Please select a predicate');
      return;
    }

    const source =
      detectedEdgeType === 'fg_bg' ? edgeCreation.sourceNodeIds : edgeCreation.sourceNodeIds[0];
    const target =
      detectedEdgeType === 'fg_bg' ? edgeCreation.targetNodeIds : edgeCreation.targetNodeIds[0];

    const attributes: MotionAttributes | undefined =
      detectedEdgeType === 'dynamic' ? { velocity, direction, trajectory } : undefined;

    try {
      const result = await createEdgeMutation.mutateAsync({
        video_id: videoId,
        edge_type: detectedEdgeType,
        user_id: currentUser.id,
        source,
        target,
        predicate,
        time_period: { start_frame: startFrame, end_frame: endFrame },
        time_periods: [{ start_frame: startFrame, end_frame: endFrame }],
        attributes,
        notes: notes || undefined,
      });

      // Construct the new edge object with all available data
      const newEdge: Edge = {
        edge_id: result.edge_id,
        edge_type: detectedEdgeType,
        source: source,
        target: target,
        source_category: detectedEdgeType === 'fg_bg'
          ? sourceNodes.map((n) => n.category)
          : sourceNodes[0].category,
        target_category: detectedEdgeType === 'fg_bg'
          ? targetNodes.map((n) => n.category)
          : targetNodes[0].category,
        predicate: predicate,
        confidence: 1.0,
        confidence_round1: 1.0,
        confidence_round2: 1.0,
        validated: true,
        extraction_round: 2,
        validation_reasoning_round1: '',
        validation_reasoning_round2: 'Manually created by user',
        time_period: { start_frame: startFrame, end_frame: endFrame },
        time_periods: [{ start_frame: startFrame, end_frame: endFrame }],
        attributes: attributes,
        has_revision: true,
        revision_action: 'create',
      };

      // Exit creation mode
      cancelEdgeCreation();

      // Add edge to store and select it immediately
      const currentEdges = useAppStore.getState().edges;
      useAppStore.setState({ edges: [...currentEdges, newEdge] });
      setSelectedEdge(newEdge);

      onSuccess();
    } catch (error) {
      console.error('Failed to create edge:', error);
      alert('Failed to create edge. Please try again.');
    }
  };

  const handleBack = () => {
    if (edgeCreation.step === 'select-target') {
      // Go back to source selection
      setAutoSwapped(false);
      useAppStore.setState((state) => ({
        edgeCreation: { ...state.edgeCreation, step: 'select-source' },
      }));
    } else if (edgeCreation.step === 'configure') {
      // Go back to target selection - undo swap if it was performed
      if (autoSwapped) {
        // Swap back
        useAppStore.setState((state) => ({
          edgeCreation: {
            ...state.edgeCreation,
            step: 'select-target',
            sourceNodeIds: state.edgeCreation.targetNodeIds,
            targetNodeIds: state.edgeCreation.sourceNodeIds,
          },
          sourceNodes: state.edgeCreation.targetNodeIds,
          targetNodes: state.edgeCreation.sourceNodeIds,
        }));
        setAutoSwapped(false);
      } else {
        useAppStore.setState((state) => ({
          edgeCreation: { ...state.edgeCreation, step: 'select-target' },
        }));
      }
    }
  };

  // Custom proceed to configure that handles auto-swap
  const handleProceedToConfigure = () => {
    // Check if we should auto-swap
    if (shouldAutoSwap(sourceNodes, targetNodes)) {
      // Swap source and target
      useAppStore.setState((state) => ({
        edgeCreation: {
          ...state.edgeCreation,
          step: 'configure',
          sourceNodeIds: state.edgeCreation.targetNodeIds,
          targetNodeIds: state.edgeCreation.sourceNodeIds,
        },
        sourceNodes: state.edgeCreation.targetNodeIds,
        targetNodes: state.edgeCreation.sourceNodeIds,
      }));
      setAutoSwapped(true);
    } else {
      proceedToConfigure();
      setAutoSwapped(false);
    }
  };

  const canProceedToTarget = edgeCreation.sourceNodeIds.length > 0;
  const canProceedToConfigure = edgeCreation.targetNodeIds.length > 0;
  const canCreate =
    detectedEdgeType !== null &&
    predicate &&
    edgeCreation.sourceNodeIds.length > 0 &&
    edgeCreation.targetNodeIds.length > 0;

  // Step indicator
  const steps = [
    { key: 'select-source', label: 'Source', number: 1 },
    { key: 'select-target', label: 'Target', number: 2 },
    { key: 'configure', label: 'Configure', number: 3 },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === edgeCreation.step);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold">Create New Edge</h3>
        <button
          onClick={cancelEdgeCreation}
          className="text-gray-400 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between px-2">
        {steps.map((step, index) => (
          <div key={step.key} className="flex items-center">
            <div
              className={clsx(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold',
                index < currentStepIndex
                  ? 'bg-green-500 text-white'
                  : index === currentStepIndex
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-600 text-gray-400'
              )}
            >
              {index < currentStepIndex ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step.number
              )}
            </div>
            <span
              className={clsx(
                'ml-2 text-sm',
                index <= currentStepIndex ? 'text-white' : 'text-gray-500'
              )}
            >
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <div
                className={clsx(
                  'w-8 h-0.5 mx-2',
                  index < currentStepIndex ? 'bg-green-500' : 'bg-gray-600'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {edgeCreation.step === 'select-source' && (
        <div className="space-y-4">
          <div className="bg-blue-500/20 border border-blue-500 rounded p-3">
            <p className="text-blue-400 text-sm">
              Click on nodes in the tracklet timeline to select source node(s).
            </p>
          </div>

          {/* Selected Source Nodes */}
          <div className="bg-gray-700 rounded p-3">
            <div className="text-xs uppercase mb-2" style={{ color: '#00d4ff' }}>
              Selected Source Nodes ({sourceNodes.length})
            </div>
            {sourceNodes.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {sourceNodes.map((node) => (
                  <span
                    key={node.node_id}
                    onClick={() => toggleSourceNode(node.node_id)}
                    className="inline-flex items-center px-2 py-1 rounded text-sm border cursor-pointer hover:opacity-80"
                    style={{
                      backgroundColor: 'rgba(0, 212, 255, 0.15)',
                      borderColor: '#00d4ff',
                      color: 'white',
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#00d4ff' }} />
                    {node.category}_{node.object_id}
                    <svg className="w-4 h-4 ml-1 text-gray-400 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-gray-400 text-sm">No source nodes selected yet</div>
            )}
          </div>

          {/* Navigation buttons */}
          <div className="flex gap-2">
            <button
              onClick={cancelEdgeCreation}
              className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={proceedToTarget}
              disabled={!canProceedToTarget}
              className={clsx(
                'flex-1 py-2 rounded font-semibold',
                canProceedToTarget
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              )}
            >
              Next: Select Target
            </button>
          </div>
        </div>
      )}

      {edgeCreation.step === 'select-target' && (
        <div className="space-y-4">
          <div className="bg-blue-500/20 border border-blue-500 rounded p-3">
            <p className="text-blue-400 text-sm">
              Click on nodes in the tracklet timeline to select target node(s).
            </p>
          </div>

          {/* Selected Source Nodes (read-only) */}
          <div className="bg-gray-700 rounded p-3">
            <div className="text-xs uppercase mb-2" style={{ color: '#00d4ff' }}>
              Source Nodes ({sourceNodes.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {sourceNodes.map((node) => (
                <span
                  key={node.node_id}
                  className="inline-flex items-center px-2 py-1 rounded text-sm border"
                  style={{
                    backgroundColor: 'rgba(0, 212, 255, 0.15)',
                    borderColor: '#00d4ff',
                    color: 'white',
                  }}
                >
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#00d4ff' }} />
                  {node.category}_{node.object_id}
                </span>
              ))}
            </div>
          </div>

          {/* Selected Target Nodes */}
          <div className="bg-gray-700 rounded p-3">
            <div className="text-xs uppercase mb-2" style={{ color: '#ff00d4' }}>
              Selected Target Nodes ({targetNodes.length})
            </div>
            {targetNodes.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {targetNodes.map((node) => (
                  <span
                    key={node.node_id}
                    onClick={() => toggleTargetNode(node.node_id)}
                    className="inline-flex items-center px-2 py-1 rounded text-sm border cursor-pointer hover:opacity-80"
                    style={{
                      backgroundColor: 'rgba(255, 0, 212, 0.15)',
                      borderColor: '#ff00d4',
                      color: 'white',
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#ff00d4' }} />
                    {node.category}_{node.object_id}
                    <svg className="w-4 h-4 ml-1 text-gray-400 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-gray-400 text-sm">No target nodes selected yet</div>
            )}
          </div>

          {/* Edge Type Preview */}
          {detectedEdgeType && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Detected Edge Type:</span>
              <span className={clsx('px-2 py-1 rounded text-white text-sm', edgeTypeColors[detectedEdgeType])}>
                {detectedEdgeType}
              </span>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="bg-yellow-500/20 border border-yellow-500 rounded p-2">
              {warnings.map((warning, i) => (
                <div key={i} className="text-yellow-400 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  {warning}
                </div>
              ))}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleBack}
              className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded font-semibold"
            >
              Back
            </button>
            <button
              onClick={handleProceedToConfigure}
              disabled={!canProceedToConfigure}
              className={clsx(
                'flex-1 py-2 rounded font-semibold',
                canProceedToConfigure
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              )}
            >
              Next: Configure
            </button>
          </div>
        </div>
      )}

      {edgeCreation.step === 'configure' && (
        <div className="space-y-4">
          {/* Edge Type Badge */}
          {detectedEdgeType ? (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Edge Type:</span>
              <span className={clsx('px-2 py-1 rounded text-white text-sm', edgeTypeColors[detectedEdgeType])}>
                {detectedEdgeType}
              </span>
            </div>
          ) : (
            <div className="text-yellow-400 text-sm">
              Cannot determine edge type from selected nodes
            </div>
          )}

          {/* Auto-swap info message */}
          {autoSwapped && (
            <div className="bg-blue-500/20 border border-blue-500 rounded p-2">
              <div className="text-blue-400 text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Swapped source and target to create valid fg_bg edge (dynamic → static)
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="bg-yellow-500/20 border border-yellow-500 rounded p-2">
              {warnings.map((warning, i) => (
                <div key={i} className="text-yellow-400 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  {warning}
                </div>
              ))}
            </div>
          )}

          {/* Selected Nodes Summary */}
          <div className="bg-gray-700 rounded p-3">
            {/* Source Nodes */}
            <div className="mb-3">
              <div className="text-xs uppercase mb-1" style={{ color: '#00d4ff' }}>
                Source ({sourceNodes.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {sourceNodes.map((node) => (
                  <span
                    key={node.node_id}
                    className="inline-flex items-center px-2 py-1 rounded text-sm border"
                    style={{
                      backgroundColor: 'rgba(0, 212, 255, 0.15)',
                      borderColor: '#00d4ff',
                      color: 'white',
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#00d4ff' }} />
                    {node.category}_{node.object_id}
                  </span>
                ))}
              </div>
            </div>

            {/* Target Nodes */}
            <div>
              <div className="text-xs uppercase mb-1" style={{ color: '#ff00d4' }}>
                Target ({targetNodes.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {targetNodes.map((node) => (
                  <span
                    key={node.node_id}
                    className="inline-flex items-center px-2 py-1 rounded text-sm border"
                    style={{
                      backgroundColor: 'rgba(255, 0, 212, 0.15)',
                      borderColor: '#ff00d4',
                      color: 'white',
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#ff00d4' }} />
                    {node.category}_{node.object_id}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Predicate */}
          <div>
            <label className="text-gray-400 text-xs uppercase block mb-1">Predicate</label>
            <select
              value={predicate}
              onChange={(e) => setPredicate(e.target.value)}
              className="w-full bg-gray-700 text-white rounded p-2 text-sm"
              disabled={!detectedEdgeType}
            >
              <option value="">Select a predicate...</option>
              {predicates.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
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
          {detectedEdgeType === 'dynamic' && (
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

          {/* Notes */}
          <div>
            <label className="text-gray-400 text-xs uppercase block mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this edge..."
              className="w-full bg-gray-700 text-white rounded p-2 text-sm resize-none"
              rows={2}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleBack}
              className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded font-semibold"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate || createEdgeMutation.isPending}
              className={clsx(
                'flex-1 py-2 rounded font-semibold',
                canCreate
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              )}
            >
              {createEdgeMutation.isPending ? 'Creating...' : 'Create Edge'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
