import { useCurrentUser } from '../api/hooks.js';
import { can } from '../utils/permissions.js';
import type { Action } from '../utils/permissions.js';

/**
 * Returns permission flags derived from the current user's role.
 *
 * In local mode all flags are true (no gating).
 * In hosted mode:
 *   - canWrite: developer, admin, or global_admin
 *   - canAdmin: admin or global_admin
 *   - isViewer: viewer role (or unauthenticated in hosted mode)
 */
export function usePermissions() {
  const { data: me } = useCurrentUser();

  return {
    canWrite: can(me, 'create:ticket'),
    canAdmin: can(me, 'settings:serviceConnections'),
    isViewer: !can(me, 'create:ticket'),
    can: (action: Action) => can(me, action),
  };
}
