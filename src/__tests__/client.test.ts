import { describe, expect, it } from "vitest";
import { SpiffeClient } from "../client.js";
import { isSpiffeId } from "../types.js";

const validId = "spiffe://fleet.build/services/portal/staging";
const invalidId = "https://fleet.build/services/portal";

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

describe("SpiffeClient construction", () => {
  it("throws when bridgeUrl is empty", () => {
    expect(() =>
      new SpiffeClient({
        bridgeUrl: "",
        // @ts-expect-error: branded type assertion via cast — runtime check is what we're testing
        selfId: validId,
      }),
    ).toThrow(/bridgeUrl/);
  });
  it("throws when selfId is not a SPIFFE ID", () => {
    expect(() =>
      new SpiffeClient({
        bridgeUrl: "https://spire-bridge-staging.fleet.internal",
        // @ts-expect-error: deliberately invalid for the runtime check
        selfId: invalidId,
      }),
    ).toThrow(/SPIFFE ID/);
  });
  it("constructs with valid input", () => {
    const c = new SpiffeClient({
      bridgeUrl: "https://spire-bridge-staging.fleet.internal/",
      // @ts-expect-error: branded type assertion via cast
      selfId: validId,
    });
    expect(c).toBeInstanceOf(SpiffeClient);
  });
});

describe("SpiffeClient methods (scaffold)", () => {
  const client = new SpiffeClient({
    bridgeUrl: "https://spire-bridge-staging.fleet.internal",
    // @ts-expect-error: branded type assertion via cast
    selfId: validId,
  });

  it("tokenFor throws not_implemented", async () => {
    // @ts-expect-error: branded type assertion via cast
    await expect(client.tokenFor(validId)).rejects.toThrow(/not implemented/);
  });

  it("fetch throws not_implemented", async () => {
    await expect(
      // @ts-expect-error: branded type assertion via cast
      client.fetch("https://ais-staging-...run.app", { audience: validId }),
    ).rejects.toThrow(/not implemented/);
  });

  it("verify throws not_implemented", async () => {
    await expect(
      // @ts-expect-error: branded type assertion via cast
      client.verify("Bearer x", { expectedAudience: validId }),
    ).rejects.toThrow(/not implemented/);
  });
});
