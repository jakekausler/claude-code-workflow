import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncConfig {
  id: number;
  repo_id: number;
  provider: 'github' | 'gitlab';
  remote_owner: string | null;
  remote_repo: string | null;
  instance_url: string | null;
  token: string | null;
  labels: string[];
  milestones: string[];
  assignees: string[];
  enabled: boolean;
  interval_ms: number;
  created_at: string;
  updated_at: string;
}

export interface SyncStatus {
  id: number;
  config_id: number;
  last_sync_at: string | null;
  items_synced: number;
  last_error: string | null;
  next_sync_at: string | null;
}

export interface SyncResult {
  configId: number;
  imported: number;
  skipped: number;
  error: string | null;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useSyncConfigs() {
  return useQuery({
    queryKey: ['sync', 'configs'],
    queryFn: () => apiFetch<{ configs: SyncConfig[] }>('/sync/configs'),
  });
}

export function useSyncStatuses() {
  return useQuery({
    queryKey: ['sync', 'status'],
    queryFn: () => apiFetch<{ statuses: SyncStatus[] }>('/sync/status'),
    refetchInterval: 30000,
  });
}

export function useCreateSyncConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<SyncConfig, 'id' | 'created_at' | 'updated_at'>) =>
      apiFetch<{ config: SyncConfig }>('/sync/configs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}

export function useUpdateSyncConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<SyncConfig>) =>
      apiFetch<{ config: SyncConfig }>(`/sync/configs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}

export function useDeleteSyncConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ success: boolean }>(`/sync/configs/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}

export function useTriggerSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ result: SyncResult }>(`/sync/configs/${id}/trigger`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'status'] });
    },
  });
}
