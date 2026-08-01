export type Confidence = "confirmed" | "estimated" | "unknown";

export type EvidenceValue<T> = {
  value: T | null;
  confidence: Confidence;
  sourceUrl?: string;
  note?: string;
};

export type RatingKey = "wakacje" | "google" | "tripadvisor" | "booking";

export type Offer = {
  id: string;
  name: string;
  location: string;
  stars: number | null;
  board: string | null;
  price: number | null;
  operator: string | null;
  image: string | null;
  dates: string | null;
  nights: number | null;
  flightOut: EvidenceValue<string>;
  flightBack: EvidenceValue<string>;
  transferMinutes: EvidenceValue<number>;
  transferKm: EvidenceValue<number>;
  ratings: Record<RatingKey, EvidenceValue<number>>;
  aquapark: EvidenceValue<number>;
  aquaparkPresent: EvidenceValue<boolean>;
  food: EvidenceValue<number>;
  beach: EvidenceValue<boolean>;
  sourceUrl: string;
  highlights: string[];
  watchouts: string[];
  checkedAt: string;
};

export type Trip = {
  destination: string;
  dateFrom: string;
  dateTo: string;
  duration: string;
  travellers: string;
  maxPrice: number | null;
  departure: string;
};

export type ImportResponse = {
  sourceUrl: string;
  checkedAt: string;
  trip: Trip;
  offers: Offer[];
  warnings: string[];
};

export type Weights = {
  price: number;
  travel: number;
  ratings: number;
  aquapark: number;
  food: number;
};

export type DimensionScores = {
  price: number | null;
  travel: number | null;
  ratings: number | null;
  aquapark: number | null;
  food: number | null;
};

export type RankedOffer = Offer & {
  score: number;
  coverage: number;
  dimensions: DimensionScores;
  reasons: string[];
};

export const DEFAULT_WEIGHTS: Weights = {
  price: 20,
  travel: 20,
  ratings: 25,
  aquapark: 20,
  food: 15,
};
