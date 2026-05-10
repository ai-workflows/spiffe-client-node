/**
 * Branded SPIFFE ID — `spiffe://<trust-domain>/<path>`.
 *
 * The brand exists so callers can't accidentally pass a raw URL where
 * a SPIFFE ID is expected. Use `isSpiffeId(s)` at boundaries to refine
 * a string into a SpiffeId; internal code handles them as opaque.
 */
export type SpiffeId = string & { readonly __brand: "SpiffeId" };

const SPIFFE_ID_RE = /^spiffe:\/\/[a-z0-9.-]+(\/[A-Za-z0-9._\-/]+)?$/;

export function isSpiffeId(value: string): value is SpiffeId {
  return SPIFFE_ID_RE.test(value);
}

/**
 * One issued JWT-SVID and its metadata. Returned by spire-bridge's
 * /svid/jwt endpoint; cached locally until expiry.
 */
export interface JwtSvid {
  /** The opaque JWT string, ready to drop into Authorization. */
  jwtSvid: string;
  /** Expiration as ISO-8601, copied verbatim from spire-bridge. */
  expiresAt: string;
  /** SPIFFE ID this SVID asserts the caller has. */
  spiffeId: SpiffeId;
}
