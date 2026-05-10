import type { JwtSvid, SpiffeId } from "./types.js";

interface CacheEntry {
  svid: JwtSvid;
  expiresMs: number;
}

/**
 * Tiny per-audience SVID cache with refresh-at-50%-TTL semantics.
 *
 * The cache stores a single SVID per target audience. On each lookup
 * we compute the remaining TTL; if it's below `refreshThresholdMs` we
 * still return the cached SVID (it's still valid) but flag it as
 * `stale` so the client knows to kick off a background refresh.
 *
 * No background timers — the client triggers refresh inline on the
 * next call. This keeps the cache simple and removes a class of
 * shutdown-leak bugs at the cost of "first call after staleness pays
 * the round-trip latency". Acceptable trade for our load profile.
 */
export class SvidCache {
  private readonly entries = new Map<SpiffeId, CacheEntry>();

  /**
   * Refresh threshold in ms. Default: 50% of token TTL means a 1h
   * token starts being "stale" with 30 minutes left.
   */
  private readonly refreshThresholdMs: number;

  /**
   * Optional clock injection for tests. Production passes Date.now.
   */
  private readonly now: () => number;

  constructor(options: { refreshThresholdMs?: number; now?: () => number } = {}) {
    this.refreshThresholdMs = options.refreshThresholdMs ?? 30 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  get(audience: SpiffeId): { svid: JwtSvid; stale: boolean } | null {
    const entry = this.entries.get(audience);
    if (!entry) return null;

    const remaining = entry.expiresMs - this.now();
    if (remaining <= 0) {
      this.entries.delete(audience);
      return null;
    }
    return { svid: entry.svid, stale: remaining < this.refreshThresholdMs };
  }

  set(audience: SpiffeId, svid: JwtSvid): void {
    const expiresMs = Date.parse(svid.expiresAt);
    if (Number.isNaN(expiresMs)) {
      throw new Error(
        `SvidCache.set: invalid expiresAt ${JSON.stringify(svid.expiresAt)}`,
      );
    }
    this.entries.set(audience, { svid, expiresMs });
  }

  delete(audience: SpiffeId): void {
    this.entries.delete(audience);
  }

  /** Mostly for tests; production code shouldn't iterate the cache. */
  size(): number {
    return this.entries.size;
  }
}
