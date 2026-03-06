export interface CacheEntry<T> {
  data: T;
  sizeBytes: number;
  lastAccessed: number;
  /**
   * Tracked for potential future use (e.g., LFU hybrid eviction or metrics).
   * Not currently exposed via public API.
   */
  accessCount: number;
}

const DEFAULT_MAX_SIZE_MB = 50;

export class DataCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private currentSizeBytes = 0;
  private maxSizeBytes: number;

  constructor(maxSizeMB: number = DEFAULT_MAX_SIZE_MB) {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    return entry.data;
  }

  set(key: string, data: T, sizeBytes: number): void {
    // Treat negative sizeBytes as 0
    if (sizeBytes < 0) sizeBytes = 0;
    // Skip insert if the single entry can never fit in the cache
    if (sizeBytes > this.maxSizeBytes) return;
    // Remove existing entry if present
    this.delete(key);
    // Evict LRU entries until we have room
    while (this.currentSizeBytes + sizeBytes > this.maxSizeBytes && this.cache.size > 0) {
      this.evictLRU();
    }
    this.cache.set(key, { data, sizeBytes, lastAccessed: Date.now(), accessCount: 1 });
    this.currentSizeBytes += sizeBytes;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.currentSizeBytes -= entry.sizeBytes;
    this.cache.delete(key);
    return true;
  }

  /**
   * Signals that the cached data for `key` is stale and should be removed.
   * Semantically distinct from `delete()` (generic removal): `invalidate`
   * communicates cache-invalidation intent. Both delegate to the same logic.
   */
  invalidate(key: string): boolean {
    return this.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.currentSizeBytes = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get totalSizeBytes(): number {
    return this.currentSizeBytes;
  }

  /**
   * O(n) scan to find the least-recently-used entry. This is a known trade-off
   * acceptable at current scale (~20-30 entries typical). If entry counts grow
   * significantly, consider a linked-list or min-heap for O(1) eviction.
   */
  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestAccess) {
        oldest = key;
        oldestAccess = entry.lastAccessed;
      }
    }
    if (oldest) this.delete(oldest);
  }
}
