import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { Node, Edge } from '../../types';
import { useAppStore, useCurrentFrame, useSelectedEdge } from '../../store';

interface GraphVisualizationProps {
  nodes: Node[];
  edges: Edge[];
  width?: number;
  height?: number;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  category: string;
  is_static: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  predicate: string;
  edge_type: string;
}

export function GraphVisualization({ nodes, edges, width = 400, height = 300 }: GraphVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const currentFrame = useCurrentFrame();
  const selectedEdge = useSelectedEdge();
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);

  // Filter nodes visible at current frame
  const visibleNodes = nodes.filter((node) => {
    const frameStr = String(currentFrame);
    return frameStr in node.bboxes_by_frame;
  });

  // Filter edges active at current frame
  const activeEdges = edges.filter((edge) => {
    if (edge.time_periods && edge.time_periods.length > 0) {
      return edge.time_periods.some(
        (tp) => tp.start_frame <= currentFrame && currentFrame <= tp.end_frame
      );
    }
    return edge.time_period.start_frame <= currentFrame && currentFrame <= edge.time_period.end_frame;
  });

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create graph data
    const graphNodes: GraphNode[] = visibleNodes.map((node) => ({
      id: node.node_id,
      category: node.category,
      is_static: node.is_static,
    }));

    const nodeIds = new Set(graphNodes.map((n) => n.id));

    const graphLinks: GraphLink[] = activeEdges
      .filter((edge) => {
        const sources = Array.isArray(edge.source) ? edge.source : [edge.source];
        const targets = Array.isArray(edge.target) ? edge.target : [edge.target];
        return sources.some((s) => nodeIds.has(s)) && targets.some((t) => nodeIds.has(t));
      })
      .map((edge) => {
        const sources = Array.isArray(edge.source) ? edge.source : [edge.source];
        const targets = Array.isArray(edge.target) ? edge.target : [edge.target];
        return {
          id: edge.edge_id,
          source: sources.find((s) => nodeIds.has(s)) || sources[0],
          target: targets.find((t) => nodeIds.has(t)) || targets[0],
          predicate: edge.predicate,
          edge_type: edge.edge_type,
        };
      });

    if (graphNodes.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7280')
        .text('No nodes at this frame');
      return;
    }

    // Create simulation
    const simulation = d3
      .forceSimulation(graphNodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(graphLinks)
          .id((d) => d.id)
          .distance(80)
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Create arrow marker
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#9ca3af');

    // Create links
    const link = svg
      .append('g')
      .selectAll('line')
      .data(graphLinks)
      .join('line')
      .attr('stroke', (d) => {
        const colors = { static: '#6b7280', dynamic: '#f97316', fg_bg: '#a855f7' };
        return colors[d.edge_type as keyof typeof colors] || '#9ca3af';
      })
      .attr('stroke-width', (d) => (selectedEdge?.edge_id === d.id ? 3 : 1.5))
      .attr('stroke-opacity', 0.8)
      .attr('marker-end', 'url(#arrow)')
      .style('cursor', 'pointer')
      .on('click', (_, d) => {
        const edge = edges.find((e) => e.edge_id === d.id);
        if (edge) setSelectedEdge(edge);
      });

    // Create link labels
    const linkLabel = svg
      .append('g')
      .selectAll('text')
      .data(graphLinks)
      .join('text')
      .attr('font-size', '9px')
      .attr('fill', '#9ca3af')
      .text((d) => d.predicate);

    // Create nodes
    const node = svg
      .append('g')
      .selectAll('circle')
      .data(graphNodes)
      .join('circle')
      .attr('r', 20)
      .attr('fill', (d) => (d.is_static ? '#374151' : '#7c3aed'))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'grab')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(
        (d3
          .drag<SVGCircleElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })) as any
      );

    // Create node labels
    const nodeLabel = svg
      .append('g')
      .selectAll('text')
      .data(graphNodes)
      .join('text')
      .attr('font-size', '10px')
      .attr('fill', '#fff')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .text((d) => d.category.substring(0, 8));

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x || 0)
        .attr('y1', (d) => (d.source as GraphNode).y || 0)
        .attr('x2', (d) => (d.target as GraphNode).x || 0)
        .attr('y2', (d) => (d.target as GraphNode).y || 0);

      linkLabel
        .attr('x', (d) => (((d.source as GraphNode).x || 0) + ((d.target as GraphNode).x || 0)) / 2)
        .attr('y', (d) => (((d.source as GraphNode).y || 0) + ((d.target as GraphNode).y || 0)) / 2 - 5);

      node.attr('cx', (d) => d.x || 0).attr('cy', (d) => d.y || 0);

      nodeLabel.attr('x', (d) => d.x || 0).attr('y', (d) => d.y || 0);
    });

    return () => {
      simulation.stop();
    };
  }, [visibleNodes, activeEdges, width, height, selectedEdge, setSelectedEdge, currentFrame, edges]);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="p-2 border-b border-gray-700">
        <span className="text-gray-400 text-sm">
          Graph View (Frame {currentFrame})
        </span>
      </div>
      <svg ref={svgRef} width={width} height={height} />
    </div>
  );
}
