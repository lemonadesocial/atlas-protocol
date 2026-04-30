import { describe, expect, it } from 'vitest';

import { Web3StoragePinner } from '../../pinners/web3-storage.js';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeFetch(responses: Array<Partial<Response> & { json?: unknown; text?: string }>) {
  const calls: CapturedCall[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url: String(url), init });
    const r = responses[i++] ?? { ok: true, status: 200 };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.statusText ?? 'OK',
      json: async () => r.json,
      text: async () => r.text ?? '',
    } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

describe('Web3StoragePinner', () => {
  it('requires apiToken and spaceDID', () => {
    expect(() => new Web3StoragePinner({ apiToken: '', spaceDID: 'did' } as never)).toThrow();
    expect(() => new Web3StoragePinner({ apiToken: 't', spaceDID: '' } as never)).toThrow();
  });

  it('pin uploads with Bearer + X-Space and returns cid', async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { cid: 'bafkreiabc', size: 12 } },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: 'token',
      spaceDID: 'did:key:abc',
      fetch: fetchImpl,
    });
    const result = await pinner.pin(new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ cid: 'bafkreiabc', size: 12 });
    expect(calls[0]?.url).toBe('https://up.web3.storage/upload');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token');
    expect(headers['X-Space']).toBe('did:key:abc');
  });

  it('throws on non-2xx pin responses', async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 500, statusText: 'Server Error', text: 'oops' },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: 't',
      spaceDID: 'd',
      fetch: fetchImpl,
    });
    await expect(pinner.pin(new Uint8Array([0]))).rejects.toThrow(/500/);
  });

  it('unpin issues DELETE', async () => {
    const { fetch: fetchImpl, calls } = makeFetch([{ ok: true }]);
    const pinner = new Web3StoragePinner({
      apiToken: 't',
      spaceDID: 'd',
      fetch: fetchImpl,
    });
    await pinner.unpin('bafkreiabc');
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('https://up.web3.storage/upload/bafkreiabc');
  });

  it('isPinned returns false on 404, true on 200', async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 404, statusText: 'Not Found' },
      { ok: true, status: 200 },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: 't',
      spaceDID: 'd',
      fetch: fetchImpl,
    });
    expect(await pinner.isPinned('bafkreiabc')).toBe(false);
    expect(await pinner.isPinned('bafkreiabc')).toBe(true);
  });
});
