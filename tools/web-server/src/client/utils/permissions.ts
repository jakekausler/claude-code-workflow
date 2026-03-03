/**
 * Client-side permission helpers.
 *
 * In local mode (mode === 'local') all actions are permitted — no gating.
 * In hosted mode, permissions are derived from the user's effective role.
 *
 * Role names match the server's RoleName type (lowercase) plus a title-case
 * alias for readability in call sites.
 */

export type UserRole = 'viewer' | 'developer' | 'admin' | 'global_admin';

export interface CurrentUser {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  role: UserRole;
}

export interface MeResponse {
  mode: 'local' | 'hosted';
  user: CurrentUser | null;
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  developer: 2,
  admin: 3,
  global_admin: 4,
};

export function hasRole(
  me: MeResponse | null | undefined,
  minRole: UserRole,
): boolean {
  if (!me) return false;
  // Local mode: always permitted
  if (me.mode === 'local') return true;
  if (!me.user) return false;
  return (ROLE_HIERARCHY[me.user.role] ?? 0) >= ROLE_HIERARCHY[minRole];
}

export type Action =
  | 'create:epic'
  | 'create:ticket'
  | 'import:trigger'
  | 'import:config'
  | 'convert:ticket'
  | 'settings:serviceConnections'
  | 'settings:teamManagement'
  | 'settings:userPreferences';

export function can(me: MeResponse | null | undefined, action: Action): boolean {
  if (!me) return false;
  // Local mode: always permitted
  if (me.mode === 'local') return true;

  switch (action) {
    case 'create:epic':
    case 'create:ticket':
    case 'import:trigger':
    case 'convert:ticket':
      return hasRole(me, 'developer');
    case 'import:config':
    case 'settings:serviceConnections':
    case 'settings:teamManagement':
      return hasRole(me, 'admin');
    case 'settings:userPreferences':
      return !!me.user;
    default:
      return false;
  }
}
