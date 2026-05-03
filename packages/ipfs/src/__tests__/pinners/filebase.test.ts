import { describe, expect, it } from "vitest";

import { canonicalize } from "../../canonicalize.js";
import { FilebasePinner } from "../../pinners/filebase.js";

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

describe("FilebasePinner", () => {
  it("requires apiToken", () => {
    expect(() => new FilebasePinner({ apiToken: "" })).toThrow();
  });

  it("pinBytes POSTs to /pins with Bearer auth", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { pin: { cid: "bafkreiabc" }, info: { size: 4 } } },
    ]);
    const pinner = new FilebasePinner({ apiToken: "tok", fetch: fetchImpl });
    const result = await pinner.pinBytes(new Uint8Array([1, 2, 3, 4]), { name: "x.bin" });
    expect(result).toEqual({ cid: "bafkreiabc", size: 4 });
    expect(calls[0]?.url).toBe("https://api.filebase.io/v1/ipfs/pins");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
    const form = calls[0]?.init.body as FormData;
    expect(await getFileBytes(form)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("pinBytes forwards bucket as meta.bucket", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { pin: { cid: "bafkreiabc" }, info: { size: 1 } } },
    ]);
    const pinner = new FilebasePinner({
      apiToken: "tok",
      bucket: "atlas-events",
      fetch: fetchImpl,
    });
    await pinner.pinBytes(new Uint8Array([0]));
    const form = calls[0]?.init.body as FormData;
    const meta = JSON.parse(form.get("meta") as string) as { bucket?: string };
    expect(meta.bucket).toBe("atlas-events");
  });

  it("pinBytes throws on non-2xx pin response", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 401, statusText: "Unauthorized", text: "no" },
    ]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    await expect(pinner.pinBytes(new Uint8Array([0]))).rejects.toThrow(/401/);
  });

  it("pinJson uploads canonicalized bytes and defaults filename to atlas-payload.json", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { pin: { cid: "bafkreijson" }, info: { size: 7 } } },
    ]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    const obj = { foo: 1, bar: "baz" };
    const result = await pinner.pinJson(obj);
    expect(result).toEqual({ cid: "bafkreijson", size: 7 });

    const form = calls[0]?.init.body as FormData;
    expect(await getFileBytes(form)).toEqual(canonicalize(obj));
    expect(getFileName(form)).toBe("atlas-payload.json");
    expect(form.get("name")).toBe("atlas-payload.json");
  });

  it("pinJson honours caller-supplied name", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { pin: { cid: "bafkreijson" }, info: { size: 1 } } },
    ]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    await pinner.pinJson({ a: 1 }, { name: "my-receipt.json" });
    const form = calls[0]?.init.body as FormData;
    expect(getFileName(form)).toBe("my-receipt.json");
    expect(form.get("name")).toBe("my-receipt.json");
  });

  it("pinJson canonicalization: reordered keys produce byte-identical bodies", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, json: { pin: { cid: "c1" }, info: { size: 1 } } },
      { ok: true, json: { pin: { cid: "c2" }, info: { size: 1 } } },
    ]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });

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
      { ok: true, json: { pin: { cid: "c1" }, info: { size: 1 } } },
      { ok: true, json: { pin: { cid: "c2" }, info: { size: 1 } } },
    ]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
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
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    await expect(pinner.pinJson({ a: 1 })).rejects.toThrow(/500/);
  });

  it("isPinned returns true when results contain matching pinned entry", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      {
        ok: true,
        json: {
          count: 1,
          results: [{ requestid: "req-1", status: "pinned", pin: { cid: "bafkreiabc" } }],
        },
      },
    ]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    expect(await pinner.isPinned("bafkreiabc")).toBe(true);
    expect(calls[0]?.url).toBe("https://api.filebase.io/v1/ipfs/pins?cid=bafkreiabc");
  });

  it("isPinned returns false when no matching pinned entry", async () => {
    const { fetch: fetchImpl } = makeFetch([{ ok: true, json: { count: 0, results: [] } }]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    expect(await pinner.isPinned("bafkreiabc")).toBe(false);
  });

  it("unpin looks up requestid then DELETEs", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      {
        ok: true,
        json: {
          count: 1,
          results: [{ requestid: "req-9", status: "pinned", pin: { cid: "bafkreiabc" } }],
        },
      },
      { ok: true },
    ]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    await pinner.unpin("bafkreiabc");
    expect(calls[1]?.init.method).toBe("DELETE");
    expect(calls[1]?.url).toBe("https://api.filebase.io/v1/ipfs/pins/req-9");
  });

  it("unpin throws if no matching pin request exists", async () => {
    const { fetch: fetchImpl } = makeFetch([{ ok: true, json: { count: 0, results: [] } }]);
    const pinner = new FilebasePinner({ apiToken: "t", fetch: fetchImpl });
    await expect(pinner.unpin("bafkreiabc")).rejects.toThrow(/no pin request found/);
  });
});
