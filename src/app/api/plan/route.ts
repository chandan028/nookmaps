import { detectContext } from "@/lib/context";
import { buildPlan, parsePlanRequest, type PlanResponse } from "@/lib/planner";
import { fetchNearby } from "@/lib/providers";
import { loadWeights } from "@/lib/ranking";
import { BadRequest, errorResponse, PRIVATE_HEADERS } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * POST /api/plan  { lat, lng, acc?, minutes, radius?, seed?, tzo }
 * "I have N minutes": a walkable sequence of real, open places (PRD §19).
 */
export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => {
      throw new BadRequest("Expected a JSON body");
    });
    const input = parsePlanRequest(body);
    const origin = { lat: input.lat, lng: input.lng };
    const { places, provider } = await fetchNearby({ ...origin, radiusM: input.radiusM });
    // Don't send people to the venue they're already standing in.
    const context = detectContext({ ...origin, accuracyM: input.accuracyM }, places);
    const plan = buildPlan({
      origin,
      places,
      nowMs: Date.now(),
      tzOffsetMinutes: input.tzOffsetMinutes,
      budgetMinutes: input.minutes,
      context: context.type,
      weights: loadWeights(),
      exclude: context.currentPlace ? [context.currentPlace.id] : [],
      seed: input.seed,
    });
    const res: PlanResponse = {
      plan,
      minutes: input.minutes,
      seed: input.seed,
      radiusM: input.radiusM,
      provider,
      contextType: context.type,
      startingFrom: context.currentPlace?.name ?? null,
    };
    return Response.json(res, { headers: PRIVATE_HEADERS });
  } catch (err) {
    return errorResponse(err);
  }
}
