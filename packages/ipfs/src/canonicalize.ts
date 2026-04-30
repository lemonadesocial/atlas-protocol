/**
 * Deterministic JSON serialization for ATLAS payloads.
 *
 * The serialization rules are intentionally narrower than RFC 8785 (JCS) to keep
 * the implementation small and predictable. The output is a UTF-8 byte sequence
 * that is byte-identical for any two logically equivalent inputs, regardless of
 * key insertion order.
 *
 * Rules:
 *  - Object keys are sorted lexicographically (UTF-16 code-unit order — the
 *    default of `Array.prototype.sort()` on strings).
 *  - `null`, `boolean`, `string`, finite `number`, arrays and plain objects are
 *    serialized.
 *  - `-0` is normalized to `0`.
 *  - `NaN`, `Infinity`, `-Infinity`, `BigInt`, `Symbol`, `function`, `Map`, `Set`
 *    throw a `TypeError`.
 *  - `Date` instances are serialized as ISO-8601 UTC strings.
 *  - `undefined` values inside an object cause the field to be omitted (JCS-style).
 *  - `undefined` values inside an array throw a `TypeError`.
 *  - Cycles throw a `TypeError`.
 *  - No whitespace, no formatting, no trailing newline, no BOM.
 */

const TEXT_ENCODER = new TextEncoder();

export function canonicalize(value: unknown): Uint8Array {
  const seen = new WeakSet<object>();
  const json = stringify(value, seen, true);
  if (json === undefined) {
    throw new TypeError("canonicalize: top-level value is not serializable");
  }
  return TEXT_ENCODER.encode(json);
}

function stringify(value: unknown, seen: WeakSet<object>, topLevel: boolean): string | undefined {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";

  if (t === "string") return JSON.stringify(value);

  if (t === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new TypeError(`canonicalize: non-finite number (${String(n)}) is not serializable`);
    }
    // Normalize -0 -> 0
    if (Object.is(n, -0)) return "0";
    return JSON.stringify(n);
  }

  if (t === "bigint") {
    throw new TypeError("canonicalize: BigInt is not serializable");
  }

  if (t === "symbol" || t === "function") {
    if (topLevel) {
      throw new TypeError(`canonicalize: ${t} is not serializable`);
    }
    return undefined;
  }

  if (t === "undefined") {
    if (topLevel) {
      throw new TypeError("canonicalize: undefined is not serializable at the top level");
    }
    return undefined;
  }

  // object branch
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (value instanceof Map || value instanceof Set) {
    throw new TypeError("canonicalize: Map and Set are not serializable");
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("canonicalize: cyclic structure is not serializable");
    }
    seen.add(value);
    try {
      const parts: string[] = [];
      for (const item of value) {
        if (item === undefined) {
          throw new TypeError("canonicalize: undefined inside an array is not serializable");
        }
        const piece = stringify(item, seen, false);
        if (piece === undefined) {
          // symbol / function inside array -> reject
          throw new TypeError("canonicalize: non-serializable value inside an array");
        }
        parts.push(piece);
      }
      return `[${parts.join(",")}]`;
    } finally {
      seen.delete(value);
    }
  }

  // Plain object
  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) {
    throw new TypeError("canonicalize: cyclic structure is not serializable");
  }
  seen.add(obj);
  try {
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (v === undefined) continue; // omit undefined fields
      const piece = stringify(v, seen, false);
      if (piece === undefined) continue; // omit symbol/function fields
      parts.push(`${JSON.stringify(key)}:${piece}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}
