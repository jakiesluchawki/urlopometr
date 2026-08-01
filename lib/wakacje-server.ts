import { Offer, Trip } from "./travel-types";
import { parseWakacjeUrl } from "./travel-client";

const MAX_HTML_BYTES = 6_000_000;
const REQUEST_TIMEOUT_MS = 14_000;

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function textOnly(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string, base: string) {
  try {
    return new URL(decodeHtml(value), base).toString();
  } catch {
    return null;
  }
}

export function assertWakacjeUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !/(^|\.)wakacje\.pl$/i.test(url.hostname)) {
    throw new Error("Obsługiwane są wyłącznie bezpieczne linki HTTPS z Wakacje.pl.");
  }
  return url;
}

export async function fetchWakacjeHtml(raw: string) {
  const url = assertWakacjeUrl(raw);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) throw new Error(`Wakacje.pl odpowiedziało kodem ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_HTML_BYTES) throw new Error("Lista ofert jest zbyt duża do bezpiecznego przetworzenia.");
    const html = await response.text();
    if (html.length > MAX_HTML_BYTES) throw new Error("Lista ofert jest zbyt duża do bezpiecznego przetworzenia.");
    return { html, finalUrl: response.url || url.toString() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Wakacje.pl nie odpowiedziało w wymaganym czasie.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonLdOffers(html: string, baseUrl: string) {
  const offers: Offer[] = [];
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const root = JSON.parse(decodeHtml(match[1]));
      const nodes = Array.isArray(root) ? root : [root];
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        const item = node as Record<string, unknown>;
        const type = String(item["@type"] ?? "");
        if (/hotel|lodgingbusiness|product/i.test(type) && typeof item.name === "string") {
          const aggregate = (item.aggregateRating ?? {}) as Record<string, unknown>;
          const address = (item.address ?? {}) as Record<string, unknown>;
          const priceSpec = (item.offers ?? {}) as Record<string, unknown>;
          const url = absoluteUrl(String(item.url ?? ""), baseUrl) ?? baseUrl;
          const id = url.match(/(?:-h|-)(\d+)(?:\.html|[/?]|$)/)?.[1] ?? `json-${offers.length}`;
          const price = Number(priceSpec.price ?? priceSpec.lowPrice ?? NaN);
          const rating = Number(aggregate.ratingValue ?? NaN);
          const image = Array.isArray(item.image) ? String(item.image[0] ?? "") : String(item.image ?? "");
          offers.push(makeOffer({
            id,
            name: item.name,
            location: String(address.addressLocality ?? address.addressRegion ?? "Turcja"),
            price: Number.isFinite(price) ? price : null,
            rating: Number.isFinite(rating) ? rating : null,
            url,
            image: absoluteUrl(image, baseUrl),
            text: "",
          }));
        }
        Object.values(item).forEach((value) => {
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === "object") walk(value);
        });
      };
      nodes.forEach(walk);
    } catch {
      // Invalid JSON-LD is common on dynamically assembled pages.
    }
  }
  return offers;
}

function makeOffer(input: { id: string; name: string; location: string; price: number | null; rating: number | null; url: string; image: string | null; text: string; aquaparkPresent?: boolean; beachPresent?: boolean; }): Offer {
  const text = input.text;
  const stars = Number(text.match(/\b([1-5])\s*(?:\*|gwiazdk)/i)?.[1] ?? NaN);
  const dates = text.match(/(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})/)?.slice(1, 3).join("–") ?? null;
  const nights = Number(text.match(/(\d+)\s*noc/i)?.[1] ?? NaN);
  const board = text.match(/\b(Ultra All Inclusive|All Inclusive|Full Board|Half Board|Śniadania)\b/i)?.[1] ?? null;
  const operator = text.match(/\b(Itaka|Rainbow|Coral Travel|Grecos|Exim Tours|Anex(?: Tour)?|Join UP!|TUI|Nekera)\b/i)?.[1] ?? null;
  const confirmed = <T>(value: T | null, sourceUrl = input.url) => ({ value, confidence: value === null ? "unknown" as const : "confirmed" as const, sourceUrl });
  return {
    id: input.id,
    name: input.name,
    location: input.location || "Turcja",
    stars: Number.isFinite(stars) ? stars : null,
    board,
    price: input.price,
    operator,
    image: input.image,
    dates,
    nights: Number.isFinite(nights) ? nights : null,
    flightOut: confirmed(null),
    flightBack: confirmed(null),
    transferMinutes: confirmed(null),
    transferKm: confirmed(null),
    ratings: {
      wakacje: confirmed(input.rating),
      google: confirmed(null),
      tripadvisor: confirmed(null),
      booking: confirmed(null),
    },
    aquapark: confirmed(null),
    aquaparkPresent: confirmed(input.aquaparkPresent ?? (/aquapark|zjeżdżal/i.test(text) ? true : null)),
    food: confirmed(null),
    beach: confirmed(input.beachPresent ?? (/przy plaży|bezpośrednio przy plaży/i.test(text) ? true : null)),
    sourceUrl: input.url,
    highlights: [
      input.rating !== null && input.rating >= 8.5 ? "wysoka ocena na Wakacje.pl" : "",
      /aquapark|zjeżdżal/i.test(text) ? "w opisie znaleziono aquapark lub zjeżdżalnie" : "",
      /przy plaży|bezpośrednio przy plaży/i.test(text) ? "położenie przy plaży" : "",
    ].filter(Boolean),
    watchouts: [],
    checkedAt: new Date().toISOString(),
  };
}

type DisplayOffer = {
  cid?: number;
  cofrname?: string;
  cofrcountry?: string;
  cofrdepdate?: string;
  cofrservice?: string;
  cofrstars?: number;
  cofrtourop?: string;
  cofrrating?: string;
  cofractualprice?: number;
};

function parseEscapedJsonProperty<T>(html: string, property: string): T | null {
  const pattern = new RegExp(`"${property}":"((?:\\\\.|[^"\\\\])*)"`);
  const match = html.match(pattern);
  if (!match) return null;
  try {
    const decoded = JSON.parse(`"${match[1]}"`);
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function extractItemListLinks(html: string, baseUrl: string) {
  const links = new Map<string, { name: string; url: string; location: string }>();
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const root = JSON.parse(decodeHtml(match[1])) as Record<string, unknown>;
      if (root["@type"] !== "ItemList" || !Array.isArray(root.itemListElement)) continue;
      for (const rawItem of root.itemListElement) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const item = rawItem as Record<string, unknown>;
        const url = absoluteUrl(String(item.url ?? ""), baseUrl);
        const name = typeof item.name === "string" ? item.name : "";
        const id = url?.match(/(?:-h|-)(\d+)(?:\.html|[/?]|$)/)?.[1];
        if (!url || !id || !name) continue;
        const segments = new URL(url).pathname.split("/").filter(Boolean);
        const locationSlug = segments.at(-2) ?? "turcja";
        const location = locationSlug.split("-").map((part) => part.charAt(0).toLocaleUpperCase("pl-PL") + part.slice(1)).join(" ");
        links.set(id, { name, url, location });
      }
    } catch {
      // Ignore unrelated or malformed JSON-LD blocks.
    }
  }
  return links;
}

function findOfferLink(html: string, id: string, baseUrl: string) {
  const escapedId = id.replace(/[^\d]/g, "");
  if (!escapedId) return null;
  const byAttribute = html.match(new RegExp(`<a[^>]+data-test-offer-id=["']${escapedId}["'][^>]+href=["']([^"']+)["']`, "i"))?.[1]
    ?? html.match(new RegExp(`<a[^>]+href=["']([^"']+)["'][^>]+data-test-offer-id=["']${escapedId}["']`, "i"))?.[1];
  return byAttribute ? absoluteUrl(byAttribute, baseUrl) : null;
}

function findOfferImage(html: string, id: string, baseUrl: string) {
  const escapedId = id.replace(/[^\d]/g, "");
  if (!escapedId) return null;
  const card = html.match(new RegExp(`<a[^>]+data-test-offer-id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"))?.[1];
  const image = card?.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1];
  return image ? absoluteUrl(image, baseUrl) : null;
}

function plDate(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
}

function extractDisplayOffers(html: string, baseUrl: string) {
  const data = parseEscapedJsonProperty<Record<string, DisplayOffer>>(html, "displayOffers");
  if (!data) return [];
  const filters = parseEscapedJsonProperty<{ attributes?: string[] }>(html, "filters");
  const links = extractItemListLinks(html, baseUrl);
  const hasAquaparkFilter = filters?.attributes?.includes("21") || /(?:^|[,?])z-aquaparkiem(?:[=,&]|$)/i.test(baseUrl);
  const hasBeachFilter = filters?.attributes?.includes("26") || /(?:^|[,?])przy-plazy(?:[=,&]|$)/i.test(baseUrl);
  const trip = parseWakacjeUrl(baseUrl);
  return Object.values(data).slice(0, 24).flatMap((item) => {
    const id = String(item.cid ?? "");
    if (!id || !item.cofrname) return [];
    const listed = links.get(id);
    const url = listed?.url ?? findOfferLink(html, id, baseUrl) ?? baseUrl;
    const rating = Number(String(item.cofrrating ?? "").replace(",", "."));
    const price = Number(item.cofractualprice);
    const stars = Number(item.cofrstars);
    const offer = makeOffer({
      id,
      name: listed?.name ?? item.cofrname,
      location: listed?.location ?? item.cofrcountry ?? "Turcja",
      price: Number.isFinite(price) ? price : null,
      rating: Number.isFinite(rating) ? rating : null,
      url,
      image: findOfferImage(html, id, baseUrl),
      text: `${item.cofrstars ?? ""} gwiazdek ${item.cofrservice ?? ""} ${item.cofrtourop ?? ""}`,
      aquaparkPresent: hasAquaparkFilter,
      beachPresent: hasBeachFilter,
    });
    offer.stars = Number.isFinite(stars) ? stars : offer.stars;
    offer.board = item.cofrservice ?? offer.board;
    offer.operator = item.cofrtourop ?? offer.operator;
    const departure = plDate(item.cofrdepdate);
    const end = trip?.dateTo ? plDate(trip.dateTo) : null;
    offer.dates = departure ? `${departure}${end ? `–${end}` : ""}` : offer.dates;
    if (hasAquaparkFilter && !offer.highlights.includes("aquapark potwierdzony filtrem listy")) offer.highlights.push("aquapark potwierdzony filtrem listy");
    if (hasBeachFilter && !offer.highlights.includes("położenie przy plaży")) offer.highlights.push("położenie przy plaży");
    return [offer];
  });
}

function extractAnchorOffers(html: string, baseUrl: string) {
  const offers: Offer[] = [];
  const anchors = html.matchAll(/<a\b([^>]*\bhref=["'][^"']*\/(?:wczasy|oferty)\/[^"']*(?:-h\d+|-\d+)(?:\.html)?[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const url = absoluteUrl(href, baseUrl);
    if (!url || !/(^|\.)wakacje\.pl$/i.test(new URL(url).hostname)) continue;
    const id = match[1].match(/data-test-offer-id=["'](\d+)["']/i)?.[1]
      ?? url.match(/(?:-h|-)(\d+)(?:\.html|[/?]|$)/)?.[1];
    if (!id || offers.some((offer) => offer.id === id)) continue;
    const body = match[2];
    const text = textOnly(body);
    if (text.length < 20) continue;
    const pathSegments = new URL(url).pathname.split("/").filter(Boolean);
    const slug = pathSegments.at(-1)?.replace(/(?:-h|-)\d+.*$/, "") ?? "hotel";
    const rawName = body.match(/<(?:h2|h3|h4)[^>]*>([\s\S]*?)<\/(?:h2|h3|h4)>/i)?.[1]
      ?? body.match(/(?:alt|title)=["']([^"']{3,100})["']/i)?.[1]
      ?? slug.replaceAll("-", " ");
    const name = textOnly(rawName).replace(/\bhotel\b\s*/i, "").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("pl-PL"));
    const priceMatch = text.match(/(?:od\s*)?([\d\s\u00a0]{4,})\s*zł/i)?.[1];
    const ratingMatch = text.match(/\b((?:10|[1-9])[,.]\d)\s*(?:\/\s*(?:5|10)|Bardzo|Dobry|Znakomity|Fantastyczny|Średni)/i)?.[1];
    const imageValue = body.match(/(?:src|data-src)=["']([^"']+\.(?:webp|jpe?g|png)[^"']*)["']/i)?.[1]
      ?? body.match(/srcset=["']\s*([^\s,"']+)/i)?.[1];
    const locationSlug = pathSegments.at(-2);
    const locationFromPath = locationSlug?.split("-").map((part) => part.charAt(0).toLocaleUpperCase("pl-PL") + part.slice(1)).join(" ");
    const location = text.match(/\b(Antalya|Alanya|Belek|Side|Lara|Kemer|Bodrum|Marmaris|Fethiye|Kuşadası|Kusadasi)\b/i)?.[1]
      ?? locationFromPath
      ?? "Turcja";
    offers.push(makeOffer({
      id,
      name,
      location,
      price: priceMatch ? Number(priceMatch.replace(/\s/g, "")) : null,
      rating: ratingMatch ? Number(ratingMatch.replace(",", ".")) : null,
      url,
      image: imageValue ? absoluteUrl(imageValue, baseUrl) : null,
      text,
    }));
    if (offers.length >= 24) break;
  }
  return offers;
}

export function parseOffers(html: string, baseUrl: string) {
  const byId = new Map<string, Offer>();
  for (const offer of [...extractDisplayOffers(html, baseUrl), ...extractAnchorOffers(html, baseUrl), ...extractJsonLdOffers(html, baseUrl)]) {
    const existing = byId.get(offer.id);
    if (!existing) byId.set(offer.id, offer);
    else {
      byId.set(offer.id, {
        ...existing,
        name: existing.name.length >= offer.name.length ? existing.name : offer.name,
        price: existing.price ?? offer.price,
        image: existing.image ?? offer.image,
        ratings: { ...existing.ratings, wakacje: existing.ratings.wakacje.value !== null ? existing.ratings.wakacje : offer.ratings.wakacje },
        aquaparkPresent: existing.aquaparkPresent?.value != null ? existing.aquaparkPresent : offer.aquaparkPresent,
        beach: existing.beach.value !== null ? existing.beach : offer.beach,
      });
    }
  }
  return [...byId.values()];
}

export async function importOffers(sourceUrl: string) {
  const fallbackTrip: Trip = parseWakacjeUrl(sourceUrl) ?? {
    destination: "Wybrany kierunek", dateFrom: "", dateTo: "", duration: "—",
    travellers: "—", maxPrice: null, departure: "—",
  };
  const { html, finalUrl } = await fetchWakacjeHtml(sourceUrl);
  const offers = parseOffers(html, finalUrl);
  if (!offers.length) {
    throw new Error("Nie znaleźliśmy ofert w odpowiedzi Wakacje.pl. Strona mogła zażądać potwierdzenia w przeglądarce — spróbuj ponownie za chwilę lub wklej bezpośrednie linki do hoteli.");
  }
  return {
    sourceUrl: finalUrl,
    checkedAt: new Date().toISOString(),
    trip: fallbackTrip,
    offers,
    warnings: [
      "Oceny zewnętrzne, dokładne godziny lotów i transfer wymagają dodatkowego sprawdzenia.",
      ...(offers.some((offer) => offer.price === null) ? ["Część ofert nie zawierała ceny w pobranym widoku."] : []),
    ],
  };
}
