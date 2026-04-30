import { describe, expect, it } from 'vitest';

import { FilebasePinner } from '../../pinners/filebase.js';

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

describe('FilebasePinner', () => {
  it('requires apiToken', () => {
    expect(() => new FilebasePinner({ apiToken: '' } as never)).toThrow();
  });

  it('pin POSTs to /pins with Bearer auth', async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { pin: { cid: 'bafkreiabc' }, info: { size: 4 } } },
    ]);
    const pinner = new FilebasePinner({ apiToken: 'tok', fetch: fetchImpl });
    const result = await pinner.pin(new Uint8Array([1, 2, 3, 4]), { name: 'x.bin' });
    expect(result).toEqual({ cid: 'bafkreiabc', size: 4 });
    expect(calls[0]?.url).toBe('https://api.filebase.io/v1/ipfs/pins');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok');
  });

  it('forwards bucket as meta.bucket', async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { pin: { cid: 'bafkreiabc' }, info: { size: 1 } } },
    ]);
    const pinner = new FilebasePinner({
      apiToken: 'tok',
      bucket: 'atlas-events',
      fetch: fetchImpl,
    });
    await pinner.pin(new Uint8Array([0]));
    const form = calls[0]?.init.body as FormData;
    const meta = JSON.parse(form.get('meta') as string);
    expect(meta.bucket).toBe('atlas-events');
  });

  it('throws on non-2xx pin response', async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 401, statusText: 'Unauthorized', text: 'no' },
    ]);
    const pinner = new FilebasePinner({ apiToken: 't', fetch: fetchImpl });
    await expect(pinner.pin(new Uint8Array([0]))).rejects.toThrow(/401/);
  });

  it('isPinned returns true when results contain matching pinned entry', async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      {
        ok: true,
        json: {
          count: 1,
          results: [
            { requestid: 'req-1', status: 'pinned', pin: { cid: 'bafkreiabc' } },
          ],
        },
      },
    ]);
    const pinner = new FilebasePinner({ apiToken: 't', fetch: fetchImpl });
    expect(await pinner.isPinned('bafkreiabc')).toBe(true);
    expect(calls[0]?.url).toBe('https://api.filebase.io/v1/ipfs/pins?cid=bafkreiabc');
  });

  it('isPinned returns false when no matching pinned entry', async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: true, json: { count: 0, results: [] } },
    ]);
    const pinner = new FilebasePinner({ apiToken: 't', fetch: fetchImpl });
    expect(await pinner.isPinned('bafkreiabc')).toBe(false);
  });

  it('unpin looks up requestid then DELETEs', async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      {
        ok: true,
        json: {
          count: 1,
          results: [
            { requestid: 'req-9', status: 'pinned', pin: { cid: 'bafkreiabc' } },
          ],
        },
      },
      { ok: true },
    ]);
    const pinner = new FilebasePinner({ apiToken: 't', fetch: fetchImpl });
    await pinner.unpin('bafkreiabc');
    expect(calls[1]?.init.method).toBe('DELETE');
    expect(calls[1]?.url).toBe('https://api.filebase.io/v1/ipfs/pins/req-9');
  });

  it('unpin throws if no matching pin request exists', async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: true, json: { count: 0, results: [] } },
    ]);
    const pinner = new FilebasePinner({ apiToken: 't', fetch: fetchImpl });
    await expect(pinner.unpin('bafkreiabc')).rejects.toThrow(/no pin request found/);
  });
});
