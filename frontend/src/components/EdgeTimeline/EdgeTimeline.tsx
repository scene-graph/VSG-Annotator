import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { Edge, TimePeriod } from '../../types';
import { useAppStore, useCurrentFrame, useSelectedEdge, useCurrentUser, useCurrentVideo } from '../../store';
import { useModifyEdge } from '../../hooks/useVideo';

interface EdgeTimelineProps {
  edges: Edge[];
  totalFrames: number;
  height?: number;
}

const EDGE_TYPE_COLORS = {
  static: '#6b7280',
  dynamic: '#f97316',
  fg_bg: '#a855f7',
};

const LANE_HEIGHT = 24;
const LANE_PADDING = 4;
const MARGIN = { top: 30, right: 20, bottom: 30, left: 150 };
const HANDLE_WIDTH = 8;
const MIN_EDGE_FRAMES = 1;

interface DragState {
  edgeId: string;
  handle: 'left' | 'right';
  originalStartFrame: number;
  originalEndFrame: number;
  currentStartFrame: number;
  currentEndFrame: number;
}

export function EdgeTimeline({ edges, totalFrames, height = 400 }: EdgeTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs to access latest values from D3 callbacks (avoid stale closures)
  const dragStateRef = useRef<DragState | null>(null);
  const handleDragEndRef = useRef<(edge: Edge, newTimePeriod: TimePeriod) => void>();
  const edgesRef = useRef<Edge[]>([]);
  const justModifiedEdgeIdRef = useRef<string | null>(null);
  const currentUserRef = useRef<typeof currentUser>(null);

  const currentFrame = useCurrentFrame();
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const selectedEdge = useSelectedEdge();
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);
  const currentUser = useCurrentUser();
  const currentVideo = useCurrentVideo();
  const setEdges = useAppStore((state) => state.setEdges);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [showUserWarning, setShowUserWarning] = useState(false);
  const modifyMutation = useModifyEdge();
  const setEdgeDragState = useAppStore((state) => state.setEdgeDragState);

  // Sort edges by type, then by start frame
  const sortedEdges = useMemo(() => {
    return [...edges].sort((a, b) => {
      const typeOrder = { static: 0, dynamic: 1, fg_bg: 2 };
      const typeCompare = typeOrder[a.edge_type] - typeOrder[b.edge_type];
      if (typeCompare !== 0) return typeCompare;
      return a.time_period.start_frame - b.time_period.start_frame;
    });
  }, [edges]);

  // Handle drag end - save modification to API
  const handleDragEnd = useCallback((edge: Edge, newTimePeriod: TimePeriod) => {
    if (!currentUser || !currentVideo) return;

    // Mark this edge as just modified so we can scroll to it
    justModifiedEdgeIdRef.current = edge.edge_id;

    // Build updated edge
    const updatedEdge: Edge = {
      ...edge,
      time_period: newTimePeriod,
      has_revision: true,
      revision_action: 'modify'
    };

    // Optimistic update FIRST using current store state (not stale closure)
    const currentEdges = useAppStore.getState().edges;
    const updatedEdges = currentEdges.map(e =>
      e.edge_id === edge.edge_id ? updatedEdge : e
    );
    setEdges(updatedEdges);

    if (selectedEdge?.edge_id === edge.edge_id) {
      setSelectedEdge(updatedEdge);
    }

    // API call in background (non-blocking)
    modifyMutation.mutate({
      video_id: currentVideo.video_id,
      edge_id: edge.edge_id,
      edge_type: edge.edge_type,
      user_id: currentUser.id,
      new_time_period: newTimePeriod,
    }, {
      onError: (error) => {
        console.error('Failed to modify edge:', error);
        // Optionally revert the optimistic update here
      }
    });
  }, [currentUser, currentVideo, modifyMutation, selectedEdge, setEdges, setSelectedEdge]);
  // Note: 'edges' removed from deps since we use getState() instead

  // Sync edgesRef immediately during render (not in useEffect)
  // This ensures the ref is current when D3 drag callbacks fire
  edgesRef.current = edges;

  // Keep refs in sync with latest values
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    handleDragEndRef.current = handleDragEnd;
  }, [handleDragEnd]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Track selection changes - mark the edge for scroll-into-view
  useEffect(() => {
    if (selectedEdge) {
      justModifiedEdgeIdRef.current = selectedEdge.edge_id;
    }
  }, [selectedEdge?.edge_id]);

  // Sync drag state to global store for TrackletTimeline to display
  useEffect(() => {
    if (dragState) {
      setEdgeDragState({
        edgeId: dragState.edgeId,
        handle: dragState.handle,
        currentStartFrame: dragState.currentStartFrame,
        currentEndFrame: dragState.currentEndFrame,
      });
    } else {
      setEdgeDragState(null);
    }
  }, [dragState, setEdgeDragState]);

  // Create drag behavior for resize handles
  const createDragBehavior = useCallback((
    edge: Edge,
    handle: 'left' | 'right',
    xScale: d3.ScaleLinear<number, number>
  ) => {
    return d3.drag<SVGRectElement, unknown>()
      .on('start', (event) => {
        event.sourceEvent.stopPropagation();

        // Check if user is selected - show warning if not
        if (!currentUserRef.current) {
          setShowUserWarning(true);
          // Auto-hide warning after 3 seconds
          setTimeout(() => setShowUserWarning(false), 3000);
          return;
        }

        setDragState({
          edgeId: edge.edge_id,
          handle,
          originalStartFrame: edge.time_period.start_frame,
          originalEndFrame: edge.time_period.end_frame,
          currentStartFrame: edge.time_period.start_frame,
          currentEndFrame: edge.time_period.end_frame,
        });
        setSelectedEdge(edge);
      })
      .on('drag', (event) => {
        setDragState(prev => {
          if (!prev) return null;
          const mouseFrame = Math.round(xScale.invert(event.x));

          if (handle === 'left') {
            const newStart = Math.max(0, Math.min(mouseFrame, prev.currentEndFrame - MIN_EDGE_FRAMES));
            return { ...prev, currentStartFrame: newStart };
          } else {
            const newEnd = Math.min(totalFrames - 1, Math.max(mouseFrame, prev.currentStartFrame + MIN_EDGE_FRAMES));
            return { ...prev, currentEndFrame: newEnd };
          }
        });
      })
      .on('end', () => {
        const currentDrag = dragStateRef.current;
        if (currentDrag && (
          currentDrag.currentStartFrame !== currentDrag.originalStartFrame ||
          currentDrag.currentEndFrame !== currentDrag.originalEndFrame
        )) {
          // Find current edge from latest edges list (avoid stale closure)
          const currentEdge = edgesRef.current.find(e => e.edge_id === currentDrag.edgeId);
          if (currentEdge) {
            handleDragEndRef.current?.(currentEdge, {
              start_frame: currentDrag.currentStartFrame,
              end_frame: currentDrag.currentEndFrame,
            });
          }
        }
        setDragState(null);
      });
  }, [totalFrames, setSelectedEdge]);
  // Note: handleDragEnd removed from deps - accessed via ref to avoid stale closures

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const contentHeight = Math.max(
      height - MARGIN.top - MARGIN.bottom,
      sortedEdges.length * (LANE_HEIGHT + LANE_PADDING)
    );

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create scales
    const xScale = d3
      .scaleLinear()
      .domain([0, totalFrames - 1])
      .range([MARGIN.left, width - MARGIN.right]);

    // Make timeline clickable to set frame (draw first so edge bars are on top)
    svg
      .append('rect')
      .attr('x', MARGIN.left)
      .attr('y', MARGIN.top)
      .attr('width', width - MARGIN.left - MARGIN.right)
      .attr('height', contentHeight)
      .attr('fill', 'transparent')
      .attr('cursor', 'pointer')
      .on('click', (event) => {
        const [mouseX] = d3.pointer(event);
        const frame = Math.round(xScale.invert(mouseX));
        setCurrentFrame(Math.max(0, Math.min(totalFrames - 1, frame)));
      });

    // Create main group
    const g = svg.append('g');

    // Add x-axis
    const xAxis = d3.axisBottom(xScale).ticks(10);
    svg
      .append('g')
      .attr('transform', `translate(0, ${MARGIN.top - 5})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .attr('font-size', '10px');

    // Add grid lines
    const gridLines = d3.axisBottom(xScale).ticks(10).tickSize(contentHeight).tickFormat(() => '');
    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0, ${MARGIN.top})`)
      .call(gridLines)
      .selectAll('line')
      .attr('stroke', '#374151')
      .attr('stroke-opacity', 0.5);

    // Draw edge bars
    sortedEdges.forEach((edge, i) => {
      const y = MARGIN.top + i * (LANE_HEIGHT + LANE_PADDING);

      // Use drag state for preview if this edge is being dragged
      const isDragging = dragState?.edgeId === edge.edge_id;
      const startFrame = isDragging ? dragState.currentStartFrame : edge.time_period.start_frame;
      const endFrame = isDragging ? dragState.currentEndFrame : edge.time_period.end_frame;

      const startX = xScale(startFrame);
      const endX = xScale(endFrame);
      const barWidth = Math.max(endX - startX, 2);

      const isSelected = selectedEdge?.edge_id === edge.edge_id;
      const color = EDGE_TYPE_COLORS[edge.edge_type];

      const edgeGroup = g.append('g').attr('class', 'edge-group');

      // Edge label (left side)
      edgeGroup.append('text')
        .attr('x', MARGIN.left - 10)
        .attr('y', y + LANE_HEIGHT / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', '11px')
        .attr('fill', isSelected ? '#22c55e' : '#d1d5db')
        .attr('cursor', 'pointer')
        .text(`${edge.predicate}`)
        .on('click', () => {
          setSelectedEdge(edge);
          setCurrentFrame(edge.time_period.start_frame);
        });

      // Ghost showing original position during drag
      if (isDragging) {
        edgeGroup.append('rect')
          .attr('x', xScale(edge.time_period.start_frame))
          .attr('y', y)
          .attr('width', Math.max(xScale(edge.time_period.end_frame) - xScale(edge.time_period.start_frame), 2))
          .attr('height', LANE_HEIGHT)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-dasharray', '4 2')
          .attr('stroke-opacity', 0.5)
          .attr('rx', 4);
      }

      // Edge bar
      edgeGroup.append('rect')
        .attr('x', startX)
        .attr('y', y)
        .attr('width', barWidth)
        .attr('height', LANE_HEIGHT)
        .attr('fill', color)
        .attr('fill-opacity', isDragging ? 0.5 : (isSelected ? 1 : 0.7))
        .attr('rx', 4)
        .attr('cursor', 'pointer')
        .attr('stroke', isDragging ? '#fbbf24' : (isSelected ? '#22c55e' : 'none'))
        .attr('stroke-width', 2)
        .on('click', (event) => {
          event.stopPropagation();  // Prevent overlay from also handling
          setSelectedEdge(edge);
          setCurrentFrame(edge.time_period.start_frame);
        })
        .on('mouseover', function() {
          if (!isDragging) d3.select(this).attr('fill-opacity', 1);
        })
        .on('mouseout', function() {
          if (!isDragging) d3.select(this).attr('fill-opacity', isSelected ? 1 : 0.7);
        });

      // Handle indicators (visible on hover)
      const leftIndicator = edgeGroup.append('rect')
        .attr('x', startX)
        .attr('y', y + 4)
        .attr('width', 3)
        .attr('height', LANE_HEIGHT - 8)
        .attr('fill', '#fff')
        .attr('fill-opacity', isDragging ? 0.7 : 0)
        .attr('rx', 1)
        .attr('pointer-events', 'none');

      const rightIndicator = edgeGroup.append('rect')
        .attr('x', endX - 3)
        .attr('y', y + 4)
        .attr('width', 3)
        .attr('height', LANE_HEIGHT - 8)
        .attr('fill', '#fff')
        .attr('fill-opacity', isDragging ? 0.7 : 0)
        .attr('rx', 1)
        .attr('pointer-events', 'none');

      // Left drag handle (invisible, for hit detection)
      edgeGroup.append('rect')
        .attr('x', startX - HANDLE_WIDTH / 2)
        .attr('y', y)
        .attr('width', HANDLE_WIDTH)
        .attr('height', LANE_HEIGHT)
        .attr('fill', 'transparent')
        .attr('cursor', 'ew-resize')
        .on('mouseenter', () => {
          leftIndicator.attr('fill-opacity', 0.7);
        })
        .on('mouseleave', () => {
          if (!isDragging) leftIndicator.attr('fill-opacity', 0);
        })
        .call(createDragBehavior(edge, 'left', xScale) as any);

      // Right drag handle (invisible, for hit detection)
      edgeGroup.append('rect')
        .attr('x', endX - HANDLE_WIDTH / 2)
        .attr('y', y)
        .attr('width', HANDLE_WIDTH)
        .attr('height', LANE_HEIGHT)
        .attr('fill', 'transparent')
        .attr('cursor', 'ew-resize')
        .on('mouseenter', () => {
          rightIndicator.attr('fill-opacity', 0.7);
        })
        .on('mouseleave', () => {
          if (!isDragging) rightIndicator.attr('fill-opacity', 0);
        })
        .call(createDragBehavior(edge, 'right', xScale) as any);

      // Validation indicator
      if (edge.validated) {
        edgeGroup.append('circle')
          .attr('cx', startX + 8)
          .attr('cy', y + LANE_HEIGHT / 2)
          .attr('r', 4)
          .attr('fill', '#22c55e');
      }

      // Revision indicator
      if (edge.has_revision) {
        const revColor = {
          accept: '#22c55e',
          reject: '#ef4444',
          modify: '#eab308',
        }[edge.revision_action || ''] || '#9ca3af';

        edgeGroup.append('circle')
          .attr('cx', endX - 8)
          .attr('cy', y + LANE_HEIGHT / 2)
          .attr('r', 4)
          .attr('fill', revColor);
      }
    });

    // Tooltip during drag
    if (dragState) {
      const tooltipFrame = dragState.handle === 'left'
        ? dragState.currentStartFrame
        : dragState.currentEndFrame;
      const tooltipX = xScale(tooltipFrame);

      g.append('rect')
        .attr('x', tooltipX - 30)
        .attr('y', MARGIN.top - 28)
        .attr('width', 60)
        .attr('height', 20)
        .attr('fill', '#1f2937')
        .attr('stroke', '#fbbf24')
        .attr('rx', 3);

      g.append('text')
        .attr('x', tooltipX)
        .attr('y', MARGIN.top - 14)
        .attr('text-anchor', 'middle')
        .attr('fill', '#fbbf24')
        .attr('font-size', '11px')
        .text(`Frame ${tooltipFrame}`);
    }

    // Current frame indicator
    const frameLineX = xScale(currentFrame);
    g.append('line')
      .attr('x1', frameLineX)
      .attr('y1', MARGIN.top)
      .attr('x2', frameLineX)
      .attr('y2', MARGIN.top + contentHeight)
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 2');

    g.append('circle')
      .attr('cx', frameLineX)
      .attr('cy', MARGIN.top)
      .attr('r', 6)
      .attr('fill', '#ef4444');
  }, [sortedEdges, totalFrames, currentFrame, selectedEdge, setSelectedEdge, setCurrentFrame, height, dragState, createDragBehavior]);

  // Scroll to modified edge after re-render
  useEffect(() => {
    const edgeId = justModifiedEdgeIdRef.current;
    if (!edgeId || !containerRef.current) return;

    // Use requestAnimationFrame to ensure scroll happens after paint
    const rafId = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;

      const edgeIndex = sortedEdges.findIndex(e => e.edge_id === edgeId);
      if (edgeIndex === -1) {
        justModifiedEdgeIdRef.current = null;
        return;
      }

      const edgeY = MARGIN.top + edgeIndex * (LANE_HEIGHT + LANE_PADDING);
      const edgeBottom = edgeY + LANE_HEIGHT;

      // Check if edge is already visible (with padding)
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const visibleTop = scrollTop + 20;
      const visibleBottom = scrollTop + containerHeight - 20;

      if (edgeY >= visibleTop && edgeBottom <= visibleBottom) {
        // Already visible, no need to scroll
        justModifiedEdgeIdRef.current = null;
        return;
      }

      // Scroll to position edge at 1/3 from top (natural viewing position)
      const targetScrollTop = edgeY - containerHeight / 3;
      const maxScroll = container.scrollHeight - containerHeight;
      const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

      container.scrollTo({
        top: clampedScrollTop,
        behavior: 'smooth'
      });

      justModifiedEdgeIdRef.current = null;
    });

    return () => cancelAnimationFrame(rafId);
  }, [sortedEdges, selectedEdge?.edge_id]);

  const contentHeight = Math.max(
    height,
    sortedEdges.length * (LANE_HEIGHT + LANE_PADDING) + MARGIN.top + MARGIN.bottom
  );

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden relative">
      {/* User selection warning */}
      {showUserWarning && (
        <div className="absolute top-0 left-0 right-0 z-10 bg-yellow-600 text-white px-4 py-2 text-sm flex items-center justify-between">
          <span>Please select a user (e.g., annotator1) before modifying edges</span>
          <button
            onClick={() => setShowUserWarning(false)}
            className="ml-4 text-white hover:text-yellow-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 p-2 border-b border-gray-700">
        <span className="text-gray-400 text-sm">Edge Types:</span>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded" style={{ backgroundColor: EDGE_TYPE_COLORS.static }} />
          <span className="text-gray-300 text-sm">Static</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded" style={{ backgroundColor: EDGE_TYPE_COLORS.dynamic }} />
          <span className="text-gray-300 text-sm">Dynamic</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded" style={{ backgroundColor: EDGE_TYPE_COLORS.fg_bg }} />
          <span className="text-gray-300 text-sm">FG-BG</span>
        </div>
      </div>

      {/* Timeline */}
      <div ref={containerRef} className="overflow-auto" style={{ maxHeight: height }}>
        <svg ref={svgRef} width="100%" height={contentHeight} />
      </div>
    </div>
  );
}
