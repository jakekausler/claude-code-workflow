import { describe, it, expect } from 'vitest';
import type { PendingBadgeProps } from '../../src/client/components/interaction/PendingBadge.js';

describe('PendingBadge', () => {
  it('exports PendingBadgeProps type', () => {
    const props: PendingBadgeProps = { count: 3 };
    expect(props.count).toBe(3);
  });
});
