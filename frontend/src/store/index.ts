import { create } from 'zustand';
import type { Edge, EdgeFilters, EdgeType, Node, User, VideoDetail } from '../types';

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

  // Selected edge
  selectedEdge: Edge | null;
  setSelectedEdge: (edge: Edge | null) => void;

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
}

const initialFilters: EdgeFilters = {};

export const useAppStore = create<AppState>((set) => ({
  // Current video
  currentVideo: null,
  setCurrentVideo: (video) => set({ currentVideo: video }),

  // Current frame
  currentFrame: 0,
  setCurrentFrame: (frame) => set({ currentFrame: frame }),

  // Nodes
  nodes: [],
  setNodes: (nodes) => set({ nodes }),

  // Edges
  edges: [],
  setEdges: (edges) => set({ edges }),

  // Selected edge
  selectedEdge: null,
  setSelectedEdge: (edge) => {
    // When selecting an edge, track source and target nodes separately
    if (edge) {
      const sources = Array.isArray(edge.source) ? edge.source : [edge.source];
      const targets = Array.isArray(edge.target) ? edge.target : [edge.target];
      set({ selectedEdge: edge, sourceNodes: sources, targetNodes: targets });
    } else {
      set({ selectedEdge: null, sourceNodes: [], targetNodes: [] });
    }
  },

  // Filters
  filters: initialFilters,
  setFilters: (filters) => set({ filters }),
  updateFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  clearFilters: () => set({ filters: initialFilters }),

  // User
  currentUser: null,
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
}));

// Selectors
export const useCurrentVideo = () => useAppStore((state) => state.currentVideo);
export const useCurrentFrame = () => useAppStore((state) => state.currentFrame);
export const useNodes = () => useAppStore((state) => state.nodes);
export const useEdges = () => useAppStore((state) => state.edges);
export const useSelectedEdge = () => useAppStore((state) => state.selectedEdge);
export const useFilters = () => useAppStore((state) => state.filters);
export const useCurrentUser = () => useAppStore((state) => state.currentUser);
export const useSourceNodes = () => useAppStore((state) => state.sourceNodes);
export const useTargetNodes = () => useAppStore((state) => state.targetNodes);
