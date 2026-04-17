import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { Node } from '../../types';
import { useAppStore, useCurrentFrame, useSelectedEdge, useSelectedNode, useSourceNodes, useTargetNodes, useEdgeDragState, useEdgeCreation, useTrackletFocusRequest } from '../../store';

interface TrackletTimelineProps {
  nodes: Node[];
  totalFrames: number;
}

// Color scheme matching bbox overlay
const COLORS = {
  source: '#00d4ff',      // Cyan
  target: '#ff00d4',      // Magenta
  unselected: '#6b7280',  // Gray
  edgePeriod: '#f97316',  // Orange
  currentFrame: '#ef4444', // Red
  selected: '#22c55e',    // Green for selected node
  static: '#6b7280',      // Gray for static nodes
  dynamic: '#f97316',     // Orange for dynamic nodes
};

const LANE_HEIGHT = 20;
const LANE_PADDING = 4;
const MARGIN = { top: 30, right: 20, bottom: 20, left: 132 };

// Extract tracklet range from node's bboxes_by_frame
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

// Find contiguous segments where the object has bboxes
function getContiguousSegments(node: Node): Array<{ start: number; end: number }> {
  const frames = Object.keys(node.bboxes_by_frame).map(Number).sort((a, b) => a - b);
  if (frames.length === 0) return [];

  const segments: Array<{ start: number; end: number }> = [];
  let segStart = frames[0];
  let segEnd = frames[0];

  for (let i = 1; i < frames.length; i++) {
    if (frames[i] === segEnd + 1) {
      // Contiguous frame
      segEnd = frames[i];
    } else {
      // Gap detected - save current segment and start new one
      segments.push({ start: segStart, end: segEnd });
      segStart = frames[i];
      segEnd = frames[i];
    }
  }
  // Don't forget last segment
  segments.push({ start: segStart, end: segEnd });

  return segments;
}

export function TrackletTimeline({ nodes, totalFrames }: TrackletTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const justSelectedNodeIdRef = useRef<string | null>(null);
  const nodeOrderRef = useRef<Map<string, number>>(new Map());
  const [containerHeight, setContainerHeight] = useState(200);
  const hasReviewedNodes = useMemo(() => nodes.some((node) => node.has_revision), [nodes]);

  const currentFrame = useCurrentFrame();
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const selectedEdge = useSelectedEdge();
  const selectedNode = useSelectedNode();
  const setSelectedNode = useAppStore((state) => state.setSelectedNode);
  const sourceNodes = useSourceNodes();
  const targetNodes = useTargetNodes();
  const edgeDragState = useEdgeDragState();

  // Edge creation state
  const edgeCreation = useEdgeCreation();
  const toggleSourceNode = useAppStore((state) => state.toggleSourceNode);
  const toggleTargetNode = useAppStore((state) => state.toggleTargetNode);

  // Cross-panel scroll request (e.g. EdgeReview source/target pill clicks)
  const trackletFocusRequest = useTrackletFocusRequest();

  // Track container height
  useEffect(() => {
    if (!wrapperRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        // Account for header and legend (approximately 80px)
        setContainerHeight(Math.max(100, height - 80));
      }
    });

    resizeObserver.observe(wrapperRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Keep a stable node order based on initial category + start-frame sort
  const sortedNodes = useMemo(() => {
    const baseNodes = [...nodes]
      .map((node) => ({
        node,
        segments: getContiguousSegments(node),
        range: getTrackletRange(node),
      }))
      .sort((a, b) => {
        const catCompare = a.node.category.localeCompare(b.node.category);
        if (catCompare !== 0) return catCompare;
        return a.range.start - b.range.start;
      });

    const orderMap = nodeOrderRef.current;
    if (orderMap.size === 0) {
      baseNodes.forEach((item, index) => {
        orderMap.set(item.node.node_id, index);
      });
    } else {
      // Append any new nodes to the end to preserve existing order
      baseNodes.forEach((item) => {
        if (!orderMap.has(item.node.node_id)) {
          orderMap.set(item.node.node_id, orderMap.size);
        }
      });
    }

    return baseNodes.sort((a, b) => {
      const aOrder = orderMap.get(a.node.node_id) ?? 0;
      const bOrder = orderMap.get(b.node.node_id) ?? 0;
      return aOrder - bOrder;
    });
  }, [nodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const contentHeight = Math.max(
      containerHeight - MARGIN.top - MARGIN.bottom,
      sortedNodes.length * (LANE_HEIGHT + LANE_PADDING)
    );

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create scales
    const xScale = d3
      .scaleLinear()
      .domain([0, totalFrames - 1])
      .range([MARGIN.left, width - MARGIN.right]);

    // Create main group
    const g = svg.append('g');

    // Add x-axis at top
    const xAxis = d3.axisTop(xScale).ticks(10);
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
      .attr('stroke-opacity', 0.3);

    // Draw edge time period overlay (behind tracklets)
    if (selectedEdge) {
      const edgePeriods = selectedEdge.time_periods && selectedEdge.time_periods.length > 0
        ? [...selectedEdge.time_periods].sort((a, b) => a.start_frame - b.start_frame)
        : [selectedEdge.time_period];

      edgePeriods.forEach((period) => {
        const startX = xScale(period.start_frame);
        const endX = xScale(period.end_frame);
        const overlayWidth = Math.max(endX - startX, 2);

        g.append('rect')
          .attr('x', startX)
          .attr('y', MARGIN.top)
          .attr('width', overlayWidth)
          .attr('height', contentHeight)
          .attr('fill', COLORS.edgePeriod)
          .attr('fill-opacity', 0.15)
          .attr('pointer-events', 'none');

        // Edge period boundaries
        g.append('line')
          .attr('x1', startX)
          .attr('y1', MARGIN.top)
          .attr('x2', startX)
          .attr('y2', MARGIN.top + contentHeight)
          .attr('stroke', COLORS.edgePeriod)
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4 2')
          .attr('pointer-events', 'none');

        g.append('line')
          .attr('x1', endX)
          .attr('y1', MARGIN.top)
          .attr('x2', endX)
          .attr('y2', MARGIN.top + contentHeight)
          .attr('stroke', COLORS.edgePeriod)
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4 2')
          .attr('pointer-events', 'none');
      });
    }

    // Draw drag preview overlay when edge is being dragged in EdgeTimeline
    if (edgeDragState) {
      const dragStartX = xScale(edgeDragState.currentStartFrame);
      const dragEndX = xScale(edgeDragState.currentEndFrame);
      const dragWidth = Math.max(dragEndX - dragStartX, 2);

      // Drag range overlay (yellow/gold tint)
      g.append('rect')
        .attr('x', dragStartX)
        .attr('y', MARGIN.top)
        .attr('width', dragWidth)
        .attr('height', contentHeight)
        .attr('fill', '#fbbf24')
        .attr('fill-opacity', 0.2)
        .attr('pointer-events', 'none');

      // Start boundary line
      g.append('line')
        .attr('x1', dragStartX)
        .attr('y1', MARGIN.top)
        .attr('x2', dragStartX)
        .attr('y2', MARGIN.top + contentHeight)
        .attr('stroke', '#fbbf24')
        .attr('stroke-width', edgeDragState.handle === 'left' ? 3 : 1)
        .attr('pointer-events', 'none');

      // End boundary line
      g.append('line')
        .attr('x1', dragEndX)
        .attr('y1', MARGIN.top)
        .attr('x2', dragEndX)
        .attr('y2', MARGIN.top + contentHeight)
        .attr('stroke', '#fbbf24')
        .attr('stroke-width', edgeDragState.handle === 'right' ? 3 : 1)
        .attr('pointer-events', 'none');

      // Tooltip showing current drag frame
      const tooltipFrame = edgeDragState.handle === 'left'
        ? edgeDragState.currentStartFrame
        : edgeDragState.currentEndFrame;
      const tooltipX = xScale(tooltipFrame);

      g.append('rect')
        .attr('x', tooltipX - 35)
        .attr('y', MARGIN.top - 22)
        .attr('width', 70)
        .attr('height', 18)
        .attr('fill', '#1f2937')
        .attr('stroke', '#fbbf24')
        .attr('rx', 3)
        .attr('pointer-events', 'none');

      g.append('text')
        .attr('x', tooltipX)
        .attr('y', MARGIN.top - 9)
        .attr('text-anchor', 'middle')
        .attr('fill', '#fbbf24')
        .attr('font-size', '10px')
        .attr('pointer-events', 'none')
        .text(`Frame ${tooltipFrame}`);
    }

    // Draw tracklet bars (with contiguous segments)
    sortedNodes.forEach(({ node, segments }, i) => {
      const y = MARGIN.top + i * (LANE_HEIGHT + LANE_PADDING);

      const isSource = sourceNodes.includes(node.node_id);
      const isTarget = targetNodes.includes(node.node_id);
      const isSelected = selectedNode?.node_id === node.node_id;
      const isReviewed = Boolean(node.has_revision);
      const hasEdgeSelection = selectedEdge !== null;
      const hasNodeSelection = selectedNode !== null;
      const isInCreationMode = edgeCreation.isCreating;

      // Determine color based on context. Static/dynamic coloring is the
      // default so dynamic tracklets stay orange even while an edge is
      // selected — opacity handles focus dimming separately.
      let color: string;
      if (isSelected) {
        color = COLORS.selected;
      } else if (isSource) {
        color = COLORS.source;
      } else if (isTarget) {
        color = COLORS.target;
      } else {
        color = node.is_static ? COLORS.static : COLORS.dynamic;
      }

      // Determine opacity
      let opacity = 0.8;
      if (isInCreationMode) {
        // During creation mode, selected nodes are bright, others are dimmed
        if (isSource || isTarget) {
          opacity = 1.0;
        } else {
          opacity = 0.5;
        }
      } else if (hasEdgeSelection && !isSource && !isTarget) {
        opacity = 0.3;
      } else if (hasNodeSelection && !isSelected) {
        opacity = 0.4;
      }

      const isHighlighted = isSelected || isSource || isTarget;

      // Node label (left side)
      const label = `${node.category}_${node.object_id}`;
      let labelColor = '#9ca3af';
      if (isSelected) labelColor = COLORS.selected;
      else if (isSource) labelColor = COLORS.source;
      else if (isTarget) labelColor = COLORS.target;

      const labelX = MARGIN.left - 8;
      const labelY = y + LANE_HEIGHT / 2 + 4;
      const labelText = g.append('text')
        .attr('x', labelX)
        .attr('y', y + LANE_HEIGHT / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', '11px')
        .attr('fill', labelColor)
        .attr('font-weight', isHighlighted ? 'bold' : 'normal')
        .attr('cursor', 'pointer')
        .text(label)
        .on('click', () => {
          // Handle edge creation mode
          if (edgeCreation.isCreating) {
            if (edgeCreation.step === 'select-source') {
              toggleSourceNode(node.node_id);
            } else if (edgeCreation.step === 'select-target') {
              toggleTargetNode(node.node_id);
            }
          } else {
            // Normal mode: select this node and seek to best frame (largest bbox)
            setSelectedNode(node);
            const bboxEntries = Object.entries(node.bboxes_by_frame);
            if (bboxEntries.length > 0) {
              let bestFrame = Number(bboxEntries[0][0]);
              let bestArea = 0;
              for (const [frameStr, bbox] of bboxEntries) {
                const area = (bbox.width ?? 0) * (bbox.height ?? 0);
                if (area > bestArea) {
                  bestArea = area;
                  bestFrame = Number(frameStr);
                }
              }
              setCurrentFrame(bestFrame);
            } else if (segments.length > 0) {
              setCurrentFrame(segments[0].start);
            }
          }
        });

      if (isReviewed) {
        const labelWidth = labelText.node()?.getComputedTextLength() ?? 0;
        g.append('circle')
          .attr('cx', labelX - labelWidth - 10)
          .attr('cy', labelY - 4)
          .attr('r', 4)
          .attr('fill', '#22c55e')
          .attr('pointer-events', 'none');
      }

      // Draw each contiguous segment as a separate bar
      segments.forEach((segment) => {
        const segStartX = xScale(segment.start);
        const segEndX = xScale(segment.end);
        const segWidth = Math.max(segEndX - segStartX, 2);

        g.append('rect')
          .attr('x', segStartX)
          .attr('y', y)
          .attr('width', segWidth)
          .attr('height', LANE_HEIGHT)
          .attr('fill', color)
          .attr('fill-opacity', opacity)
          .attr('rx', 3)
          .attr('cursor', 'pointer')
          .attr('stroke', isHighlighted ? color : 'none')
          .attr('stroke-width', isHighlighted ? 2 : 0)
          .on('click', (event) => {
            event.stopPropagation();
            // Click on tracklet: seek to that frame
            const [mouseX] = d3.pointer(event);
            const frame = Math.round(xScale.invert(mouseX));
            const clampedFrame = Math.max(segment.start, Math.min(segment.end, frame));
            setCurrentFrame(clampedFrame);

            // Handle edge creation mode
            if (edgeCreation.isCreating) {
              if (edgeCreation.step === 'select-source') {
                toggleSourceNode(node.node_id);
              } else if (edgeCreation.step === 'select-target') {
                toggleTargetNode(node.node_id);
              }
            } else {
              // Normal mode: select this node
              setSelectedNode(node);
            }
          })
          .on('mouseover', function () {
            d3.select(this).attr('fill-opacity', 1);
          })
          .on('mouseout', function () {
            d3.select(this).attr('fill-opacity', opacity);
          });

        // Frame range indicator on segment (only if wide enough)
        if (segWidth > 40) {
          g.append('text')
            .attr('x', segStartX + segWidth / 2)
            .attr('y', y + LANE_HEIGHT / 2 + 3)
            .attr('text-anchor', 'middle')
            .attr('font-size', '9px')
            .attr('fill', '#fff')
            .attr('pointer-events', 'none')
            .text(`${segment.start}-${segment.end}`);
        }
      });

      // Add badge indicator for edge creation mode
      if (isInCreationMode && (isSource || isTarget)) {
        const badgeColor = isSource ? COLORS.source : COLORS.target;
        const badgeText = isSource ? 'S' : 'T';
        const firstSegment = segments[0];
        if (firstSegment) {
          const badgeX = xScale(firstSegment.start) - 12;

          // Badge circle background
          g.append('circle')
            .attr('cx', badgeX)
            .attr('cy', y + LANE_HEIGHT / 2)
            .attr('r', 8)
            .attr('fill', badgeColor)
            .attr('stroke', '#1f2937')
            .attr('stroke-width', 1)
            .attr('pointer-events', 'none');

          // Badge text
          g.append('text')
            .attr('x', badgeX)
            .attr('y', y + LANE_HEIGHT / 2 + 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .attr('font-weight', 'bold')
            .attr('fill', '#fff')
            .attr('pointer-events', 'none')
            .text(badgeText);
        }
      }
    });

    // Current frame indicator (red vertical line)
    const frameLineX = xScale(currentFrame);
    g.append('line')
      .attr('x1', frameLineX)
      .attr('y1', MARGIN.top)
      .attr('x2', frameLineX)
      .attr('y2', MARGIN.top + contentHeight)
      .attr('stroke', COLORS.currentFrame)
      .attr('stroke-width', 2)
      .attr('pointer-events', 'none');

    g.append('polygon')
      .attr('points', `${frameLineX - 5},${MARGIN.top} ${frameLineX + 5},${MARGIN.top} ${frameLineX},${MARGIN.top + 8}`)
      .attr('fill', COLORS.currentFrame)
      .attr('pointer-events', 'none');

    // Make timeline background clickable to set frame
    svg
      .insert('rect', ':first-child')
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
  }, [sortedNodes, totalFrames, currentFrame, selectedEdge, selectedNode, sourceNodes, targetNodes, setCurrentFrame, setSelectedNode, containerHeight, edgeDragState, edgeCreation, toggleSourceNode, toggleTargetNode]);

  // Scroll a given tracklet into view. `center: true` places the lane at
  // the vertical midpoint of the viewport; otherwise it uses the 1/3-from-
  // top rule for a natural reading position. No-ops if the lane is
  // already comfortably visible so repeat clicks don't jump the viewport.
  const scrollNodeIntoView = useCallback(
    (nodeId: string, options: { center?: boolean } = {}) => {
      const container = containerRef.current;
      if (!container) return;

      const nodeIndex = sortedNodes.findIndex(({ node }) => node.node_id === nodeId);
      if (nodeIndex === -1) return;

      const nodeY = MARGIN.top + nodeIndex * (LANE_HEIGHT + LANE_PADDING);
      const nodeBottom = nodeY + LANE_HEIGHT;

      const scrollTop = container.scrollTop;
      const viewportHeight = container.clientHeight;
      const visibleTop = scrollTop + 20;
      const visibleBottom = scrollTop + viewportHeight - 20;

      if (nodeY >= visibleTop && nodeBottom <= visibleBottom) {
        return;
      }

      const targetScrollTop = options.center
        ? nodeY - viewportHeight / 2 + LANE_HEIGHT / 2
        : nodeY - viewportHeight / 3;
      const maxScroll = container.scrollHeight - viewportHeight;
      const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

      container.scrollTo({
        top: clampedScrollTop,
        behavior: 'smooth',
      });
    },
    [sortedNodes]
  );

  // Track selection changes - mark the node as just selected so the next
  // render of the tracklet lanes (which may reshuffle sortedNodes) scrolls.
  useEffect(() => {
    if (selectedNode) {
      justSelectedNodeIdRef.current = selectedNode.node_id;
    }
  }, [selectedNode?.node_id]);

  // Scroll to the just-selected node once lanes are laid out.
  useEffect(() => {
    const nodeId = justSelectedNodeIdRef.current;
    if (!nodeId) return;
    const rafId = requestAnimationFrame(() => {
      scrollNodeIntoView(nodeId);
      justSelectedNodeIdRef.current = null;
    });
    return () => cancelAnimationFrame(rafId);
  }, [sortedNodes, scrollNodeIntoView]);

  // React to cross-panel focus requests (EdgeReview source/target pill
  // clicks). Keyed on the request's nonce so repeat clicks on the same
  // node still re-fire the scroll.
  useEffect(() => {
    if (!trackletFocusRequest) return;
    const { nodeId } = trackletFocusRequest;
    const rafId = requestAnimationFrame(() => {
      scrollNodeIntoView(nodeId, { center: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [trackletFocusRequest?.nonce, trackletFocusRequest?.nodeId, scrollNodeIntoView]);

  const contentHeight = Math.max(
    containerHeight,
    sortedNodes.length * (LANE_HEIGHT + LANE_PADDING) + MARGIN.top + MARGIN.bottom
  );

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div ref={wrapperRef} className="bg-gray-800 rounded-lg overflow-hidden h-full flex flex-col">
      {/* Edge Creation Mode Banner */}
      {edgeCreation.isCreating && (
        <div className="bg-green-600/20 border-b border-green-500 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-green-400 font-medium">
              {edgeCreation.step === 'select-source'
                ? 'Click nodes to select source(s)'
                : edgeCreation.step === 'select-target'
                ? 'Click nodes to select target(s)'
                : 'Configure edge in sidebar'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-300">
              Sources: {edgeCreation.sourceNodeIds.length}
            </span>
            <span className="text-gray-500">|</span>
            <span className="text-green-300">
              Targets: {edgeCreation.targetNodeIds.length}
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-gray-700">
        <span className="text-gray-400 text-sm font-medium">Object Tracklets</span>
        {edgeCreation.isCreating ? (
          // Edge creation mode: show Source/Target colors
          <>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.source }} />
              <span className="text-gray-300 text-xs">Source</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.target }} />
              <span className="text-gray-300 text-xs">Target</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.unselected }} />
              <span className="text-gray-300 text-xs">Unselected</span>
            </div>
          </>
        ) : selectedEdge ? (
          // Edge selection: show Source/Target/Other
          <>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.source }} />
              <span className="text-gray-300 text-xs">Source</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.target }} />
              <span className="text-gray-300 text-xs">Target</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.unselected }} />
              <span className="text-gray-300 text-xs">Other</span>
            </div>
            <div className="flex items-center gap-1 ml-2 border-l border-gray-600 pl-3">
              <span
                className="w-3 h-3 rounded"
                style={{ backgroundColor: COLORS.edgePeriod, opacity: 0.5 }}
              />
              <span className="text-gray-300 text-xs">Edge Period</span>
            </div>
          </>
        ) : selectedNode ? (
          // Node selection: show Selected/Static/Dynamic
          <>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.selected }} />
              <span className="text-gray-300 text-xs">Selected</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.static }} />
              <span className="text-gray-300 text-xs">Static</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.dynamic }} />
              <span className="text-gray-300 text-xs">Dynamic</span>
            </div>
          </>
        ) : (
          // No selection: show Static/Dynamic
          <>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.static }} />
              <span className="text-gray-300 text-xs">Static</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.dynamic }} />
              <span className="text-gray-300 text-xs">Dynamic</span>
            </div>
          </>
        )}
        {hasReviewedNodes && (
          <div className="flex items-center gap-1 ml-2 border-l border-gray-600 pl-3">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22c55e' }} />
            <span className="text-gray-300 text-xs">Reviewed</span>
          </div>
        )}
        {edgeDragState && (
          <div className="flex items-center gap-1 ml-2 border-l border-gray-600 pl-3 animate-pulse">
            <span
              className="w-3 h-3 rounded"
              style={{ backgroundColor: '#fbbf24', opacity: 0.7 }}
            />
            <span className="text-yellow-400 text-xs font-medium">Dragging...</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div ref={containerRef} className="overflow-auto flex-1" style={{ maxHeight: containerHeight }}>
        <svg ref={svgRef} width="100%" height={contentHeight} />
      </div>
    </div>
  );
}
