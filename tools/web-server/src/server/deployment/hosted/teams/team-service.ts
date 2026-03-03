import type { Pool } from 'pg';
import { type RoleName, ROLE_HIERARCHY } from '../rbac/role-service.js';

export interface Team {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  added_at: Date;
  username?: string;
}

export interface TeamRepoAccess {
  id: string;
  team_id: string;
  repo_id: number;
  role_name: string;
  created_at: Date;
  repo_name?: string;
}

export class TeamService {
  constructor(private readonly pool: Pool) {}

  async createTeam(name: string, description: string, createdBy: string): Promise<Team> {
    const result = await this.pool.query<Team>(
      `INSERT INTO teams (name, description, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [name, description, createdBy],
    );
    return result.rows[0];
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.pool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
  }

  async addMember(teamId: string, userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [teamId, userId],
    );
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId],
    );
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const result = await this.pool.query<TeamMember>(
      `SELECT tm.*, u.username FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1`,
      [teamId],
    );
    return result.rows;
  }

  async setTeamRepoAccess(
    teamId: string,
    repoId: number,
    roleName: 'admin' | 'developer' | 'viewer',
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_repo_access (team_id, repo_id, role_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, repo_id) DO UPDATE SET role_name = $3`,
      [teamId, repoId, roleName],
    );
  }

  async removeTeamRepoAccess(teamId: string, repoId: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM team_repo_access WHERE team_id = $1 AND repo_id = $2`,
      [teamId, repoId],
    );
  }

  async getUserTeams(userId: string): Promise<Team[]> {
    const result = await this.pool.query<Team>(
      `SELECT t.* FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = $1`,
      [userId],
    );
    return result.rows;
  }

  async getEffectiveRole(userId: string, repoId: string): Promise<RoleName | null> {
    // Individual role (repo-specific + global)
    const individualResult = await this.pool.query<{ role_name: RoleName }>(
      `SELECT role_name FROM roles
       WHERE user_id = $1 AND (repo_id = $2::integer OR repo_id IS NULL)
       ORDER BY CASE role_name
         WHEN 'global_admin' THEN 4
         WHEN 'admin' THEN 3
         WHEN 'developer' THEN 2
         WHEN 'viewer' THEN 1
       END DESC
       LIMIT 1`,
      [userId, repoId],
    );

    // Team roles
    const teamResult = await this.pool.query<{ role_name: RoleName }>(
      `SELECT tra.role_name FROM team_repo_access tra
       JOIN team_members tm ON tm.team_id = tra.team_id
       WHERE tm.user_id = $1 AND tra.repo_id = $2::integer`,
      [userId, repoId],
    );

    const allRoles: RoleName[] = [];
    if (individualResult.rows.length > 0) allRoles.push(individualResult.rows[0].role_name);
    for (const row of teamResult.rows) allRoles.push(row.role_name);

    if (allRoles.length === 0) return null;
    return allRoles.reduce((max, r) => (ROLE_HIERARCHY[r] > ROLE_HIERARCHY[max] ? r : max));
  }

  async getAllTeams(): Promise<(Team & { member_count: number })[]> {
    const result = await this.pool.query<Team & { member_count: number }>(
      `SELECT t.*, COUNT(tm.id)::int AS member_count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       GROUP BY t.id`,
    );
    return result.rows;
  }

  async getTeamDetail(
    teamId: string,
  ): Promise<{ team: Team; members: TeamMember[]; repoAccess: TeamRepoAccess[] } | null> {
    const teamResult = await this.pool.query<Team>(
      `SELECT * FROM teams WHERE id = $1`,
      [teamId],
    );
    if (teamResult.rows.length === 0) return null;

    const members = await this.getTeamMembers(teamId);

    const accessResult = await this.pool.query<TeamRepoAccess>(
      `SELECT tra.*, r.name as repo_name FROM team_repo_access tra
       JOIN repos r ON r.id = tra.repo_id
       WHERE tra.team_id = $1`,
      [teamId],
    );

    return {
      team: teamResult.rows[0],
      members,
      repoAccess: accessResult.rows,
    };
  }
}
