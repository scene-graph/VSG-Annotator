import { useMutation, useQuery } from '@tanstack/react-query';
import { aiApi, type AttributeSuggestionRequest, type AttributeSuggestionResponse } from '../services/ai';

/**
 * Hook for getting AI attribute suggestions for a node.
 */
export function useAISuggestions() {
  return useMutation<AttributeSuggestionResponse, Error, AttributeSuggestionRequest>({
    mutationFn: async (request) => {
      return await aiApi.suggestAttributes(request);
    },
    retry: 1,
    onError: (error) => {
      console.error('Failed to get AI suggestions:', error);
    },
  });
}

/**
 * Hook for checking AI service health.
 */
export function useAIHealth() {
  return useQuery({
    queryKey: ['ai-health'],
    queryFn: () => aiApi.checkHealth(),
    staleTime: 60 * 1000, // Cache for 1 minute
    retry: false,
  });
}