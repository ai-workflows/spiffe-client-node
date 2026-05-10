import { describe, expect, it } from "vitest";
import { SpiffeClient } from "../client.js";
import { GoogleTokenFetcher } from "../google_token.js";
import { SvidCache } from "../cache.js";
import { decodeJwtPayload, isSpiffeId, type SpiffeId } from "../types.js";

const validId = "spiffe://fleet.build/services/portal/staging" as SpiffeId;
const targetId = "spiffe://fleet.build/services/ais/staging" as SpiffeId;
const invalidId = "https://fleet.build/services/portal";

// Build a fake fetch that records every call and returns a canned response.
function buildFakeFetch(handler: (req: Request) => Response | Promise<Response>): {
  fetchImpl: typeof globalThis.fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const req = new Request(url, init);
    return handler(req);
  };
  return { fetchImpl, calls };
}

function fakeBridgeResponse(jwt: string, expiresAt: string, spiffeId: string): Response {
  return new Response(
    JSON.stringify({ jwt_svid: jwt, expires_at: expiresAt, spiffe_id: spiffeId }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// Build a fake JWT (header.payload.signature) with the given claims.
function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = "AAAA";
  return `${header}.${payload}.${sig}`;
}

describe("isSpiffeId", () => {
  it("accepts a canonical id", () => {
    expect(isSpiffeId(validId)).toBe(true);
  });
  it("rejects a non-spiffe URL", () => {
    expect(isSpiffeId(invalidId)).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isSpiffeId("")).toBe(false);
  });
});

describe("decodeJwtPayload", () => {
  it("decodes a valid JWT payload", () => {
    const token = fakeJwt({ sub: validId, aud: targetId, exp: 9999999999 });
    const claims = decodeJwtPayload(token);
    expect(claims.sub).toBe(validId);
    expect(claims.aud).toBe(targetId);
  });
  it("throws on malformed JWT", () => {
    expect(() => decodeJwtPayload("not.a.jwt.token")).toThrow(/3 parts/);
  });
  it("throws on bad JSON in payload", () => {
    const token = "aGVhZGVy.bm90anNvbg.c2ln"; // 'header.notjson.sig'
    expect(() => decodeJwtPayload(token)).toThrow(/valid JSON/);
  });
});

describe("SpiffeClient construction", () => {
  it("throws when bridgeUrl is empty", () => {
    expect(
      () => new SpiffeClient({ bridgeUrl: "", selfId: validId }),
    ).toThrow(/bridgeUrl/);
  });
  it("throws when selfId is not a SPIFFE ID", () => {
    expect(
      () =>
        new SpiffeClient({
          bridgeUrl: "https://b.fleet.internal",
          selfId: invalidId as SpiffeId,
        }),
    ).toThrow(/SPIFFE ID/);
  });
  it("constructs with valid input", () => {
    const c = new SpiffeClient({ bridgeUrl: "https://b.fleet.internal/", selfId: validId });
    expect(c).toBeInstanceOf(SpiffeClient);
  });
});

describe("SpiffeClient.tokenFor", () => {
  it("fetches a Google ID token then mints an SVID via the bridge", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { fetchImpl, calls } = buildFakeFetch(async (req) => {
      const u = new URL(req.url);
      if (u.host === "metadata.google.internal") {
        return new Response("google-id-token-x", { status: 200 });
      }
      if (u.pathname === "/svid/jwt") {
        return fakeBridgeResponse(fakeJwt({ sub: validId, aud: targetId, exp: 9999 }), futureIso, validId);
      }
      return new Response("", { status: 404 });
    });

    const client = new SpiffeClient({
      bridgeUrl: "https://b.fleet.internal",
      selfId: validId,
      fetchImpl,
    });

    const svid = await client.tokenFor(targetId);
    expect(svid.spiffeId).toBe(validId);
    expect(svid.jwtSvid).toMatch(/\./);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("metadata.google.internal");
    expect(calls[1].url).toBe("https://b.fleet.internal/svid/jwt");

    const second = await client.tokenFor(targetId);
    expect(second.jwtSvid).toBe(svid.jwtSvid);
    expect(calls).toHaveLength(2);
  });

  it("throws when bridge issues SVID for a different SPIFFE ID", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const wrongId = "spiffe://fleet.build/services/wrong/staging";
    const { fetchImpl } = buildFakeFetch(async (req) => {
      const u = new URL(req.url);
      if (u.host === "metadata.google.internal") return new Response("token");
      return fakeBridgeResponse(fakeJwt({ sub: wrongId, aud: targetId, exp: 9999 }), futureIso, wrongId);
    });

    const client = new SpiffeClient({
      bridgeUrl: "https://b.fleet.internal",
      selfId: validId,
      fetchImpl,
    });

    await expect(client.tokenFor(targetId)).rejects.toThrow(/expected/);
  });

  it("falls back to stale cached SVID when bridge fails", async () => {
    const futureIso = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min, well below 30-min threshold
    const cache = new SvidCache();
    cache.set(targetId, {
      jwtSvid: "cached.token.sig",
      expiresAt: futureIso,
      spiffeId: validId,
    });

    // Metadata succeeds (so we get past the Google ID fetch); only the
    // bridge errors. That's the "bridge transient failure" scenario this
    // test pins.
    const { fetchImpl } = buildFakeFetch(async (req) => {
      const u = new URL(req.url);
      if (u.host === "metadata.google.internal") {
        return new Response("google-id-token", { status: 200 });
      }
      return new Response("oops", { status: 500 });
    });

    const client = new SpiffeClient({
      bridgeUrl: "https://b.fleet.internal",
      selfId: validId,
      fetchImpl,
      cache,
      googleTokens: new GoogleTokenFetcher({ fetchImpl }),
    });

    const svid = await client.tokenFor(targetId);
    expect(svid.jwtSvid).toBe("cached.token.sig");
  });
});

describe("SpiffeClient.fetch", () => {
  it("injects Authorization Bearer with the SVID", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { fetchImpl, calls } = buildFakeFetch(async (req) => {
      const u = new URL(req.url);
      if (u.host === "metadata.google.internal") return new Response("google-token");
      if (u.pathname === "/svid/jwt") {
        return fakeBridgeResponse("the.minted.svid", futureIso, validId);
      }
      return new Response("ok", { status: 200 });
    });

    const client = new SpiffeClient({
      bridgeUrl: "https://b.fleet.internal",
      selfId: validId,
      fetchImpl,
    });

    const res = await client.fetch("https://ais-staging.run.app/foo", {
      audience: targetId,
    });
    expect(res.status).toBe(200);

    const targetCall = calls.find((c) => c.url === "https://ais-staging.run.app/foo");
    expect(targetCall).toBeDefined();
    const headers = new Headers(targetCall!.init!.headers);
    expect(headers.get("Authorization")).toBe("Bearer the.minted.svid");
  });

  it("rejects non-SPIFFE audience", async () => {
    const client = new SpiffeClient({
      bridgeUrl: "https://b.fleet.internal",
      selfId: validId,
    });
    await expect(
      client.fetch("https://x", { audience: "not-spiffe" as SpiffeId }),
    ).rejects.toThrow(/SPIFFE ID/);
  });
});

describe("SpiffeClient.verify (claim-only, B1.2)", () => {
  const expectedAudience = "spiffe://fleet.build/services/ais/staging" as SpiffeId;
  const callerId = "spiffe://fleet.build/services/portal/staging" as SpiffeId;

  function makeClient(): SpiffeClient {
    return new SpiffeClient({
      bridgeUrl: "https://b.fleet.internal",
      selfId: callerId,
    });
  }

  it("accepts a well-formed token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = fakeJwt({ sub: callerId, aud: expectedAudience, exp });
    const result = await makeClient().verify(`Bearer ${token}`, { expectedAudience });
    expect(result.sub).toBe(callerId);
  });

  it("rejects expired token", async () => {
    const token = fakeJwt({
      sub: callerId,
      aud: expectedAudience,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    await expect(
      makeClient().verify(`Bearer ${token}`, { expectedAudience }),
    ).rejects.toThrow(/expired/);
  });

  it("rejects audience mismatch", async () => {
    const token = fakeJwt({
      sub: callerId,
      aud: "spiffe://fleet.build/services/wrong/staging",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await expect(
      makeClient().verify(`Bearer ${token}`, { expectedAudience }),
    ).rejects.toThrow(/audience/);
  });

  it("rejects missing Bearer", async () => {
    await expect(
      makeClient().verify("not bearer", { expectedAudience }),
    ).rejects.toThrow(/Bearer/);
  });

  it("rejects non-SPIFFE sub", async () => {
    const token = fakeJwt({
      sub: "alice@example.com",
      aud: expectedAudience,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await expect(
      makeClient().verify(`Bearer ${token}`, { expectedAudience }),
    ).rejects.toThrow(/sub/);
  });
});

describe("SvidCache", () => {
  it("returns null on miss", () => {
    expect(new SvidCache().get(targetId)).toBeNull();
  });

  it("returns fresh on hit", () => {
    const cache = new SvidCache({ now: () => 1000 });
    cache.set(targetId, {
      jwtSvid: "x",
      expiresAt: new Date(60 * 60 * 1000).toISOString(),
      spiffeId: validId,
    });
    const hit = cache.get(targetId);
    expect(hit?.stale).toBe(false);
  });

  it("flags stale within refresh threshold", () => {
    const cache = new SvidCache({ now: () => 0, refreshThresholdMs: 30 * 60 * 1000 });
    cache.set(targetId, {
      jwtSvid: "x",
      expiresAt: new Date(20 * 60 * 1000).toISOString(),
      spiffeId: validId,
    });
    const hit = cache.get(targetId);
    expect(hit?.stale).toBe(true);
  });

  it("evicts expired", () => {
    const cache = new SvidCache({ now: () => 99999999999 });
    cache.set(targetId, {
      jwtSvid: "x",
      expiresAt: new Date(0).toISOString(),
      spiffeId: validId,
    });
    expect(cache.get(targetId)).toBeNull();
  });
});
