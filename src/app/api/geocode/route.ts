import { geocode } from "@/lib/providers";
import { errorResponse, BadRequest, PRIVATE_HEADERS } from "@/lib/request";

export const dynamic = "force-dynamic";

/** GET /api/geocode?q=… — manual location fallback when GPS is denied (PRD §21). */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2 || q.length > 200) throw new BadRequest("Enter a place or address");
    const results = await geocode(q);
    return Response.json({ results }, { headers: PRIVATE_HEADERS });
  } catch (err) {
    return errorResponse(err);
  }
}
