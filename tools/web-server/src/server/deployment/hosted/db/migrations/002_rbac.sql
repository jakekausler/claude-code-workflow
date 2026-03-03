-- RBAC migration: roles table with user/repo scoped role assignments.

DO $$ BEGIN
  CREATE TYPE role_name AS ENUM ('global_admin', 'admin', 'developer', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id         INTEGER REFERENCES repos(id) ON DELETE CASCADE,
    role_name       role_name NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, COALESCE(repo_id, -1))
);

CREATE INDEX IF NOT EXISTS idx_roles_user_id ON roles(user_id);
CREATE INDEX IF NOT EXISTS idx_roles_repo_id ON roles(repo_id);
