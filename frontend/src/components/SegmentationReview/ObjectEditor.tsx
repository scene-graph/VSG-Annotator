/**
 * Object editor — refinement tools for the selected mask object.
 * Uses box prompts to refine masks via SAM3.
 */

import { useState } from 'react';
import { useAppStore } from '../../store';
import { segmentationApi } from '../../services/segmentationApi';
import type { MaskObject } from '../../types';
import clsx from 'clsx';

interface ObjectEditorProps {
  videoId: string;
  object: MaskObject;
  currentFrame: number;
  userId: number | null;
}

export function ObjectEditor({ videoId, object, currentFrame, userId }: ObjectEditorProps) {
  const segmentationTool = useAppStore((s) => s.segmentationTool);
  const setSegmentationTool = useAppStore((s) => s.setSegmentationTool);
  const pendingBoxes = useAppStore((s) => s.pendingBoxes);
  const clearPendingBoxes = useAppStore((s) => s.clearPendingBoxes);
  const refinementPreviewB64 = useAppStore((s) => s.refinementPreviewB64);
  const setRefinementPreview = useAppStore((s) => s.setRefinementPreview);
  const isRefining = useAppStore((s) => s.isRefining);
  const setIsRefining = useAppStore((s) => s.setIsRefining);

  const [sam3Status, setSam3Status] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [refineError, setRefineError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Check SAM3 health on first render
  useState(() => {
    segmentationApi.getHealth()
      .then((h) => setSam3Status(h.status === 'ok' ? 'online' : 'offline'))
      .catch(() => setSam3Status('offline'));
  });

  const handleRefine = async () => {
    if (pendingBoxes.length === 0) return;
    setRefineError(null);

    try {
      const result = await segmentationApi.refine({
        video_id: videoId,
        frame_idx: currentFrame,
        object_id: object.object_id,
        boxes: pendingBoxes.map((b) => [b.x1, b.y1, b.x2, b.y2]),
        box_labels: pendingBoxes.map((b) => b.label),
      });

      if (result.error) {
        setRefineError(result.error);
      } else {
        setRefinementPreview(result.mask_b64);
      }
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSave = async () => {
    if (!refinementPreviewB64 || !userId) return;
    setSaving(true);
    try {
      await segmentationApi.save({
        video_id: videoId,
        frame_idx: currentFrame,
        object_id: object.object_id,
        mask_b64: refinementPreviewB64,
        user_id: userId,
      });
      clearPendingBoxes();
      setIsRefining(false);
      // Force MaskOverlay to re-fetch by clearing its cache entry
      // (handled by cache-busting in MaskOverlay)
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    clearPendingBoxes();
    setIsRefining(false);
    setSegmentationTool('select');
  };

  const handleStartRefine = () => {
    setIsRefining(true);
    setSegmentationTool('box');
    clearPendingBoxes();
  };

  const [propagating, setPropagating] = useState(false);
  const [propagateResult, setPropagateResult] = useState<string | null>(null);

  const handlePropagate = async () => {
    if (!refinementPreviewB64) return;
    setPropagating(true);
    setPropagateResult(null);
    try {
      const result = await segmentationApi.propagate({
        video_id: videoId,
        object_id: object.object_id,
        source_frame: currentFrame,
        mask_b64: refinementPreviewB64,
      });
      if (result.success) {
        setPropagateResult(`Propagated to ${result.frames_updated} frames`);
        clearPendingBoxes();
        setIsRefining(false);
        setSegmentationTool('select');
      } else {
        setPropagateResult(result.error || 'Propagation failed');
      }
    } catch (e) {
      setPropagateResult(e instanceof Error ? e.message : String(e));
    } finally {
      setPropagating(false);
    }
  };

  return (
    <div className="bg-gray-700/50 rounded p-3 space-y-3">
      {/* Object info header */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-sm border border-gray-500" style={{ backgroundColor: object.color_hex }} />
        <span className="text-white font-medium">{object.category}</span>
        <span className="text-gray-400 text-xs">(id: {object.object_id})</span>
      </div>

      {/* SAM3 status */}
      <div className="flex items-center gap-2 text-xs">
        <span className={clsx(
          'w-2 h-2 rounded-full',
          sam3Status === 'online' ? 'bg-green-500' : sam3Status === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
        )} />
        <span className="text-gray-400">
          SAM3: {sam3Status === 'online' ? 'Online' : sam3Status === 'offline' ? 'Offline' : 'Checking...'}
        </span>
      </div>

      {/* Refinement mode */}
      {!isRefining ? (
        <button
          onClick={handleStartRefine}
          disabled={sam3Status === 'offline'}
          className={clsx(
            'w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors',
            sam3Status === 'offline'
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          )}
        >
          {sam3Status === 'offline' ? 'SAM3 Offline' : 'Refine Mask'}
        </button>
      ) : (
        <>
          {/* Tool selector */}
          <div className="flex gap-1">
            <button
              onClick={() => setSegmentationTool('box')}
              className={clsx(
                'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors',
                segmentationTool === 'box' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
              )}
            >Box+</button>
            <button
              onClick={() => setSegmentationTool('positive_point')}
              className={clsx(
                'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors',
                segmentationTool === 'positive_point' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'
              )}
            >Point+</button>
            <button
              onClick={() => setSegmentationTool('negative_point')}
              className={clsx(
                'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors',
                segmentationTool === 'negative_point' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'
              )}
            >Point-</button>
          </div>

          <p className="text-xs text-gray-400">
            {segmentationTool === 'box'
              ? 'Draw a box around the object on the video frame'
              : segmentationTool === 'positive_point'
                ? 'Click to add positive points (include region)'
                : 'Click to add negative points (exclude region)'}
          </p>

          {/* Pending prompts count */}
          {pendingBoxes.length > 0 && (
            <div className="text-xs text-gray-300">
              {pendingBoxes.length} prompt{pendingBoxes.length > 1 ? 's' : ''} pending
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleRefine}
              disabled={pendingBoxes.length === 0}
              className={clsx(
                'flex-1 py-2 rounded text-sm font-medium transition-colors',
                pendingBoxes.length === 0
                  ? 'bg-gray-600 text-gray-400'
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              )}
            >Refine</button>

            {refinementPreviewB64 && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving || !userId}
                  className="flex-1 py-2 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Frame'}
                </button>
                <button
                  onClick={handlePropagate}
                  disabled={propagating || !userId}
                  className="flex-1 py-2 rounded text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                >
                  {propagating ? 'Propagating...' : 'Propagate All'}
                </button>
              </>
            )}

            <button
              onClick={handleCancel}
              className="flex-1 py-2 rounded text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white transition-colors"
            >Cancel</button>
          </div>

          {/* Status messages */}
          {refineError && (
            <p className="text-xs text-red-400">{refineError}</p>
          )}
          {propagateResult && (
            <p className="text-xs text-amber-400">{propagateResult}</p>
          )}
        </>
      )}
    </div>
  );
}
