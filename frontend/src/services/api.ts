import type {
  AnnotationAccept,
  AnnotationCreate,
  AnnotationModify,
  AnnotationReject,
  Edge,
  EdgeFilters,
  EdgeStats,
  Node,
  Revision,
  User,
  VideoDetail,
  VideoSummary,
} from '../types';

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

// Videos API
export const videosApi = {
  list: (status?: string, dataset?: string): Promise<VideoSummary[]> => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (dataset) params.set('dataset', dataset);
    const query = params.toString();
    return fetchJson(`${API_BASE}/videos${query ? `?${query}` : ''}`);
  },

  get: (videoId: string): Promise<VideoDetail> => {
    return fetchJson(`${API_BASE}/videos/${videoId}`);
  },

  getFrameUrl: (videoId: string, frameIdx: number): string => {
    return `${API_BASE}/videos/${videoId}/frame/${frameIdx}`;
  },

  getNodes: (videoId: string, isStatic?: boolean, frame?: number): Promise<Node[]> => {
    const params = new URLSearchParams();
    if (isStatic !== undefined) params.set('is_static', String(isStatic));
    if (frame !== undefined) params.set('frame', String(frame));
    const query = params.toString();
    return fetchJson(`${API_BASE}/videos/${videoId}/nodes${query ? `?${query}` : ''}`);
  },

  getNode: (videoId: string, nodeId: string): Promise<Node> => {
    return fetchJson(`${API_BASE}/videos/${videoId}/nodes/${nodeId}`);
  },

  getMetadata: (videoId: string): Promise<Record<string, unknown>> => {
    return fetchJson(`${API_BASE}/videos/${videoId}/metadata`);
  },
};

// Edges API
export const edgesApi = {
  list: (videoId: string, filters?: EdgeFilters): Promise<Edge[]> => {
    const params = new URLSearchParams();
    if (filters) {
      if (filters.edge_type) params.set('edge_type', filters.edge_type);
      if (filters.min_confidence !== undefined) params.set('min_confidence', String(filters.min_confidence));
      if (filters.max_confidence !== undefined) params.set('max_confidence', String(filters.max_confidence));
      if (filters.validated !== undefined) params.set('validated', String(filters.validated));
      if (filters.extraction_round !== undefined) params.set('extraction_round', String(filters.extraction_round));
      if (filters.predicate) params.set('predicate', filters.predicate);
      if (filters.frame !== undefined) params.set('frame', String(filters.frame));
    }
    const query = params.toString();
    return fetchJson(`${API_BASE}/videos/${videoId}/edges${query ? `?${query}` : ''}`);
  },

  get: (videoId: string, edgeId: string): Promise<Edge> => {
    return fetchJson(`${API_BASE}/videos/${videoId}/edges/${edgeId}`);
  },

  getStats: (videoId: string): Promise<EdgeStats> => {
    return fetchJson(`${API_BASE}/videos/${videoId}/edges/stats`);
  },

  getPredicates: (videoId: string, edgeType?: string): Promise<{ predicates?: string[]; static?: string[]; dynamic?: string[]; fg_bg?: string[] }> => {
    const params = edgeType ? `?edge_type=${edgeType}` : '';
    return fetchJson(`${API_BASE}/videos/${videoId}/edges/predicates${params}`);
  },

  getMotionValues: (): Promise<{ velocity: string[]; direction: string[]; trajectory: string[] }> => {
    return fetchJson(`${API_BASE}/videos/placeholder/edges/motion-values`);
  },

  getHistory: (videoId: string, edgeId: string): Promise<Revision[]> => {
    return fetchJson(`${API_BASE}/videos/${videoId}/edges/${edgeId}/history`);
  },
};

// Annotations API
export const annotationsApi = {
  accept: (annotation: AnnotationAccept): Promise<{ success: boolean; revision_id: number }> => {
    return fetchJson(`${API_BASE}/annotations/accept`, {
      method: 'POST',
      body: JSON.stringify(annotation),
    });
  },

  reject: (annotation: AnnotationReject): Promise<{ success: boolean; revision_id: number }> => {
    return fetchJson(`${API_BASE}/annotations/reject`, {
      method: 'POST',
      body: JSON.stringify(annotation),
    });
  },

  modify: (annotation: AnnotationModify): Promise<{ success: boolean; revision_id: number }> => {
    return fetchJson(`${API_BASE}/annotations/modify`, {
      method: 'POST',
      body: JSON.stringify(annotation),
    });
  },

  create: (annotation: AnnotationCreate): Promise<{ success: boolean; revision_id: number; edge_id: string }> => {
    return fetchJson(`${API_BASE}/annotations/create`, {
      method: 'POST',
      body: JSON.stringify(annotation),
    });
  },

  getHistory: (videoId: string, edgeId: string): Promise<Revision[]> => {
    return fetchJson(`${API_BASE}/annotations/history/${videoId}/${edgeId}`);
  },
};

// Export API
export const exportApi = {
  export: (
    videoId: string,
    includeRejected?: boolean,
    applyModifications?: boolean,
    userId?: number
  ): Promise<{ video_id: string; exported_at: string; vsg: Record<string, unknown>; revision_summary: Record<string, number> }> => {
    const params = new URLSearchParams();
    if (includeRejected !== undefined) params.set('include_rejected', String(includeRejected));
    if (applyModifications !== undefined) params.set('apply_modifications', String(applyModifications));
    if (userId !== undefined) params.set('user_id', String(userId));
    const query = params.toString();
    return fetchJson(`${API_BASE}/export/${videoId}${query ? `?${query}` : ''}`, {
      method: 'POST',
    });
  },

  getDownloadUrl: (videoId: string, includeRejected?: boolean, applyModifications?: boolean, userId?: number): string => {
    const params = new URLSearchParams();
    if (includeRejected !== undefined) params.set('include_rejected', String(includeRejected));
    if (applyModifications !== undefined) params.set('apply_modifications', String(applyModifications));
    if (userId !== undefined) params.set('user_id', String(userId));
    const query = params.toString();
    return `${API_BASE}/export/${videoId}/download${query ? `?${query}` : ''}`;
  },

  getSummary: (videoId: string): Promise<{ video_id: string; original: Record<string, unknown>; revisions: Record<string, number> }> => {
    return fetchJson(`${API_BASE}/export/${videoId}/summary`);
  },
};

// Users API
export const usersApi = {
  list: (): Promise<User[]> => {
    return fetchJson(`${API_BASE}/users`);
  },

  create: (username: string): Promise<User> => {
    return fetchJson(`${API_BASE}/users`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  },

  get: (userId: number): Promise<User> => {
    return fetchJson(`${API_BASE}/users/${userId}`);
  },

  delete: (userId: number): Promise<{ success: boolean }> => {
    return fetchJson(`${API_BASE}/users/${userId}`, {
      method: 'DELETE',
    });
  },
};
