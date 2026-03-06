export { RoleService, type RoleName, ROLE_HIERARCHY } from './role-service.js';
export { requireRole, extractRepoId } from './rbac-middleware.js';
export { repoScopeMiddleware } from './repo-scope-middleware.js';
export { registerRbacRoutes } from './rbac-routes.js';
