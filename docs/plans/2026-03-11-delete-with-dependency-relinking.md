# Delete with Dependency Re-linking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add delete functionality for epics, tickets, and stages with smart dependency re-linking and user confirmation dialogs.

**Architecture:** Preview endpoints return what will be affected before deletion. On delete, dependencies are re-linked (if A->B->C and B is deleted, create A->C), then cascading deletes remove child records bottom-up. SSE broadcast notifies all clients.

**Tech Stack:** Fastify routes, SQLite/PostgreSQL repos, React Query mutations, Tailwind confirmation dialog.

---

## Task 1: Database layer — delete methods in kanban-cli repos

**Files:**
- Modify: `tools/kanban-cli/src/db/repositories/dependency-repository.ts`
- Modify: `tools/kanban-cli/src/db/repositories/stage-repository.ts`
- Modify: `tools/kanban-cli/src/db/repositories/ticket-repository.ts`
- Modify: `tools/kanban-cli/src/db/repositories/epic-repository.ts`

**Step 1: Add dependency re-link and delete methods**

In `dependency-repository.ts`, add three methods:

```typescript
/** Find all dependencies where this item is the source (from_id) — i.e. "this item depends on X" */
listBySource(sourceId: string): { from_id: string; from_type: string; to_id: string; to_type: string; repo_id: number; target_repo_name: string | null; resolved: number }[] {
  return this.db
    .raw()
    .prepare('SELECT * FROM dependencies WHERE from_id = ?')
    .all(sourceId) as any[];
}

/** Find all dependencies where this item is the target (to_id) — i.e. "X depends on this item" */
listByTarget(targetId: string): { from_id: string; from_type: string; to_id: string; to_type: string; repo_id: number; target_repo_name: string | null; resolved: number }[] {
  return this.db
    .raw()
    .prepare('SELECT * FROM dependencies WHERE to_id = ?')
    .all(targetId) as any[];
}
```

NOTE: `listBySource` and `listByTarget` may already exist. Check before adding — if they do, skip this. The important new methods are:

```typescript
/**
 * Re-link dependencies through an item being deleted, then remove all its deps.
 * If A depends on B and B depends on C, deleting B creates A->C.
 */
relinkAndDelete(itemId: string): { removed: number; created: number } {
  const parents = this.db
    .raw()
    .prepare('SELECT * FROM dependencies WHERE from_id = ?')
    .all(itemId) as any[];
  const children = this.db
    .raw()
    .prepare('SELECT * FROM dependencies WHERE to_id = ?')
    .all(itemId) as any[];

  let created = 0;
  for (const child of children) {
    for (const parent of parents) {
      // Check if this link already exists
      const exists = this.db
        .raw()
        .prepare('SELECT 1 FROM dependencies WHERE from_id = ? AND to_id = ?')
        .get(child.from_id, parent.to_id);
      if (!exists) {
        this.db
          .raw()
          .prepare(
            'INSERT INTO dependencies (from_id, from_type, to_id, to_type, resolved, repo_id, target_repo_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(child.from_id, child.from_type, parent.to_id, parent.to_type, 0, parent.repo_id, parent.target_repo_name);
        created++;
      }
    }
  }

  const result = this.db
    .raw()
    .prepare('DELETE FROM dependencies WHERE from_id = ? OR to_id = ?')
    .run(itemId, itemId);

  return { removed: result.changes, created };
}

/** Delete all dependencies referencing any of the given item IDs */
deleteByItemIds(itemIds: string[]): number {
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map(() => '?').join(',');
  const result = this.db
    .raw()
    .prepare(`DELETE FROM dependencies WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`)
    .run(...itemIds, ...itemIds);
  return result.changes;
}
```

**Step 2: Add delete methods to stage, ticket, epic repos**

In `stage-repository.ts`:
```typescript
deleteById(id: string): void {
  this.db.raw().prepare('DELETE FROM stages WHERE id = ?').run(id);
}

deleteByTicketId(ticketId: string): string[] {
  const stages = this.db
    .raw()
    .prepare('SELECT id FROM stages WHERE ticket_id = ?')
    .all(ticketId) as { id: string }[];
  if (stages.length > 0) {
    const ids = stages.map((s) => s.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.raw().prepare(`DELETE FROM stages WHERE id IN (${placeholders})`).run(...ids);
  }
  return stages.map((s) => s.id);
}

deleteByEpicId(epicId: string): string[] {
  const stages = this.db
    .raw()
    .prepare('SELECT id FROM stages WHERE epic_id = ?')
    .all(epicId) as { id: string }[];
  if (stages.length > 0) {
    const ids = stages.map((s) => s.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.raw().prepare(`DELETE FROM stages WHERE id IN (${placeholders})`).run(...ids);
  }
  return stages.map((s) => s.id);
}
```

In `ticket-repository.ts`:
```typescript
deleteById(id: string): void {
  this.db.raw().prepare('DELETE FROM tickets WHERE id = ?').run(id);
}

deleteByEpicId(epicId: string): string[] {
  const tickets = this.db
    .raw()
    .prepare('SELECT id FROM tickets WHERE epic_id = ?')
    .all(epicId) as { id: string }[];
  if (tickets.length > 0) {
    const ids = tickets.map((t) => t.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.raw().prepare(`DELETE FROM tickets WHERE id IN (${placeholders})`).run(...ids);
  }
  return tickets.map((t) => t.id);
}
```

In `epic-repository.ts`:
```typescript
deleteById(id: string): void {
  this.db.raw().prepare('DELETE FROM epics WHERE id = ?').run(id);
}
```

**Step 3: Rebuild kanban-cli**

```bash
cd tools/kanban-cli && npm run build
```

**Step 4: Commit**

```bash
git add tools/kanban-cli/src/db/repositories/
git commit -m "feat(db): add delete methods with dependency re-linking to kanban-cli repos"
```

---

## Task 2: Repository interfaces and adapters

**Files:**
- Modify: `tools/web-server/src/server/services/repositories/types.ts`
- Modify: `tools/web-server/src/server/services/repositories/sqlite/index.ts`
- Modify: `tools/web-server/src/server/services/repositories/pg/index.ts`

**Step 1: Update interfaces in types.ts**

Add to `IEpicRepository`:
```typescript
deleteById(id: string): Promise<void>;
```

Add to `ITicketRepository`:
```typescript
deleteById(id: string): Promise<void>;
deleteByEpicId(epicId: string): Promise<string[]>;
```

Add to `IStageRepository`:
```typescript
deleteById(id: string): Promise<void>;
deleteByTicketId(ticketId: string): Promise<string[]>;
deleteByEpicId(epicId: string): Promise<string[]>;
```

Add to `IDependencyRepository`:
```typescript
relinkAndDelete(itemId: string): Promise<{ removed: number; created: number }>;
deleteByItemIds(itemIds: string[]): Promise<number>;
```

**Step 2: Implement in SQLite adapters (sqlite/index.ts)**

For each adapter class, add the corresponding method that delegates to the kanban-cli repo. Pattern:

```typescript
// In SqliteEpicRepository:
async deleteById(id: string): Promise<void> {
  this.repo.deleteById(id);
}

// In SqliteTicketRepository:
async deleteById(id: string): Promise<void> {
  this.repo.deleteById(id);
}
async deleteByEpicId(epicId: string): Promise<string[]> {
  return this.repo.deleteByEpicId(epicId);
}

// In SqliteStageRepository:
async deleteById(id: string): Promise<void> {
  this.repo.deleteById(id);
}
async deleteByTicketId(ticketId: string): Promise<string[]> {
  return this.repo.deleteByTicketId(ticketId);
}
async deleteByEpicId(epicId: string): Promise<string[]> {
  return this.repo.deleteByEpicId(epicId);
}

// In SqliteDependencyRepository:
async relinkAndDelete(itemId: string): Promise<{ removed: number; created: number }> {
  return this.repo.relinkAndDelete(itemId);
}
async deleteByItemIds(itemIds: string[]): Promise<number> {
  return this.repo.deleteByItemIds(itemIds);
}
```

**Step 3: Implement in PG adapters (pg/index.ts)**

For each PG repo class, implement direct SQL. The dependency re-linking in PG:

```typescript
// In PgDependencyRepository:
async relinkAndDelete(itemId: string): Promise<{ removed: number; created: number }> {
  const parents = await this.pool.query('SELECT * FROM dependencies WHERE from_id = $1', [itemId]);
  const children = await this.pool.query('SELECT * FROM dependencies WHERE to_id = $1', [itemId]);

  let created = 0;
  for (const child of children.rows) {
    for (const parent of parents.rows) {
      const exists = await this.pool.query(
        'SELECT 1 FROM dependencies WHERE from_id = $1 AND to_id = $2',
        [child.from_id, parent.to_id],
      );
      if (exists.rowCount === 0) {
        await this.pool.query(
          'INSERT INTO dependencies (from_id, from_type, to_id, to_type, resolved, repo_id, target_repo_name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [child.from_id, child.from_type, parent.to_id, parent.to_type, false, parent.repo_id, parent.target_repo_name],
        );
        created++;
      }
    }
  }

  const result = await this.pool.query('DELETE FROM dependencies WHERE from_id = $1 OR to_id = $1', [itemId]);
  return { removed: result.rowCount ?? 0, created };
}

async deleteByItemIds(itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
  const doubledPlaceholders = itemIds.map((_, i) => `$${i + 1 + itemIds.length}`).join(',');
  const result = await this.pool.query(
    `DELETE FROM dependencies WHERE from_id IN (${placeholders}) OR to_id IN (${doubledPlaceholders})`,
    [...itemIds, ...itemIds],
  );
  return result.rowCount ?? 0;
}
```

PG delete methods for epic/ticket/stage repos follow the same pattern:
```typescript
// PgEpicRepository:
async deleteById(id: string): Promise<void> {
  await this.pool.query('DELETE FROM epics WHERE id = $1', [id]);
}

// PgTicketRepository:
async deleteById(id: string): Promise<void> {
  await this.pool.query('DELETE FROM tickets WHERE id = $1', [id]);
}
async deleteByEpicId(epicId: string): Promise<string[]> {
  const result = await this.pool.query('DELETE FROM tickets WHERE epic_id = $1 RETURNING id', [epicId]);
  return result.rows.map((r: any) => r.id);
}

// PgStageRepository:
async deleteById(id: string): Promise<void> {
  await this.pool.query('DELETE FROM stages WHERE id = $1', [id]);
}
async deleteByTicketId(ticketId: string): Promise<string[]> {
  const result = await this.pool.query('DELETE FROM stages WHERE ticket_id = $1 RETURNING id', [ticketId]);
  return result.rows.map((r: any) => r.id);
}
async deleteByEpicId(epicId: string): Promise<string[]> {
  const result = await this.pool.query('DELETE FROM stages WHERE epic_id = $1 RETURNING id', [epicId]);
  return result.rows.map((r: any) => r.id);
}
```

**Step 4: Commit**

```bash
git add tools/web-server/src/server/services/repositories/
git commit -m "feat(repos): add delete interfaces and implementations for SQLite and PG"
```

---

## Task 3: Delete preview and delete API routes

**Files:**
- Modify: `tools/web-server/src/server/routes/epics.ts`
- Modify: `tools/web-server/src/server/routes/tickets.ts`
- Modify: `tools/web-server/src/server/routes/stages.ts`

**Step 1: Add preview and delete endpoints to stages.ts**

Stage is the simplest — no cascading child records, just dependency re-linking.

```typescript
// GET /api/stages/:id/delete-preview
app.get<{ Params: { id: string } }>('/api/stages/:id/delete-preview', async (request, reply) => {
  const { id } = request.params;
  const { stages, dependencies } = app.dataService;

  const stage = await stages.findById(id);
  if (!stage) return reply.status(404).send({ error: 'Stage not found' });

  const parents = await dependencies.listBySource(id);
  const children = await dependencies.listByTarget(id);

  // Compute re-links: each child x parent pair
  const relinks: { from: string; to: string }[] = [];
  for (const child of children) {
    for (const parent of parents) {
      relinks.push({ from: child.from_id, to: parent.to_id });
    }
  }

  return reply.send({
    item: { id: stage.id, title: stage.title, type: 'stage' },
    childrenToDelete: [],
    dependenciesRemoved: parents.length + children.length,
    dependenciesCreated: relinks,
  });
});

// DELETE /api/stages/:id
app.delete<{ Params: { id: string } }>('/api/stages/:id', async (request, reply) => {
  const { id } = request.params;
  const { stages, dependencies, stageSessions } = app.dataService;

  const stage = await stages.findById(id);
  if (!stage) return reply.status(404).send({ error: 'Stage not found' });

  // Re-link dependencies through this stage, then delete all its deps
  await dependencies.relinkAndDelete(id);

  // Clean up sessions and tracking
  // (stage_sessions, parent_branch_tracking, mr_comment_tracking will need cleanup too)
  await stages.deleteById(id);

  broadcastEvent('board-update', { type: 'stage_deleted', stageId: id });
  return reply.status(200).send({ ok: true });
});
```

**Step 2: Add preview and delete endpoints to tickets.ts**

```typescript
// GET /api/tickets/:id/delete-preview
app.get<{ Params: { id: string } }>('/api/tickets/:id/delete-preview', async (request, reply) => {
  const { id } = request.params;
  const { tickets, stages, dependencies } = app.dataService;

  const ticket = await tickets.findById(id);
  if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

  const ticketStages = await stages.listByTicket(id);
  const allItemIds = [id, ...ticketStages.map((s) => s.id)];

  // Gather all deps that will be affected
  let totalRemoved = 0;
  const allRelinks: { from: string; to: string }[] = [];
  for (const itemId of allItemIds) {
    const parents = await dependencies.listBySource(itemId);
    const children = await dependencies.listByTarget(itemId);
    totalRemoved += parents.length + children.length;
    for (const child of children) {
      for (const parent of parents) {
        if (!allItemIds.includes(child.from_id)) {
          allRelinks.push({ from: child.from_id, to: parent.to_id });
        }
      }
    }
  }

  return reply.send({
    item: { id: ticket.id, title: ticket.title, type: 'ticket' },
    childrenToDelete: ticketStages.map((s) => ({ id: s.id, title: s.title, type: 'stage' })),
    dependenciesRemoved: totalRemoved,
    dependenciesCreated: allRelinks,
  });
});

// DELETE /api/tickets/:id
app.delete<{ Params: { id: string } }>('/api/tickets/:id', async (request, reply) => {
  const { id } = request.params;
  const { tickets, stages, dependencies } = app.dataService;

  const ticket = await tickets.findById(id);
  if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

  // Get all stages before deleting
  const ticketStages = await stages.listByTicket(id);
  const allItemIds = [id, ...ticketStages.map((s) => s.id)];

  // Re-link dependencies for each item being deleted
  for (const itemId of allItemIds) {
    await dependencies.relinkAndDelete(itemId);
  }

  // Delete stages, then ticket
  await stages.deleteByTicketId(id);
  await tickets.deleteById(id);

  broadcastEvent('board-update', { type: 'ticket_deleted', ticketId: id });
  return reply.status(200).send({ ok: true });
});
```

**Step 3: Add preview and delete endpoints to epics.ts**

Same pattern but also cascades through tickets:

```typescript
// GET /api/epics/:id/delete-preview
app.get<{ Params: { id: string } }>('/api/epics/:id/delete-preview', async (request, reply) => {
  const { id } = request.params;
  const { epics, tickets, stages, dependencies } = app.dataService;

  const epic = await epics.findById(id);
  if (!epic) return reply.status(404).send({ error: 'Epic not found' });

  const epicTickets = await tickets.listByEpic(id);
  const epicStages = await stages.listByEpic(id);
  const allItemIds = [id, ...epicTickets.map((t) => t.id), ...epicStages.map((s) => s.id)];

  let totalRemoved = 0;
  const allRelinks: { from: string; to: string }[] = [];
  for (const itemId of allItemIds) {
    const parents = await dependencies.listBySource(itemId);
    const children = await dependencies.listByTarget(itemId);
    totalRemoved += parents.length + children.length;
    for (const child of children) {
      for (const parent of parents) {
        if (!allItemIds.includes(child.from_id)) {
          allRelinks.push({ from: child.from_id, to: parent.to_id });
        }
      }
    }
  }

  return reply.send({
    item: { id: epic.id, title: epic.title, type: 'epic' },
    childrenToDelete: [
      ...epicTickets.map((t) => ({ id: t.id, title: t.title, type: 'ticket' as const })),
      ...epicStages.map((s) => ({ id: s.id, title: s.title, type: 'stage' as const })),
    ],
    dependenciesRemoved: totalRemoved,
    dependenciesCreated: allRelinks,
  });
});

// DELETE /api/epics/:id
app.delete<{ Params: { id: string } }>('/api/epics/:id', async (request, reply) => {
  const { id } = request.params;
  const { epics, tickets, stages, dependencies } = app.dataService;

  const epic = await epics.findById(id);
  if (!epic) return reply.status(404).send({ error: 'Epic not found' });

  const epicTickets = await tickets.listByEpic(id);
  const epicStages = await stages.listByEpic(id);
  const allItemIds = [id, ...epicTickets.map((t) => t.id), ...epicStages.map((s) => s.id)];

  // Re-link dependencies for each item being deleted
  for (const itemId of allItemIds) {
    await dependencies.relinkAndDelete(itemId);
  }

  // Delete bottom-up: stages -> tickets -> epic
  await stages.deleteByEpicId(id);
  for (const ticket of epicTickets) {
    await stages.deleteByTicketId(ticket.id);
  }
  await tickets.deleteByEpicId(id);
  await epics.deleteById(id);

  broadcastEvent('board-update', { type: 'epic_deleted', epicId: id });
  return reply.status(200).send({ ok: true });
});
```

Remember to add `import { broadcastEvent } from './events.js';` if not already imported.

**Step 4: Commit**

```bash
git add tools/web-server/src/server/routes/
git commit -m "feat(api): add delete preview and delete endpoints for epics, tickets, stages"
```

---

## Task 4: Confirmation dialog component

**Files:**
- Create: `tools/web-server/src/client/components/shared/DeleteConfirmationDialog.tsx`

Create a reusable confirmation dialog that shows:
- What item is being deleted (name, type)
- What children will be cascade-deleted (list of tickets/stages)
- What dependency re-links will be created
- How many dependency links will be removed
- Cancel and Delete buttons (Delete in red)

Follow the existing modal pattern from `ApprovalDialog.tsx`:
- Fixed overlay with backdrop
- `role="dialog"` and `aria-modal="true"`
- Escape key to close
- Loading state while delete is in progress

Props:
```typescript
interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  preview: {
    item: { id: string; title: string; type: string };
    childrenToDelete: { id: string; title: string; type: string }[];
    dependenciesRemoved: number;
    dependenciesCreated: { from: string; to: string }[];
  } | null;
}
```

**Step 1: Create the component**

Use Tailwind classes matching the existing dark theme (zinc backgrounds, red for destructive actions). Show a summary like:

```
Delete Epic: "User Authentication"

This will also delete:
  - 2 tickets
  - 6 stages

Dependencies:
  - 5 links will be removed
  - 2 links will be re-routed

[Cancel]  [Delete]
```

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/shared/
git commit -m "feat(ui): add DeleteConfirmationDialog component"
```

---

## Task 5: Client hooks and UI integration

**Files:**
- Modify: `tools/web-server/src/client/api/hooks.ts`
- Modify: `tools/web-server/src/client/components/detail/EpicDetailContent.tsx`
- Modify: `tools/web-server/src/client/components/detail/TicketDetailContent.tsx`
- Modify: `tools/web-server/src/client/components/detail/StageDetailContent.tsx`

**Step 1: Add hooks in hooks.ts**

```typescript
// Preview hooks
export function useDeletePreview(type: 'epics' | 'tickets' | 'stages', id: string | null) {
  return useQuery({
    queryKey: ['delete-preview', type, id],
    queryFn: () => apiFetch<DeletePreview>(`/${type}/${id}/delete-preview`),
    enabled: !!id,
  });
}

// Delete mutations
export function useDeleteEpic() {
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/epics/${id}`, { method: 'DELETE' }),
  });
}

export function useDeleteTicket() {
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/tickets/${id}`, { method: 'DELETE' }),
  });
}

export function useDeleteStage() {
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/stages/${id}`, { method: 'DELETE' }),
  });
}
```

Add the `DeletePreview` response type:
```typescript
interface DeletePreviewItem {
  id: string;
  title: string;
  type: string;
}

interface DeletePreview {
  item: DeletePreviewItem;
  childrenToDelete: DeletePreviewItem[];
  dependenciesRemoved: number;
  dependenciesCreated: { from: string; to: string }[];
}
```

**Step 2: Wire into EpicDetailContent.tsx**

Add a red "Delete Epic" button (bottom of the detail panel). On click:
1. Set `showDeleteDialog` state to true
2. Fetch the delete preview
3. Show `DeleteConfirmationDialog` with the preview
4. On confirm: call `useDeleteEpic`, invalidate queries, close the drawer

**Step 3: Wire into TicketDetailContent.tsx**

Same pattern with "Delete Ticket" button.

**Step 4: Wire into StageDetailContent.tsx**

Same pattern with "Delete Stage" button.

**Step 5: Commit**

```bash
git add tools/web-server/src/client/
git commit -m "feat(ui): add delete buttons with confirmation dialogs to detail panels"
```

---

## Task 6: Tests

**Files:**
- Create: `tools/web-server/tests/server/delete-routes.test.ts`

Write tests covering:

1. **DELETE /api/stages/:id** — deletes a stage and its dependencies
2. **DELETE /api/tickets/:id** — deletes ticket and cascades to stages
3. **DELETE /api/epics/:id** — deletes epic and cascades to tickets and stages
4. **Dependency re-linking** — if A->B->C and B is deleted, verify A->C exists
5. **Preview endpoints** — verify preview returns correct counts
6. **404 handling** — delete nonexistent item returns 404

Use the existing test pattern: `seedDatabase()`, `app.inject()`, assert on response.

**Step 1: Write and run tests**

**Step 2: Commit**

```bash
git add tools/web-server/tests/server/delete-routes.test.ts
git commit -m "test: add delete route tests with dependency re-linking verification"
```

---

## Task 7: Verify and commit

```bash
cd tools/web-server && npm run verify
```

Fix any issues, then final commit if needed.
