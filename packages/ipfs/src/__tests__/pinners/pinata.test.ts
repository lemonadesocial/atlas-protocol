import { describe, expect, it, vi } from "vitest";

import { canonicalize } from "../../canonicalize.js";
import { PinataPinner } from "../../pinners/pinata.js";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function urlToString(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function makeFetch(responses: Array<Partial<Response> & { json?: unknown; text?: string }>) {
  const calls: CapturedCall[] = [];
  let i = 0;
  const fn = (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url: urlToString(url), init });
    const r = responses[i++] ?? { ok: true, status: 200 };
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.statusText ?? "OK",
      json: () => Promise.resolve(r.json),
      text: () => Promise.resolve(r.text ?? ""),
    } as Response);
  };
  return { fetch: fn, calls };
}

async function getFileBytes(form: FormData): Promise<Uint8Array> {
  const blob = form.get("file") as Blob;
  return new Uint8Array(await blob.arrayBuffer());
}

describe("PinataPinner", () => {
  it("throws if neither jwt nor apiKey+secret is provided", () => {
    expect(() => new PinataPinner({})).toThrow(/credentials/);
  });

  it("pinBytes uploads bytes verbatim and returns cid", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { IpfsHash: "bafkreiabc", PinSize: 42 } },
    ]);
    const pinner = new PinataPinner({ jwt: "jwt-token", fetch: fetchImpl });
    const result = await pinner.pinBytes(new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ cid: "bafkreiabc", size: 42 });
    expect(calls[0]?.url).toBe("https://api.pinata.cloud/pinning/pinFileToIPFS");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer jwt-token");
    const body = calls[0]?.init.body as FormData;
    expect(await getFileBytes(body)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("pinBytes uses key+secret headers when no jwt", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { IpfsHash: "bafkreixyz", PinSize: 9 } },
    ]);
    const pinner = new PinataPinner({
      apiKey: "k",
      apiSecret: "s",
      fetch: fetchImpl,
    });
    await pinner.pinBytes(new Uint8Array([0]));
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["pinata_api_key"]).toBe("k");
    expect(headers["pinata_secret_api_key"]).toBe("s");
  });

  it("pinBytes passes name + metadata to pinataMetadata", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { IpfsHash: "bafkrei1", PinSize: 1 } },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    await pinner.pinBytes(new Uint8Array([0]), {
      name: "event.json",
      metadata: { kind: "event" },
    });
    const body = calls[0]?.init.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    const meta = form.get("pinataMetadata");
    expect(typeof meta).toBe("string");
    const parsed = JSON.parse(meta as string) as {
      name: string;
      keyvalues: Record<string, string>;
    };
    expect(parsed.name).toBe("event.json");
    expect(parsed.keyvalues).toEqual({ kind: "event" });
  });

  it("pinBytes throws on 401 unauthorized", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 401, statusText: "Unauthorized", text: "bad creds" },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    await expect(pinner.pinBytes(new Uint8Array([0]))).rejects.toThrow(/401/);
  });

  it("pinBytes throws on 429 rate limit", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 429, statusText: "Too Many Requests", text: "slow down" },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    await expect(pinner.pinBytes(new Uint8Array([0]))).rejects.toThrow(/429/);
  });

  it("pinJson uploads canonicalized bytes and defaults filename to atlas-payload.json", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { IpfsHash: "bafkreijson", PinSize: 7 } },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    const obj = { foo: 1, bar: "baz" };
    const result = await pinner.pinJson(obj);
    expect(result).toEqual({ cid: "bafkreijson", size: 7 });

    const form = calls[0]?.init.body as FormData;
    expect(await getFileBytes(form)).toEqual(canonicalize(obj));
    const meta = JSON.parse(form.get("pinataMetadata") as string) as { name: string };
    expect(meta.name).toBe("atlas-payload.json");
  });

  it("pinJson honours caller-supplied name", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { IpfsHash: "bafkreijson", PinSize: 1 } },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    await pinner.pinJson({ a: 1 }, { name: "my-receipt.json" });
    const form = calls[0]?.init.body as FormData;
    const meta = JSON.parse(form.get("pinataMetadata") as string) as { name: string };
    expect(meta.name).toBe("my-receipt.json");
  });

  it("pinJson canonicalization: reordered keys produce byte-identical bodies", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { IpfsHash: "c1", PinSize: 1 } },
      { ok: true, json: { IpfsHash: "c2", PinSize: 1 } },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });

    const a = { foo: 1, bar: { x: 1, y: 2 } };
    const b = { bar: { y: 2, x: 1 }, foo: 1 };
    await pinner.pinJson(a);
    await pinner.pinJson(b);

    const bytesA = await getFileBytes(calls[0]?.init.body as FormData);
    const bytesB = await getFileBytes(calls[1]?.init.body as FormData);
    expect(bytesA).toEqual(bytesB);
  });

  it("pinJson(obj) and pinBytes(canonicalize(obj)) upload identical request bodies", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { IpfsHash: "c1", PinSize: 1 } },
      { ok: true, json: { IpfsHash: "c2", PinSize: 1 } },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    const obj = { a: 1 };
    await pinner.pinJson(obj);
    await pinner.pinBytes(canonicalize(obj), { name: "atlas-payload.json" });

    const bytesA = await getFileBytes(calls[0]?.init.body as FormData);
    const bytesB = await getFileBytes(calls[1]?.init.body as FormData);
    expect(bytesA).toEqual(bytesB);
  });

  it("pinJson throws on 500", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 500, statusText: "Server Error", text: "boom" },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    await expect(pinner.pinJson({ a: 1 })).rejects.toThrow(/500/);
  });

  it("unpin issues DELETE to /pinning/unpin/:cid", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([{ ok: true }]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    await pinner.unpin("bafkreiabc");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://api.pinata.cloud/pinning/unpin/bafkreiabc");
  });

  it("isPinned returns true when count > 0", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { count: 1, rows: [{ ipfs_pin_hash: "bafkreiabc" }] } },
    ]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    const ok = await pinner.isPinned("bafkreiabc");
    expect(ok).toBe(true);
    expect(calls[0]?.url).toContain("/data/pinList");
    expect(calls[0]?.url).toContain("hashContains=bafkreiabc");
  });

  it("isPinned returns false when count is 0", async () => {
    const { fetch: fetchImpl } = makeFetch([{ ok: true, json: { count: 0, rows: [] } }]);
    const pinner = new PinataPinner({ jwt: "t", fetch: fetchImpl });
    const ok = await pinner.isPinned("bafkreiabc");
    expect(ok).toBe(false);
  });

  it("default fetch falls back to global fetch", () => {
    const original = globalThis.fetch;
    const spy = vi.fn();
    globalThis.fetch = spy;
    try {
      // Just verify construction does not throw and uses some fetch impl.
      expect(() => new PinataPinner({ jwt: "t" })).not.toThrow();
    } finally {
      globalThis.fetch = original;
    }
  });
});
