/**
 * Fetch a Google identity token from the GCE metadata server.
 *
 * Cloud Run / GCE / GAE workloads ask the metadata server for a JWT
 * signed by Google, audience-bound to whatever URL we want to call.
 * The bridge then validates the signature against Google's JWKS.
 *
 * `audience` MUST be the spire-bridge service URL (e.g.
 * https://spire-bridge-prod.fleet.internal). Mismatch => bridge rejects
 * with `invalid_token`.
 */
const METADATA_BASE =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

export interface GoogleTokenFetcherOptions {
  /** Override for tests. */
  fetchImpl?: typeof globalThis.fetch;
  /** Override metadata host (test only). */
  metadataBase?: string;
}

export class GoogleTokenFetcher {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly metadataBase: string;

  constructor(options: GoogleTokenFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.metadataBase = options.metadataBase ?? METADATA_BASE;
  }

  async fetchIdToken(audience: string): Promise<string> {
    const url = `${this.metadataBase}?audience=${encodeURIComponent(audience)}`;
    const res = await this.fetchImpl(url, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!res.ok) {
      throw new Error(
        `metadata identity fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    const text = (await res.text()).trim();
    if (!text) {
      throw new Error("metadata identity fetch returned empty body");
    }
    return text;
  }
}
