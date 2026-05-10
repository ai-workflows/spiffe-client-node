import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

/**
 * Fetches and caches the bridge's JWKS (`/.well-known/jwks.json`)
 * for signature verification of incoming SVIDs.
 *
 * Phase 1 detail: in dev-signer mode (B1.2) the bridge issues
 * locally-signed JWTs and exposes the public key here. Once B1.3
 * replaces the dev signer with real SPIRE-Server-issued SVIDs, the
 * verification source becomes the SPIFFE trust bundle and this
 * helper is replaced (the API on `SpiffeClient.verify` stays the
 * same so consumers don't churn).
 */
export interface BridgeJwksOptions {
  /** Override fetch (mostly for tests). */
  fetchImpl?: typeof globalThis.fetch;
  /**
   * Cache the JWKS for this many ms. Default: 5 min — long enough
   * to be cheap, short enough that key rotation propagates fast.
   */
  cacheMaxAgeMs?: number;
}

/**
 * Returns a `jose.JWTVerifyGetKey` that resolves keys from the bridge's
 * JWKS endpoint. Reuse a single value per process — `jose` already
 * caches internally.
 */
export function buildBridgeJwks(
  bridgeUrl: string,
  options: BridgeJwksOptions = {},
): JWTVerifyGetKey {
  const url = new URL(`${bridgeUrl.replace(/\/$/, "")}/.well-known/jwks.json`);

  // jose's createRemoteJWKSet accepts an explicit fetcher via
  // `[customFetch]` symbol option. We use the public `cacheMaxAge`
  // and let jose handle HTTP retries / cache population.
  return createRemoteJWKSet(url, {
    cacheMaxAge: options.cacheMaxAgeMs ?? 5 * 60 * 1000,
    timeoutDuration: 5_000,
    [Symbol.for("jose.fetcher")]: options.fetchImpl,
  });
}
