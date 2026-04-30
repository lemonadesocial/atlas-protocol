import { generateManifest } from "@atlasprotocol/server-sdk";

import { getAtlasConfig } from "../../../../lib/atlas-config";

export const dynamic = "force-static";

export function GET(): Response {
  const manifest = generateManifest(getAtlasConfig());

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
