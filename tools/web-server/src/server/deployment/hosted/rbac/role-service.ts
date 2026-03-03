import type { Pool } from 'pg';

export type RoleName = 'global_admin' | 'admin' | 'developer' | 'viewer';

export const ROLE_HIERARCHY: Record<RoleName, number> = {
  global_admin: 4,
  admin: 3,
  developer: 2,
  viewer: 1,
};

export class RoleService {
  constructor(private readonly pool: Pool) {}

  async getUserRole(userId: string, repoId: string | null): Promise<RoleName | null> {
    // Get role for this specific repo (or global if repoId is null)
    const result = await this.pool.query<{ role_name: RoleName }>(
      `SELECT role_name FROM roles
       WHERE user_id = $1
         AND (($2::integer IS NULL AND repo_id IS NULL) OR repo_id = $2::integer)`,
      [userId, repoId],
    );

    // Also check global_admin (repo_id IS NULL)
    const globalResult = await this.pool.query<{ role_name: RoleName }>(
      `SELECT role_name FROM roles WHERE user_id = $1 AND repo_id IS NULL`,
      [userId],
    );

    const roles: RoleName[] = [];
    if (result.rows.length > 0) roles.push(result.rows[0].role_name);
    if (globalResult.rows.length > 0) roles.push(globalResult.rows[0].role_name);

    // Also check team-based roles if team_repo_access table exists
    try {
      const teamResult = await this.pool.query<{ role_name: RoleName }>(
        `SELECT tra.role_name FROM team_repo_access tra
         JOIN team_members tm ON tm.team_id = tra.team_id
         WHERE tm.user_id = $1 AND tra.repo_id = $2::integer`,
        [userId, repoId],
      );
      for (const row of teamResult.rows) roles.push(row.role_name);
    } catch {
      // team tables may not exist yet
    }

    if (roles.length === 0) return null;
    return roles.reduce((max, r) => (ROLE_HIERARCHY[r] > ROLE_HIERARCHY[max] ? r : max));
  }

  async assignRole(
    userId: string,
    repoId: string | null,
    roleName: RoleName,
    assignedByUserId: string,
  ): Promise<void> {
    const isAdmin = await this.isGlobalAdmin(assignedByUserId);
    if (!isAdmin) {
      const assignerRole = await this.getUserRole(assignedByUserId, repoId);
      if (!assignerRole || ROLE_HIERARCHY[assignerRole] < ROLE_HIERARCHY['admin']) {
        throw new Error('Insufficient permissions to assign roles');
      }
    }
    await this.pool.query(
      `INSERT INTO roles (user_id, repo_id, role_name)
       VALUES ($1, $2::integer, $3)
       ON CONFLICT (user_id, COALESCE(repo_id, -1))
       DO UPDATE SET role_name = $3, updated_at = NOW()`,
      [userId, repoId, roleName],
    );
  }

  async removeRole(userId: string, repoId: string | null): Promise<void> {
    await this.pool.query(
      `DELETE FROM roles
       WHERE user_id = $1
         AND (($2::integer IS NULL AND repo_id IS NULL) OR repo_id = $2::integer)`,
      [userId, repoId],
    );
  }

  async getUserRepos(userId: string): Promise<string[]> {
    const result = await this.pool.query<{ repo_id: string }>(
      `SELECT DISTINCT repo_id::text FROM roles WHERE user_id = $1 AND repo_id IS NOT NULL`,
      [userId],
    );
    return result.rows.map((r) => r.repo_id);
  }

  async isGlobalAdmin(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM roles WHERE user_id = $1 AND repo_id IS NULL AND role_name = 'global_admin'`,
      [userId],
    );
    return result.rows.length > 0;
  }

  async bootstrapFirstUser(userId: string): Promise<void> {
    const result = await this.pool.query(`SELECT COUNT(*) AS count FROM roles`);
    if (parseInt(result.rows[0].count, 10) === 0) {
      await this.pool.query(
        `INSERT INTO roles (user_id, repo_id, role_name) VALUES ($1, NULL, 'global_admin')
         ON CONFLICT DO NOTHING`,
        [userId],
      );
    }
  }

  /** Expose pool for direct queries in route handlers. */
  getPool(): Pool {
    return this.pool;
  }
}
