/**
 * Back-compat re-export. The protocol type definitions previously lived in
 * this directory; they now live in `@atlasprotocol/types` so server-sdk and
 * ipfs can share them without forming a workspace dependency cycle. Existing
 * imports against `@atlasprotocol/server-sdk` (or relative `./types/index.js`)
 * continue to resolve unchanged.
 */
export * from "@atlasprotocol/types";
