export const dynamic = "force-dynamic";

/**
 * GET /api/photo?name=places/…/photos/…&w=800
 * Proxies Google Place photos so the API key stays server-side.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const name = params.get("name") ?? "";
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
    return new Response("Not found", { status: 404 });
  }
  const width = Math.max(100, Math.min(1600, Number(params.get("w")) || 800));
  const res = await fetch(
    `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&key=${key}`,
    { redirect: "follow" },
  );
  if (!res.ok || !res.body) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
