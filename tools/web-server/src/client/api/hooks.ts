import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client.js';

export interface HealthResponse {
  status: string;
  timestamp: string;
}

/** Health check — useful for verifying connectivity. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
  });
}
