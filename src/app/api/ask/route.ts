import { answerAsk, parseAskRequest } from "@/lib/ask";
import { fetchNearby } from "@/lib/providers";
import { loadWeights } from "@/lib/ranking";
import { BadRequest, errorResponse, PRIVATE_HEADERS } from "@/lib/request";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

/**
 * POST /api/ask  { lat, lng, acc?, query, radius?, tzo }
 * Natural-language discovery (PRD §20): the query is parsed into constraints
 * by deterministic rules, then applied to the same ranked nearby places the
 * feed uses. The query text is never logged or stored.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) throw new BadRequest("Request is too large");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new BadRequest("Send a JSON body");
    }
    const ask = parseAskRequest(body);
    const { places, provider } = await fetchNearby({
      lat: ask.origin.lat,
      lng: ask.origin.lng,
      radiusM: ask.radiusM,
    });
    const response = answerAsk({ ...ask, places, provider, nowMs: Date.now(), weights: loadWeights() });
    return Response.json(response, { headers: PRIVATE_HEADERS });
  } catch (err) {
    return errorResponse(err);
  }
}
