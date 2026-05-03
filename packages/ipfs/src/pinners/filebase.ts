import { canonicalize } from "../canonicalize.js";
import type { FetchLike, PinOptions, PinResult, Pinner } from "@atlasprotocol/types";

export interface FilebasePinnerConfig {
  apiToken: string;
  bucket?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = "https://api.filebase.io/v1/ipfs";

/**
 * IPFS pinning service backed by Filebase, conforming to the IPFS Pinning
 * Service API spec (https://ipfs.github.io/pinning-services-api-spec/).
 *
 * Filebase's pinning service spec endpoint accepts a CID + name + meta to pin
 * existing content. To pin raw bytes from this client we POST the bytes to the
 * `/pins` endpoint (Filebase performs the add + pin server-side); the bucket,
 * if provided, is forwarded as a custom metadata field.
 */
export class FilebasePinner implements Pinner {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly bucket: string | undefined;

  constructor(config: FilebasePinnerConfig) {
    if (!config.apiToken) throw new Error("FilebasePinner: apiToken is required");
    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.bucket = config.bucket;
  }

  async pinJson(obj: unknown, opts: PinOptions = {}): Promise<PinResult> {
    const bytes = canonicalize(obj);
    const effectiveOpts: PinOptions = opts.name ? opts : { ...opts, name: "atlas-payload.json" };
    return this.pinBytes(bytes, effectiveOpts);
  }

  async pinBytes(content: Uint8Array, opts: PinOptions = {}): Promise<PinResult> {
    const filename = opts.name ?? "atlas-payload.bin";
    const form = new FormData();
    form.append("file", new Blob([content], { type: "application/octet-stream" }), filename);

    const meta: Record<string, string> = { ...(opts.metadata ?? {}) };
    if (this.bucket) meta["bucket"] = this.bucket;
    if (Object.keys(meta).length > 0) {
      form.append("meta", JSON.stringify(meta));
    }
    form.append("name", filename);

    const res = await this.fetchImpl(`${this.baseUrl}/pins`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiToken}` },
      body: form,
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`FilebasePinner.pinBytes failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = (await res.json()) as {
      pin?: { cid: string };
      cid?: string;
      info?: { size?: number };
    };
    const cid = data.pin?.cid ?? data.cid;
    if (!cid) {
      throw new Error("FilebasePinner.pinBytes: response missing cid");
    }
    return { cid, size: data.info?.size ?? content.byteLength };
  }

  async unpin(cid: string): Promise<void> {
    const requestId = await this.findRequestId(cid);
    if (!requestId) {
      throw new Error(`FilebasePinner.unpin: no pin request found for cid ${cid}`);
    }
    const res = await this.fetchImpl(`${this.baseUrl}/pins/${encodeURIComponent(requestId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`FilebasePinner.unpin failed: ${res.status} ${res.statusText} ${text}`);
    }
  }

  async isPinned(cid: string): Promise<boolean> {
    const data = await this.listByCid(cid);
    if (!data) return false;
    const results = data.results ?? [];
    return results.some((r) => r.pin?.cid === cid && r.status === "pinned");
  }

  private async findRequestId(cid: string): Promise<string | undefined> {
    const data = await this.listByCid(cid);
    if (!data) return undefined;
    const results = data.results ?? [];
    const match = results.find((r) => r.pin?.cid === cid);
    return match?.requestid;
  }

  private async listByCid(cid: string): Promise<FilebaseListResponse | undefined> {
    const url = `${this.baseUrl}/pins?cid=${encodeURIComponent(cid)}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`FilebasePinner.list failed: ${res.status} ${res.statusText} ${text}`);
    }
    return (await res.json()) as FilebaseListResponse;
  }
}

interface FilebaseListResponse {
  count?: number;
  results?: Array<{
    requestid: string;
    status: string;
    pin?: { cid: string };
  }>;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
