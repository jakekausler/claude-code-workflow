---
title: "ScopedFileSystemProvider"
phase: 12
labels: [hosted, security]
depends_on: [019]
---

# ScopedFileSystemProvider

Filesystem access restriction for hosted mode — each user can only access their own files.

## Design (from HOSTED-DESIGN.md)

- Restricts all filesystem operations to user's root directory (e.g., `/home/username/.claude`)
- Path traversal protection using `realpathSync` + `startsWith` checks
- Prevents symlink-based attacks by resolving paths before validation
- All file read/write/watch operations go through this provider

## Requirements

- Implement `FileSystemProvider` interface from `types.ts`
- `realpathSync` resolution before any path check
- `startsWith` validation against user's scoped root
- Throw descriptive errors on access violations (log but don't expose paths to client)
- All existing file operations (session JSONL reading, stage file reading, file watcher) must use this provider in hosted mode

## Security Considerations

- Symlink resolution must happen before access check (TOCTOU prevention)
- Reject paths containing `..` segments even if they resolve within scope (defense in depth)
- Log all access violations for security monitoring
