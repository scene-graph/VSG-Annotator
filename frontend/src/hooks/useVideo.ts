import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { videosApi, edgesApi, annotationsApi } from '../services/api';
import { useAppStore } from '../store';
import type { AnnotationAccept, AnnotationReject, AnnotationModify, AnnotationCreate, EdgeFilters } from '../types';

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
      queryClient.invalidateQueries({ queryKey: ['edges', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['edgeHistory', variables.video_id, variables.edge_id] });
    },
  });
}

export function useRejectEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotation: AnnotationReject) => annotationsApi.reject(annotation),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['edges', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['edgeHistory', variables.video_id, variables.edge_id] });
    },
  });
}

export function useModifyEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotation: AnnotationModify) => annotationsApi.modify(annotation),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['edges', variables.video_id] });
      queryClient.invalidateQueries({ queryKey: ['edgeHistory', variables.video_id, variables.edge_id] });
    },
  });
}

export function useCreateEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (annotation: AnnotationCreate) => annotationsApi.create(annotation),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['edges', variables.video_id] });
    },
  });
}
