import { DEFAULT_WEIGHTS, Offer, RankedOffer, Trip, Weights } from "./travel-types";

const polishMonths = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

const departureNames: Record<string, string> = {
  warszawy: "Warszawa", katowic: "Katowice", krakowa: "Kraków",
  poznania: "Poznań", wroclawia: "Wrocław", wrocławia: "Wrocław",
  gdanska: "Gdańsk", gdańska: "Gdańsk", lodzi: "Łódź", łodzi: "Łódź",
  rzeszowa: "Rzeszów", radomia: "Radom",
};

export function humanDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || "—";
  return `${Number(match[3])} ${polishMonths[Number(match[2]) - 1]}`;
}

export function parseWakacjeUrl(raw: string): Trip | null {
  try {
    const url = new URL(raw.trim());
    if (!/(^|\.)wakacje\.pl$/i.test(url.hostname)) return null;
    const pathParts = url.pathname.split("/").filter(Boolean);
    const destinationSlug = pathParts.at(-1)?.replace(/-h\d+.*$/, "") ?? "wybrany kierunek";
    const destination = destinationSlug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toLocaleUpperCase("pl-PL") + part.slice(1))
      .join(" ");
    const decoded = decodeURIComponent(`${url.pathname}?${url.searchParams.toString()}`);
    const tokens = decoded.split(/[/?&,]/).filter(Boolean);
    const find = (prefix: string) => tokens.find((token) => token.startsWith(prefix))?.slice(prefix.length) ?? "";
    const travellerToken = tokens.find((token) => /\d+dorosl.*\d+dzieci/i.test(token));
    const travellerMatch = travellerToken?.match(/(\d+)dorosl[^\d]*(\d+)dzieci/i);
    const adults = travellerMatch?.[1] ?? "2";
    const children = travellerMatch?.[2] ?? "0";
    const durationToken = tokens.find((token) => /\d+-dni/.test(token))?.match(/\d+/)?.[0];
    const priceToken = tokens.find((token) => /^do-\d+zl/.test(token))?.match(/\d+/)?.[0];
    const dateToToken = tokens.find((token) => /^do-\d{4}-\d{2}-\d{2}$/.test(token));
    const departureToken = tokens
      .filter((token) => /^z-[a-ząćęłńóśźż-]+$/i.test(token))
      .find((token) => !["z-aquaparkiem", "z-basenem", "z-dziecmi"].includes(token.toLowerCase()));

    return {
      destination: destination || "Wybrany kierunek",
      dateFrom: find("od-") || "",
      dateTo: dateToToken?.slice(3) ?? "",
      duration: durationToken ? `${durationToken} dni` : "—",
      travellers: `${adults} dorosłych · ${children} dzieci`,
      maxPrice: priceToken ? Number(priceToken) : null,
      departure: departureToken
        ? departureNames[departureToken.slice(2).toLowerCase()] ?? departureToken.slice(2).replaceAll("-", " ").replace(/^./, (letter) => letter.toLocaleUpperCase("pl-PL"))
        : "dowolne lotnisko",
    };
  } catch {
    return null;
  }
}

export function formatPrice(value: number | null) {
  return value === null ? "brak ceny" : `${value.toLocaleString("pl-PL")} zł`;
}

function averageKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function ratingScore(offer: Offer) {
  const normalized = [
    offer.ratings.wakacje.value,
    offer.ratings.google.value === null ? null : offer.ratings.google.value * 2,
    offer.ratings.tripadvisor.value === null ? null : offer.ratings.tripadvisor.value * 2,
    offer.ratings.booking.value,
  ];
  return averageKnown(normalized);
}

function travelScore(offer: Offer) {
  const values: number[] = [];
  if (offer.transferMinutes.value !== null) {
    values.push(Math.max(1, Math.min(10, 10 - Math.max(0, offer.transferMinutes.value - 20) / 9)));
  }
  if (offer.flightOut.value || offer.flightBack.value) {
    const text = `${offer.flightOut.value ?? ""} ${offer.flightBack.value ?? ""}`;
    let score = 7.4;
    const hours = [...text.matchAll(/\b(\d{1,2}):\d{2}\b/g)].map((match) => Number(match[1]));
    if (hours.some((hour) => hour < 6)) score -= 1.8;
    if (hours.some((hour) => hour >= 22)) score -= 1.2;
    values.push(Math.max(1, score));
  }
  return averageKnown(values);
}

export function rankOffers(offers: Offer[], weights: Weights = DEFAULT_WEIGHTS): RankedOffer[] {
  const prices = offers.map((offer) => offer.price).filter((value): value is number => value !== null);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  return offers
    .map((offer) => {
      const price = offer.price === null || minPrice === null || maxPrice === null
        ? null
        : minPrice === maxPrice ? 8 : 10 - ((offer.price - minPrice) / (maxPrice - minPrice)) * 4;
      const dimensions = {
        price,
        travel: travelScore(offer),
        ratings: ratingScore(offer),
        aquapark: offer.aquapark.value,
        food: offer.food.value,
      };
      const entries = (Object.keys(weights) as Array<keyof Weights>)
        .map((key) => ({ key, value: dimensions[key], weight: weights[key] }))
        .filter((entry) => entry.value !== null && entry.weight > 0);
      const activeWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
      const totalWeight = (Object.values(weights) as number[]).reduce((sum, value) => sum + value, 0) || 1;
      const raw = activeWeight
        ? entries.reduce((sum, entry) => sum + (entry.value as number) * entry.weight, 0) / activeWeight
        : 0;
      const coverage = activeWeight / totalWeight;
      const score = raw * (0.84 + coverage * 0.16);
      const reasons: string[] = [];
      const candidates: Array<[string, number | null]> = [
        ["korzystna cena na tle listy", dimensions.price],
        ["wygodniejsza podróż", dimensions.travel],
        ["mocne oceny gości", dimensions.ratings],
        ["dobry aquapark dla dzieci", dimensions.aquapark],
        ["dobrze oceniane jedzenie", dimensions.food],
      ];
      candidates.sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
      candidates.filter(([, value]) => value !== null && value >= 7.4).slice(0, 2).forEach(([label]) => reasons.push(label));
      if (coverage < 0.55) reasons.push("mało danych do pewnej oceny");
      return { ...offer, score, coverage, dimensions, reasons };
    })
    .sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));
}

export function sourceSearchUrl(source: "google" | "tripadvisor" | "booking", offer: Offer) {
  const query = encodeURIComponent(`${offer.name} ${offer.location}`);
  if (source === "google") return `https://www.google.com/maps/search/?api=1&query=${query}`;
  if (source === "tripadvisor") return `https://www.tripadvisor.com/Search?q=${query}`;
  return `https://www.booking.com/searchresults.pl.html?ss=${query}`;
}
