import { describe, expect, it } from "vitest";

import { KuboPinner } from "../../pinners/kubo.js";

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

describe("KuboPinner", () => {
  it("uses default apiUrl http://localhost:5001 and pin=true", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      {
        ok: true,
        text:
          '{"Name":"x","Hash":"bafkreiabc","Size":"42"}\n' +
          '{"Name":"x","Hash":"bafkreiroot","Size":"50"}\n',
      },
    ]);
    const pinner = new KuboPinner({ fetch: fetchImpl });
    const result = await pinner.pin(new Uint8Array([1, 2, 3]));
    expect(result.cid).toBe("bafkreiroot");
    expect(result.size).toBe(50);
    const url = calls[0]?.url ?? "";
    expect(url.startsWith("http://localhost:5001/api/v0/add")).toBe(true);
    expect(url).toContain("pin=true");
  });

  it("pin honours custom apiUrl", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { ok: true, text: '{"Name":"x","Hash":"bafkreiabc","Size":"42"}\n' },
    ]);
    const pinner = new KuboPinner({
      apiUrl: "http://kubo.example:5001/",
      fetch: fetchImpl,
    });
    await pinner.pin(new Uint8Array([1]));
    expect(calls[0]?.url.startsWith("http://kubo.example:5001/api/v0/add")).toBe(true);
  });

  it("pin throws on empty response", async () => {
    const { fetch: fetchImpl } = makeFetch([{ ok: true, text: "" }]);
    const pinner = new KuboPinner({ fetch: fetchImpl });
    await expect(pinner.pin(new Uint8Array([0]))).rejects.toThrow(/empty response/);
  });

  it("pin throws on non-2xx", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 500, statusText: "Server Error", text: "boom" },
    ]);
    const pinner = new KuboPinner({ fetch: fetchImpl });
    await expect(pinner.pin(new Uint8Array([0]))).rejects.toThrow(/500/);
  });

  it("unpin POSTs /api/v0/pin/rm", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([{ ok: true }]);
    const pinner = new KuboPinner({ fetch: fetchImpl });
    await pinner.unpin("bafkreiabc");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toBe("http://localhost:5001/api/v0/pin/rm?arg=bafkreiabc");
  });

  it("isPinned returns true on 200 with Keys, false on 500/404", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: true, json: { Keys: { bafkreiabc: { Type: "recursive" } } } },
      { ok: false, status: 500, statusText: "Internal", text: "not pinned" },
      { ok: false, status: 404, statusText: "Not Found" },
    ]);
    const pinner = new KuboPinner({ fetch: fetchImpl });
    expect(await pinner.isPinned("bafkreiabc")).toBe(true);
    expect(await pinner.isPinned("bafkreiabc")).toBe(false);
    expect(await pinner.isPinned("bafkreiabc")).toBe(false);
  });

  it("isPinned throws on other non-ok statuses", async () => {
    const { fetch: fetchImpl } = makeFetch([
      { ok: false, status: 401, statusText: "Unauthorized", text: "no" },
    ]);
    const pinner = new KuboPinner({ fetch: fetchImpl });
    await expect(pinner.isPinned("bafkreiabc")).rejects.toThrow(/401/);
  });
});
