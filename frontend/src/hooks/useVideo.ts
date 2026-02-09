import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { videosApi, edgesApi, annotationsApi, importApi } from '../services/api';
import type {
  AnnotationAccept,
  AnnotationReject,
  AnnotationModify,
  AnnotationCreate,
  CameraMotionModifyRequest,
  EdgeFilters,
  NodeModify,
  SceneInfoModifyRequest,
} from '../types';

export function useVideos(status?: string, dataset?: string) {
  return useQuery({
    queryKey: ['videos', status, dataset],
    queryFn: () => videosApi.list(status, dataset),
  });
}

export function useVideo(videoId: string | undefined) {
  return useQuery({
    queryKey: ['video', videoId],
    queryFn: () => videosApi.get(videoId!),
    enabled: !!videoId,
  });
}

export function useNodes(videoId: string | undefined, isStatic?: boolean, frame?: number) {
  return useQuery({
    queryKey: ['nodes', videoId, isStatic, frame],
    queryFn: () => videosApi.getNodes(videoId!, isStatic, frame),
    enabled: !!videoId,
  });
}

export function useEdges(videoId: string | undefined, filters?: EdgeFilters) {
  return useQuery({
    queryKey: ['edges', videoId, filters],
    queryFn: () => edgesApi.list(videoId!, filters),
    enabled: !!videoId,
  });
}

export function useEdgeStats(videoId: string | undefined) {
  return useQuery({
    queryKey: ['edgeStats', videoId],
    queryFn: () => edgesApi.getStats(videoId!),
    enabled: !!videoId,
  });
}

export function usePredicates(videoId: string | undefined, edgeType?: string) {
  return useQuery({
    queryKey: ['predicates', videoId, edgeType],
    queryFn: () => edgesApi.getPredicates(videoId!, edgeType),
    enabled: !!videoId,
  });
}

export function useEdgeHistory(videoId: string | undefined, edgeId: string | undefined) {
  return useQuery({
    queryKey: ['edgeHistory', videoId, edgeId],
    queryFn: () => edgesApi.getHistory(videoId!, edgeId!),
    enabled: !!videoId && !!edgeId,
  });
}

export function useAcceptEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotation: AnnotationAccept) => annotationsApi.accept(annotation),
    onSuccess: (_, variables) => {
      // Use predicate to match all edge queries for this video (handles different filter combinations)
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'edges' && query.queryKey[1] === variables.video_id
      });
      queryClient.invalidateQueries({ queryKey: ['edgeHistory', variables.video_id, variables.edge_id] });
      queryClient.invalidateQueries({ queryKey: ['edgeStats', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
    },
  });
}

export function useRejectEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotation: AnnotationReject) => annotationsApi.reject(annotation),
    onSuccess: (_, variables) => {
      // Use predicate to match all edge queries for this video (handles different filter combinations)
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'edges' && query.queryKey[1] === variables.video_id
      });
      queryClient.invalidateQueries({ queryKey: ['edgeHistory', variables.video_id, variables.edge_id] });
      queryClient.invalidateQueries({ queryKey: ['edgeStats', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
    },
  });
}

export function useModifyEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotation: AnnotationModify) => annotationsApi.modify(annotation),
    onSuccess: (_, variables) => {
      // Don't invalidate edges query - rely on optimistic updates in components.
      // Invalidating here causes a race condition where the refetch overwrites
      // the locally updated edge before the optimistic update can take effect.
      // The edges query will be refreshed when filters change or user navigates.

      // Still invalidate edge history and stats
      queryClient.invalidateQueries({ queryKey: ['edgeHistory', variables.video_id, variables.edge_id] });
      queryClient.invalidateQueries({ queryKey: ['edgeStats', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
    },
  });
}

export function useCreateEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotation: AnnotationCreate) => annotationsApi.create(annotation),
    onSuccess: (_, variables) => {
      // Don't invalidate edges query immediately - the edge is already
      // optimistically added to the store by EdgeCreator. Invalidating
      // here causes a race condition where the refetch overwrites the
      // locally added edge before it can be used for dragging.
      // The edges query will be refreshed when filters change or user
      // navigates away and back.

      // Only invalidate stats since that's a separate concern
      queryClient.invalidateQueries({ queryKey: ['edgeStats', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
    },
  });
}

export function useDeleteEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      video_id: string;
      edge_id: string;
      edge_type: string;
      user_id: number;
      review_notes?: string;
    }) => annotationsApi.delete(data),
    onSuccess: (_, variables) => {
      // Invalidate all edge queries for this video
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'edges' && query.queryKey[1] === variables.video_id
      });
      queryClient.invalidateQueries({ queryKey: ['edgeHistory', variables.video_id, variables.edge_id] });
      queryClient.invalidateQueries({ queryKey: ['edgeStats', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
    },
  });
}

// Scene Info and Camera Motion hooks
export function useSceneInfo(videoId: string | undefined) {
  return useQuery({
    queryKey: ['sceneInfo', videoId],
    queryFn: () => videosApi.getSceneInfo(videoId!),
    enabled: !!videoId,
  });
}

export function useCameraMotion(videoId: string | undefined) {
  return useQuery({
    queryKey: ['cameraMotion', videoId],
    queryFn: () => videosApi.getCameraMotion(videoId!),
    enabled: !!videoId,
  });
}

export function useModifySceneInfo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: SceneInfoModifyRequest) => annotationsApi.modifySceneInfo(request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sceneInfo', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['metadataHistory', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
    },
  });
}

export function useModifyCameraMotion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CameraMotionModifyRequest) => annotationsApi.modifyCameraMotion(request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cameraMotion', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['metadataHistory', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
    },
  });
}

export function useMetadataHistory(videoId: string | undefined) {
  return useQuery({
    queryKey: ['metadataHistory', videoId],
    queryFn: () => annotationsApi.getMetadataHistory(videoId!),
    enabled: !!videoId,
  });
}

// Node modification hooks
export function useModifyNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modification: NodeModify) => annotationsApi.modifyNode(modification),
    onSuccess: (_, variables) => {
      // Invalidate node queries for this video
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'nodes' && query.queryKey[1] === variables.video_id
      });
      queryClient.invalidateQueries({ queryKey: ['nodeHistory', variables.video_id, variables.node_id] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.video_id] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'edges' && query.queryKey[1] === variables.video_id
      });
      queryClient.invalidateQueries({ queryKey: ['edgeStats', variables.video_id] });
    },
  });
}

export function useNodeHistory(videoId: string | undefined, nodeId: string | undefined) {
  return useQuery({
    queryKey: ['nodeHistory', videoId, nodeId],
    queryFn: () => annotationsApi.getNodeHistory(videoId!, nodeId!),
    enabled: !!videoId && !!nodeId,
  });
}

export function useExportSummary(videoId: string | undefined) {
  return useQuery({
    queryKey: ['exportSummary', videoId],
    queryFn: () => import('../services/api').then(api => api.exportApi.getSummary(videoId!)),
    enabled: !!videoId,
  });
}

export function useImportVsg() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      videoId,
      file,
      userId,
      clearRevisions = true,
    }: {
      videoId: string;
      file: File;
      userId: number;
      clearRevisions?: boolean;
    }) => importApi.importVsg(videoId, file, userId, clearRevisions),
    onSuccess: (_, variables) => {
      // Invalidate all video-related queries to refresh with new VSG
      queryClient.invalidateQueries({ queryKey: ['video', variables.videoId] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'nodes' && query.queryKey[1] === variables.videoId
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'edges' && query.queryKey[1] === variables.videoId
      });
      queryClient.invalidateQueries({ queryKey: ['edgeStats', variables.videoId] });
      queryClient.invalidateQueries({ queryKey: ['exportSummary', variables.videoId] });
      queryClient.invalidateQueries({ queryKey: ['sceneInfo', variables.videoId] });
      queryClient.invalidateQueries({ queryKey: ['cameraMotion', variables.videoId] });
      queryClient.invalidateQueries({ queryKey: ['metadataHistory', variables.videoId] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'edgeHistory' && query.queryKey[1] === variables.videoId
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'nodeHistory' && query.queryKey[1] === variables.videoId
      });
    },
  });
}

export function useSyncData(videoId: string) {
  const queryClient = useQueryClient();
  const isMutating = useIsMutating();

  const sync = async () => {
    // Wait for any pending mutations to settle
    await queryClient.cancelQueries();

    // Invalidate and refetch all video-related queries
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['video', videoId] }),
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'edges' && query.queryKey[1] === videoId
      }),
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'nodes' && query.queryKey[1] === videoId
      }),
      queryClient.invalidateQueries({ queryKey: ['edgeStats', videoId] }),
      queryClient.invalidateQueries({ queryKey: ['exportSummary', videoId] }),
      queryClient.invalidateQueries({ queryKey: ['sceneInfo', videoId] }),
      queryClient.invalidateQueries({ queryKey: ['cameraMotion', videoId] }),
      queryClient.invalidateQueries({ queryKey: ['metadataHistory', videoId] }),
    ]);

    // Wait for all refetches to complete
    await queryClient.refetchQueries({ type: 'active' });
  };

  return { sync, isMutating: isMutating > 0 };
}
