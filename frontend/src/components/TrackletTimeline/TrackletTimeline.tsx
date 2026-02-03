import { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import type { Node } from '../../types';
import { useAppStore, useCurrentFrame, useSelectedEdge, useSourceNodes, useTargetNodes, useEdgeDragState } from '../../store';

interface TrackletTimelineProps {
  nodes: Node[];
  totalFrames: number;
  height?: number;
}

// Color scheme matching bbox overlay
const COLORS = {
  source: '#00d4ff',      // Cyan
  target: '#ff00d4',      // Magenta
  unselected: '#6b7280',  // Gray
  edgePeriod: '#f97316',  // Orange
  currentFrame: '#ef4444', // Red
};

const LANE_HEIGHT = 20;
const LANE_PADDING = 4;
const MARGIN = { top: 30, right: 20, bottom: 20, left: 120 };

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

export function TrackletTimeline({ nodes, totalFrames, height = 200 }: TrackletTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentFrame = useCurrentFrame();
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const selectedEdge = useSelectedEdge();
  const sourceNodes = useSourceNodes();
  const targetNodes = useTargetNodes();
  const edgeDragState = useEdgeDragState();

  // Sort nodes by category, then by start frame
  const sortedNodes = useMemo(() => {
    return [...nodes]
      .map((node) => ({
        node,
        range: getTrackletRange(node),
      }))
      .sort((a, b) => {
        // First, sort source nodes to top, then target, then others
        const aIsSource = sourceNodes.includes(a.node.node_id);
        const bIsSource = sourceNodes.includes(b.node.node_id);
        const aIsTarget = targetNodes.includes(a.node.node_id);
        const bIsTarget = targetNodes.includes(b.node.node_id);

        if (aIsSource && !bIsSource) return -1;
        if (!aIsSource && bIsSource) return 1;
        if (aIsTarget && !bIsTarget) return -1;
        if (!aIsTarget && bIsTarget) return 1;

        // Then sort by category
        const catCompare = a.node.category.localeCompare(b.node.category);
        if (catCompare !== 0) return catCompare;

        // Then by start frame
        return a.range.start - b.range.start;
      });
  }, [nodes, sourceNodes, targetNodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const contentHeight = Math.max(
      height - MARGIN.top - MARGIN.bottom,
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
      const startX = xScale(selectedEdge.time_period.start_frame);
      const endX = xScale(selectedEdge.time_period.end_frame);
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

    // Draw tracklet bars
    sortedNodes.forEach(({ node, range }, i) => {
      const y = MARGIN.top + i * (LANE_HEIGHT + LANE_PADDING);
      const startX = xScale(range.start);
      const endX = xScale(range.end);
      const barWidth = Math.max(endX - startX, 2);

      const isSource = sourceNodes.includes(node.node_id);
      const isTarget = targetNodes.includes(node.node_id);

      let color = COLORS.unselected;
      if (isSource) color = COLORS.source;
      else if (isTarget) color = COLORS.target;

      const opacity = selectedEdge && !isSource && !isTarget ? 0.3 : 0.8;

      // Node label (left side)
      const label = `${node.category}_${node.object_id}`;
      g.append('text')
        .attr('x', MARGIN.left - 8)
        .attr('y', y + LANE_HEIGHT / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', '11px')
        .attr('fill', isSource ? COLORS.source : isTarget ? COLORS.target : '#9ca3af')
        .attr('font-weight', isSource || isTarget ? 'bold' : 'normal')
        .text(label);

      // Tracklet bar
      g.append('rect')
        .attr('x', startX)
        .attr('y', y)
        .attr('width', barWidth)
        .attr('height', LANE_HEIGHT)
        .attr('fill', color)
        .attr('fill-opacity', opacity)
        .attr('rx', 3)
        .attr('cursor', 'pointer')
        .attr('stroke', isSource || isTarget ? color : 'none')
        .attr('stroke-width', isSource || isTarget ? 2 : 0)
        .on('click', (event) => {
          event.stopPropagation();
          // Click on tracklet to seek to that frame
          const [mouseX] = d3.pointer(event);
          const frame = Math.round(xScale.invert(mouseX));
          const clampedFrame = Math.max(range.start, Math.min(range.end, frame));
          setCurrentFrame(clampedFrame);
        })
        .on('mouseover', function () {
          d3.select(this).attr('fill-opacity', 1);
        })
        .on('mouseout', function () {
          d3.select(this).attr('fill-opacity', opacity);
        });

      // Frame range indicator on bar
      if (barWidth > 40) {
        g.append('text')
          .attr('x', startX + barWidth / 2)
          .attr('y', y + LANE_HEIGHT / 2 + 3)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', '#fff')
          .attr('pointer-events', 'none')
          .text(`${range.start}-${range.end}`);
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
  }, [sortedNodes, totalFrames, currentFrame, selectedEdge, sourceNodes, targetNodes, setCurrentFrame, height, edgeDragState]);

  const contentHeight = Math.max(
    height,
    sortedNodes.length * (LANE_HEIGHT + LANE_PADDING) + MARGIN.top + MARGIN.bottom
  );

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-gray-700">
        <span className="text-gray-400 text-sm font-medium">Object Tracklets</span>
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
        {selectedEdge && (
          <div className="flex items-center gap-1 ml-2 border-l border-gray-600 pl-3">
            <span
              className="w-3 h-3 rounded"
              style={{ backgroundColor: COLORS.edgePeriod, opacity: 0.5 }}
            />
            <span className="text-gray-300 text-xs">Edge Period</span>
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
      <div ref={containerRef} className="overflow-auto" style={{ maxHeight: height }}>
        <svg ref={svgRef} width="100%" height={contentHeight} />
      </div>
    </div>
  );
}
