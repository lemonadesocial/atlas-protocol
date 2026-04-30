import type { FetchLike, PinOptions, PinResult, Pinner } from './pinner.js';

export interface KuboPinnerConfig {
  apiUrl?: string;
  fetch?: FetchLike;
}

const DEFAULT_API_URL = 'http://localhost:5001';

/**
 * IPFS pinning service backed by a self-hosted Kubo daemon
 * (https://docs.ipfs.tech/reference/kubo/rpc/).
 */
export class KuboPinner implements Pinner {
  private readonly fetchImpl: FetchLike;
  private readonly apiUrl: string;

  constructor(config: KuboPinnerConfig = {}) {
    this.fetchImpl = config.fetch ?? fetch;
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  }

  async pin(content: Uint8Array, opts: PinOptions = {}): Promise<PinResult> {
    const filename = opts.name ?? 'atlas-payload.bin';
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'application/octet-stream' }), filename);

    const url = `${this.apiUrl}/api/v0/add?pin=true&cid-version=1&raw-leaves=true`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`KuboPinner.pin failed: ${res.status} ${res.statusText} ${text}`);
    }
    // Kubo /add returns NDJSON; the last line is the root.
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) {
      throw new Error('KuboPinner.pin: empty response');
    }
    const last = lines[lines.length - 1] as string;
    const data = JSON.parse(last) as { Hash: string; Size: string | number };
    const size =
      typeof data.Size === 'string' ? Number.parseInt(data.Size, 10) : (data.Size ?? content.byteLength);
    return { cid: data.Hash, size: Number.isFinite(size) ? size : content.byteLength };
  }

  async unpin(cid: string): Promise<void> {
    const url = `${this.apiUrl}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`;
    const res = await this.fetchImpl(url, { method: 'POST' });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`KuboPinner.unpin failed: ${res.status} ${res.statusText} ${text}`);
    }
  }

  async isPinned(cid: string): Promise<boolean> {
    const url = `${this.apiUrl}/api/v0/pin/ls?arg=${encodeURIComponent(cid)}`;
    const res = await this.fetchImpl(url, { method: 'POST' });
    if (res.status === 500 || res.status === 404) {
      // Kubo returns 500 with `not pinned` when the CID isn't in the pinset.
      return false;
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`KuboPinner.isPinned failed: ${res.status} ${res.statusText} ${text}`);
    }
    const data = (await res.json()) as { Keys?: Record<string, { Type: string }> };
    return Boolean(data.Keys && Object.keys(data.Keys).length > 0);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
