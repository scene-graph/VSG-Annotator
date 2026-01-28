import type { BBox } from '../../types';

// Role indicates whether bbox is source, target, or neither
type BBoxRole = 'source' | 'target' | null;

interface BBoxItem {
  nodeId: string;
  category: string;
  bbox: BBox;
  role: BBoxRole;
}

interface BBoxOverlayProps {
  bboxes: BBoxItem[];
  scale: number;
  width: number;
  height: number;
}

// Color scheme for source/target differentiation
const COLORS = {
  source: '#00d4ff',  // Cyan - cool color for source
  target: '#ff00d4',  // Magenta - warm color for target
  static: '#6b7280',  // Gray for static objects
  dynamic: '#f97316', // Orange for dynamic objects (default)
};

export function BBoxOverlay({ bboxes, scale, width, height }: BBoxOverlayProps) {
  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {bboxes.map(({ nodeId, category, bbox, role }) => {
        const x = bbox.left * scale;
        const y = bbox.top * scale;
        const w = bbox.width * scale;
        const h = bbox.height * scale;

        const isStatic = nodeId.startsWith('static');
        const isHighlighted = role !== null;

        // Determine stroke color based on role
        let strokeColor: string;
        if (role === 'source') {
          strokeColor = COLORS.source;
        } else if (role === 'target') {
          strokeColor = COLORS.target;
        } else {
          strokeColor = isStatic ? COLORS.static : COLORS.dynamic;
        }

        const strokeWidth = isHighlighted ? 4 : 2;
        const cornerSize = isHighlighted ? 20 : 15;
        const cornerStroke = isHighlighted ? 5 : 4;

        // Role label text
        const roleLabel = role === 'source' ? 'SOURCE' : role === 'target' ? 'TARGET' : null;
        const labelWidth = Math.max(category.length * 8 + 10, 60);
        const roleLabelWidth = roleLabel ? roleLabel.length * 7 + 10 : 0;

        return (
          <g key={nodeId}>
            {/* Semi-transparent fill for highlighted bboxes */}
            {isHighlighted && (
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={strokeColor}
                fillOpacity={0.1}
              />
            )}

            {/* Bounding box */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeDasharray={isStatic && !isHighlighted ? '4 2' : undefined}
            />

            {/* Role label badge (SOURCE/TARGET) - above category label */}
            {roleLabel && (
              <>
                <rect
                  x={x}
                  y={y - 40}
                  width={roleLabelWidth}
                  height={18}
                  fill={strokeColor}
                  rx={2}
                />
                <text
                  x={x + 5}
                  y={y - 26}
                  fill="white"
                  fontSize={11}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {roleLabel}
                </text>
              </>
            )}

            {/* Category label background */}
            <rect
              x={x}
              y={y - 20}
              width={labelWidth}
              height={18}
              fill={strokeColor}
              rx={2}
            />

            {/* Category label text */}
            <text
              x={x + 5}
              y={y - 6}
              fill="white"
              fontSize={12}
              fontFamily="monospace"
              fontWeight={isHighlighted ? 'bold' : 'normal'}
            >
              {category}
            </text>

            {/* Corner markers for highlighted bboxes */}
            {isHighlighted && (
              <>
                {/* Top-left corner */}
                <line x1={x} y1={y} x2={x + cornerSize} y2={y} stroke={strokeColor} strokeWidth={cornerStroke} />
                <line x1={x} y1={y} x2={x} y2={y + cornerSize} stroke={strokeColor} strokeWidth={cornerStroke} />

                {/* Top-right corner */}
                <line x1={x + w} y1={y} x2={x + w - cornerSize} y2={y} stroke={strokeColor} strokeWidth={cornerStroke} />
                <line x1={x + w} y1={y} x2={x + w} y2={y + cornerSize} stroke={strokeColor} strokeWidth={cornerStroke} />

                {/* Bottom-left corner */}
                <line x1={x} y1={y + h} x2={x + cornerSize} y2={y + h} stroke={strokeColor} strokeWidth={cornerStroke} />
                <line x1={x} y1={y + h} x2={x} y2={y + h - cornerSize} stroke={strokeColor} strokeWidth={cornerStroke} />

                {/* Bottom-right corner */}
                <line x1={x + w} y1={y + h} x2={x + w - cornerSize} y2={y + h} stroke={strokeColor} strokeWidth={cornerStroke} />
                <line x1={x + w} y1={y + h} x2={x + w} y2={y + h - cornerSize} stroke={strokeColor} strokeWidth={cornerStroke} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
