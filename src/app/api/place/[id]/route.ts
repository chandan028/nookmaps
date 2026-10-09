import { whatNext } from "@/lib/feed";
import { fetchDetails, fetchNearby } from "@/lib/providers";
import { loadWeights } from "@/lib/ranking";
import { errorResponse, PRIVATE_HEADERS, tzOffsetFrom } from "@/lib/request";

export const dynamic = "force-dynamic";

/** GET /api/place/:id?tzo — details plus the contextual "What next?" sections. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const search = new URL(req.url).searchParams;
    const place = await fetchDetails(decodeURIComponent(id));
    if (!place) return Response.json({ error: "Place not found" }, { status: 404 });
    const { places } = await fetchNearby({ lat: place.lat, lng: place.lng, radiusM: 2000 });
    const next = whatNext(place, places, Date.now(), tzOffsetFrom(search), loadWeights());
    return Response.json(
      { place, openNow: next.current.openNow, whatNext: next.sections },
      { headers: PRIVATE_HEADERS },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
