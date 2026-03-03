import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';

interface Team {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_count: number;
}

function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => apiFetch<Team[]>('/teams'),
  });
}

function CreateTeamForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<Team>('/teams', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      }),
    onSuccess: () => {
      setName('');
      setDescription('');
      setError(null);
      onCreated();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-800">Create Team</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            Team Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Core engineering team"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || mutation.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {mutation.isPending ? 'Creating...' : 'Create Team'}
        </button>
      </div>
    </div>
  );
}

function TeamList({ teams }: { teams: Team[] }) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (teamId: string) =>
      apiFetch(`/teams/${teamId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
  });

  if (teams.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        No teams yet. Create one above.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {teams.map((team) => (
        <div
          key={team.id}
          className="rounded-lg border border-slate-200 bg-white p-4 flex items-center justify-between"
        >
          <div className="flex-1">
            <Link
              to={`/teams/${team.id}`}
              className="text-sm font-semibold text-blue-600 hover:text-blue-800"
            >
              {team.name}
            </Link>
            {team.description && (
              <p className="text-xs text-slate-500 mt-1">{team.description}</p>
            )}
            <p className="text-xs text-slate-400 mt-1">
              {team.member_count} member{team.member_count !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => {
              if (confirm(`Delete team "${team.name}"?`)) {
                deleteMutation.mutate(team.id);
              }
            }}
            className="rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

export function TeamManagement() {
  const { data: teams, isLoading, error, refetch } = useTeams();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Team Management</h1>

      <CreateTeamForm onCreated={() => refetch()} />

      {isLoading && (
        <p className="text-sm text-slate-500">Loading teams...</p>
      )}
      {error && (
        <p className="text-sm text-red-600">
          Failed to load teams: {(error as Error).message}
        </p>
      )}
      {teams && <TeamList teams={teams} />}
    </div>
  );
}
