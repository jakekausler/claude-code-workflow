import { describe, it, expect } from 'vitest';
import { formatGraphAsMermaid, sanitizeNodeId } from '../../../src/cli/formatters/graph-mermaid.js';
import type { GraphOutput } from '../../../src/cli/logic/graph.js';

describe('sanitizeNodeId', () => {
  it('converts EPIC IDs to abbreviated form', () => {
    expect(sanitizeNodeId('EPIC-001')).toBe('E001');
  });

  it('converts TICKET IDs to abbreviated form with underscores', () => {
    expect(sanitizeNodeId('TICKET-001-001')).toBe('T001_001');
  });

  it('converts STAGE IDs to abbreviated form with underscores', () => {
    expect(sanitizeNodeId('STAGE-001-001-001')).toBe('S001_001_001');
  });

  it('replaces hyphens with underscores for unknown prefixes', () => {
    expect(sanitizeNodeId('some-arbitrary-id')).toBe('some_arbitrary_id');
  });

  it('produces IDs with no hyphens', () => {
    const ids = ['EPIC-001', 'TICKET-001-002', 'STAGE-003-001-005', 'custom-id-here'];
    for (const id of ids) {
      expect(sanitizeNodeId(id)).not.toContain('-');
    }
  });
});

describe('formatGraphAsMermaid', () => {
  it('outputs starts with graph TD', () => {
    const graph: GraphOutput = { nodes: [], edges: [], cycles: [], critical_path: [] };
    const output = formatGraphAsMermaid(graph);
    expect(output.startsWith('graph TD')).toBe(true);
  });

  it('produces minimal valid output for empty graph', () => {
    const graph: GraphOutput = { nodes: [], edges: [], cycles: [], critical_path: [] };
    const output = formatGraphAsMermaid(graph);
    expect(output).toBe('graph TD');
  });

  it('contains subgraph for each epic', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'EPIC-001', type: 'epic', status: 'In Progress', title: 'Auth' },
        { id: 'EPIC-002', type: 'epic', status: 'Not Started', title: 'Payments' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('subgraph sub_E001 ["EPIC-001: Auth"]');
    expect(output).toContain('subgraph sub_E002 ["EPIC-002: Payments"]');
    expect(output).toContain('end');
  });

  it('contains node definitions for stages with rounded parentheses', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Design', title: 'Login Form' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('S001_001_001("STAGE-001-001-001<br/>Login Form<br/>Design")');
  });

  it('contains node definitions for tickets with square brackets', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'TICKET-001-001', type: 'ticket', status: 'In Progress', title: 'Login Flow' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('T001_001["TICKET-001-001<br/>Login Flow"]');
  });

  it('contains node definitions for epics with double brackets', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'EPIC-001', type: 'epic', status: 'In Progress', title: 'Auth' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('E001[["EPIC-001<br/>Auth"]]');
  });

  it('uses solid arrows for resolved edges', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Complete', title: 'S1' },
        { id: 'STAGE-001-001-002', type: 'stage', status: 'Build', title: 'S2' },
      ],
      edges: [
        { from: 'STAGE-001-001-002', to: 'STAGE-001-001-001', type: 'depends_on', resolved: true },
      ],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('S001_001_002 --> S001_001_001');
  });

  it('uses dashed arrows for unresolved edges', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Not Started', title: 'S1' },
        { id: 'STAGE-001-001-002', type: 'stage', status: 'Not Started', title: 'S2' },
      ],
      edges: [
        { from: 'STAGE-001-001-002', to: 'STAGE-001-001-001', type: 'depends_on', resolved: false },
      ],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('S001_001_002 -.-> S001_001_001');
  });

  it('uses thick arrows for critical path edges', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Not Started', title: 'S1' },
        { id: 'STAGE-001-001-002', type: 'stage', status: 'Not Started', title: 'S2' },
        { id: 'STAGE-001-001-003', type: 'stage', status: 'Not Started', title: 'S3' },
      ],
      edges: [
        { from: 'STAGE-001-001-002', to: 'STAGE-001-001-001', type: 'depends_on', resolved: false },
        { from: 'STAGE-001-001-003', to: 'STAGE-001-001-002', type: 'depends_on', resolved: false },
      ],
      cycles: [],
      critical_path: ['STAGE-001-001-001', 'STAGE-001-001-002', 'STAGE-001-001-003'],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('S001_001_002 ==> S001_001_001');
    expect(output).toContain('S001_001_003 ==> S001_001_002');
  });

  it('applies green style for Complete status', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Complete', title: 'S1' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('style S001_001_001 fill:#27ae60,color:#fff');
  });

  it('applies gray style for Not Started status', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Not Started', title: 'S1' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('style S001_001_001 fill:#bdc3c7,color:#2c3e50');
  });

  it('applies blue style for Build status', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Build', title: 'S1' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('style S001_001_001 fill:#3498db,color:#fff');
  });

  it('applies purple style for Design status', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Design', title: 'S1' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('style S001_001_001 fill:#9b59b6,color:#fff');
  });

  it('adds cycle comments when cycles exist', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Not Started', title: 'S1' },
        { id: 'STAGE-001-001-002', type: 'stage', status: 'Not Started', title: 'S2' },
      ],
      edges: [],
      cycles: [['STAGE-001-001-001', 'STAGE-001-001-002']],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('%% Cycle detected: S001_001_001 -> S001_001_002');
  });

  it('groups tickets and stages under their epic subgraph with nested ticket subgraphs', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'EPIC-001', type: 'epic', status: 'In Progress', title: 'Auth' },
        { id: 'TICKET-001-001', type: 'ticket', status: 'In Progress', title: 'Login' },
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Design', title: 'Login Form' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    // Epic subgraph should exist
    expect(output).toContain('subgraph sub_E001 ["EPIC-001: Auth"]');
    // Ticket subgraph should be nested inside epic subgraph
    expect(output).toContain('subgraph sub_T001_001 ["TICKET-001-001: Login"]');
    // The ticket and stage should appear inside the ticket subgraph
    const ticketSubgraphStart = output.indexOf('subgraph sub_T001_001');
    const ticketSubgraphEnd = output.indexOf('end', ticketSubgraphStart);
    const ticketPos = output.indexOf('T001_001[');
    const stagePos = output.indexOf('S001_001_001(');
    expect(ticketPos).toBeGreaterThan(ticketSubgraphStart);
    expect(ticketPos).toBeLessThan(ticketSubgraphEnd);
    expect(stagePos).toBeGreaterThan(ticketSubgraphStart);
    expect(stagePos).toBeLessThan(ticketSubgraphEnd);
  });

  it('nests multiple ticket subgraphs inside an epic subgraph', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'EPIC-001', type: 'epic', status: 'In Progress', title: 'Auth' },
        { id: 'TICKET-001-001', type: 'ticket', status: 'In Progress', title: 'Login' },
        { id: 'TICKET-001-002', type: 'ticket', status: 'Not Started', title: 'Registration' },
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Design', title: 'Login Form' },
        { id: 'STAGE-001-001-002', type: 'stage', status: 'Build', title: 'Auth API' },
        { id: 'STAGE-001-002-001', type: 'stage', status: 'Not Started', title: 'Signup Form' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    // Both ticket subgraphs should exist
    expect(output).toContain('subgraph sub_T001_001 ["TICKET-001-001: Login"]');
    expect(output).toContain('subgraph sub_T001_002 ["TICKET-001-002: Registration"]');
    // Login stages should be inside Login ticket subgraph
    const loginSubStart = output.indexOf('subgraph sub_T001_001');
    const loginSubEnd = output.indexOf('end', loginSubStart);
    expect(output.indexOf('S001_001_001(')).toBeGreaterThan(loginSubStart);
    expect(output.indexOf('S001_001_001(')).toBeLessThan(loginSubEnd);
    expect(output.indexOf('S001_001_002(')).toBeGreaterThan(loginSubStart);
    expect(output.indexOf('S001_001_002(')).toBeLessThan(loginSubEnd);
    // Registration stage should be inside Registration ticket subgraph
    const regSubStart = output.indexOf('subgraph sub_T001_002');
    const regSubEnd = output.indexOf('end', regSubStart);
    expect(output.indexOf('S001_002_001(')).toBeGreaterThan(regSubStart);
    expect(output.indexOf('S001_002_001(')).toBeLessThan(regSubEnd);
  });

  it('renders ticket without stages as a subgraph with just the ticket node', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'EPIC-001', type: 'epic', status: 'In Progress', title: 'Auth' },
        { id: 'TICKET-001-001', type: 'ticket', status: 'Not Started', title: 'To Convert' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    expect(output).toContain('subgraph sub_T001_001 ["TICKET-001-001: To Convert"]');
    // Ticket node should be inside its subgraph
    const ticketSubStart = output.indexOf('subgraph sub_T001_001');
    const ticketSubEnd = output.indexOf('end', ticketSubStart);
    const ticketPos = output.indexOf('T001_001[');
    expect(ticketPos).toBeGreaterThan(ticketSubStart);
    expect(ticketPos).toBeLessThan(ticketSubEnd);
  });

  it('renders nodes without matching epic outside subgraphs', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'orphan-stage', type: 'stage', status: 'Not Started', title: 'Orphan' },
      ],
      edges: [],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    // Should not have a subgraph
    expect(output).not.toContain('subgraph');
    // Should still have the node
    expect(output).toContain('orphan_stage(');
  });

  it('node IDs are properly sanitized with no hyphens', () => {
    const graph: GraphOutput = {
      nodes: [
        { id: 'EPIC-001', type: 'epic', status: 'In Progress', title: 'Auth' },
        { id: 'TICKET-001-001', type: 'ticket', status: 'In Progress', title: 'Login' },
        { id: 'STAGE-001-001-001', type: 'stage', status: 'Design', title: 'Form' },
      ],
      edges: [
        { from: 'STAGE-001-001-001', to: 'TICKET-001-001', type: 'depends_on', resolved: true },
      ],
      cycles: [],
      critical_path: [],
    };
    const output = formatGraphAsMermaid(graph);
    // Extract all tokens that look like Mermaid node IDs (before [ or ( or in style/edge lines)
    // Just verify no raw hyphenated IDs appear as node identifiers
    expect(output).not.toMatch(/\bEPIC-001\b(?=[[\("(])/);
    // Sanitized IDs should be present
    expect(output).toContain('E001');
    expect(output).toContain('T001_001');
    expect(output).toContain('S001_001_001');
  });
});
