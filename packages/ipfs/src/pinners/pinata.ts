import { canonicalize } from "../canonicalize.js";
import type { FetchLike, PinOptions, PinResult, Pinner } from "@atlasprotocol/types";

export interface PinataPinnerConfig {
  apiKey?: string;
  apiSecret?: string;
  jwt?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = "https://api.pinata.cloud";

/**
 * IPFS pinning service backed by Pinata (https://pinata.cloud). Authenticates
 * via either a JWT (preferred) or an apiKey + apiSecret pair.
 */
export class PinataPinner implements Pinner {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly authHeaders: Record<string, string>;

  constructor(config: PinataPinnerConfig) {
    if (!config.jwt && !(config.apiKey && config.apiSecret)) {
      throw new Error("PinataPinner: provide either { jwt } or { apiKey, apiSecret } credentials");
    }

    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

    if (config.jwt) {
      this.authHeaders = { Authorization: `Bearer ${config.jwt}` };
    } else {
      this.authHeaders = {
        pinata_api_key: config.apiKey as string,
        pinata_secret_api_key: config.apiSecret as string,
      };
    }
  }

  async pinJson(obj: unknown, opts: PinOptions = {}): Promise<PinResult> {
    const bytes = canonicalize(obj);
    const effectiveOpts: PinOptions = opts.name ? opts : { ...opts, name: "atlas-payload.json" };
    return this.pinBytes(bytes, effectiveOpts);
  }

  async pinBytes(content: Uint8Array, opts: PinOptions = {}): Promise<PinResult> {
    const form = new FormData();
    const blob = new Blob([content], { type: "application/octet-stream" });
    const filename = opts.name ?? "atlas-payload.bin";
    form.append("file", blob, filename);

    const pinataMetadata: { name: string; keyvalues?: Record<string, string> } = {
      name: filename,
    };
    if (opts.metadata) {
      pinataMetadata.keyvalues = opts.metadata;
    }
    form.append("pinataMetadata", JSON.stringify(pinataMetadata));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const res = await this.fetchImpl(`${this.baseUrl}/pinning/pinFileToIPFS`, {
      method: "POST",
      headers: { ...this.authHeaders },
      body: form,
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`PinataPinner.pinBytes failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = (await res.json()) as { IpfsHash: string; PinSize: number };
    return { cid: data.IpfsHash, size: data.PinSize };
  }

  async unpin(cid: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/pinning/unpin/${encodeURIComponent(cid)}`, {
      method: "DELETE",
      headers: { ...this.authHeaders },
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`PinataPinner.unpin failed: ${res.status} ${res.statusText} ${text}`);
    }
  }

  async isPinned(cid: string): Promise<boolean> {
    const url = `${this.baseUrl}/data/pinList?hashContains=${encodeURIComponent(cid)}&status=pinned`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { ...this.authHeaders },
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`PinataPinner.isPinned failed: ${res.status} ${res.statusText} ${text}`);
    }
    const data = (await res.json()) as { count?: number; rows?: Array<{ ipfs_pin_hash: string }> };
    if (typeof data.count === "number") {
      return data.count > 0;
    }
    return Array.isArray(data.rows) && data.rows.some((row) => row.ipfs_pin_hash === cid);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
