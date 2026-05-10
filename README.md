# @fleet/spiffe-client

SPIFFE workload-identity client for Node services. Imported by every Node service in the org (portal, fleet, orchestrator, billing, AIS) to participate in service-to-service SVID auth.

Phase 1 of the rollout in [`ai-workflows/docs/architecture/design/spiffe-rollout.md`](https://github.com/ai-workflows/docs/blob/master/architecture/design/spiffe-rollout.md). Companion implementation plan: [`spiffe-implementation-plan.md`](https://github.com/ai-workflows/docs/blob/master/architecture/design/spiffe-implementation-plan.md) — this repo implements ticket `C1.1` (scaffold) and `C1.2` (real fetch + cache + verify).

## Status

**Phase 1 scaffold (C1.1)**. Public API, types, and tests are in. The actual fetch / cache / refresh / verify logic throws `not implemented` — those land in `C1.2` once `spire-bridge` exposes the real `/svid/jwt` endpoint.

## Usage (target shape)

```ts
import { SpiffeClient, type SpiffeId } from "@fleet/spiffe-client";

const spiffe = new SpiffeClient({
  bridgeUrl: process.env.SPIRE_BRIDGE_URL!,        // https://spire-bridge-prod.fleet.internal
  selfId: process.env.SPIFFE_SELF_ID! as SpiffeId, // spiffe://fleet.build/services/portal/prod
});

// One-shot: get a JWT-SVID for calling AIS.
const svid = await spiffe.tokenFor(
  "spiffe://fleet.build/services/ais/prod" as SpiffeId,
);

// Wrapped fetch: handles header injection + audience derivation.
const res = await spiffe.fetch(
  "https://ais-prod-...run.app/api/v1/admin/services",
  { audience: "spiffe://fleet.build/services/ais/prod" as SpiffeId },
);

// Server-side: verify an inbound SVID.
const claims = await spiffe.verify(req.headers.authorization!, {
  expectedAudience: "spiffe://fleet.build/services/ais/prod" as SpiffeId,
});
// claims.sub === "spiffe://fleet.build/services/portal/prod"
```

## Internals (when C1.2 lands)

- **`tokenFor(audience)`** — checks an in-memory cache; on miss, fetches a Google identity token from the GCE metadata server (audience = `bridgeUrl`), POSTs it to `/svid/jwt`, caches the result, schedules refresh at 50% TTL.
- **`fetch(input, options)`** — derives audience from `options.audience`, calls `tokenFor`, fires `fetch` with `Authorization: Bearer <svid>`.
- **`verify(authHeader, opts)`** — validates the SVID against the trust bundle (fetched from spire-bridge), checks `exp`, `aud`, and `sub`. Returns the caller's SPIFFE ID.

## Distribution

Published to **GitHub Packages** under `@fleet/spiffe-client`. Consumer repos add the registry to their `.npmrc`:

```
@fleet:registry=https://npm.pkg.github.com
```

## Test plan

- `npm test` — vitest covers branded type guard + constructor input validation + scaffold method behavior
- `npm run lint` — `tsc --noEmit`
- `npm run build` — emits `dist/`

## Out of scope (Phase 1)

- Trust bundle fetching from a non-`spire-bridge` source
- Federation across trust domains (Phase 3)
- mTLS X.509-SVIDs (callers in Cloud Run use JWT-SVIDs only)
- A Go variant — that's `spiffe-client-go`, separate repo, lands in Phase 3 when AWS workloads need it
