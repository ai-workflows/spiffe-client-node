import { SvidCache } from "./cache.js";
import { GoogleTokenFetcher } from "./google_token.js";
import { decodeJwtPayload, isSpiffeId, type JwtSvid, type SpiffeId } from "./types.js";

export interface SpiffeClientOptions {
  /**
   * Base URL of the spire-bridge service (e.g.,
   * `https://spire-bridge-prod.fleet.internal`). The client posts to
   * `${bridgeUrl}/svid/jwt` to mint SVIDs.
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

  /**
   * Override the GoogleTokenFetcher (tests only).
   */
  googleTokens?: GoogleTokenFetcher;

  /**
   * Override the SvidCache (tests only). Defaults to a fresh cache with
   * 30-minute refresh threshold.
   */
  cache?: SvidCache;
}

export interface FetchOptions extends RequestInit {
  /** SPIFFE ID of the *target* service. Determines the SVID's audience claim. */
  audience: SpiffeId;
}

/**
 * SPIFFE workload-identity client.
 *
 * `tokenFor` mints (or returns cached) JWT-SVIDs.
 * `fetch` wraps `globalThis.fetch` with the SVID injected as Bearer.
 * `verify` parses + validates an inbound SVID's claims (signature
 * verification stub for B1.2; B1.3 wires real trust-bundle pinning).
 */
export class SpiffeClient {
  private readonly bridgeUrl: string;
  private readonly selfId: SpiffeId;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly google: GoogleTokenFetcher;
  private readonly cache: SvidCache;

  constructor(options: SpiffeClientOptions) {
    if (!options.bridgeUrl) {
      throw new Error("SpiffeClient: `bridgeUrl` is required");
    }
    if (!isSpiffeId(options.selfId)) {
      throw new Error(
        `SpiffeClient: \`selfId\` must be a SPIFFE ID; got ${JSON.stringify(options.selfId)}`,
      );
    }
    this.bridgeUrl = options.bridgeUrl.replace(/\/$/, "");
    this.selfId = options.selfId;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.google =
      options.googleTokens ?? new GoogleTokenFetcher({ fetchImpl: this.fetchImpl });
    this.cache = options.cache ?? new SvidCache();
  }

  /**
   * Mint or return a cached JWT-SVID for the given audience.
   */
  async tokenFor(audience: SpiffeId): Promise<JwtSvid> {
    const hit = this.cache.get(audience);
    if (hit && !hit.stale) {
      return hit.svid;
    }

    const idToken = await this.google.fetchIdToken(this.bridgeUrl);
    const res = await this.fetchImpl(`${this.bridgeUrl}/svid/jwt`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audience }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // If we have a stale-but-valid token cached, return it rather
      // than throwing — caller's request can still go out, and the
      // next call has a fresh chance to refresh.
      if (hit) {
        return hit.svid;
      }
      throw new Error(
        `spire-bridge /svid/jwt failed: ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as {
      jwt_svid: string;
      expires_at: string;
      spiffe_id: string;
    };
    if (!json.jwt_svid || !json.expires_at || !json.spiffe_id) {
      throw new Error(`spire-bridge /svid/jwt: malformed response`);
    }
    if (!isSpiffeId(json.spiffe_id)) {
      throw new Error(
        `spire-bridge returned non-SPIFFE id: ${JSON.stringify(json.spiffe_id)}`,
      );
    }
    if (json.spiffe_id !== this.selfId) {
      throw new Error(
        `spire-bridge issued SVID for ${json.spiffe_id} but we expected ${this.selfId}`,
      );
    }

    const svid: JwtSvid = {
      jwtSvid: json.jwt_svid,
      expiresAt: json.expires_at,
      spiffeId: json.spiffe_id,
    };
    this.cache.set(audience, svid);
    return svid;
  }

  /**
   * Wrapped fetch: derives target SPIFFE ID from `options.audience`,
   * mints/cache-hits a JWT-SVID, calls fetch with `Authorization:
   * Bearer <svid>`.
   */
  async fetch(input: string | URL, options: FetchOptions): Promise<Response> {
    if (!isSpiffeId(options.audience)) {
      throw new Error(
        `SpiffeClient.fetch: \`options.audience\` must be a SPIFFE ID; got ${JSON.stringify(options.audience)}`,
      );
    }

    const svid = await this.tokenFor(options.audience);
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${svid.jwtSvid}`);

    const { audience: _audience, ...rest } = options;
    void _audience;
    return this.fetchImpl(input, { ...rest, headers });
  }

  /**
   * Server-side verification of an inbound JWT-SVID.
   *
   * B1.2 ships claim-only verification: parses the JWT, checks
   * `exp`/`aud`/`sub`, returns the caller's SPIFFE ID. **Signature
   * verification is intentionally NOT performed here** — that requires
   * the SPIFFE trust bundle, which lands in B1.3 alongside real
   * SPIRE-Server-issued SVIDs.
   *
   * Until then, server-side `requireSpiffeOrM2M` middleware should
   * also enforce that the bridge's dev signer is in use (check the
   * `dev_signer: true` claim) and that the network path from caller
   * to callee runs through trusted infra (Tailscale + IAP, not the
   * public internet). B1.3 swaps this for real signature verification
   * against the trust bundle.
   */
  async verify(
    authHeader: string,
    opts: { expectedAudience: SpiffeId },
  ): Promise<{ sub: SpiffeId }> {
    void this.selfId;

    const prefix = "Bearer ";
    if (!authHeader || !authHeader.startsWith(prefix)) {
      throw new Error("SpiffeClient.verify: missing Bearer token");
    }
    const token = authHeader.slice(prefix.length).trim();
    if (!token) {
      throw new Error("SpiffeClient.verify: empty Bearer token");
    }

    const claims = decodeJwtPayload(token);
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= nowSec) {
      throw new Error("SpiffeClient.verify: token expired");
    }
    if (claims.aud !== opts.expectedAudience) {
      throw new Error(
        `SpiffeClient.verify: audience mismatch; got ${JSON.stringify(claims.aud)}, want ${opts.expectedAudience}`,
      );
    }
    if (typeof claims.sub !== "string" || !isSpiffeId(claims.sub)) {
      throw new Error(
        `SpiffeClient.verify: invalid sub claim: ${JSON.stringify(claims.sub)}`,
      );
    }
    return { sub: claims.sub };
  }
}
