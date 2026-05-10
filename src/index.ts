/**
 * @fleet/spiffe-client — SPIFFE workload identity for Node services
 *
 * Phase 1 of the SPIFFE rollout (see ai-workflows/docs
 * architecture/design/spiffe-rollout.md). This package is what every
 * Node service in the org imports to participate in service-to-service
 * SVID auth. The shape:
 *
 *   const spiffe = new SpiffeClient({
 *     bridgeUrl: process.env.SPIRE_BRIDGE_URL!,
 *     selfId: 'spiffe://fleet.build/services/portal/prod',
 *   });
 *
 *   const res = await spiffe.fetch('https://ais-prod-...run.app/admin/x', {
 *     audience: 'spiffe://fleet.build/services/ais/prod',
 *   });
 *
 * Phase 1 ticket C1.1 lands the scaffold; the actual fetch + cache +
 * refresh-at-50%-TTL logic lands in C1.2 once spire-bridge is real.
 */

export { SpiffeClient, type SpiffeClientOptions, type FetchOptions } from "./client.js";
export { GoogleTokenFetcher } from "./google_token.js";
export { SvidCache } from "./cache.js";
export {
  type JwtSvid,
  type SpiffeId,
  isSpiffeId,
  decodeJwtPayload,
} from "./types.js";
