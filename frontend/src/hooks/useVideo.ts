import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { videosApi, edgesApi, annotationsApi, importApi, reextractApi } from '../services/api';
import type { ReextractJob } from '../services/api';
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

// Upper bound for how long sync() will wait for in-flight mutations to
// settle before forcing a refetch. 10s is well above any realistic
// accept/modify/create roundtrip, so hitting this cap indicates the
// server is unreachable and a stale refetch is the lesser evil.
const SYNC_MUTATION_TIMEOUT_MS = 10_000;
const SYNC_POLL_INTERVAL_MS = 50;

export function useSyncData(videoId: string) {
  const queryClient = useQueryClient();
  const isMutating = useIsMutating();

  const sync = async () => {
    // Wait for any in-flight mutations (e.g. the EdgeTimeline drag's
    // fire-and-forget modify) to fully commit on the server before we
    // invalidate and refetch. Otherwise the refetch races the POST and
    // can return pre-revision data, silently overwriting the user's
    // optimistic update.
    const deadline = Date.now() + SYNC_MUTATION_TIMEOUT_MS;
    while (queryClient.isMutating() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_INTERVAL_MS));
    }

    // Cancel in-flight queries so they don't clash with the refetch.
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

/**
 * Poll Gemini reextraction jobs for this video.
 *
 * When any job is still pending/running, refetch every 2s; once all jobs
 * are terminal the query idles. Each time a job transitions from
 * pending/running → done, we invalidate the edges query so the UI picks
 * up the new predicate/attributes the worker wrote as an edge revision.
 */
export function useReextractJobs(videoId: string | undefined) {
  const queryClient = useQueryClient();
  const prevRunningIdsRef = useRef<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['reextractJobs', videoId],
    queryFn: () => reextractApi.listJobs(videoId!),
    enabled: !!videoId,
    refetchInterval: (query) => {
      const data = (query.state.data as ReextractJob[] | undefined) ?? [];
      const hasActive = data.some((j) => j.status === 'pending' || j.status === 'running');
      return hasActive ? 2000 : false;
    },
  });

  useEffect(() => {
    if (!videoId || !query.data) return;
    const currentRunningIds = new Set<number>(
      query.data.filter((j) => j.status === 'pending' || j.status === 'running').map((j) => j.id)
    );
    // Jobs that were running last tick but aren't now — they completed
    // (done or failed) since the last poll. Invalidate edges so modify
    // revisions produced by the worker flow into the UI.
    const completed: number[] = [];
    for (const prevId of prevRunningIdsRef.current) {
      if (!currentRunningIds.has(prevId)) completed.push(prevId);
    }
    if (completed.length > 0) {
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'edges' && q.queryKey[1] === videoId,
      });
    }
    prevRunningIdsRef.current = currentRunningIds;
  }, [videoId, query.data, queryClient]);

  return query;
}

export function useTriggerReextract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ videoId, edgeId }: { videoId: string; edgeId: string }) =>
      reextractApi.triggerEdge(videoId, edgeId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reextractJobs', variables.videoId] });
    },
  });
}
