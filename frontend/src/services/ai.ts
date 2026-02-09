/**
 * API client functions for AI services.
 */

export interface AttributeSuggestionRequest {
  video_id: string;
  node_id: string;
  frame_idx: number;
  debug?: boolean;
  provider?: 'kimi' | 'openai' | 'gemini';
  model?: string;
}

export interface AttributeSuggestionResponse {
  visual: {
    color: string;
    texture: string;
    material: string;
  };
  physical: {
    size: string;
    shape: string;
  };
  confidence: number;
  node_id: string;
  frame_idx: number;
  category: string;
  error?: string;
  debug_info?: {
    frame_path_attempted?: string[];
    frame_exists?: boolean;
    bbox_used?: { left: number; top: number; width: number; height: number };
    error_details?: string;
  };
  cropped_image?: string;
  raw_request?: any;
  raw_response?: any;
  response_content?: string;
}

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

export const aiApi = {
  /**
   * Get AI-suggested attributes for a node at a specific frame.
   */
  suggestAttributes: (
    request: AttributeSuggestionRequest,
    signal?: AbortSignal
  ): Promise<AttributeSuggestionResponse> => {
    return fetchJson(`${API_BASE}/ai/suggest-attributes`, {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    });
  },

  /**
   * Check AI service health status.
   */
  checkHealth: (): Promise<{
    status: string;
    api_configured: boolean;
    model: string;
    temperature: number;
    thinking_enabled: boolean;
  }> => {
    return fetchJson(`${API_BASE}/ai/health`);
  },
};
