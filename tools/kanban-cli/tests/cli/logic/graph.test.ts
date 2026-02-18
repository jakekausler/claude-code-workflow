import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../../src/cli/logic/graph.js';

describe('buildGraph', () => {
  it('creates nodes for all entities', () => {
    const result = buildGraph({
      epics: [
        { id: 'EPIC-001', title: 'Auth', status: 'In Progress' },
      ],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login', status: 'In Progress' },
      ],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Design' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Auth API', status: 'Not Started' },
      ],
      dependencies: [],
    });
    expect(result.nodes).toHaveLength(4);
    const types = result.nodes.map((n) => n.type);
    expect(types).toContain('epic');
    expect(types).toContain('ticket');
    expect(types).toContain('stage');
  });

  it('creates edges from dependencies', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Complete' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Not Started' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-002', to_id: 'STAGE-001-001-001', from_type: 'stage', to_type: 'stage', resolved: true },
      ],
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from).toBe('STAGE-001-001-002');
    expect(result.edges[0].to).toBe('STAGE-001-001-001');
    expect(result.edges[0].type).toBe('depends_on');
    expect(result.edges[0].resolved).toBe(true);
  });

  it('detects cycles', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Not Started' },
        { id: 'STAGE-001-001-002', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Not Started' },
        { id: 'STAGE-001-001-003', ticket_id: 'T', epic_id: 'E', title: 'S3', status: 'Not Started' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-001', to_id: 'STAGE-001-001-002', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 2, from_id: 'STAGE-001-001-002', to_id: 'STAGE-001-001-003', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 3, from_id: 'STAGE-001-001-003', to_id: 'STAGE-001-001-001', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
    });
    expect(result.cycles.length).toBeGreaterThan(0);
    // The cycle should contain all three IDs
    const cycleIds = result.cycles[0];
    expect(cycleIds).toContain('STAGE-001-001-001');
    expect(cycleIds).toContain('STAGE-001-001-002');
    expect(cycleIds).toContain('STAGE-001-001-003');
  });

  it('reports no cycles when there are none', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Complete' },
        { id: 'STAGE-001-001-002', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Not Started' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-002', to_id: 'STAGE-001-001-001', from_type: 'stage', to_type: 'stage', resolved: true },
      ],
    });
    expect(result.cycles).toHaveLength(0);
  });

  it('computes critical path as the longest chain of unresolved dependencies', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'S1', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Not Started' },
        { id: 'S2', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Not Started' },
        { id: 'S3', ticket_id: 'T', epic_id: 'E', title: 'S3', status: 'Not Started' },
        { id: 'S4', ticket_id: 'T', epic_id: 'E', title: 'S4', status: 'Not Started' },
      ],
      dependencies: [
        // Chain: S4 -> S3 -> S2 -> S1 (all unresolved)
        { id: 1, from_id: 'S2', to_id: 'S1', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 2, from_id: 'S3', to_id: 'S2', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 3, from_id: 'S4', to_id: 'S3', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
    });
    expect(result.critical_path).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('returns empty critical path when all deps are resolved', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'S1', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Complete' },
        { id: 'S2', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Complete' },
      ],
      dependencies: [
        { id: 1, from_id: 'S2', to_id: 'S1', from_type: 'stage', to_type: 'stage', resolved: true },
      ],
    });
    expect(result.critical_path).toHaveLength(0);
  });

  it('filters by epic', () => {
    const result = buildGraph({
      epics: [
        { id: 'EPIC-001', title: 'Auth', status: 'In Progress' },
        { id: 'EPIC-002', title: 'Pay', status: 'Not Started' },
      ],
      tickets: [],
      stages: [
        { id: 'S1', ticket_id: 'T1', epic_id: 'EPIC-001', title: 'S1', status: 'Design' },
        { id: 'S2', ticket_id: 'T2', epic_id: 'EPIC-002', title: 'S2', status: 'Design' },
      ],
      dependencies: [],
      filters: { epic: 'EPIC-001' },
    });
    expect(result.nodes.some((n) => n.id === 'S1')).toBe(true);
    expect(result.nodes.some((n) => n.id === 'S2')).toBe(false);
    expect(result.nodes.some((n) => n.id === 'EPIC-001')).toBe(true);
    expect(result.nodes.some((n) => n.id === 'EPIC-002')).toBe(false);
  });

  it('filters by ticket', () => {
    const result = buildGraph({
      epics: [],
      tickets: [
        { id: 'T1', epic_id: 'E1', title: 'Ticket 1', status: 'In Progress' },
        { id: 'T2', epic_id: 'E1', title: 'Ticket 2', status: 'Not Started' },
      ],
      stages: [
        { id: 'S1', ticket_id: 'T1', epic_id: 'E1', title: 'S1', status: 'Design' },
        { id: 'S2', ticket_id: 'T2', epic_id: 'E1', title: 'S2', status: 'Design' },
      ],
      dependencies: [],
      filters: { ticket: 'T1' },
    });
    expect(result.nodes.some((n) => n.id === 'T1')).toBe(true);
    expect(result.nodes.some((n) => n.id === 'T2')).toBe(false);
    expect(result.nodes.some((n) => n.id === 'S1')).toBe(true);
    expect(result.nodes.some((n) => n.id === 'S2')).toBe(false);
  });
});
