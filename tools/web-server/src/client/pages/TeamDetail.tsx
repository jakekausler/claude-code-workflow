import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

interface Team {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  added_at: string;
  username?: string;
}

interface TeamRepoAccess {
  id: string;
  team_id: string;
  repo_id: number;
  role_name: string;
  created_at: string;
  repo_name?: string;
}

interface TeamDetailResponse {
  team: Team;
  members: TeamMember[];
  repoAccess: TeamRepoAccess[];
}

interface RepoItem {
  id: number;
  name: string;
  path: string;
}

function useTeamDetail(teamId: string) {
  return useQuery({
    queryKey: ['teams', teamId],
    queryFn: () => apiFetch<TeamDetailResponse>(`/teams/${teamId}`),
    enabled: !!teamId,
  });
}

function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: () => apiFetch<RepoItem[]>('/repos'),
  });
}

function MembersSection({
  teamId,
  members,
}: {
  teamId: string;
  members: TeamMember[];
}) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');

  const addMutation = useMutation({
    mutationFn: (addUserId: string) =>
      apiFetch(`/teams/${teamId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: addUserId }),
      }),
    onSuccess: () => {
      setUserId('');
      queryClient.invalidateQueries({ queryKey: ['teams', teamId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (removeUserId: string) =>
      apiFetch(`/teams/${teamId}/members/${removeUserId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['teams', teamId] }),
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-800">Members</h2>

      {/* Add member */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User ID"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => userId.trim() && addMutation.mutate(userId.trim())}
          disabled={!userId.trim() || addMutation.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* Members list */}
      {members.length === 0 ? (
        <p className="text-sm text-slate-500">No members yet.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between py-2"
            >
              <span className="text-sm text-slate-700">
                {m.username || m.user_id}
              </span>
              <button
                onClick={() => removeMutation.mutate(m.user_id)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepoAccessSection({
  teamId,
  repoAccess,
}: {
  teamId: string;
  repoAccess: TeamRepoAccess[];
}) {
  const queryClient = useQueryClient();
  const { data: repos } = useRepos();
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [selectedRole, setSelectedRole] = useState<
    'admin' | 'developer' | 'viewer'
  >('developer');

  const setAccessMutation = useMutation({
    mutationFn: ({
      repoId,
      roleName,
    }: {
      repoId: number;
      roleName: string;
    }) =>
      apiFetch(`/teams/${teamId}/repos`, {
        method: 'POST',
        body: JSON.stringify({ repoId, roleName }),
      }),
    onSuccess: () => {
      setSelectedRepoId('');
      queryClient.invalidateQueries({ queryKey: ['teams', teamId] });
    },
  });

  const removeAccessMutation = useMutation({
    mutationFn: (repoId: number) =>
      apiFetch(`/teams/${teamId}/repos/${repoId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['teams', teamId] }),
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-800">
        Repo Access
      </h2>

      {/* Add repo access */}
      <div className="flex gap-2 mb-4">
        <select
          value={selectedRepoId}
          onChange={(e) => setSelectedRepoId(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select a repo...</option>
          {repos?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={selectedRole}
          onChange={(e) =>
            setSelectedRole(
              e.target.value as 'admin' | 'developer' | 'viewer',
            )
          }
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="admin">Admin</option>
          <option value="developer">Developer</option>
          <option value="viewer">Viewer</option>
        </select>
        <button
          onClick={() =>
            selectedRepoId &&
            setAccessMutation.mutate({
              repoId: parseInt(selectedRepoId, 10),
              roleName: selectedRole,
            })
          }
          disabled={!selectedRepoId || setAccessMutation.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Assign
        </button>
      </div>

      {/* Repo access list */}
      {repoAccess.length === 0 ? (
        <p className="text-sm text-slate-500">No repo access configured.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {repoAccess.map((ra) => (
            <div
              key={ra.id}
              className="flex items-center justify-between py-2"
            >
              <div>
                <span className="text-sm font-medium text-slate-700">
                  {ra.repo_name || `Repo #${ra.repo_id}`}
                </span>
                <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {ra.role_name}
                </span>
              </div>
              <button
                onClick={() => removeAccessMutation.mutate(ra.repo_id)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const { data, isLoading, error } = useTeamDetail(teamId ?? '');

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading team...</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load team: {(error as Error).message}
      </p>
    );
  }

  if (!data) {
    return <p className="text-sm text-slate-500">Team not found.</p>;
  }

  const { team, members, repoAccess } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/teams"
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Teams
        </Link>
        <span className="text-sm text-slate-400">/</span>
        <h1 className="text-2xl font-bold text-slate-900">{team.name}</h1>
      </div>

      {team.description && (
        <p className="text-sm text-slate-600">{team.description}</p>
      )}

      <MembersSection teamId={team.id} members={members} />
      <RepoAccessSection teamId={team.id} repoAccess={repoAccess} />
    </div>
  );
}
