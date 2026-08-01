import { json, corsHeaders } from "../../../lib/http";
import { fetchWakacjeHtml, importOffers, parseOffers } from "../../../lib/wakacje-server";
import { parseWakacjeUrl } from "../../../lib/travel-client";
import { Offer } from "../../../lib/travel-types";

export const runtime = "edge";

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 24_000) return json(request, { error: "Żądanie jest zbyt duże." }, 413);
    const body = JSON.parse(raw) as { sourceUrl?: unknown; offerUrls?: unknown };
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    const offerUrls = Array.isArray(body.offerUrls)
      ? body.offerUrls.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 12)
      : [];

    if (sourceUrl) {
      const result = await importOffers(sourceUrl);
      return json(request, result);
    }

    if (offerUrls.length < 2) {
      return json(request, { error: "Wklej link do listy ofert albo co najmniej dwa bezpośrednie linki do hoteli." }, 400);
    }

    const settled = await Promise.allSettled(offerUrls.map(async (url) => {
      const { html, finalUrl } = await fetchWakacjeHtml(url);
      return parseOffers(html, finalUrl);
    }));
    const offersById = new Map<string, Offer>();
    settled.forEach((result) => {
      if (result.status === "fulfilled") result.value.forEach((offer) => offersById.set(offer.id, offer));
    });
    const offers = [...offersById.values()];
    if (offers.length < 2) {
      throw new Error("Nie udało się odczytać przynajmniej dwóch hoteli. Sprawdź, czy linki prowadzą bezpośrednio do ofert Wakacje.pl.");
    }
    return json(request, {
      sourceUrl: offerUrls[0],
      checkedAt: new Date().toISOString(),
      trip: parseWakacjeUrl(offerUrls[0]) ?? {
        destination: "Wybrane hotele", dateFrom: "", dateTo: "", duration: "—",
        travellers: "—", maxPrice: null, departure: "—",
      },
      offers,
      warnings: settled.some((result) => result.status === "rejected")
        ? ["Niektórych linków nie udało się pobrać."]
        : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się odczytać ofert.";
    return json(request, { error: message }, 422);
  }
}

