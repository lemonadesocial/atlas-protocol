import { describe, expect, it } from "vitest";

import { canonicalize } from "../../canonicalize.js";
import { Web3StoragePinner } from "../../pinners/web3-storage.js";

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

function getFileName(form: FormData): string {
  const file = form.get("file") as File;
  return file.name;
}

describe("Web3StoragePinner", () => {
  it("requires apiToken and spaceDID", () => {
    expect(() => new Web3StoragePinner({ apiToken: "", spaceDID: "did" })).toThrow();
    expect(() => new Web3StoragePinner({ apiToken: "t", spaceDID: "" })).toThrow();
  });

  it("pinBytes uploads with Bearer + X-Space and returns cid", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { cid: "bafkreiabc", size: 12 } },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "token",
      spaceDID: "did:key:abc",
      fetch: fetchImpl,
    });
    const result = await pinner.pinBytes(new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ cid: "bafkreiabc", size: 12 });
    expect(calls[0]?.url).toBe("https://up.web3.storage/upload");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer token");
    expect(headers["X-Space"]).toBe("did:key:abc");
    const form = calls[0]?.init.body as FormData;
    expect(await getFileBytes(form)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("pinBytes throws on non-2xx pin responses", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 500, statusText: "Server Error", text: "oops" },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });
    await expect(pinner.pinBytes(new Uint8Array([0]))).rejects.toThrow(/500/);
  });

  it("pinJson uploads canonicalized bytes and defaults filename to atlas-payload.json", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { cid: "bafkreijson", size: 7 } },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });
    const obj = { foo: 1, bar: "baz" };
    const result = await pinner.pinJson(obj);
    expect(result).toEqual({ cid: "bafkreijson", size: 7 });

    const form = calls[0]?.init.body as FormData;
    expect(await getFileBytes(form)).toEqual(canonicalize(obj));
    expect(getFileName(form)).toBe("atlas-payload.json");
  });

  it("pinJson honours caller-supplied name", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { cid: "bafkreijson", size: 1 } },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });
    await pinner.pinJson({ a: 1 }, { name: "my-receipt.json" });
    const form = calls[0]?.init.body as FormData;
    expect(getFileName(form)).toBe("my-receipt.json");
  });

  it("pinJson canonicalization: reordered keys produce byte-identical bodies", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { cid: "c1", size: 1 } },
      { ok: true, json: { cid: "c2", size: 1 } },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });

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
      { ok: true, json: { cid: "c1", size: 1 } },
      { ok: true, json: { cid: "c2", size: 1 } },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });
    const obj = { a: 1 };
    await pinner.pinJson(obj);
    await pinner.pinBytes(canonicalize(obj), { name: "atlas-payload.json" });

    const bytesA = await getFileBytes(calls[0]?.init.body as FormData);
    const bytesB = await getFileBytes(calls[1]?.init.body as FormData);
    expect(bytesA).toEqual(bytesB);
  });

  it("pinJson throws on 500", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 500, statusText: "Server Error", text: "oops" },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });
    await expect(pinner.pinJson({ a: 1 })).rejects.toThrow(/500/);
  });

  it("unpin issues DELETE", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([{ ok: true }]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });
    await pinner.unpin("bafkreiabc");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://up.web3.storage/upload/bafkreiabc");
  });

  it("isPinned returns false on 404, true on 200", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 404, statusText: "Not Found" },
      { ok: true, status: 200 },
    ]);
    const pinner = new Web3StoragePinner({
      apiToken: "t",
      spaceDID: "d",
      fetch: fetchImpl,
    });
    expect(await pinner.isPinned("bafkreiabc")).toBe(false);
    expect(await pinner.isPinned("bafkreiabc")).toBe(true);
  });
});
