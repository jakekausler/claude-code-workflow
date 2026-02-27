---
title: "Docker deployment configuration"
phase: 12
labels: [hosted, infrastructure]
depends_on: [019, 020, 021, 022]
---

# Docker Deployment Configuration

Docker Compose setup for hosted deployment.

## Design (from HOSTED-DESIGN.md)

### Services
- **postgres**: PostgreSQL 16-alpine with health checks
- **web-server**: Node.js app depending on postgres, with mounted `/home` volume

### Environment Variables
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — OAuth credentials
- `JWT_SECRET` — Token signing key
- `DATABASE_URL` — PostgreSQL connection string
- `NODE_ENV=production`

## Requirements

- `docker-compose.yml` with postgres + web-server services
- `Dockerfile` for the web-server (multi-stage build for minimal image)
- Health checks on both services
- Volume mounts for `/home` (user data) and postgres data
- Environment variable documentation
- Startup script that runs migrations before starting the server

## Deliverables

- `docker-compose.yml`
- `Dockerfile` (or `tools/web-server/Dockerfile`)
- `.env.example` with all required environment variables documented
- `scripts/docker-start.sh` for first-time setup
