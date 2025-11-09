# Przewodnik Rozwiązywania Problemów z Analityką

## Problem: Dane z Web Pixel nie docierają do Analytics Worker

### Symptomy
- Zdarzenia są logowane w konsoli przeglądarki
- Dane nie pojawiają się w bazie D1
- Logi Analytics Worker nie pokazują przychodzących żądań

### Root Cause
Web Pixel używał względnej ścieżki `/pixel`, która była rozwiązywana do domeny sklepu Shopify zamiast do workera Cloudflare.

### Rozwiązanie ✅

#### 1. Aktualizacja Web Pixel Extension
Web pixel został zaktualizowany (commit: 5e9a863) aby używać **pełnego URL** zamiast ścieżki względnej.

**Przed:**
```typescript
const response = await fetch('/pixel', {
  method: 'POST',
  ...
});
```

**Po:**
```typescript
const analyticsUrl = settings?.analyticsUrl || 'https://asystent.epirbizuteria.pl/pixel';
const response = await fetch(analyticsUrl, {
  method: 'POST',
  ...
});
```

#### 2. Konfiguracja w Shopify Admin

Po wdrożeniu rozszerzenia, skonfiguruj URL w panelu administracyjnym:

1. Przejdź do: **Shopify Admin** → **Apps** → **Agent EPIR Art Jewellery**
2. Znajdź ustawienia rozszerzenia **"my-web-pixel"**
3. W polu **"Analytics URL"** wpisz: `https://asystent.epirbizuteria.pl/pixel`
4. Zapisz zmiany

#### 3. Wdrożenie

```powershell
# Z katalogu głównego repozytorium
shopify app deploy
```

Wybierz rozszerzenie `my-web-pixel` do wdrożenia.

## Weryfikacja Poprawności Działania

### Krok 1: Sprawdź Console w Przeglądarce

Otwórz sklep Shopify i sprawdź Console (F12):

```
[EPIR Pixel] Customer ID: gid://shopify/Customer/123 (lub 'anonymous')
[EPIR Pixel] Session ID: session_1699564123456_abc123
[EPIR Pixel] Analytics URL: https://asystent.epirbizuteria.pl/pixel
```

**Ważne:** Jeśli widzisz `Analytics URL: /pixel`, oznacza to że rozszerzenie nie zostało zaktualizowane.

### Krok 2: Sprawdź Network Tab

W zakładce Network (F12) poszukaj żądań do `/pixel`:
- **Prawidłowo:** Żądanie POST do `https://asystent.epirbizuteria.pl/pixel`
- **Błędnie:** Żądanie POST do `https://epir-art-silver-jewellery.myshopify.com/pixel`

### Krok 3: Sprawdź Logi Cloudflare Workers

#### Analytics Worker
```powershell
wrangler tail epir-analityc-worker
```

Powinieneś zobaczyć:
```
[ANALYTICS_WORKER] 📥 Received POST /pixel request
[ANALYTICS_WORKER] 📊 Event type: page_viewed
[ANALYTICS_WORKER] 💾 Preparing INSERT with values: {...}
[ANALYTICS_WORKER] ✅ INSERT successful
```

#### Main Worker (Chat Worker)
```powershell
wrangler tail epir-art-jewellery-worker
```

Szukaj logów proxy:
```
[handleChat] Proxying /pixel request to ANALYTICS service
```

### Krok 4: Sprawdź Bazę D1

```powershell
# Ostatnie 5 zdarzeń
wrangler d1 execute epir_art_jewellery --remote --command "SELECT event_type, customer_id, session_id, created_at FROM pixel_events ORDER BY id DESC LIMIT 5"

# Liczba zdarzeń według typu
wrangler d1 execute epir_art_jewellery --remote --command "SELECT event_type, COUNT(*) as count FROM pixel_events GROUP BY event_type"
```

### Krok 5: Test Bezpośredni

Wyślij testowe zdarzenie bezpośrednio do workera:

```powershell
curl -X POST https://asystent.epirbizuteria.pl/pixel `
  -H "Content-Type: application/json" `
  -d '{"type":"page_viewed","data":{"customerId":"test-123","sessionId":"test-session","page_url":"https://example.com"}}'
```

Oczekiwana odpowiedź:
```json
{
  "ok": true,
  "activate_chat": false,
  "reason": null
}
```

## Częste Problemy i Rozwiązania

### Problem 1: URL nadal pokazuje `/pixel` w logach

**Przyczyna:** Rozszerzenie nie zostało zaktualizowane lub ustawienia nie zostały zapisane.

**Rozwiązanie:**
1. Upewnij się, że wdrożono najnowszą wersję rozszerzenia
2. Sprawdź ustawienia w Shopify Admin
3. Wyczyść cache przeglądarki (Ctrl+Shift+Delete)
4. Przeładuj stronę sklepu

### Problem 2: CORS Error w Console

```
Access to fetch at 'https://asystent.epirbizuteria.pl/pixel' from origin 
'https://epir-art-silver-jewellery.myshopify.com' has been blocked by CORS policy
```

**Przyczyna:** Brakuje nagłówków CORS w odpowiedzi workera.

**Rozwiązanie:** Sprawdź, czy Main Worker ma skonfigurowane CORS:
```typescript
// W workers/worker/src/index.ts
headers: {
  'Access-Control-Allow-Origin': 'https://epir-art-silver-jewellery.myshopify.com',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
```

### Problem 3: 404 Not Found

**Przyczyna:** Worker nie jest wdrożony lub routing jest niepoprawny.

**Rozwiązanie:**
```powershell
# Sprawdź czy worker działa
curl https://asystent.epirbizuteria.pl/healthz

# Wdróż ponownie
cd workers/worker
npm run deploy

cd ../analytics-worker
npm run deploy
```

### Problem 4: Dane w D1 ale brak logów w Analytics Worker

**Przyczyna:** Logi mogą być filtrowane lub sampling może pomijać niektóre logi.

**Rozwiązanie:**
1. Sprawdź ustawienia observability w `wrangler.toml`:
   ```toml
   [observability.logs]
   head_sampling_rate = 1  # 100% logów
   ```
2. Użyj dashboard Cloudflare zamiast `wrangler tail`
3. Poczekaj ~30 sekund na propagację logów

## Architektura Przepływu Danych

```
┌─────────────────────────────────────────────────────────────┐
│ SHOPIFY STOREFRONT                                          │
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │ Web Pixel Extension (my-web-pixel)           │          │
│  │                                              │          │
│  │  analytics.subscribe('page_viewed', ...)     │          │
│  │             ↓                                │          │
│  │  sendPixelEvent()                            │          │
│  │             ↓                                │          │
│  │  fetch(analyticsUrl, { ... })  ←── ustawienie z Shopify│
│  │             ↓                                │          │
│  └─────────────┼────────────────────────────────┘          │
│                │                                            │
└────────────────┼────────────────────────────────────────────┘
                 │
                 │ HTTPS POST
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ CLOUDFLARE WORKERS                                          │
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │ Main Worker (epir-art-jewellery-worker)      │          │
│  │ https://asystent.epirbizuteria.pl            │          │
│  │                                              │          │
│  │  POST /pixel → proxy do ANALYTICS binding   │          │
│  │             ↓                                │          │
│  └─────────────┼────────────────────────────────┘          │
│                │                                            │
│                │ Service Binding (zero-cost)                │
│                │                                            │
│  ┌─────────────▼────────────────────────────────┐          │
│  │ Analytics Worker (epir-analityc-worker)      │          │
│  │                                              │          │
│  │  handlePixelPost()                           │          │
│  │      ↓                                       │          │
│  │  ensurePixelTable(env.DB)                    │          │
│  │      ↓                                       │          │
│  │  INSERT INTO pixel_events                    │          │
│  │      ↓                                       │          │
│  │  upsertCustomerSession()                     │          │
│  │      ↓                                       │          │
│  │  AI scoring (co 3 eventy)                    │          │
│  │      ↓                                       │          │
│  │  Notify Session DO (product views)           │          │
│  │                                              │          │
│  └──────────────────────────────────────────────┘          │
│                │                                            │
│                ↓                                            │
│  ┌──────────────────────────────────────────────┐          │
│  │ D1 Database (epir_art_jewellery)             │          │
│  │                                              │          │
│  │  - pixel_events (41 kolumn)                  │          │
│  │  - customer_sessions (AI analysis)           │          │
│  │                                              │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Monitoring i Alerty

### Metryki do Śledzenia
1. **Event ingestion rate** - liczba eventów/sekunda
2. **Error rate** - % żądań z błędami
3. **D1 latency** - czas INSERT do bazy
4. **Worker CPU time** - czas wykonania workera

### Konfiguracja Alertów w Cloudflare

1. Przejdź do: **Notifications** → **Create**
2. Wybierz: **Workers: Errors**
3. Skonfiguruj próg: np. > 5 błędów/minutę
4. Dodaj email lub webhook

## Dodatkowe Zasoby

- [Shopify Web Pixels API](https://shopify.dev/docs/api/web-pixels-api)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Database Docs](https://developers.cloudflare.com/d1/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)

## Kontakt

W razie problemów:
1. Sprawdź najpierw ten przewodnik
2. Przejrzyj logi Cloudflare
3. Otwórz issue w GitHub z szczegółami:
   - Logi z przeglądarki (Console + Network)
   - Logi z Cloudflare Workers
   - Wynik zapytania D1
   - Konfiguracja ustawień w Shopify Admin
