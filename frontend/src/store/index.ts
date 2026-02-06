import { create } from 'zustand';
import type { Edge, EdgeFilters, EdgeType, Node, User, VideoDetail } from '../types';

// Edge drag state for sharing between EdgeTimeline and TrackletTimeline
export interface EdgeDragState {
  edgeId: string;
  handle: 'left' | 'right';
  currentStartFrame: number;
  currentEndFrame: number;
}

// Annotation mode: viewing nodes or edges
export type AnnotationMode = 'nodes' | 'edges';

// Edge creation state
export type EdgeCreationStep = 'select-source' | 'select-target' | 'configure';

export interface EdgeCreationState {
  isCreating: boolean;
  step: EdgeCreationStep;
  sourceNodeIds: string[];
  targetNodeIds: string[];
  edgeType: EdgeType | null;
}

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
