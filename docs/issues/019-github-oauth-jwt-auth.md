---
title: "GitHub OAuth + JWT authentication"
phase: 12
labels: [hosted, security]
depends_on: []
---

# GitHub OAuth + JWT Authentication

Implement authentication for hosted mode using GitHub OAuth and JWT tokens.

## Design (from HOSTED-DESIGN.md)

### OAuth Flow
- GitHub OAuth with `read:user, user:email` scopes
- Authorization code flow → exchange for GitHub access token
- Create internal JWT tokens for session management

### Token Strategy
- **Access tokens**: Short-lived (120-second expiry), used for API authentication
- **Refresh tokens**: Long-lived (365-day expiry) with rotation
- Refresh tokens contain AES-256-GCM encrypted GitHub tokens
- Token rotation on every refresh with reuse detection for security

### Reuse Detection
- `revoked_refresh_tokens` table tracks used tokens
- If a revoked token is reused, revoke entire auth session (potential theft)

## Deliverables

- GitHub OAuth callback route
- JWT token generation and validation middleware
- Refresh token rotation logic
- Reuse detection and session revocation
- Auth middleware for all API routes
- Login/logout UI flow

## References

- `tools/web-server/src/server/deployment/HOSTED-DESIGN.md` (in stage-10d worktree)
- `tools/web-server/src/server/deployment/types.ts` — AuthProvider interface
