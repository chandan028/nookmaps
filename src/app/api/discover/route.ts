import { buildFeed } from "@/lib/feed";
import { fetchArea, fetchNearby } from "@/lib/providers";
import { loadWeights } from "@/lib/ranking";
import { clampRadius, errorResponse, latLngFrom, num, PRIVATE_HEADERS, tzOffsetFrom } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * GET /api/discover?lat&lng&acc&radius&tzo
 * Exact coordinates in → context + ranked "What can I do here?" feed out.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const origin = latLngFrom(params);
    const accuracyM = num(params, "acc", 30);
    const radiusM = clampRadius(num(params, "radius", 2000));
    const tzo = tzOffsetFrom(params);
    const [{ places, provider }, area] = await Promise.all([
      fetchNearby({ ...origin, radiusM }),
      fetchArea(origin),
    ]);
    const feed = buildFeed({
      origin: { ...origin, accuracyM },
      places,
      area,
      nowMs: Date.now(),
      tzOffsetMinutes: tzo,
      radiusM,
      provider,
      weights: loadWeights(),
    });
    return Response.json(feed, { headers: PRIVATE_HEADERS });
  } catch (err) {
    return errorResponse(err);
  }
}
