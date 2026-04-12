/**
 * Main segmentation review panel — object list, opacity controls, mask visibility.
 */

import { useMemo } from 'react';
import { useAppStore, useMasksVisible, useMaskOpacity, useSelectedMaskObject, useHiddenMaskObjects } from '../../store';
import type { MaskMetadata, MaskObject, Node } from '../../types';
import { ObjectEditor } from './ObjectEditor';
import clsx from 'clsx';

interface SegmentationReviewProps {
  videoId: string;
  maskMetadata: MaskMetadata | null;
  nodes: Node[];
  currentFrame: number;
}

export function SegmentationReview({ videoId, maskMetadata, nodes, currentFrame }: SegmentationReviewProps) {
  const masksVisible = useMasksVisible();
  const setMasksVisible = useAppStore((state) => state.setMasksVisible);
  const maskOpacity = useMaskOpacity();
  const setMaskOpacity = useAppStore((state) => state.setMaskOpacity);
  const selectedMaskObject = useSelectedMaskObject();
  const setSelectedMaskObject = useAppStore((state) => state.setSelectedMaskObject);
  const hiddenMaskObjects = useHiddenMaskObjects();
  const toggleMaskObject = useAppStore((state) => state.toggleMaskObject);
  const setSelectedNode = useAppStore((state) => state.setSelectedNode);
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);

  if (!maskMetadata?.has_masks) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <p className="text-gray-400">No masks available for this video</p>
      </div>
    );
  }

  const handleObjectClick = (obj: MaskObject) => {
    const newId = selectedMaskObject === obj.object_id ? null : obj.object_id;
    setSelectedMaskObject(newId);
    if (newId != null) {
      const node = nodes.find(n => n.object_id === newId);
      if (node) setSelectedNode(node);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-white text-sm font-semibold">Segmentation</span>
        <span className="text-gray-400 text-xs">{maskMetadata.objects.length} objects</span>
      </div>

      {/* Controls */}
      <div className="mb-4 space-y-3">
        {/* Visibility toggle */}
        <div className="flex items-center justify-between">
          <label className="text-gray-400 text-xs uppercase">Mask Overlay</label>
          <button
            onClick={() => setMasksVisible(!masksVisible)}
            className={clsx(
              'px-3 py-1 rounded text-xs font-medium transition-colors',
              masksVisible
                ? 'bg-purple-600 text-white'
                : 'bg-gray-700 text-gray-300'
            )}
          >
            {masksVisible ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Opacity slider */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-gray-400 text-xs uppercase">Opacity</label>
            <span className="text-gray-400 text-xs">{Math.round(maskOpacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(maskOpacity * 100)}
            onChange={(e) => setMaskOpacity(Number(e.target.value) / 100)}
            className="w-full h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Sparse mask frame navigation (composite format) */}
        {maskMetadata.available_frames && maskMetadata.available_frames.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-gray-400 text-xs uppercase">Annotated Frames</label>
              <span className="text-gray-400 text-xs">{maskMetadata.available_frames.length} frames</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  const af = maskMetadata.available_frames!;
                  const prev = af.filter(f => f < currentFrame);
                  if (prev.length > 0) setCurrentFrame(prev[prev.length - 1]);
                  else setCurrentFrame(af[af.length - 1]); // wrap
                }}
                className="flex-1 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-white"
              >Prev Mask</button>
              <button
                onClick={() => {
                  const af = maskMetadata.available_frames!;
                  const next = af.filter(f => f > currentFrame);
                  if (next.length > 0) setCurrentFrame(next[0]);
                  else setCurrentFrame(af[0]); // wrap
                }}
                className="flex-1 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-white"
              >Next Mask</button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Current frame: {currentFrame} {maskMetadata.available_frames.includes(currentFrame) ? '(has mask)' : '(no mask)'}
            </p>
          </div>
        )}
      </div>

      {/* Selected object editor */}
      {selectedMaskObject != null && (() => {
        const selectedObj = maskMetadata.objects.find(o => o.object_id === selectedMaskObject);
        return selectedObj ? (
          <ObjectEditor
            videoId={videoId}
            object={selectedObj}
            currentFrame={currentFrame}
            userId={currentUser?.id ?? null}
          />
        ) : null;
      })()}

      {/* Object list */}
      <div className="space-y-1">
        <div className="text-gray-400 text-xs uppercase mb-2">Objects</div>
        {maskMetadata.objects.map((obj) => {
          const isSelected = selectedMaskObject === obj.object_id;
          const isHidden = hiddenMaskObjects.has(obj.object_id);

          return (
            <div
              key={obj.object_id}
              className={clsx(
                'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                isSelected ? 'bg-purple-600/30 border border-purple-500' : 'hover:bg-gray-700 border border-transparent',
              )}
              onClick={() => handleObjectClick(obj)}
            >
              {/* Color swatch */}
              <div
                className="w-4 h-4 rounded-sm flex-shrink-0 border border-gray-500"
                style={{ backgroundColor: obj.color_hex }}
              />

              {/* Category + ID */}
              <div className="flex-1 min-w-0">
                <span className="text-white text-sm truncate block">{obj.category}</span>
                <span className="text-gray-500 text-xs">{obj.node_id} (id: {obj.object_id})</span>
              </div>

              {/* Static/dynamic badge */}
              <span className={clsx(
                'px-1.5 py-0.5 rounded text-xs flex-shrink-0',
                obj.is_static ? 'bg-gray-600 text-gray-300' : 'bg-orange-600/30 text-orange-300'
              )}>
                {obj.is_static ? 'S' : 'D'}
              </span>

              {/* Visibility toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleMaskObject(obj.object_id); }}
                className={clsx(
                  'p-1 rounded transition-colors flex-shrink-0',
                  isHidden ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-white'
                )}
                title={isHidden ? 'Show mask' : 'Hide mask'}
              >
                {isHidden ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
