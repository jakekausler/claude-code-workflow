import { describe, it, expect } from 'vitest';
import { jiraTicketDataSchema } from '../../src/jira/schemas.js';

describe('jiraTicketDataSchema', () => {
  const baseTicket = {
    key: 'PROJ-123',
    summary: 'Test ticket',
    description: 'A description',
    status: 'To Do',
    type: 'Story',
    parent: null,
    assignee: null,
    labels: ['backend'],
    comments: [{ author: 'alice', body: 'Looks good', created: '2026-01-01T00:00:00Z' }],
  };

  // ─── links field ────────────────────────────────────────────────────────

  describe('links field', () => {
    it('parses response with links array populated', () => {
      const input = {
        ...baseTicket,
        links: [
          {
            type: 'confluence',
            url: 'https://wiki.example.com/page/123',
            title: 'Design Doc',
          },
          {
            type: 'jira_issue',
            url: 'https://jira.example.com/browse/PROJ-456',
            title: 'Related issue',
            key: 'PROJ-456',
            relationship: 'blocks',
          },
          {
            type: 'attachment',
            url: 'https://jira.example.com/attach/file.pdf',
            title: 'Architecture diagram',
            filename: 'arch.pdf',
            mime_type: 'application/pdf',
          },
          {
            type: 'external',
            url: 'https://docs.google.com/doc/abc',
            title: 'External spec',
          },
        ],
      };

      const result = jiraTicketDataSchema.parse(input);

      expect(result.links).toHaveLength(4);
      expect(result.links[0]).toEqual({
        type: 'confluence',
        url: 'https://wiki.example.com/page/123',
        title: 'Design Doc',
      });
      expect(result.links[1]).toEqual({
        type: 'jira_issue',
        url: 'https://jira.example.com/browse/PROJ-456',
        title: 'Related issue',
        key: 'PROJ-456',
        relationship: 'blocks',
      });
      expect(result.links[2]).toEqual({
        type: 'attachment',
        url: 'https://jira.example.com/attach/file.pdf',
        title: 'Architecture diagram',
        filename: 'arch.pdf',
        mime_type: 'application/pdf',
      });
      expect(result.links[3]).toEqual({
        type: 'external',
        url: 'https://docs.google.com/doc/abc',
        title: 'External spec',
      });
    });

    it('defaults to empty array when links field is omitted', () => {
      const result = jiraTicketDataSchema.parse(baseTicket);

      expect(result.links).toEqual([]);
    });

    it('accepts explicit empty links array', () => {
      const input = { ...baseTicket, links: [] };

      const result = jiraTicketDataSchema.parse(input);

      expect(result.links).toEqual([]);
    });

    it('rejects link with invalid type', () => {
      const input = {
        ...baseTicket,
        links: [{ type: 'invalid_type', url: 'https://example.com', title: 'Bad' }],
      };

      expect(() => jiraTicketDataSchema.parse(input)).toThrow();
    });

    it('rejects link missing required url field', () => {
      const input = {
        ...baseTicket,
        links: [{ type: 'confluence', title: 'Missing URL' }],
      };

      expect(() => jiraTicketDataSchema.parse(input)).toThrow();
    });

    it('rejects link missing required title field', () => {
      const input = {
        ...baseTicket,
        links: [{ type: 'confluence', url: 'https://example.com' }],
      };

      expect(() => jiraTicketDataSchema.parse(input)).toThrow();
    });

    it('allows optional fields to be omitted on link objects', () => {
      const input = {
        ...baseTicket,
        links: [{
          type: 'confluence' as const,
          url: 'https://wiki.example.com/page',
          title: 'Minimal link',
        }],
      };

      const result = jiraTicketDataSchema.parse(input);

      expect(result.links[0].key).toBeUndefined();
      expect(result.links[0].relationship).toBeUndefined();
      expect(result.links[0].filename).toBeUndefined();
      expect(result.links[0].mime_type).toBeUndefined();
    });
  });
});
