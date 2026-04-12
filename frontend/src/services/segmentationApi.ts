/**
 * API client for mask and segmentation services.
 */

import type { MaskMetadata } from '../types';

const API_BASE = '/api';

export interface RefinementPoint {
  x: number;
  y: number;
  label: boolean; // true=positive, false=negative
}

export const masksApi = {
  /** Get mask metadata: objects, colors, frame count. */
  getMetadata: async (videoId: string): Promise<MaskMetadata> => {
    const resp = await fetch(`${API_BASE}/videos/${videoId}/masks/metadata`);
    if (!resp.ok) throw new Error(`Mask metadata: ${resp.status}`);
    return resp.json();
  },

  /** Build a URL for the raw panoptic mask PNG (for <img> or fetch). */
  getMaskFrameUrl: (videoId: string, frameIdx: number): string =>
    `${API_BASE}/videos/${videoId}/masks/frame/${frameIdx}`,

  /** Get objects present at a specific frame with bboxes. */
  getObjectsAtFrame: async (videoId: string, frameIdx: number) => {
    const resp = await fetch(`${API_BASE}/videos/${videoId}/masks/objects-at-frame/${frameIdx}`);
    if (!resp.ok) throw new Error(`Objects at frame: ${resp.status}`);
    return resp.json();
  },
};

export const segmentationApi = {
  /** Check SAM3 worker health. */
  getHealth: async (): Promise<{ status: string; model: string | null; device: string | null; gpu_name?: string }> => {
    const resp = await fetch(`${API_BASE}/segmentation/health`);
    if (!resp.ok) throw new Error(`Segmentation health: ${resp.status}`);
    return resp.json();
  },

  /** Refine a mask using box prompts via SAM3. */
  refine: async (data: {
    video_id: string;
    frame_idx: number;
    object_id: number;
    boxes: number[][];
    box_labels: number[];
    text_prompt?: string;
  }): Promise<{ mask_b64: string; score: number; simulated: boolean; error?: string }> => {
    const resp = await fetch(`${API_BASE}/segmentation/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || `Refine failed: ${resp.status}`);
    }
    return resp.json();
  },

  /** Propagate a mask from one frame to all frames via SAM3. */
  propagate: async (data: {
    video_id: string;
    object_id: number;
    source_frame: number;
    mask_b64: string;
  }): Promise<{ success: boolean; frames_updated: number; error?: string }> => {
    const resp = await fetch(`${API_BASE}/segmentation/propagate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || `Propagate failed: ${resp.status}`);
    }
    return resp.json();
  },

  /** Save a refined mask back to the panoptic PNG. */
  save: async (data: {
    video_id: string;
    frame_idx: number;
    object_id: number;
    mask_b64: string;
    user_id: number;
  }): Promise<{ success: boolean }> => {
    const resp = await fetch(`${API_BASE}/segmentation/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || `Save failed: ${resp.status}`);
    }
    return resp.json();
  },
};
