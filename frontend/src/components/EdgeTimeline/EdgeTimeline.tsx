import { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import type { Edge } from '../../types';
import { useAppStore, useCurrentFrame, useSelectedEdge } from '../../store';

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

export function EdgeTimeline({ edges, totalFrames, height = 400 }: EdgeTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentFrame = useCurrentFrame();
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const selectedEdge = useSelectedEdge();
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);

  // Sort edges by type, then by start frame
  const sortedEdges = useMemo(() => {
    return [...edges].sort((a, b) => {
      const typeOrder = { static: 0, dynamic: 1, fg_bg: 2 };
      const typeCompare = typeOrder[a.edge_type] - typeOrder[b.edge_type];
      if (typeCompare !== 0) return typeCompare;
      return a.time_period.start_frame - b.time_period.start_frame;
    });
  }, [edges]);

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
      const startX = xScale(edge.time_period.start_frame);
      const endX = xScale(edge.time_period.end_frame);
      const barWidth = Math.max(endX - startX, 2);

      const isSelected = selectedEdge?.edge_id === edge.edge_id;
      const color = EDGE_TYPE_COLORS[edge.edge_type];

      // Edge label (left side)
      g.append('text')
        .attr('x', MARGIN.left - 10)
        .attr('y', y + LANE_HEIGHT / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', '11px')
        .attr('fill', isSelected ? '#22c55e' : '#d1d5db')
        .attr('cursor', 'pointer')
        .text(`${edge.predicate}`)
        .on('click', () => setSelectedEdge(edge));

      // Edge bar
      g.append('rect')
        .attr('x', startX)
        .attr('y', y)
        .attr('width', barWidth)
        .attr('height', LANE_HEIGHT)
        .attr('fill', color)
        .attr('fill-opacity', isSelected ? 1 : 0.7)
        .attr('rx', 4)
        .attr('cursor', 'pointer')
        .attr('stroke', isSelected ? '#22c55e' : 'none')
        .attr('stroke-width', 2)
        .on('click', () => setSelectedEdge(edge))
        .on('mouseover', function() {
          d3.select(this).attr('fill-opacity', 1);
        })
        .on('mouseout', function() {
          d3.select(this).attr('fill-opacity', isSelected ? 1 : 0.7);
        });

      // Validation indicator
      if (edge.validated) {
        g.append('circle')
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

        g.append('circle')
          .attr('cx', endX - 8)
          .attr('cy', y + LANE_HEIGHT / 2)
          .attr('r', 4)
          .attr('fill', revColor);
      }
    });

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

    // Make timeline clickable to set frame
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
  }, [sortedEdges, totalFrames, currentFrame, selectedEdge, setSelectedEdge, setCurrentFrame, height]);

  const contentHeight = Math.max(
    height,
    sortedEdges.length * (LANE_HEIGHT + LANE_PADDING) + MARGIN.top + MARGIN.bottom
  );

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
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
