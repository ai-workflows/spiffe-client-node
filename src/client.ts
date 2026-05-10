import { isSpiffeId, type JwtSvid, type SpiffeId } from "./types.js";

export interface SpiffeClientOptions {
  /**
   * Base URL of the spire-bridge service (e.g., `https://spire-bridge-prod.fleet.internal`).
   * The client posts to `${bridgeUrl}/svid/jwt` to mint SVIDs.
   */
  bridgeUrl: string;

  /**
   * SPIFFE ID this service claims to be. Verified by spire-bridge against
   * the calling Google ID token's service-account email, so it can't lie.
   */
  selfId: SpiffeId;

  /**
   * Override the system fetch (mainly for tests).
   */
  fetchImpl?: typeof globalThis.fetch;
}

export interface FetchOptions extends RequestInit {
  /** SPIFFE ID of the *target* service. Determines the SVID's audience claim. */
  audience: SpiffeId;
}

/**
 * Phase 1 scaffold of the SPIFFE workload-identity client.
 *
 * The constructor stores config and validates inputs at boundaries.
 * Real methods (`tokenFor`, `fetch`, `verify`) are stubs that throw
 * `not_implemented` until ticket C1.2 wires them against a real
 * spire-bridge.
 */
export class SpiffeClient {
  private readonly bridgeUrl: string;
  private readonly selfId: SpiffeId;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: SpiffeClientOptions) {
    if (!options.bridgeUrl) {
      throw new Error("SpiffeClient: `bridgeUrl` is required");
    }
    if (!isSpiffeId(options.selfId)) {
      throw new Error(`SpiffeClient: \`selfId\` must be a SPIFFE ID; got ${JSON.stringify(options.selfId)}`);
    }
    this.bridgeUrl = options.bridgeUrl.replace(/\/$/, "");
    this.selfId = options.selfId;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Mint (or return cached) JWT-SVID for the given audience.
   *
   * Phase 1 scaffold: throws. Real impl in C1.2 will:
   * - check in-memory cache for a non-expired SVID for this audience
   * - on miss, fetch a Google identity token from the metadata server
   *   (audience = bridgeUrl), POST it to /svid/jwt
   * - cache the returned JwtSvid; schedule refresh at 50% TTL
   */
  async tokenFor(_audience: SpiffeId): Promise<JwtSvid> {
    void this.bridgeUrl;
    void this.selfId;
    void this.fetchImpl;
    throw new Error(
      "SpiffeClient.tokenFor: not implemented (C1.1 scaffold; C1.2 wires the real fetch)",
    );
  }

  /**
   * Wrapped fetch: derives target SPIFFE ID from `options.audience`,
   * mints/cache-hits a JWT-SVID, calls fetch with `Authorization:
   * Bearer <svid>`. Phase 1 scaffold throws.
   */
  async fetch(_input: string | URL, _options: FetchOptions): Promise<Response> {
    throw new Error(
      "SpiffeClient.fetch: not implemented (C1.1 scaffold; C1.2 wires the real fetch)",
    );
  }

  /**
   * Server-side verification of an inbound JWT-SVID. Phase 1 scaffold
   * throws. Real impl uses the trust bundle to validate signature,
   * checks `exp`, `aud`, and `sub`.
   */
  async verify(
    _authHeader: string,
    _opts: { expectedAudience: SpiffeId },
  ): Promise<{ sub: SpiffeId }> {
    throw new Error(
      "SpiffeClient.verify: not implemented (C1.1 scaffold; C1.2 wires the real verify)",
    );
  }
}
