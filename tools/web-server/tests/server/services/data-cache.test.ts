import { describe, it, expect, vi } from 'vitest';
import { DataCache } from '../../../src/server/services/data-cache.js';

describe('DataCache', () => {
  describe('set() and get()', () => {
    it('stores and retrieves data', () => {
      const cache = new DataCache<string>(1);
      cache.set('key1', 'value1', 100);
      expect(cache.get('key1')).toBe('value1');
    });

    it('returns undefined for missing keys', () => {
      const cache = new DataCache<string>(1);
      expect(cache.get('nonexistent')).toBeUndefined();
    });
  });

  describe('get() updates lastAccessed', () => {
    it('updates lastAccessed timestamp on get', () => {
      const cache = new DataCache<string>(1); // 1MB
      const halfMB = 512 * 1024;
      const now = 1000;

      // Insert two entries that together fill the cache
      vi.spyOn(Date, 'now').mockReturnValue(now);
      cache.set('old', 'value-old', halfMB);

      vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
      cache.set('new', 'value-new', halfMB);

      // Touch 'old' so its lastAccessed becomes more recent than 'new'
      vi.spyOn(Date, 'now').mockReturnValue(now + 5000);
      cache.get('old');

      // Insert a third entry that forces one eviction.
      // 'new' (lastAccessed: now+1000) should be evicted before 'old' (lastAccessed: now+5000).
      vi.spyOn(Date, 'now').mockReturnValue(now + 6000);
      cache.set('third', 'value-third', halfMB);

      expect(cache.get('new')).toBeUndefined();
      expect(cache.get('old')).toBe('value-old');
      expect(cache.get('third')).toBe('value-third');

      vi.restoreAllMocks();
    });

  });

  describe('LRU eviction', () => {
    it('evicts least recently used entry when size limit exceeded', () => {
      const smallCache = new DataCache<string>(1); // 1MB
      const halfMB = 512 * 1024;

      const now = 1000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      smallCache.set('first', 'data1', halfMB);

      vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
      smallCache.set('second', 'data2', halfMB);

      // Cache is now full (1MB). Adding another should evict 'first' (oldest).
      vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
      smallCache.set('third', 'data3', halfMB);

      expect(smallCache.get('first')).toBeUndefined();
      expect(smallCache.get('second')).toBe('data2');
      expect(smallCache.get('third')).toBe('data3');

      vi.restoreAllMocks();
    });

    it('evicts multiple entries if needed to fit new entry', () => {
      const cache = new DataCache<string>(1); // 1MB
      const quarterMB = 256 * 1024;
      const threeFourthsMB = 768 * 1024;

      const now = 1000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      cache.set('a', 'data-a', quarterMB);

      vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
      cache.set('b', 'data-b', quarterMB);

      vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
      cache.set('c', 'data-c', quarterMB);

      // Cache has 768KB used. Adding 768KB entry needs 768KB free,
      // but only 256KB is available. Must evict 'a' and 'b'.
      vi.spyOn(Date, 'now').mockReturnValue(now + 3000);
      cache.set('big', 'big-data', threeFourthsMB);

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe('data-c');
      expect(cache.get('big')).toBe('big-data');

      vi.restoreAllMocks();
    });
  });

  describe('invalidate()', () => {
    it('removes a specific entry', () => {
      const cache = new DataCache<string>(1);
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 200);

      const result = cache.invalidate('key1');

      expect(result).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
    });

    it('returns false for nonexistent key', () => {
      const cache = new DataCache<string>(1);
      expect(cache.invalidate('nonexistent')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('removes all entries and resets size', () => {
      const cache = new DataCache<string>(1);
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 200);
      cache.set('key3', 'value3', 300);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.totalSizeBytes).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBeUndefined();
    });
  });

  describe('size tracking', () => {
    it('accurately tracks totalSizeBytes after set operations', () => {
      const cache = new DataCache<string>(1);
      cache.set('key1', 'value1', 100);
      expect(cache.totalSizeBytes).toBe(100);

      cache.set('key2', 'value2', 250);
      expect(cache.totalSizeBytes).toBe(350);
    });

    it('accurately tracks totalSizeBytes after delete operations', () => {
      const cache = new DataCache<string>(1);
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 250);

      cache.delete('key1');
      expect(cache.totalSizeBytes).toBe(250);
    });

    it('tracks size correctly when overwriting existing key', () => {
      const cache = new DataCache<string>(1);
      cache.set('key1', 'value1', 100);
      expect(cache.totalSizeBytes).toBe(100);

      cache.set('key1', 'updated', 300);
      expect(cache.totalSizeBytes).toBe(300);
      expect(cache.size).toBe(1);
    });

    it('reports correct entry count via size', () => {
      const cache = new DataCache<string>(1);
      expect(cache.size).toBe(0);

      cache.set('a', 'data', 10);
      cache.set('b', 'data', 10);
      expect(cache.size).toBe(2);

      cache.delete('a');
      expect(cache.size).toBe(1);
    });
  });

  describe('zero-size entries', () => {
    it('stores and retrieves zero-byte entries', () => {
      const cache = new DataCache<string>(1);
      cache.set('empty', 'still-has-data', 0);
      expect(cache.get('empty')).toBe('still-has-data');
      expect(cache.totalSizeBytes).toBe(0);
      expect(cache.size).toBe(1);
    });

    it('does not break size tracking with zero-byte entries', () => {
      const cache = new DataCache<string>(1);
      cache.set('zero', 'data', 0);
      cache.set('nonzero', 'data', 500);
      expect(cache.totalSizeBytes).toBe(500);

      cache.delete('zero');
      expect(cache.totalSizeBytes).toBe(500);
    });
  });

  describe('oversized entry', () => {
    it('skips insert when single entry exceeds total cache capacity', () => {
      const cache = new DataCache<string>(1); // 1MB
      const twoMB = 2 * 1024 * 1024;

      cache.set('too-big', 'data', twoMB);

      // Entry should not be stored; cache stays empty
      expect(cache.get('too-big')).toBeUndefined();
      expect(cache.size).toBe(0);
      expect(cache.totalSizeBytes).toBe(0);
    });

    it('does not evict existing entries when oversized entry is rejected', () => {
      const cache = new DataCache<string>(1); // 1MB
      const halfMB = 512 * 1024;
      const twoMB = 2 * 1024 * 1024;

      cache.set('keep', 'value', halfMB);
      cache.set('too-big', 'data', twoMB);

      // 'keep' should survive; oversized entry is silently dropped
      expect(cache.get('keep')).toBe('value');
      expect(cache.get('too-big')).toBeUndefined();
      expect(cache.size).toBe(1);
      expect(cache.totalSizeBytes).toBe(halfMB);
    });
  });

  describe('negative sizeBytes', () => {
    it('treats negative sizeBytes as 0', () => {
      const cache = new DataCache<string>(1);
      cache.set('neg', 'data', -100);

      expect(cache.get('neg')).toBe('data');
      expect(cache.totalSizeBytes).toBe(0);
      expect(cache.size).toBe(1);
    });
  });
});
