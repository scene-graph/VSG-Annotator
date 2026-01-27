import type { BBox } from '../../types';

interface BBoxItem {
  nodeId: string;
  category: string;
  bbox: BBox;
  isHighlighted: boolean;
}

interface BBoxOverlayProps {
  bboxes: BBoxItem[];
  scale: number;
  width: number;
  height: number;
}

export function BBoxOverlay({ bboxes, scale, width, height }: BBoxOverlayProps) {
  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {bboxes.map(({ nodeId, category, bbox, isHighlighted }) => {
        const x = bbox.left * scale;
        const y = bbox.top * scale;
        const w = bbox.width * scale;
        const h = bbox.height * scale;

        const isStatic = nodeId.startsWith('static');
        const baseColor = isStatic ? '#6b7280' : '#f97316';
        const strokeColor = isHighlighted ? '#22c55e' : baseColor;
        const strokeWidth = isHighlighted ? 3 : 2;

        return (
          <g key={nodeId}>
            {/* Bounding box */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeDasharray={isStatic ? '4 2' : undefined}
            />

            {/* Label background */}
            <rect
              x={x}
              y={y - 20}
              width={Math.max(category.length * 8 + 10, 60)}
              height={18}
              fill={strokeColor}
              rx={2}
            />

            {/* Label text */}
            <text
              x={x + 5}
              y={y - 6}
              fill="white"
              fontSize={12}
              fontFamily="monospace"
            >
              {category}
            </text>

            {/* Highlighted indicator */}
            {isHighlighted && (
              <>
                {/* Corner markers */}
                <line x1={x} y1={y} x2={x + 15} y2={y} stroke="#22c55e" strokeWidth={4} />
                <line x1={x} y1={y} x2={x} y2={y + 15} stroke="#22c55e" strokeWidth={4} />

                <line x1={x + w} y1={y} x2={x + w - 15} y2={y} stroke="#22c55e" strokeWidth={4} />
                <line x1={x + w} y1={y} x2={x + w} y2={y + 15} stroke="#22c55e" strokeWidth={4} />

                <line x1={x} y1={y + h} x2={x + 15} y2={y + h} stroke="#22c55e" strokeWidth={4} />
                <line x1={x} y1={y + h} x2={x} y2={y + h - 15} stroke="#22c55e" strokeWidth={4} />

                <line x1={x + w} y1={y + h} x2={x + w - 15} y2={y + h} stroke="#22c55e" strokeWidth={4} />
                <line x1={x + w} y1={y + h} x2={x + w} y2={y + h - 15} stroke="#22c55e" strokeWidth={4} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
