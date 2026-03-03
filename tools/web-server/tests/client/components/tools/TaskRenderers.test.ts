import { describe, it, expect } from 'vitest';
import { extractPreviousStatus } from '../../../../src/client/components/tools/TaskRenderers.js';

describe('extractPreviousStatus', () => {
  it('returns the status from a JSON object string', () => {
    const content = JSON.stringify({ id: '42', status: 'pending', subject: 'Fix bug' });
    expect(extractPreviousStatus(content)).toBe('pending');
  });

  it('returns null for null input', () => {
    expect(extractPreviousStatus(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(extractPreviousStatus(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractPreviousStatus('')).toBeNull();
  });

  it('returns null for non-JSON string', () => {
    expect(extractPreviousStatus('Task updated successfully')).toBeNull();
  });

  it('returns null when parsed JSON has no status field', () => {
    const content = JSON.stringify({ id: '42', subject: 'No status here' });
    expect(extractPreviousStatus(content)).toBeNull();
  });

  it('returns null when status field is not a string', () => {
    const content = JSON.stringify({ id: '42', status: 3 });
    expect(extractPreviousStatus(content)).toBeNull();
  });

  it('returns null when status is an empty string', () => {
    const content = JSON.stringify({ id: '42', status: '' });
    expect(extractPreviousStatus(content)).toBeNull();
  });

  it('returns null for a JSON array', () => {
    const content = JSON.stringify([{ status: 'pending' }]);
    expect(extractPreviousStatus(content)).toBeNull();
  });

  it('handles in_progress status', () => {
    const content = JSON.stringify({ id: '7', status: 'in_progress' });
    expect(extractPreviousStatus(content)).toBe('in_progress');
  });

  it('handles completed status', () => {
    const content = JSON.stringify({ id: '1', status: 'completed', subject: 'Done' });
    expect(extractPreviousStatus(content)).toBe('completed');
  });

  it('handles blocked status', () => {
    const content = JSON.stringify({ status: 'blocked' });
    expect(extractPreviousStatus(content)).toBe('blocked');
  });

  it('handles failed status', () => {
    const content = JSON.stringify({ status: 'failed' });
    expect(extractPreviousStatus(content)).toBe('failed');
  });
});
