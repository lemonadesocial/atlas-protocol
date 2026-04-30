import type { FetchLike, PinOptions, PinResult, Pinner } from "./pinner.js";

export interface Web3StoragePinnerConfig {
  apiToken: string;
  spaceDID: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = "https://up.web3.storage";

/**
 * IPFS pinning service backed by Web3.Storage / w3up. Uses the public REST
 * surface directly so the package stays light-weight (no @web3-storage/w3up-client
 * dependency).
 *
 * Some advanced w3up flows (UCAN delegation chains, signed receipts) are only
 * exposed by the SDK. Endpoints not covered by the public REST surface are
 * marked with a TODO comment below.
 */
export class Web3StoragePinner implements Pinner {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly spaceDID: string;

  constructor(config: Web3StoragePinnerConfig) {
    if (!config.apiToken) throw new Error("Web3StoragePinner: apiToken is required");
    if (!config.spaceDID) throw new Error("Web3StoragePinner: spaceDID is required");
    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.spaceDID = config.spaceDID;
  }

  async pin(content: Uint8Array, opts: PinOptions = {}): Promise<PinResult> {
    const filename = opts.name ?? "atlas-payload.bin";
    const form = new FormData();
    form.append("file", new Blob([content], { type: "application/octet-stream" }), filename);
    if (opts.metadata) {
      form.append("meta", JSON.stringify(opts.metadata));
    }

    const res = await this.fetchImpl(`${this.baseUrl}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "X-Space": this.spaceDID,
      },
      body: form,
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Web3StoragePinner.pin failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = (await res.json()) as { cid: string; size?: number };
    return { cid: data.cid, size: data.size ?? content.byteLength };
  }

  async unpin(cid: string): Promise<void> {
    // TODO: Web3.Storage's public REST endpoint for un-pinning a single CID is
    //       limited; the full revocation flow requires the w3up SDK's UCAN
    //       receipts. We issue a best-effort DELETE here and leave the SDK
    //       integration for a follow-up.
    const res = await this.fetchImpl(`${this.baseUrl}/upload/${encodeURIComponent(cid)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "X-Space": this.spaceDID,
      },
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Web3StoragePinner.unpin failed: ${res.status} ${res.statusText} ${text}`);
    }
  }

  async isPinned(cid: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/upload/${encodeURIComponent(cid)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "X-Space": this.spaceDID,
      },
    });
    if (res.status === 404) return false;
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Web3StoragePinner.isPinned failed: ${res.status} ${res.statusText} ${text}`);
    }
    return true;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
