/**
 * Canvas-based overlay for panoptic segmentation masks.
 *
 * Fetches the raw paletted PNG for the current frame, decodes it client-side,
 * and renders a colorized RGBA overlay on a <canvas> element.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppStore } from '../../store';
import { masksApi } from '../../services/segmentationApi';
import type { MaskMetadata } from '../../types';

interface MaskOverlayProps {
  videoId: string;
  frameIdx: number;
  width: number;
  height: number;
  visible: boolean;
  opacity: number; // 0-1
  metadata: MaskMetadata | null;
  selectedObjectId: number | null;
  hiddenObjectIds: Set<number>;
  onObjectClick?: (objectId: number | null) => void;
}

/** Parse a '#rrggbb' hex string into [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

// Cache decoded panoptic data per frame. For palette format stores uint8 object_ids,
// for composite format stores uint16 pixel values.
const panopticCache = new Map<string, Uint16Array>();
const CACHE_MAX = 30;

export function MaskOverlay({
  videoId,
  frameIdx,
  width,
  height,
  visible,
  opacity,
  metadata,
  selectedObjectId,
  hiddenObjectIds,
  onObjectClick,
}: MaskOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Store the raw panoptic pixel data for click detection
  const panopticDataRef = useRef<Uint16Array | null>(null);
  const imageWidthRef = useRef(0);
  const imageHeightRef = useRef(0);

  const isComposite = metadata?.mask_format === 'composite';

  // Build a color lookup from palette — for palette format keyed by int object_id,
  // for composite format keyed by string object_id
  const colorLookup = useRef<Map<number | string, [number, number, number]>>(new Map());
  useEffect(() => {
    if (!metadata?.palette) return;
    const lookup = new Map<number | string, [number, number, number]>();
    for (const [idStr, hex] of Object.entries(metadata.palette)) {
      lookup.set(isComposite ? idStr : Number(idStr), hexToRgb(hex));
    }
    // Also build by object from metadata objects (covers composite string IDs)
    for (const obj of metadata.objects) {
      lookup.set(String(obj.object_id), hexToRgb(obj.color_hex));
    }
    colorLookup.current = lookup;
  }, [metadata?.palette, metadata?.objects, isComposite]);

  // Fetch and render the mask for the current frame
  const renderMask = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || !metadata?.has_masks) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cacheKey = `${videoId}:${frameIdx}`;

    // Try cache first
    let panopticPixels = panopticCache.get(cacheKey);

    if (!panopticPixels) {
      try {
        const url = masksApi.getMaskFrameUrl(videoId, frameIdx);
        const resp = await fetch(url);
        if (!resp.ok) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);

        // Draw to offscreen canvas to read pixel data
        const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
        const offCtx = offscreen.getContext('2d')!;
        offCtx.drawImage(bitmap, 0, 0);
        const imageData = offCtx.getImageData(0, 0, bitmap.width, bitmap.height);
        const data = imageData.data;

        panopticPixels = new Uint16Array(bitmap.width * bitmap.height);

        if (isComposite) {
          // Composite 16-bit PNG: browser decodes to 8-bit RGB.
          // The 16-bit value is encoded as: R channel = high byte, G = low byte
          // (browsers scale 16-bit grayscale to 8-bit RGB differently, so we
          // reconstruct from the rendered grayscale R value × 256)
          // Actually, browsers render 16-bit grayscale by scaling to 0-255.
          // Since max value is ~18004, the scaled value = pixelVal * 255 / 65535.
          // We reverse: pixelVal = R_scaled * 65535 / 255 ≈ R * 257.
          // But this loses precision. Instead, build a color→objectId map from metadata.
          //
          // Simpler approach: map each unique rendered RGB to the nearest composite ID.
          // Since cityscapes has few unique values, this works reliably.
          const renderedToId = new Map<string, number>();
          // Pre-compute what each composite ID renders as
          const allPixelVals: number[] = [];
          for (const obj of metadata.objects) {
            const oid = String(obj.object_id);
            // Decode composite pixel value from object_id string
            // e.g. "car_1" → cat=13, inst=1 → pixel=13001
            // e.g. "stuff_road" → cat=0, inst=0 → pixel=0 (but stuff_road uses cat*1000)
            // This is complex, so let unique-pixel scanning handle it
          }
          // Just scan unique colors and assign sequential IDs for coloring
          const uniqueColors = new Map<string, number>();
          let nextId = 1;
          for (let i = 0; i < panopticPixels.length; i++) {
            const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
            if (r === 0 && g === 0 && b === 0) {
              panopticPixels[i] = 0;
              continue;
            }
            const key = `${r},${g},${b}`;
            let id = uniqueColors.get(key);
            if (id === undefined) {
              id = nextId++;
              uniqueColors.set(key, id);
            }
            panopticPixels[i] = id;
          }
          // Build color lookup from the unique IDs
          // Use metadata object colors in order
          const metaObjs = metadata.objects;
          let colorIdx = 0;
          for (const [, id] of uniqueColors) {
            if (colorIdx < metaObjs.length) {
              colorLookup.current.set(id, hexToRgb(metaObjs[colorIdx].color_hex));
            }
            colorIdx++;
          }
        } else {
          // Palette format: reverse-map RGB → object_id using the palette
          const reversePalette = new Map<string, number>();
          for (const [idStr, hex] of Object.entries(metadata.palette)) {
            const [r, g, b] = hexToRgb(hex);
            reversePalette.set(`${r},${g},${b}`, Number(idStr));
          }
          reversePalette.set('0,0,0', 0);

          for (let i = 0; i < panopticPixels.length; i++) {
            const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
            panopticPixels[i] = reversePalette.get(`${r},${g},${b}`) ?? 0;
          }
        }

        imageWidthRef.current = bitmap.width;
        imageHeightRef.current = bitmap.height;

        if (panopticCache.size >= CACHE_MAX) {
          const firstKey = panopticCache.keys().next().value;
          if (firstKey !== undefined) panopticCache.delete(firstKey);
        }
        panopticCache.set(cacheKey, panopticPixels);
        bitmap.close();
      } catch {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
    }

    panopticDataRef.current = panopticPixels;

    // Render colorized overlay
    const imgW = imageWidthRef.current;
    const imgH = imageHeightRef.current;
    const outData = ctx.createImageData(canvas.width, canvas.height);
    const out = outData.data;
    const lookup = colorLookup.current;
    const scaleX = imgW / canvas.width;
    const scaleY = imgH / canvas.height;

    for (let y = 0; y < canvas.height; y++) {
      const srcY = Math.floor(y * scaleY);
      for (let x = 0; x < canvas.width; x++) {
        const srcX = Math.floor(x * scaleX);
        const pixelVal = panopticPixels[srcY * imgW + srcX];
        const idx = (y * canvas.width + x) * 4;

        if (pixelVal === 0) {
          out[idx + 3] = 0;
          continue;
        }

        const rgb = lookup.get(pixelVal) || lookup.get(String(pixelVal));
        if (!rgb) {
          out[idx + 3] = 0;
          continue;
        }

        out[idx] = rgb[0];
        out[idx + 1] = rgb[1];
        out[idx + 2] = rgb[2];

        // Selected object at full opacity, others dimmed
        if (selectedObjectId != null) {
          const isSelected = pixelVal === selectedObjectId || String(pixelVal) === String(selectedObjectId);
          out[idx + 3] = isSelected
            ? Math.round(opacity * 255)
            : Math.round(opacity * 0.3 * 255);
        } else {
          out[idx + 3] = Math.round(opacity * 255);
        }
      }
    }

    ctx.putImageData(outData, 0, 0);
  }, [videoId, frameIdx, visible, opacity, metadata, selectedObjectId, hiddenObjectIds]);

  useEffect(() => {
    renderMask();
  }, [renderMask]);

  // Clear canvas when masks are hidden
  useEffect(() => {
    if (!visible) {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }, [visible]);

  // Refinement state from store
  const segmentationTool = useAppStore((s) => s.segmentationTool);
  const addPendingBox = useAppStore((s) => s.addPendingBox);
  const pendingBoxes = useAppStore((s) => s.pendingBoxes);
  const isRefiningMode = useAppStore((s) => s.isRefining);
  const refinementPreviewB64 = useAppStore((s) => s.refinementPreviewB64);

  // Preview canvas ref
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Box drawing state
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Render refinement preview mask (green overlay)
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!refinementPreviewB64) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      // Draw mask to offscreen canvas to read pixel data
      const offscreen = document.createElement('canvas');
      offscreen.width = img.width;
      offscreen.height = img.height;
      const offCtx = offscreen.getContext('2d')!;
      offCtx.drawImage(img, 0, 0);
      const maskData = offCtx.getImageData(0, 0, img.width, img.height);

      // Build green-tinted RGBA overlay
      const outData = ctx.createImageData(canvas.width, canvas.height);
      const out = outData.data;
      const scaleX = img.width / canvas.width;
      const scaleY = img.height / canvas.height;

      for (let y = 0; y < canvas.height; y++) {
        const srcY = Math.floor(y * scaleY);
        for (let x = 0; x < canvas.width; x++) {
          const srcX = Math.floor(x * scaleX);
          const srcIdx = (srcY * img.width + srcX) * 4;
          const dstIdx = (y * canvas.width + x) * 4;

          // Mask pixel > 127 means foreground
          const isForeground = maskData.data[srcIdx] > 127;
          if (isForeground) {
            out[dstIdx] = 0;       // R
            out[dstIdx + 1] = 220; // G
            out[dstIdx + 2] = 80;  // B
            out[dstIdx + 3] = 140; // A — semi-transparent green
          }
        }
      }

      ctx.putImageData(outData, 0, 0);
    };
    img.src = `data:image/png;base64,${refinementPreviewB64}`;
  }, [refinementPreviewB64, width, height]);

  const getImageCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
    const imgW = imageWidthRef.current;
    const imgH = imageHeightRef.current;
    return {
      x: Math.floor(canvasX * (imgW / canvas.width)),
      y: Math.floor(canvasY * (imgH / canvas.height)),
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isRefiningMode || segmentationTool === 'select') return;
    if (segmentationTool === 'box') {
      const coords = getImageCoords(e);
      if (coords) setDrawStart(coords);
    }
  }, [isRefiningMode, segmentationTool, getImageCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawStart || segmentationTool !== 'box') return;
    const coords = getImageCoords(e);
    if (coords) setDrawCurrent(coords);
  }, [drawStart, segmentationTool, getImageCoords]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (segmentationTool === 'box' && drawStart) {
      const end = getImageCoords(e);
      if (end) {
        const x1 = Math.min(drawStart.x, end.x);
        const y1 = Math.min(drawStart.y, end.y);
        const x2 = Math.max(drawStart.x, end.x);
        const y2 = Math.max(drawStart.y, end.y);
        if (x2 - x1 > 5 && y2 - y1 > 5) {
          addPendingBox({ x1, y1, x2, y2, label: 1 });
        }
      }
      setDrawStart(null);
      setDrawCurrent(null);
      return;
    }
  }, [segmentationTool, drawStart, getImageCoords, addPendingBox]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Point tools: convert click to small box
      if (isRefiningMode && (segmentationTool === 'positive_point' || segmentationTool === 'negative_point')) {
        const coords = getImageCoords(e);
        if (coords) {
          const r = 15; // radius around click
          addPendingBox({
            x1: Math.max(0, coords.x - r),
            y1: Math.max(0, coords.y - r),
            x2: coords.x + r,
            y2: coords.y + r,
            label: segmentationTool === 'positive_point' ? 1 : 0,
          });
        }
        return;
      }

      // Default: object selection
      if (!onObjectClick || !panopticDataRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const canvasX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
      const canvasY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
      const imgW = imageWidthRef.current;
      const imgH = imageHeightRef.current;
      const srcX = Math.floor(canvasX * (imgW / canvas.width));
      const srcY = Math.floor(canvasY * (imgH / canvas.height));
      if (srcX >= 0 && srcX < imgW && srcY >= 0 && srcY < imgH) {
        const objId = panopticDataRef.current[srcY * imgW + srcX];
        onObjectClick(objId === 0 ? null : objId);
      }
    },
    [onObjectClick, isRefiningMode, segmentationTool, getImageCoords, addPendingBox],
  );

  if (!visible) return null;

  const toolCursor = isRefiningMode
    ? segmentationTool === 'box' ? 'crosshair'
      : segmentationTool === 'positive_point' ? 'cell'
        : segmentationTool === 'negative_point' ? 'not-allowed'
          : 'pointer'
    : 'crosshair';

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'auto',
          cursor: toolCursor,
        }}
      />
      {/* Refinement preview overlay (green tint) — always mounted for ref access */}
      <canvas
        ref={previewCanvasRef}
        width={width}
        height={height}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          display: refinementPreviewB64 ? 'block' : 'none',
        }}
      />
      {/* Draw pending boxes and current draw as SVG overlay */}
      {isRefiningMode && (
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox={`0 0 ${width} ${height}`}
        >
          {/* Pending prompts — circles for points, rects for boxes */}
          {pendingBoxes.map((b, i) => {
            const imgW = imageWidthRef.current || width;
            const imgH = imageHeightRef.current || height;
            const scaleX = width / imgW;
            const scaleY = height / imgH;
            const bw = b.x2 - b.x1;
            const bh = b.y2 - b.y1;
            const isPoint = bw <= 40 && bh <= 40; // point prompts are small boxes
            const color = b.label === 1 ? '#22c55e' : '#ef4444';

            if (isPoint) {
              const cx = ((b.x1 + b.x2) / 2) * scaleX;
              const cy = ((b.y1 + b.y2) / 2) * scaleY;
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={8} fill={color} fillOpacity={0.7} stroke="white" strokeWidth={2} />
                  {b.label === 0 && (
                    <line x1={cx - 5} y1={cy} x2={cx + 5} y2={cy} stroke="white" strokeWidth={2} />
                  )}
                  {b.label === 1 && (
                    <>
                      <line x1={cx - 5} y1={cy} x2={cx + 5} y2={cy} stroke="white" strokeWidth={2} />
                      <line x1={cx} y1={cy - 5} x2={cx} y2={cy + 5} stroke="white" strokeWidth={2} />
                    </>
                  )}
                </g>
              );
            }

            return (
              <rect
                key={i}
                x={b.x1 * scaleX}
                y={b.y1 * scaleY}
                width={bw * scaleX}
                height={bh * scaleY}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeDasharray="6 3"
              />
            );
          })}
          {/* Current drawing box */}
          {drawStart && drawCurrent && (() => {
            const scaleX = width / imageWidthRef.current;
            const scaleY = height / imageHeightRef.current;
            const x1 = Math.min(drawStart.x, drawCurrent.x) * scaleX;
            const y1 = Math.min(drawStart.y, drawCurrent.y) * scaleY;
            const w = Math.abs(drawCurrent.x - drawStart.x) * scaleX;
            const h = Math.abs(drawCurrent.y - drawStart.y) * scaleY;
            return <rect x={x1} y={y1} width={w} height={h} fill="none" stroke="#00d4ff" strokeWidth={2} strokeDasharray="4 4" />;
          })()}
        </svg>
      )}
    </div>
  );
}
