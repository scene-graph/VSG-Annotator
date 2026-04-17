import { create } from 'zustand';
import type { Edge, EdgeFilters, EdgeType, Node, User, VideoDetail } from '../types';
import type { AttributeSuggestionResponse } from '../services/ai';

// Edge drag state for sharing between EdgeTimeline and TrackletTimeline
export interface EdgeDragState {
  edgeId: string;
  segmentIndex: number;
  handle: 'left' | 'right';
  currentStartFrame: number;
  currentEndFrame: number;
}

// Annotation mode: viewing nodes or edges
export type AnnotationMode = 'nodes' | 'edges' | 'segmentation';

// Edge creation state
export type EdgeCreationStep = 'select-source' | 'select-target' | 'configure';

export interface EdgeCreationState {
  isCreating: boolean;
  step: EdgeCreationStep;
  sourceNodeIds: string[];
  targetNodeIds: string[];
  edgeType: EdgeType | null;
}

const AI_SUGGESTION_STORAGE_VERSION = 1;

type AISuggestionSource = 'bulk' | 'single';

interface AppState {
  // Current video
  currentVideo: VideoDetail | null;
  setCurrentVideo: (video: VideoDetail | null) => void;

  // Current frame
  currentFrame: number;
  setCurrentFrame: (frame: number) => void;

  // Nodes
  nodes: Node[];
  setNodes: (nodes: Node[]) => void;

  // Edges
  edges: Edge[];
  setEdges: (edges: Edge[]) => void;

  // Selected edge (mutually exclusive with selectedNode)
  selectedEdge: Edge | null;
  setSelectedEdge: (edge: Edge | null) => void;

  // Selected node (mutually exclusive with selectedEdge)
  selectedNode: Node | null;
  setSelectedNode: (node: Node | null) => void;

  // Annotation mode (auto-switches based on selection)
  annotationMode: AnnotationMode;
  setAnnotationMode: (mode: AnnotationMode) => void;

  // Filters
  filters: EdgeFilters;
  setFilters: (filters: EdgeFilters) => void;
  updateFilter: <K extends keyof EdgeFilters>(key: K, value: EdgeFilters[K]) => void;
  clearFilters: () => void;

  // User
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;

  // UI State
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;

  showValidationReasoning: boolean;
  setShowValidationReasoning: (show: boolean) => void;

  // Source/Target nodes (for bbox overlay differentiation)
  sourceNodes: string[];
  targetNodes: string[];
  setSourceNodes: (nodeIds: string[]) => void;
  setTargetNodes: (nodeIds: string[]) => void;

  // Video list source filter (persists across navigation)
  sourceFilter: string;
  setSourceFilter: (filter: string) => void;

  // Edge drag state (for syncing EdgeTimeline drag with TrackletTimeline)
  edgeDragState: EdgeDragState | null;
  setEdgeDragState: (state: EdgeDragState | null) => void;

  // Edge creation state
  edgeCreation: EdgeCreationState;
  startEdgeCreation: () => void;
  cancelEdgeCreation: () => void;
  toggleSourceNode: (nodeId: string) => void;
  toggleTargetNode: (nodeId: string) => void;
  proceedToTarget: () => void;
  proceedToConfigure: () => void;
  setEdgeCreationType: (edgeType: EdgeType | null) => void;

  // BBox overlay state
  bboxesVisible: boolean;
  setBboxesVisible: (v: boolean) => void;

  // Mask overlay state
  masksVisible: boolean;
  setMasksVisible: (v: boolean) => void;
  maskOpacity: number;
  setMaskOpacity: (v: number) => void;
  selectedMaskObject: number | string | null;
  setSelectedMaskObject: (id: number | string | null) => void;
  hiddenMaskObjects: Set<number | string>;
  toggleMaskObject: (id: number | string) => void;

  // Refinement tools
  segmentationTool: string;
  setSegmentationTool: (tool: string) => void;
  pendingBoxes: Array<{ x1: number; y1: number; x2: number; y2: number; label: number }>;
  addPendingBox: (box: { x1: number; y1: number; x2: number; y2: number; label: number }) => void;
  clearPendingBoxes: () => void;
  refinementPreviewB64: string | null;
  setRefinementPreview: (b64: string | null) => void;
  isRefining: boolean;
  setIsRefining: (v: boolean) => void;

  // AI suggestions (node attributes)
  aiProvider: 'openai' | 'gemini';
  setAiProvider: (provider: 'openai' | 'gemini') => void;
  aiSuggestionsByNode: Record<string, AttributeSuggestionResponse>;
  aiSuggestionStatusByNode: Record<string, 'idle' | 'pending' | 'done' | 'error'>;
  aiSuggestionFrameByNode: Record<string, number>;
  aiSuggestionSourceByNode: Record<string, AISuggestionSource>;
  bulkAiProgress: { total: number; completed: number; running: boolean; cancelled: boolean };
  setAiSuggestion: (
    nodeId: string,
    suggestion: AttributeSuggestionResponse,
    frameIdx: number,
    source: AISuggestionSource
  ) => void;
  setAiSuggestionStatus: (nodeId: string, status: 'idle' | 'pending' | 'done' | 'error') => void;
  clearAiSuggestion: (nodeId: string) => void;
  startBulkAi: (total: number) => void;
  updateBulkAiProgress: (completed: number) => void;
  finishBulkAi: () => void;
  cancelBulkAi: () => void;
  resetBulkAi: () => void;

  // Persistence helpers
  hydrateAiSuggestions: (videoId: string) => void;
  clearAiSuggestions: () => void;
}

const initialFilters: EdgeFilters = {};

type AiSnapshot = Pick<
  AppState,
  | 'aiSuggestionsByNode'
  | 'aiSuggestionFrameByNode'
  | 'aiSuggestionSourceByNode'
  | 'aiSuggestionStatusByNode'
  | 'bulkAiProgress'
>;

const buildAiSnapshot = (state: AppState, overrides: Partial<AiSnapshot> = {}): AiSnapshot => ({
  aiSuggestionsByNode: overrides.aiSuggestionsByNode ?? state.aiSuggestionsByNode,
  aiSuggestionFrameByNode: overrides.aiSuggestionFrameByNode ?? state.aiSuggestionFrameByNode,
  aiSuggestionSourceByNode: overrides.aiSuggestionSourceByNode ?? state.aiSuggestionSourceByNode,
  aiSuggestionStatusByNode: overrides.aiSuggestionStatusByNode ?? state.aiSuggestionStatusByNode,
  bulkAiProgress: overrides.bulkAiProgress ?? state.bulkAiProgress,
});

const persistAiSnapshot = (videoId: string, snapshot: AiSnapshot) => {
  if (!videoId || typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(
    `ai_suggestions:${videoId}`,
    JSON.stringify({ version: AI_SUGGESTION_STORAGE_VERSION, ...snapshot })
  );
};

export const useAppStore = create<AppState>((set) => ({
  // Current video
  currentVideo: null,
  setCurrentVideo: (video) => set({
    currentVideo: video,
    currentFrame: 0  // Reset frame when switching videos
  }),

  // Current frame
  currentFrame: 0,
  setCurrentFrame: (frame) => set((state) => {
    // Validate frame is within bounds
    const video = state.currentVideo;
    if (video && video.total_frames) {
      // Clamp frame to valid range [0, totalFrames - 1]
      const validFrame = Math.max(0, Math.min(frame, video.total_frames - 1));
      return { currentFrame: validFrame };
    }
    // If no video or total_frames, just ensure non-negative
    return { currentFrame: Math.max(0, frame) };
  }),

  // Nodes
  nodes: [],
  setNodes: (nodes) => set({ nodes }),

  // Edges
  edges: [],
  setEdges: (edges) => set({ edges }),

  // Selected edge (mutually exclusive with selectedNode)
  selectedEdge: null,
  setSelectedEdge: (edge) => {
    // When selecting an edge, clear selected node and track source/target nodes
    if (edge) {
      const sources = Array.isArray(edge.source) ? edge.source : [edge.source];
      const targets = Array.isArray(edge.target) ? edge.target : [edge.target];
      set({
        selectedEdge: edge,
        selectedNode: null,  // Clear node selection
        sourceNodes: sources,
        targetNodes: targets,
        annotationMode: 'edges',  // Auto-switch to edges mode
      });
    } else {
      set({ selectedEdge: null, sourceNodes: [], targetNodes: [] });
    }
  },

  // Selected node (mutually exclusive with selectedEdge)
  selectedNode: null,
  setSelectedNode: (node) => {
    // When selecting a node, clear selected edge
    if (node) {
      set({
        selectedNode: node,
        selectedEdge: null,  // Clear edge selection
        sourceNodes: [],
        targetNodes: [],
        annotationMode: 'nodes',  // Auto-switch to nodes mode
      });
    } else {
      set({ selectedNode: null });
    }
  },

  // Annotation mode
  annotationMode: 'edges',
  setAnnotationMode: (mode) => set({ annotationMode: mode }),

  // Filters
  filters: initialFilters,
  setFilters: (filters) => set({ filters }),
  updateFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  clearFilters: () => set({ filters: initialFilters }),

  // User — default to admin
  currentUser: { id: 1, username: 'admin' },
  setCurrentUser: (user) => set({ currentUser: user }),

  // UI State
  isPlaying: false,
  setIsPlaying: (playing) => set({ isPlaying: playing }),

  showValidationReasoning: true,
  setShowValidationReasoning: (show) => set({ showValidationReasoning: show }),

  // Source/Target nodes
  sourceNodes: [],
  targetNodes: [],
  setSourceNodes: (nodeIds) => set({ sourceNodes: nodeIds }),
  setTargetNodes: (nodeIds) => set({ targetNodes: nodeIds }),

  // Video list source filter
  sourceFilter: 'all',
  setSourceFilter: (filter) => set({ sourceFilter: filter }),

  // Edge drag state
  edgeDragState: null,
  setEdgeDragState: (state) => set({ edgeDragState: state }),

  // Edge creation state
  edgeCreation: {
    isCreating: false,
    step: 'select-source',
    sourceNodeIds: [],
    targetNodeIds: [],
    edgeType: null,
  },
  startEdgeCreation: () =>
    set({
      edgeCreation: {
        isCreating: true,
        step: 'select-source',
        sourceNodeIds: [],
        targetNodeIds: [],
        edgeType: null,
      },
      selectedEdge: null,
      selectedNode: null,
      sourceNodes: [],
      targetNodes: [],
    }),
  cancelEdgeCreation: () =>
    set({
      edgeCreation: {
        isCreating: false,
        step: 'select-source',
        sourceNodeIds: [],
        targetNodeIds: [],
        edgeType: null,
      },
      sourceNodes: [],
      targetNodes: [],
    }),
  toggleSourceNode: (nodeId) =>
    set((state) => {
      const currentSources = state.edgeCreation.sourceNodeIds;
      const newSources = currentSources.includes(nodeId)
        ? currentSources.filter((id) => id !== nodeId)
        : [...currentSources, nodeId];
      return {
        edgeCreation: { ...state.edgeCreation, sourceNodeIds: newSources },
        sourceNodes: newSources,
      };
    }),
  toggleTargetNode: (nodeId) =>
    set((state) => {
      const currentTargets = state.edgeCreation.targetNodeIds;
      const newTargets = currentTargets.includes(nodeId)
        ? currentTargets.filter((id) => id !== nodeId)
        : [...currentTargets, nodeId];
      return {
        edgeCreation: { ...state.edgeCreation, targetNodeIds: newTargets },
        targetNodes: newTargets,
      };
    }),
  proceedToTarget: () =>
    set((state) => ({
      edgeCreation: { ...state.edgeCreation, step: 'select-target' },
    })),
  proceedToConfigure: () =>
    set((state) => ({
      edgeCreation: { ...state.edgeCreation, step: 'configure' },
    })),
  setEdgeCreationType: (edgeType) =>
    set((state) => ({
      edgeCreation: { ...state.edgeCreation, edgeType },
    })),

  // BBox overlay state
  bboxesVisible: true,
  setBboxesVisible: (v) => set({ bboxesVisible: v }),

  // Mask overlay state
  masksVisible: false,
  setMasksVisible: (v) => set({ masksVisible: v }),
  maskOpacity: 0.45,
  setMaskOpacity: (v) => set({ maskOpacity: v }),
  selectedMaskObject: null,
  setSelectedMaskObject: (id) => set({ selectedMaskObject: id }),
  hiddenMaskObjects: new Set<number | string>(),
  toggleMaskObject: (id) =>
    set((state) => {
      const next = new Set(state.hiddenMaskObjects);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { hiddenMaskObjects: next };
    }),

  // Refinement tools
  segmentationTool: 'select',
  setSegmentationTool: (tool) => set({ segmentationTool: tool }),
  pendingBoxes: [],
  addPendingBox: (box) => set((state) => ({ pendingBoxes: [...state.pendingBoxes, box] })),
  clearPendingBoxes: () => set({ pendingBoxes: [], refinementPreviewB64: null }),
  refinementPreviewB64: null,
  setRefinementPreview: (b64) => set({ refinementPreviewB64: b64 }),
  isRefining: false,
  setIsRefining: (v) => set({ isRefining: v }),

  // AI suggestions
  aiProvider: 'gemini',
  setAiProvider: (provider) => set({ aiProvider: provider }),
  aiSuggestionsByNode: {},
  aiSuggestionStatusByNode: {},
  aiSuggestionFrameByNode: {},
  aiSuggestionSourceByNode: {},
  bulkAiProgress: { total: 0, completed: 0, running: false, cancelled: false },
  setAiSuggestion: (nodeId, suggestion, frameIdx, source) =>
    set((state) => {
      const next = {
        aiSuggestionsByNode: { ...state.aiSuggestionsByNode, [nodeId]: suggestion },
        aiSuggestionFrameByNode: { ...state.aiSuggestionFrameByNode, [nodeId]: frameIdx },
        aiSuggestionSourceByNode: { ...state.aiSuggestionSourceByNode, [nodeId]: source },
        aiSuggestionStatusByNode: { ...state.aiSuggestionStatusByNode, [nodeId]: 'done' },
      };
      const videoId = state.currentVideo?.video_id;
      if (videoId) {
        persistAiSnapshot(videoId, buildAiSnapshot(state, next));
      }
      return next;
    }),
  setAiSuggestionStatus: (nodeId, status) =>
    set((state) => {
      const next = {
        aiSuggestionStatusByNode: { ...state.aiSuggestionStatusByNode, [nodeId]: status },
      };
      const videoId = state.currentVideo?.video_id;
      if (videoId) {
        persistAiSnapshot(
          videoId,
          buildAiSnapshot(state, { aiSuggestionStatusByNode: next.aiSuggestionStatusByNode })
        );
      }
      return next;
    }),
  clearAiSuggestion: (nodeId) =>
    set((state) => {
      const { [nodeId]: _removedSuggestion, ...remainingSuggestions } = state.aiSuggestionsByNode;
      const { [nodeId]: _removedFrame, ...remainingFrames } = state.aiSuggestionFrameByNode;
      const { [nodeId]: _removedSource, ...remainingSources } = state.aiSuggestionSourceByNode;
      const next = {
        aiSuggestionsByNode: remainingSuggestions,
        aiSuggestionFrameByNode: remainingFrames,
        aiSuggestionSourceByNode: remainingSources,
        aiSuggestionStatusByNode: { ...state.aiSuggestionStatusByNode, [nodeId]: 'idle' },
      };
      const videoId = state.currentVideo?.video_id;
      if (videoId) {
        persistAiSnapshot(videoId, buildAiSnapshot(state, next));
      }
      return next;
    }),
  startBulkAi: (total) =>
    set((state) => {
      const next = { bulkAiProgress: { total, completed: 0, running: true, cancelled: false } };
      const videoId = state.currentVideo?.video_id;
      if (videoId) {
        persistAiSnapshot(videoId, buildAiSnapshot(state, next));
      }
      return next;
    }),
  updateBulkAiProgress: (completed) =>
    set((state) => {
      const next = { bulkAiProgress: { ...state.bulkAiProgress, completed } };
      const videoId = state.currentVideo?.video_id;
      if (videoId) {
        persistAiSnapshot(videoId, buildAiSnapshot(state, next));
      }
      return next;
    }),
  finishBulkAi: () =>
    set((state) => {
      const next = { bulkAiProgress: { ...state.bulkAiProgress, running: false } };
      const videoId = state.currentVideo?.video_id;
      if (videoId) {
        persistAiSnapshot(videoId, buildAiSnapshot(state, next));
      }
      return next;
    }),
  cancelBulkAi: () =>
    set((state) => {
      const next = { bulkAiProgress: { ...state.bulkAiProgress, cancelled: true, running: false } };
      const videoId = state.currentVideo?.video_id;
      if (videoId) {
        persistAiSnapshot(videoId, buildAiSnapshot(state, next));
      }
      return next;
    }),
  resetBulkAi: () =>
    set({
      bulkAiProgress: { total: 0, completed: 0, running: false, cancelled: false },
    }),

  hydrateAiSuggestions: (videoId) =>
    set(() => {
      if (!videoId || typeof localStorage === 'undefined') {
        return {
          aiSuggestionsByNode: {},
          aiSuggestionStatusByNode: {},
          aiSuggestionFrameByNode: {},
          aiSuggestionSourceByNode: {},
          bulkAiProgress: { total: 0, completed: 0, running: false, cancelled: false },
        };
      }
      try {
        const raw = localStorage.getItem(`ai_suggestions:${videoId}`);
        if (!raw) {
          return {
            aiSuggestionsByNode: {},
            aiSuggestionStatusByNode: {},
            aiSuggestionFrameByNode: {},
            aiSuggestionSourceByNode: {},
            bulkAiProgress: { total: 0, completed: 0, running: false, cancelled: false },
          };
        }
        const parsed = JSON.parse(raw);
        if (parsed?.version !== AI_SUGGESTION_STORAGE_VERSION) {
          return {
            aiSuggestionsByNode: {},
            aiSuggestionStatusByNode: {},
            aiSuggestionFrameByNode: {},
            aiSuggestionSourceByNode: {},
            bulkAiProgress: { total: 0, completed: 0, running: false, cancelled: false },
          };
        }
        const storedProgress = parsed.bulkAiProgress;
        const bulkAiProgress = storedProgress && typeof storedProgress.total === 'number'
          ? {
              total: storedProgress.total,
              completed: storedProgress.completed ?? 0,
              running: false,
              cancelled: false,
            }
          : { total: 0, completed: 0, running: false, cancelled: false };
        return {
          aiSuggestionsByNode: parsed.aiSuggestionsByNode || {},
          aiSuggestionStatusByNode: parsed.aiSuggestionStatusByNode || {},
          aiSuggestionFrameByNode: parsed.aiSuggestionFrameByNode || {},
          aiSuggestionSourceByNode: parsed.aiSuggestionSourceByNode || {},
          bulkAiProgress,
        };
      } catch {
        return {
          aiSuggestionsByNode: {},
          aiSuggestionStatusByNode: {},
          aiSuggestionFrameByNode: {},
          aiSuggestionSourceByNode: {},
          bulkAiProgress: { total: 0, completed: 0, running: false, cancelled: false },
        };
      }
    }),

  clearAiSuggestions: () =>
    set((state) => {
      const videoId = state.currentVideo?.video_id;
      if (videoId && typeof localStorage !== 'undefined') {
        localStorage.removeItem(`ai_suggestions:${videoId}`);
      }
      return {
        aiSuggestionsByNode: {},
        aiSuggestionStatusByNode: {},
        aiSuggestionFrameByNode: {},
        aiSuggestionSourceByNode: {},
        bulkAiProgress: { total: 0, completed: 0, running: false, cancelled: false },
      };
    }),
}));

// Selectors
export const useCurrentVideo = () => useAppStore((state) => state.currentVideo);
export const useCurrentFrame = () => useAppStore((state) => state.currentFrame);
export const useNodes = () => useAppStore((state) => state.nodes);
export const useEdges = () => useAppStore((state) => state.edges);
export const useSelectedEdge = () => useAppStore((state) => state.selectedEdge);
export const useSelectedNode = () => useAppStore((state) => state.selectedNode);
export const useAnnotationMode = () => useAppStore((state) => state.annotationMode);
export const useFilters = () => useAppStore((state) => state.filters);
export const useCurrentUser = () => useAppStore((state) => state.currentUser);
export const useSourceNodes = () => useAppStore((state) => state.sourceNodes);
export const useTargetNodes = () => useAppStore((state) => state.targetNodes);
export const useEdgeDragState = () => useAppStore((state) => state.edgeDragState);
export const useEdgeCreation = () => useAppStore((state) => state.edgeCreation);
export const useAiSuggestionsByNode = () => useAppStore((state) => state.aiSuggestionsByNode);
export const useAiSuggestionStatusByNode = () => useAppStore((state) => state.aiSuggestionStatusByNode);
export const useAiSuggestionFrameByNode = () => useAppStore((state) => state.aiSuggestionFrameByNode);
export const useAiSuggestionSourceByNode = () => useAppStore((state) => state.aiSuggestionSourceByNode);
export const useBulkAiProgress = () => useAppStore((state) => state.bulkAiProgress);
export const useAiProvider = () => useAppStore((state) => state.aiProvider);
export const useSetAiProvider = () => useAppStore((state) => state.setAiProvider);
export const useResetBulkAi = () => useAppStore((state) => state.resetBulkAi);
export const useHydrateAiSuggestions = () => useAppStore((state) => state.hydrateAiSuggestions);
export const useClearAiSuggestions = () => useAppStore((state) => state.clearAiSuggestions);

// BBox overlay selector
export const useBboxesVisible = () => useAppStore((state) => state.bboxesVisible);

// Mask overlay selectors
export const useMasksVisible = () => useAppStore((state) => state.masksVisible);
export const useMaskOpacity = () => useAppStore((state) => state.maskOpacity);
export const useSelectedMaskObject = () => useAppStore((state) => state.selectedMaskObject);
export const useHiddenMaskObjects = () => useAppStore((state) => state.hiddenMaskObjects);
