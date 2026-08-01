"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_WEIGHTS,
  ImportResponse,
  Offer,
  RankedOffer,
  Trip,
  Weights,
} from "../lib/travel-types";
import {
  formatPrice,
  humanDate,
  parseWakacjeUrl,
  rankOffers,
  sourceSearchUrl,
} from "../lib/travel-client";

declare global {
  interface Window { __URLOPOMETR_API__?: string }
}

type Mode = "list" | "manual";
type ResearchState = "checking" | "available" | "unavailable" | "running";
type HistoryItem = { id: string; savedAt: string; report: ImportResponse };

const WEIGHT_META: Array<{ key: keyof Weights; label: string; hint: string }> = [
  { key: "price", label: "Cena", hint: "niższa cena w tej samej liście" },
  { key: "travel", label: "Wygoda podróży", hint: "loty i długość transferu" },
  { key: "ratings", label: "Opinie gości", hint: "oceny z wielu serwisów" },
  { key: "aquapark", label: "Aquapark", hint: "zjeżdżalnie i strefy dziecięce" },
  { key: "food", label: "Jedzenie", hint: "wybór, smak i kolejki" },
];

const LOADING_STEPS = ["Pobieramy listę", "Rozpoznajemy hotele", "Budujemy ranking"];

function apiUrl(path: string) {
  if (typeof window === "undefined") return path;
  const base = window.__URLOPOMETR_API__?.replace(/\/$/, "") ?? "";
  return `${base}${path}`;
}

function Icon({ name, size = 20 }: { name: "link" | "spark" | "check" | "alert" | "sliders" | "compare" | "arrow" | "clock" | "database" | "close" | "history"; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    link: <><path d="M10.5 13.5l3-3"/><path d="M7 16.5H5.5a4 4 0 010-8H9"/><path d="M15 7.5h1.5a4 4 0 010 8H13"/></>,
    spark: <><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z"/><path d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15z"/></>,
    check: <path d="M4 12.5l5 5L20 6.5"/>,
    alert: <><path d="M12 3L2.8 19h18.4L12 3z"/><path d="M12 9v4"/><path d="M12 16.5h.01"/></>,
    sliders: <><path d="M4 6h6"/><path d="M14 6h6"/><circle cx="12" cy="6" r="2"/><path d="M4 18h3"/><path d="M11 18h9"/><circle cx="9" cy="18" r="2"/><path d="M4 12h10"/><path d="M18 12h2"/><circle cx="16" cy="12" r="2"/></>,
    compare: <><rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/></>,
    arrow: <><path d="M5 12h14"/><path d="M14 7l5 5-5 5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    close: <><path d="M6 6l12 12"/><path d="M18 6L6 18"/></>,
    history: <><path d="M4 4v5h5"/><path d="M5.8 16a8 8 0 10.4-8.5L4 9"/><path d="M12 8v5l3 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ConfidenceDot({ confidence }: { confidence: "confirmed" | "estimated" | "unknown" }) {
  const label = confidence === "confirmed" ? "potwierdzone" : confidence === "estimated" ? "oszacowane" : "brak danych";
  return <span className={`confidence ${confidence}`}><i />{label}</span>;
}

function Value({ value, suffix = "", confidence = "unknown" }: { value: string | number | null; suffix?: string; confidence?: "confirmed" | "estimated" | "unknown" }) {
  return (
    <div className={`data-value ${value === null ? "missing" : ""}`}>
      <strong>{value === null ? "—" : `${value}${suffix}`}</strong>
      <ConfidenceDot confidence={value === null ? "unknown" : confidence} />
    </div>
  );
}

function ScoreRing({ score, coverage }: { score: number; coverage: number }) {
  const dash = Math.max(0, Math.min(100, score * 10));
  return (
    <div className="score-ring" style={{ "--score": dash } as React.CSSProperties}>
      <span><strong>{score.toFixed(1)}</strong><small>/10</small></span>
      <em>{Math.round(coverage * 100)}% danych</em>
    </div>
  );
}

function DimensionBars({ offer }: { offer: RankedOffer }) {
  const rows: Array<[string, number | null]> = [
    ["Cena", offer.dimensions.price],
    ["Podróż", offer.dimensions.travel],
    ["Opinie", offer.dimensions.ratings],
    ["Aquapark", offer.dimensions.aquapark],
    ["Jedzenie", offer.dimensions.food],
  ];
  return (
    <div className="dimension-bars">
      {rows.map(([label, value]) => (
        <div key={label} className={value === null ? "missing" : ""}>
          <span>{label}</span><i><b style={{ width: `${(value ?? 0) * 10}%` }} /></i><strong>{value === null ? "—" : value.toFixed(1)}</strong>
        </div>
      ))}
    </div>
  );
}

function OfferCard({ offer, rank, selected, onSelect }: { offer: RankedOffer; rank: number; selected: boolean; onSelect: () => void }) {
  const [details, setDetails] = useState(rank === 1);
  const ratingEntries = [
    ["Wakacje", offer.ratings.wakacje, offer.sourceUrl],
    ["Google", offer.ratings.google, sourceSearchUrl("google", offer)],
    ["Tripadvisor", offer.ratings.tripadvisor, sourceSearchUrl("tripadvisor", offer)],
    ["Booking", offer.ratings.booking, sourceSearchUrl("booking", offer)],
  ] as const;
  return (
    <article className={`offer-card ${rank === 1 ? "winner" : ""}`}>
      <div className="offer-rank"><span>{rank}</span>{rank === 1 && <small>najlepsze dopasowanie</small>}</div>
      <div className="offer-summary">
        <div className={`offer-image ${offer.image ? "has-image" : ""}`} style={offer.image ? { backgroundImage: `url("${offer.image}")` } : undefined}>
          {!offer.image && <span>U</span>}
          <button className={selected ? "selected" : ""} type="button" onClick={onSelect} aria-pressed={selected}>
            <Icon name={selected ? "check" : "compare"} size={16}/>{selected ? "Wybrane" : "Porównaj"}
          </button>
        </div>
        <div className="offer-title">
          <div className="offer-kicker"><span>{offer.location}</span>{offer.stars && <span>{"★".repeat(offer.stars)}</span>}</div>
          <h3>{offer.name}</h3>
          <p>{[offer.board, offer.operator, offer.dates].filter(Boolean).join(" · ") || "Szczegóły w ofercie"}</p>
          <div className="reason-tags">
            {offer.reasons.map((reason) => <span key={reason}>{reason}</span>)}
          </div>
        </div>
        <div className="offer-price">
          <span>Cena całkowita</span>
          <strong>{formatPrice(offer.price)}</strong>
          <small>{offer.nights ? `${offer.nights} nocy` : "sprawdź zakres ceny w źródle"}</small>
          <a href={offer.sourceUrl} target="_blank" rel="noreferrer">Otwórz ofertę <Icon name="arrow" size={15}/></a>
        </div>
        <ScoreRing score={offer.score} coverage={offer.coverage}/>
      </div>

      <div className="offer-facts">
        <div className="travel-facts">
          <div><span>Lot tam</span><Value value={offer.flightOut.value} confidence={offer.flightOut.confidence}/></div>
          <div><span>Lot z powrotem</span><Value value={offer.flightBack.value} confidence={offer.flightBack.confidence}/></div>
          <div><span>Transfer</span><Value value={offer.transferMinutes.value} suffix=" min" confidence={offer.transferMinutes.confidence}/></div>
        </div>
        <div className="ratings-grid">
          {ratingEntries.map(([label, rating, link]) => (
            <a key={label} href={link} target="_blank" rel="noreferrer">
              <span>{label}</span>
              <Value value={rating.value} suffix={label === "Google" || label === "Tripadvisor" ? "/5" : "/10"} confidence={rating.confidence}/>
            </a>
          ))}
        </div>
        <DimensionBars offer={offer}/>
      </div>

      <button className="details-toggle" type="button" onClick={() => setDetails((value) => !value)} aria-expanded={details}>
        {details ? "Zwiń uzasadnienie" : "Pokaż uzasadnienie i braki"}<span>{details ? "−" : "+"}</span>
      </button>
      {details && (
        <div className="offer-details">
          <div>
            <h4><Icon name="check" size={17}/> Co przemawia za</h4>
            {offer.highlights.length ? <ul>{offer.highlights.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Na razie za mało potwierdzonych informacji.</p>}
          </div>
          <div>
            <h4><Icon name="alert" size={17}/> Ryzyka i braki</h4>
            <ul>
              {offer.watchouts.map((item) => <li key={item}>{item}</li>)}
              {offer.coverage < .8 && <li>Ranking nie obejmuje jeszcze wszystkich ważnych kryteriów.</li>}
              {offer.price === null && <li>Brak ceny możliwej do odczytania automatycznie.</li>}
            </ul>
          </div>
          <div className="evidence-legend">
            <h4>Jakość danych</h4>
            <ConfidenceDot confidence="confirmed"/><span>bezpośrednio ze źródła</span>
            <ConfidenceDot confidence="estimated"/><span>research, wymaga kontroli</span>
            <ConfidenceDot confidence="unknown"/><span>nie wpływa na wynik</span>
          </div>
        </div>
      )}
    </article>
  );
}

function CompareModal({ offers, onClose, onRemove }: { offers: RankedOffer[]; onClose: () => void; onRemove: (id: string) => void }) {
  const rows: Array<{ label: string; render: (offer: RankedOffer) => React.ReactNode }> = [
    { label: "Wynik", render: (offer) => <strong>{offer.score.toFixed(1)}/10</strong> },
    { label: "Cena", render: (offer) => formatPrice(offer.price) },
    { label: "Pokrycie danych", render: (offer) => `${Math.round(offer.coverage * 100)}%` },
    { label: "Wakacje.pl", render: (offer) => offer.ratings.wakacje.value ?? "—" },
    { label: "Google", render: (offer) => offer.ratings.google.value ?? "—" },
    { label: "Tripadvisor", render: (offer) => offer.ratings.tripadvisor.value ?? "—" },
    { label: "Booking", render: (offer) => offer.ratings.booking.value ?? "—" },
    { label: "Transfer", render: (offer) => offer.transferMinutes.value === null ? "—" : `${offer.transferMinutes.value} min` },
    { label: "Aquapark", render: (offer) => offer.aquapark.value?.toFixed(1) ?? "—" },
    { label: "Jedzenie", render: (offer) => offer.food.value?.toFixed(1) ?? "—" },
  ];
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title">
        <div className="modal-head"><div><span className="section-label">Krótka lista</span><h2 id="compare-title">Porównanie obok siebie</h2></div><button type="button" onClick={onClose} aria-label="Zamknij"><Icon name="close"/></button></div>
        <div className="compare-scroll">
          <table>
            <thead><tr><th>Parametr</th>{offers.map((offer) => <th key={offer.id}><span>{offer.name}</span><button type="button" onClick={() => onRemove(offer.id)}>usuń</button></th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row.label}><th>{row.label}</th>{offers.map((offer) => <td key={offer.id}>{row.render(offer)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="modal-note">„—” oznacza, że dana wartość nie była dostępna i nie została użyta do wyniku.</p>
      </section>
    </div>
  );
}

function TripSummary({ trip, count, checkedAt }: { trip: Trip; count: number; checkedAt: string }) {
  return (
    <div className="trip-summary">
      <div><span>Kierunek</span><strong>{trip.destination}</strong></div>
      <div><span>Termin</span><strong>{trip.dateFrom ? `${humanDate(trip.dateFrom)} – ${humanDate(trip.dateTo)}` : "według ofert"}</strong></div>
      <div><span>Podróżni</span><strong>{trip.travellers}</strong></div>
      <div><span>Wylot</span><strong>{trip.departure}</strong></div>
      <div><span>Budżet</span><strong>{trip.maxPrice ? `do ${formatPrice(trip.maxPrice)}` : "bez limitu"}</strong></div>
      <div><span>Znaleziono</span><strong>{count} ofert</strong><small>pobrano {new Date(checkedAt).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</small></div>
    </div>
  );
}

export default function UrlopometrApp() {
  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [manual, setManual] = useState("");
  const [report, setReport] = useState<ImportResponse | null>(null);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [research, setResearch] = useState<ResearchState>("checking");
  const [filters, setFilters] = useState({ withinBudget: true, beach: false, aquapark: false });
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem("urlopometr-v2-history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    fetch(apiUrl("/api/research"))
      .then((response) => response.json())
      .then((body) => setResearch(body.available ? "available" : "unavailable"))
      .catch(() => setResearch("unavailable"));
  }, []);

  const parsedPreview = useMemo(() => parseWakacjeUrl(query), [query]);
  const ranked = useMemo(() => {
    if (!report) return [];
    return rankOffers(report.offers, weights).filter((offer) => {
      if (filters.withinBudget && report.trip.maxPrice && offer.price && offer.price > report.trip.maxPrice) return false;
      if (filters.beach && offer.beach.value !== true) return false;
      if (filters.aquapark && offer.aquaparkPresent?.value !== true) return false;
      return true;
    });
  }, [report, weights, filters]);
  const selectedOffers = ranked.filter((offer) => selected.includes(offer.id));

  function persistReport(nextReport: ImportResponse) {
    const item: HistoryItem = { id: `${nextReport.sourceUrl}-${nextReport.checkedAt}`, savedAt: new Date().toISOString(), report: nextReport };
    const next = [item, ...history.filter((entry) => entry.report.sourceUrl !== nextReport.sourceUrl)].slice(0, 4);
    setHistory(next);
    try { window.localStorage.setItem("urlopometr-v2-history", JSON.stringify(next)); } catch { /* private mode */ }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const sourceUrl = query.trim();
    const offerUrls = manual.split(/\s+/).map((value) => value.trim()).filter(Boolean);
    if (mode === "list" && !parseWakacjeUrl(sourceUrl)) {
      setError("Wklej pełny link HTTPS do wyszukiwania na Wakacje.pl.");
      return;
    }
    if (mode === "manual" && offerUrls.length < 2) {
      setError("Wklej co najmniej dwa bezpośrednie linki do ofert — każdy w osobnej linii.");
      return;
    }
    setLoading(true);
    setLoadingStep(0);
    setSelected([]);
    const timers = [window.setTimeout(() => setLoadingStep(1), 700), window.setTimeout(() => setLoadingStep(2), 1500)];
    try {
      const response = await fetch(apiUrl("/api/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "list" ? { sourceUrl } : { offerUrls }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Nie udało się pobrać ofert.");
      setReport(body as ImportResponse);
      persistReport(body as ImportResponse);
      window.setTimeout(() => document.getElementById("ranking")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się pobrać ofert.");
    } finally {
      timers.forEach(window.clearTimeout);
      setLoading(false);
    }
  }

  async function runResearch() {
    if (!report || research !== "available") return;
    setResearch("running");
    setError("");
    try {
      const response = await fetch(apiUrl("/api/research"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offers: report.offers.slice(0, 8), trip: report.trip }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Research nie powiódł się.");
      const next = { ...report, offers: body.offers as Offer[], checkedAt: body.researchedAt as string };
      setReport(next);
      persistReport(next);
      setResearch("available");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Research nie powiódł się.");
      setResearch("available");
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 4 ? [...current, id] : current);
  }

  function exportReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `urlopometr-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <main id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Urlopometr — strona główna"><span className="brand-mark">U</span><span><strong>Urlopometr</strong><small>decyzja oparta na danych</small></span></a>
        <nav>
          <a href="#method">Metodologia</a>
          <button type="button" onClick={() => setHistoryOpen((value) => !value)}><Icon name="history" size={18}/> Historia <span className="nav-count">{history.length}</span></button>
        </nav>
      </header>

      {historyOpen && (
        <aside className="history-drawer">
          <div className="drawer-head"><div><span className="section-label">Na tym urządzeniu</span><h2>Poprzednie analizy</h2></div><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Zamknij"><Icon name="close"/></button></div>
          {history.length === 0 ? <div className="empty-history"><Icon name="database"/><p>Po pierwszej analizie wrócisz tutaj do zapisanych wyników.</p></div> : history.map((item) => (
            <button className="history-item" type="button" key={item.id} onClick={() => { setReport(item.report); setHistoryOpen(false); }}>
              <span><strong>{item.report.trip.destination}</strong><small>{item.report.offers.length} ofert · {new Date(item.savedAt).toLocaleDateString("pl-PL")}</small></span><Icon name="arrow" size={18}/>
            </button>
          ))}
        </aside>
      )}

      <section className="decision-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="section-label">Rodzinny wybór bez zgadywania</span>
            <h1>Nie szukamy najładniejszego hotelu. Szukamy <em>właściwej oferty.</em></h1>
            <p>Wklej wyniki z Wakacje.pl. Urlopometr oddzieli fakty od braków, przeliczy Wasze priorytety i pokaże, za co naprawdę warto dopłacić.</p>
            <div className="trust-row"><span><Icon name="check" size={16}/> bez zmyślonych ocen</span><span><Icon name="sliders" size={16}/> własne wagi</span><span><Icon name="compare" size={16}/> porównanie 2–4 ofert</span></div>
          </div>
          <div className="hero-scorecard" aria-hidden="true">
            <span className="float-label one">krótki transfer</span><span className="float-label two">dobry aquapark</span><span className="float-label three">brak godzin lotu</span>
            <div className="mini-card back"><i/><i/><i/></div>
            <div className="mini-card front"><div className="mini-rank">1</div><div><b>Najlepszy balans</b><span>8,7 / 10</span></div><strong>27 840 zł</strong></div>
          </div>
        </div>

        <form className="import-panel" onSubmit={submit}>
          <div className="mode-tabs" role="tablist" aria-label="Sposób dodania ofert">
            <button type="button" role="tab" aria-selected={mode === "list"} className={mode === "list" ? "active" : ""} onClick={() => { setMode("list"); setError(""); }}>Lista z Wakacje.pl</button>
            <button type="button" role="tab" aria-selected={mode === "manual"} className={mode === "manual" ? "active" : ""} onClick={() => { setMode("manual"); setError(""); }}>Pojedyncze oferty</button>
          </div>
          {mode === "list" ? (
            <div className="url-field">
              <Icon name="link"/>
              <label htmlFor="source-url">Link do wyników Wakacje.pl</label>
              <input id="source-url" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="https://www.wakacje.pl/wczasy/turcja/…" inputMode="url" aria-invalid={Boolean(error)}/>
              <button type="submit" disabled={loading}>{loading ? "Analizujemy…" : <><span>Przeanalizuj oferty</span><Icon name="arrow"/></>}</button>
            </div>
          ) : (
            <div className="manual-field">
              <label htmlFor="manual-urls">Wklej 2–12 linków do konkretnych hoteli, każdy w osobnej linii</label>
              <textarea id="manual-urls" value={manual} onChange={(event) => setManual(event.target.value)} placeholder={"https://www.wakacje.pl/wczasy/hotel-pierwszy-h123…\nhttps://www.wakacje.pl/wczasy/hotel-drugi-h456…"}/>
              <button type="submit" disabled={loading}>Zbuduj porównanie <Icon name="arrow"/></button>
            </div>
          )}
          {parsedPreview && mode === "list" && <div className="parsed-line"><span><Icon name="check" size={15}/> Link rozpoznany</span><b>{parsedPreview.destination}</b><span>{parsedPreview.dateFrom ? `${humanDate(parsedPreview.dateFrom)}–${humanDate(parsedPreview.dateTo)}` : "termin z listy"}</span><span>{parsedPreview.travellers}</span><span>{parsedPreview.maxPrice ? `do ${formatPrice(parsedPreview.maxPrice)}` : "bez limitu"}</span></div>}
          {error && <div className="error-box" role="alert"><Icon name="alert"/><div><strong>Nie udało się dokończyć analizy</strong><p>{error}</p></div></div>}
          {loading && <div className="loading-pipeline" aria-live="polite">{LOADING_STEPS.map((step, index) => <div key={step} className={index < loadingStep ? "done" : index === loadingStep ? "active" : ""}><i>{index < loadingStep ? <Icon name="check" size={13}/> : index + 1}</i><span>{step}</span></div>)}</div>}
        </form>
      </section>

      {!report && !loading && (
        <section className="empty-state">
          <div><span className="section-label">Co dostaniesz</span><h2>Jedna lista. Pięć pytań.<br/>Jedna sensowna decyzja.</h2></div>
          <div className="empty-steps">
            <article><b>01</b><h3>Czy lot nie zabiera urlopu?</h3><p>Porównujemy pory wylotu i powrotu, nie tylko liczbę noclegów.</p></article>
            <article><b>02</b><h3>Ile trwa droga do hotelu?</h3><p>Transfer staje się osobnym kryterium, a brak danych pozostaje widoczny.</p></article>
            <article><b>03</b><h3>Czy dzieci będą miały co robić?</h3><p>Aquapark oceniamy oddzielnie od ogólnych gwiazdek hotelu.</p></article>
            <article><b>04</b><h3>Co powtarza się w opiniach?</h3><p>Google, Tripadvisor i Booking są pokazane osobno, ze źródłem.</p></article>
          </div>
        </section>
      )}

      {report && (
        <section className="workspace" id="ranking">
          <div className="workspace-head">
            <div><span className="section-label">Analiza gotowa</span><h2>Ranking ofert</h2><p>Wynik reaguje na suwaki. Brak danych nie jest liczony jako zero.</p></div>
            <div className="workspace-actions">
              {research === "available" && <button className="research-button" type="button" onClick={runResearch}><Icon name="spark" size={18}/> Sprawdź brakujące dane</button>}
              {research === "running" && <button className="research-button" type="button" disabled><span className="spinner"/> Research w toku…</button>}
              <button className="ghost-button" type="button" onClick={exportReport}>Pobierz raport</button>
            </div>
          </div>
          <TripSummary trip={report.trip} count={report.offers.length} checkedAt={report.checkedAt}/>
          {report.warnings.length > 0 && <div className="warnings"><Icon name="alert" size={18}/><div>{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}

          <div className="ranking-layout">
            <aside className="priority-panel">
              <div className="priority-head"><Icon name="sliders"/><div><span className="section-label">Wasze priorytety</span><h3>Co jest ważne?</h3></div></div>
              <p>Wagi są względne. Przesuń suwaki, a ranking przeliczy się od razu.</p>
              <div className="weight-list">
                {WEIGHT_META.map((item) => (
                  <label key={item.key}>
                    <span><b>{item.label}</b><em>{weights[item.key]}</em></span>
                    <input type="range" min="0" max="40" step="5" value={weights[item.key]} onChange={(event) => setWeights((current) => ({ ...current, [item.key]: Number(event.target.value) }))}/>
                    <small>{item.hint}</small>
                  </label>
                ))}
              </div>
              <button className="reset-weights" type="button" onClick={() => setWeights(DEFAULT_WEIGHTS)}>Przywróć ustawienia rodzinne</button>
              <div className="filter-group"><span className="section-label">Warunki konieczne</span>
                <label><input type="checkbox" checked={filters.withinBudget} onChange={(event) => setFilters((current) => ({ ...current, withinBudget: event.target.checked }))}/><i/><span>Mieści się w budżecie</span></label>
                <label><input type="checkbox" checked={filters.beach} onChange={(event) => setFilters((current) => ({ ...current, beach: event.target.checked }))}/><i/><span>Potwierdzone przy plaży</span></label>
                <label><input type="checkbox" checked={filters.aquapark} onChange={(event) => setFilters((current) => ({ ...current, aquapark: event.target.checked }))}/><i/><span>Potwierdzony aquapark</span></label>
              </div>
              <div className="model-note"><Icon name="database" size={18}/><p><b>Jak liczymy wynik?</b> Średnia obejmuje tylko dostępne wymiary, a niższe pokrycie danych delikatnie obniża wynik końcowy.</p></div>
            </aside>

            <div className="offers-column">
              <div className="list-head"><span>{ranked.length} z {report.offers.length} ofert</span><div className="legend-inline"><ConfidenceDot confidence="confirmed"/><ConfidenceDot confidence="estimated"/><ConfidenceDot confidence="unknown"/></div></div>
              {ranked.length ? ranked.map((offer, index) => <OfferCard key={offer.id} offer={offer} rank={index + 1} selected={selected.includes(offer.id)} onSelect={() => toggleSelected(offer.id)}/>) : <div className="no-results"><Icon name="sliders"/><h3>Żadna oferta nie spełnia tych warunków</h3><p>Wyłącz jeden z warunków koniecznych albo zmień budżet w źródłowej liście.</p></div>}
            </div>
          </div>
        </section>
      )}

      <section className="method" id="method">
        <div><span className="section-label">Transparentna metodologia</span><h2>Wynik ma pomagać w rozmowie,<br/>nie udawać prawdy objawionej.</h2></div>
        <div className="method-principles">
          <article><Icon name="database"/><h3>Źródło przy każdej liczbie</h3><p>Potwierdzone dane, szacunki i braki mają różne oznaczenia. Każdą zewnętrzną ocenę można otworzyć.</p></article>
          <article><Icon name="sliders"/><h3>Wasze priorytety, nie nasze</h3><p>Zmiana wagi ceny, podróży lub aquaparku natychmiast zmienia kolejność ofert.</p></article>
          <article><Icon name="alert"/><h3>Brak danych pozostaje brakiem</h3><p>Nie zamieniamy pustych pól w zera ani nie wymyślamy ocen, by karta wyglądała pełniej.</p></article>
        </div>
      </section>

      <footer><a className="brand compact" href="#top"><span className="brand-mark">U</span><span><strong>Urlopometr</strong></span></a><p>Pomoc w porównaniu, nie gwarancja jakości. Przed zakupem sprawdź cenę, warunki i godziny lotów u organizatora.</p></footer>

      {selected.length > 0 && !compareOpen && <div className="compare-bar"><span><b>{selected.length}</b> {selected.length === 1 ? "oferta wybrana" : "oferty wybrane"}<small>{selected.length < 2 ? "Wybierz jeszcze jedną" : "Możesz porównać maksymalnie 4"}</small></span><button type="button" disabled={selected.length < 2} onClick={() => setCompareOpen(true)}><Icon name="compare" size={18}/> Porównaj obok siebie</button></div>}
      {compareOpen && <CompareModal offers={selectedOffers} onClose={() => setCompareOpen(false)} onRemove={(id) => setSelected((current) => current.filter((value) => value !== id))}/>} 
    </main>
  );
}
