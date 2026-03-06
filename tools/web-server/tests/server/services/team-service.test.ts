import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamService } from '../../../src/server/deployment/hosted/teams/team-service.js';
import type { Pool } from 'pg';

function makePool(rows: Record<string, unknown>[] = []): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pool;
}

const teamRow = {
  id: 'team-1',
  name: 'Engineering',
  description: 'Core engineering team',
  created_by: 'user-1',
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01'),
};

const memberRow = {
  id: 'member-1',
  team_id: 'team-1',
  user_id: 'user-2',
  added_at: new Date('2024-01-02'),
  username: 'alice',
};

const accessRow = {
  id: 'access-1',
  team_id: 'team-1',
  repo_id: 42,
  role_name: 'developer',
  created_at: new Date('2024-01-03'),
  repo_name: 'my-repo',
};

describe('TeamService', () => {
  describe('createTeam()', () => {
    it('inserts a new team and returns the row', async () => {
      const pool = makePool([teamRow]);
      const service = new TeamService(pool);

      const result = await service.createTeam('Engineering', 'Core engineering team', 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO teams'),
        ['Engineering', 'Core engineering team', 'user-1'],
      );
      expect(result).toEqual(teamRow);
    });
  });

  describe('deleteTeam()', () => {
    it('deletes the team by id', async () => {
      const pool = makePool([]);
      const service = new TeamService(pool);

      await service.deleteTeam('team-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM teams'),
        ['team-1'],
      );
    });
  });

  describe('addMember()', () => {
    it('inserts a team member with ON CONFLICT DO NOTHING', async () => {
      const pool = makePool([]);
      const service = new TeamService(pool);

      await service.addMember('team-1', 'user-2');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO team_members'),
        ['team-1', 'user-2'],
      );
    });
  });

  describe('removeMember()', () => {
    it('deletes the member row matching team and user', async () => {
      const pool = makePool([]);
      const service = new TeamService(pool);

      await service.removeMember('team-1', 'user-2');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM team_members'),
        ['team-1', 'user-2'],
      );
    });
  });

  describe('getTeamMembers()', () => {
    it('returns member rows joined with usernames', async () => {
      const pool = makePool([memberRow]);
      const service = new TeamService(pool);

      const result = await service.getTeamMembers('team-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tm.team_id = $1'),
        ['team-1'],
      );
      expect(result).toEqual([memberRow]);
    });

    it('returns empty array when team has no members', async () => {
      const pool = makePool([]);
      const service = new TeamService(pool);

      const result = await service.getTeamMembers('team-1');

      expect(result).toEqual([]);
    });
  });

  describe('setTeamRepoAccess()', () => {
    it('upserts repo access with the given role', async () => {
      const pool = makePool([]);
      const service = new TeamService(pool);

      await service.setTeamRepoAccess('team-1', 42, 'admin');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO team_repo_access'),
        ['team-1', 42, 'admin'],
      );
    });
  });

  describe('removeTeamRepoAccess()', () => {
    it('deletes the repo access row', async () => {
      const pool = makePool([]);
      const service = new TeamService(pool);

      await service.removeTeamRepoAccess('team-1', 42);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM team_repo_access'),
        ['team-1', 42],
      );
    });
  });

  describe('getUserTeams()', () => {
    it('returns teams the user belongs to', async () => {
      const pool = makePool([teamRow]);
      const service = new TeamService(pool);

      const result = await service.getUserTeams('user-2');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tm.user_id = $1'),
        ['user-2'],
      );
      expect(result).toEqual([teamRow]);
    });
  });

  describe('getAllTeams()', () => {
    it('returns teams with member counts', async () => {
      const rowWithCount = { ...teamRow, member_count: 3 };
      const pool = makePool([rowWithCount]);
      const service = new TeamService(pool);

      const result = await service.getAllTeams();

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(tm.id)'),
      );
      expect(result).toEqual([rowWithCount]);
    });
  });

  describe('getTeamDetail()', () => {
    it('returns null when team does not exist', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as Pool;
      const service = new TeamService(pool);

      const result = await service.getTeamDetail('missing-team');

      expect(result).toBeNull();
    });

    it('returns team with members and repo access', async () => {
      const pool = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [teamRow] })   // team lookup
          .mockResolvedValueOnce({ rows: [memberRow] }) // getTeamMembers inner query
          .mockResolvedValueOnce({ rows: [accessRow] }), // repo access
      } as unknown as Pool;
      const service = new TeamService(pool);

      const result = await service.getTeamDetail('team-1');

      expect(result).not.toBeNull();
      expect(result!.team).toEqual(teamRow);
      expect(result!.members).toEqual([memberRow]);
      expect(result!.repoAccess).toEqual([accessRow]);
    });
  });

  describe('getEffectiveRole()', () => {
    it('returns null when user has no roles', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as Pool;
      const service = new TeamService(pool);

      const result = await service.getEffectiveRole('user-1', '99');

      expect(result).toBeNull();
    });

    it('returns the highest role across individual and team roles', async () => {
      const pool = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ role_name: 'developer' }] }) // individual role
          .mockResolvedValueOnce({ rows: [{ role_name: 'admin' }] }),    // team role
      } as unknown as Pool;
      const service = new TeamService(pool);

      const result = await service.getEffectiveRole('user-1', '42');

      expect(result).toBe('admin');
    });

    it('returns the individual role when no team roles exist', async () => {
      const pool = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ role_name: 'viewer' }] }) // individual role
          .mockResolvedValueOnce({ rows: [] }),                        // no team roles
      } as unknown as Pool;
      const service = new TeamService(pool);

      const result = await service.getEffectiveRole('user-1', '42');

      expect(result).toBe('viewer');
    });
  });
});
