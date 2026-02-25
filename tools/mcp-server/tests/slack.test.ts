import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleSlackNotify,
  registerSlackTools,
  type SlackToolDeps,
} from '../src/tools/slack.js';
import { MockState } from '../src/state.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseResult } from './helpers.js';

describe('Slack tools', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.KANBAN_MOCK;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.KANBAN_MOCK;
    } else {
      process.env.KANBAN_MOCK = savedEnv;
    }
  });

  describe('handleSlackNotify — mock mode', () => {
    let mockState: MockState;
    let deps: SlackToolDeps;

    beforeEach(() => {
      process.env.KANBAN_MOCK = 'true';
      mockState = new MockState();
      deps = { mockState };
    });

    it('stores notification with all fields in MockState', async () => {
      const args = {
        message: 'PR created successfully',
        stage: 'STAGE-001',
        title: 'New MR Ready',
        ticket: 'TICKET-001',
        ticket_title: 'Auth flow',
        epic: 'EPIC-001',
        epic_title: 'User Auth',
        url: 'https://github.com/org/repo/pull/42',
      };
      await handleSlackNotify(args, deps);

      const notifications = mockState.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toBe('PR created successfully');
      expect(notifications[0].stage).toBe('STAGE-001');
      expect(notifications[0].title).toBe('New MR Ready');
      expect(notifications[0].ticket).toBe('TICKET-001');
      expect(notifications[0].ticket_title).toBe('Auth flow');
      expect(notifications[0].epic).toBe('EPIC-001');
      expect(notifications[0].epic_title).toBe('User Auth');
      expect(notifications[0].url).toBe('https://github.com/org/repo/pull/42');
    });

    it('returns success ToolResult', async () => {
      const result = await handleSlackNotify({ message: 'test' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('mock mode');
    });

    it('notification includes ISO timestamp', async () => {
      await handleSlackNotify({ message: 'test' }, deps);
      const notifications = mockState.getNotifications();
      expect(notifications[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('with mockState: null returns success with skipped message', async () => {
      const nullDeps: SlackToolDeps = { mockState: null };
      const result = await handleSlackNotify({ message: 'test' }, nullDeps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('skipped');
    });
  });

  describe('handleSlackNotify — real mode, no webhook URL', () => {
    it('returns success with skipped message when webhookUrl is undefined', async () => {
      delete process.env.KANBAN_MOCK;
      const deps: SlackToolDeps = { mockState: null };
      const result = await handleSlackNotify({ message: 'test' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('skipped');
      expect(data).toContain('no webhook URL');
    });

    it('returns success with skipped message when webhookUrl is empty string', async () => {
      delete process.env.KANBAN_MOCK;
      const deps: SlackToolDeps = { mockState: null, webhookUrl: '' };
      const result = await handleSlackNotify({ message: 'test' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('skipped');
    });
  });

  describe('handleSlackNotify — real mode, webhook POST', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    let deps: SlackToolDeps;

    beforeEach(() => {
      delete process.env.KANBAN_MOCK;
      mockFetch = vi.fn();
      deps = {
        mockState: null,
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/xxx',
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      };
    });

    it('POST success returns success with sent message', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      const result = await handleSlackNotify({ message: 'PR created' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('sent');
    });

    it('POST non-2xx returns success with warning (not error)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });
      const result = await handleSlackNotify({ message: 'test' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('failed');
      expect(data).toContain('403');
    });

    it('POST network error returns success with warning (not error)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await handleSlackNotify({ message: 'test' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('failed');
      expect(data).toContain('ECONNREFUSED');
    });

    it('payload includes top-level text fallback field', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      await handleSlackNotify({ message: 'PR created for auth' }, deps);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.text).toBe('PR created for auth');
    });

    it('payload blocks contain all provided fields in mrkdwn format', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      await handleSlackNotify(
        {
          message: 'PR created',
          stage: 'STAGE-001',
          title: 'New MR Ready',
          ticket: 'TICKET-001',
          ticket_title: 'Auth flow',
          epic: 'EPIC-001',
          epic_title: 'User Auth',
          url: 'https://github.com/org/repo/pull/42',
        },
        deps,
      );

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      const mrkdwn = payload.blocks[0].text.text;
      expect(mrkdwn).toContain('*New MR Ready*');
      expect(mrkdwn).toContain('PR created');
      expect(mrkdwn).toContain('*Stage:* STAGE-001');
      expect(mrkdwn).toContain('*Ticket:* TICKET-001');
      expect(mrkdwn).toContain('Auth flow');
      expect(mrkdwn).toContain('*Epic:* EPIC-001');
      expect(mrkdwn).toContain('User Auth');
      expect(mrkdwn).toContain('<https://github.com/org/repo/pull/42|View MR/PR>');
    });

    it('payload omits absent optional fields (no undefined in output)', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      await handleSlackNotify({ message: 'minimal notification' }, deps);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      const mrkdwn = payload.blocks[0].text.text;
      expect(mrkdwn).not.toContain('undefined');
      expect(mrkdwn).not.toContain('*Stage:*');
      expect(mrkdwn).not.toContain('*Ticket:*');
      expect(mrkdwn).not.toContain('*Epic:*');
      expect(mrkdwn).not.toContain('View MR/PR');
    });

    it('payload with only message renders cleanly', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      await handleSlackNotify({ message: 'Just a message' }, deps);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.text).toBe('Just a message');
      expect(payload.blocks).toHaveLength(1);
      expect(payload.blocks[0].type).toBe('section');
      const mrkdwn = payload.blocks[0].text.text;
      expect(mrkdwn).toContain('*Workflow Notification*');
      expect(mrkdwn).toContain('Just a message');
    });

    it('POSTs to the correct webhook URL with correct headers', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      await handleSlackNotify({ message: 'test' }, deps);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/T000/B000/xxx');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('handleSlackNotify — webhook_url override', () => {
    describe('mock mode', () => {
      let mockState: MockState;
      let deps: SlackToolDeps;

      beforeEach(() => {
        process.env.KANBAN_MOCK = 'true';
        mockState = new MockState();
        deps = { mockState };
      });

      it('stores webhook_url in MockState notification', async () => {
        const args = {
          message: 'test notification',
          webhook_url: 'https://hooks.slack.com/services/T111/B111/override',
        };
        await handleSlackNotify(args, deps);

        const notifications = mockState.getNotifications();
        expect(notifications).toHaveLength(1);
        expect(notifications[0].webhook_url).toBe(
          'https://hooks.slack.com/services/T111/B111/override',
        );
        expect(notifications[0].message).toBe('test notification');
      });

      it('works without webhook_url (existing behavior unchanged)', async () => {
        await handleSlackNotify({ message: 'no override' }, deps);

        const notifications = mockState.getNotifications();
        expect(notifications).toHaveLength(1);
        expect(notifications[0].webhook_url).toBeUndefined();
        expect(notifications[0].message).toBe('no override');
      });
    });

    describe('real mode', () => {
      let mockFetch: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        delete process.env.KANBAN_MOCK;
        mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      });

      it('webhook_url override sends to specified URL', async () => {
        const deps: SlackToolDeps = {
          mockState: null,
          webhookUrl: 'https://hooks.slack.com/services/T000/B000/global',
          fetch: mockFetch as unknown as typeof globalThis.fetch,
        };
        await handleSlackNotify(
          {
            message: 'test',
            webhook_url: 'https://hooks.slack.com/services/T111/B111/override',
          },
          deps,
        );

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toBe('https://hooks.slack.com/services/T111/B111/override');
      });

      it('webhook_url takes precedence over global webhook', async () => {
        const deps: SlackToolDeps = {
          mockState: null,
          webhookUrl: 'https://hooks.slack.com/services/T000/B000/global',
          fetch: mockFetch as unknown as typeof globalThis.fetch,
        };
        await handleSlackNotify(
          {
            message: 'test',
            webhook_url: 'https://hooks.slack.com/services/T222/B222/repo-specific',
          },
          deps,
        );

        const [url] = mockFetch.mock.calls[0];
        expect(url).toBe('https://hooks.slack.com/services/T222/B222/repo-specific');
        expect(url).not.toBe('https://hooks.slack.com/services/T000/B000/global');
      });

      it('without webhook_url, uses global webhookUrl (existing behavior)', async () => {
        const deps: SlackToolDeps = {
          mockState: null,
          webhookUrl: 'https://hooks.slack.com/services/T000/B000/global',
          fetch: mockFetch as unknown as typeof globalThis.fetch,
        };
        await handleSlackNotify({ message: 'test' }, deps);

        const [url] = mockFetch.mock.calls[0];
        expect(url).toBe('https://hooks.slack.com/services/T000/B000/global');
      });

      it('webhook_url without global webhookUrl still sends successfully', async () => {
        const deps: SlackToolDeps = {
          mockState: null,
          fetch: mockFetch as unknown as typeof globalThis.fetch,
        };
        const result = await handleSlackNotify(
          {
            message: 'test',
            webhook_url: 'https://hooks.slack.com/services/T333/B333/only-override',
          },
          deps,
        );

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toBe('https://hooks.slack.com/services/T333/B333/only-override');
        const data = parseResult(result);
        expect(data).toContain('sent');
      });

      it('neither webhook_url nor global webhookUrl skips silently', async () => {
        const deps: SlackToolDeps = {
          mockState: null,
          fetch: mockFetch as unknown as typeof globalThis.fetch,
        };
        const result = await handleSlackNotify({ message: 'test' }, deps);

        expect(mockFetch).not.toHaveBeenCalled();
        const data = parseResult(result);
        expect(data).toContain('skipped');
        expect(data).toContain('no webhook URL');
      });
    });
  });

  describe('registerSlackTools', () => {
    it('registers 1 tool on the server without error', () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      const spy = vi.spyOn(server, 'tool');
      const deps: SlackToolDeps = { mockState: null };
      registerSlackTools(server, deps);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
