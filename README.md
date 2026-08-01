# Urlopometr

Urlopometr pomaga rodzinie wybrać właściwą ofertę wakacyjną, zamiast tylko
przeglądać kolejne karty hoteli. Importuje wyniki lub pojedyncze oferty z
Wakacje.pl, pokazuje jakość danych i buduje wyjaśnialny ranking.

## Co działa

- import linku do listy lub 2–12 bezpośrednich linków do hoteli,
- ranking według ceny, wygody podróży, opinii, aquaparku i jedzenia,
- regulowane wagi i filtry warunków koniecznych,
- kara za niskie pokrycie danych bez zamieniania braków w zera,
- porównanie 2–4 ofert obok siebie,
- historia analiz w pamięci przeglądarki i eksport raportu JSON,
- opcjonalny research z OpenAI Responses API i wyszukiwaniem sieciowym.

## Architektura

Pełna aplikacja działa jako Next/Vinext na Cloudflare Workers. Statyczny frontend
może być również publikowany przez GitHub Pages; wtedy korzysta z publicznego API
pod adresem `adam-urlopometr.jakiesluchawki.chatgpt.site`.

```
przeglądarka → /api/import → Wakacje.pl → parser → jawny ranking
            → /api/research → OpenAI web search (opcjonalnie)
```

Klucze nigdy nie trafiają do przeglądarki. Research jest domyślnie wyłączony.
Aby go uruchomić w środowisku serwerowym, ustaw:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
AI_RESEARCH_ENABLED=true
```

Publiczne włączenie researchu powinno być połączone z limitem kosztów lub
mechanizmem dostępu. Sama subskrypcja ChatGPT/Codex nie udostępnia klucza API
aplikacji działającej publicznie.

## Uruchomienie lokalne

```bash
npm ci
npm run dev
```

Sprawdzenie produkcyjnego buildu:

```bash
npm run build
npm run build:pages
```

## GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` buduje statyczny frontend po pushu
do `main`. Repozytorium musi mieć włączone Pages z GitHub Actions.

## Ważne ograniczenie

Serwisy turystyczne mogą zmieniać HTML lub blokować automatyczne pobieranie.
Aplikacja zgłasza wtedy błąd i pozwala przejść na import pojedynczych linków.
Każdą cenę, warunki i godziny lotów należy ostatecznie potwierdzić u organizatora.

