import { describe, it, expect } from 'vitest';
import { mapIds, mapStageId, buildTicketId } from '../../src/migration/id-mapper.js';
import type { OldFormatEpic, OldFormatStage } from '../../src/migration/types.js';

function makeStage(overrides: Partial<OldFormatStage> = {}): OldFormatStage {
  return {
    filename: 'STAGE-001-001.md',
    filePath: '/tmp/epics/EPIC-001/STAGE-001-001.md',
    oldId: 'STAGE-001-001',
    epicNum: '001',
    stageNum: '001',
    title: 'Test Stage',
    status: 'Not Started',
    body: '',
    ...overrides,
  };
}

describe('buildTicketId', () => {
  it('builds ticket ID with epic number and ticket number 001', () => {
    expect(buildTicketId('001')).toBe('TICKET-001-001');
  });

  it('builds ticket ID for different epic number', () => {
    expect(buildTicketId('003')).toBe('TICKET-003-001');
  });
});

describe('mapStageId', () => {
  it('converts old two-level ID to new three-level ID with ticket 001', () => {
    expect(mapStageId('STAGE-001-003')).toBe('STAGE-001-001-003');
  });

  it('preserves the epic number and stage number', () => {
    expect(mapStageId('STAGE-002-005')).toBe('STAGE-002-001-005');
  });

  it('handles single digit stage numbers', () => {
    expect(mapStageId('STAGE-001-001')).toBe('STAGE-001-001-001');
  });
});

describe('mapIds', () => {
  it('maps all stages in an epic to new IDs', () => {
    const epic: OldFormatEpic = {
      id: 'EPIC-001',
      epicNum: '001',
      dirPath: '/tmp/epics/EPIC-001',
      title: 'Auth',
      status: 'Not Started',
      hadEpicFile: false,
      stages: [
        makeStage({ oldId: 'STAGE-001-001', epicNum: '001', stageNum: '001' }),
        makeStage({ oldId: 'STAGE-001-002', epicNum: '001', stageNum: '002' }),
        makeStage({ oldId: 'STAGE-001-003', epicNum: '001', stageNum: '003' }),
      ],
    };

    const mappings = mapIds(epic);
    expect(mappings).toHaveLength(3);
    expect(mappings[0]).toEqual({
      oldStageId: 'STAGE-001-001',
      newStageId: 'STAGE-001-001-001',
      ticketId: 'TICKET-001-001',
      epicId: 'EPIC-001',
    });
    expect(mappings[1].newStageId).toBe('STAGE-001-001-002');
    expect(mappings[2].newStageId).toBe('STAGE-001-001-003');
  });

  it('uses the same ticket ID for all stages in an epic', () => {
    const epic: OldFormatEpic = {
      id: 'EPIC-002',
      epicNum: '002',
      dirPath: '/tmp/epics/EPIC-002',
      title: 'Payments',
      status: 'Not Started',
      hadEpicFile: false,
      stages: [
        makeStage({ oldId: 'STAGE-002-001', epicNum: '002', stageNum: '001' }),
        makeStage({ oldId: 'STAGE-002-002', epicNum: '002', stageNum: '002' }),
      ],
    };

    const mappings = mapIds(epic);
    expect(mappings[0].ticketId).toBe('TICKET-002-001');
    expect(mappings[1].ticketId).toBe('TICKET-002-001');
  });
});
