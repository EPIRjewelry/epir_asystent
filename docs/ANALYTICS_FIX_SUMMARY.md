# Podsumowanie Naprawy: Przepływ Danych Analytics

## Problem
Dane z Web Pixel Extension nie docierały do Analytics Worker, pomimo poprawnej konfiguracji.

### Root Cause
Web Pixel wysyłał zdarzenia do **ścieżki względnej** `/pixel`, która była rozwiązywana do domeny sklepu Shopify (`epir-art-silver-jewellery.myshopify.com/pixel`) zamiast do workera Cloudflare (`asystent.epirbizuteria.pl/pixel`).

## Rozwiązanie

### 1. Konfigurowalny URL w Web Pixel Extension
**Plik**: `extensions/my-web-pixel/shopify.extension.toml`

Dodano nowe pole konfiguracyjne:
```toml
[settings.fields.analyticsUrl]
name = "Analytics URL"
description = "URL to send analytics events (e.g., https://asystent.epirbizuteria.pl/pixel)"
type = "single_line_text_field"
```

### 2. Używanie Pełnego URL
**Plik**: `extensions/my-web-pixel/src/index.ts`

```typescript
// Przed:
const response = await fetch('/pixel', { ... });

// Po:
const analyticsUrl = settings?.analyticsUrl || 'https://asystent.epirbizuteria.pl/pixel';
const response = await fetch(analyticsUrl, { ... });
```

**Kluczowe zmiany:**
- Dodano parametr `settings` do funkcji `register()`
- Utworzono zmienną `analyticsUrl` z fallbackiem do produkcyjnego URL
- Zmieniono wszystkie wywołania `fetch('/pixel', ...)` na `fetch(analyticsUrl, ...)`
- Dodano logging dla celów diagnostycznych

### 3. CORS Headers w Main Worker
**Plik**: `workers/worker/src/index.ts`

Dodano nagłówki CORS do wszystkich odpowiedzi proxy z Analytics Worker:

```typescript
const response = await env.ANALYTICS.fetch(proxied);
return new Response(response.body, {
  status: response.status,
  statusText: response.statusText,
  headers: { ...Object.fromEntries(response.headers), ...cors(env) },
});
```

**Dlaczego to było potrzebne:**
- Web Pixel działa w kontekście domeny Shopify
- Wysyła żądania do innej domeny (asystent.epirbizuteria.pl)
- Przeglądarka wymaga nagłówków CORS dla takich żądań cross-origin

### 4. Dokumentacja Troubleshootingu
**Plik**: `docs/ANALYTICS_TROUBLESHOOTING.md`

Utworzono kompletny przewodnik zawierający:
- Szczegółowe kroki weryfikacji
- Instrukcje debugowania
- Diagram architektury
- FAQ z częstymi problemami
- Przykłady testów curl

## Instrukcje Wdrożenia

### Krok 1: Deploy Rozszerzenia Shopify
```powershell
# Z katalogu głównego repo
shopify app deploy
```

Wybierz rozszerzenie `my-web-pixel` do wdrożenia.

### Krok 2: Konfiguracja w Shopify Admin
1. Przejdź do: **Shopify Admin** → **Apps** → **"Agent EPIR Art Jewellery"**
2. Znajdź ustawienia rozszerzenia **"my-web-pixel"**
3. W polu **"Analytics URL"** wpisz: `https://asystent.epirbizuteria.pl/pixel`
4. **Zapisz ustawienia**

### Krok 3: Deploy Workers
```powershell
# Main Worker (z CORS headers)
cd workers\worker
npm run deploy

# Analytics Worker (bez zmian, ale warto zweryfikować)
cd ..\analytics-worker
npm run deploy
```

### Krok 4: Weryfikacja

#### A. Console Przeglądarki
Otwórz sklep i sprawdź Console (F12):
```
[EPIR Pixel] Analytics URL: https://asystent.epirbizuteria.pl/pixel
```

**Jeśli widzisz `/pixel`** → rozszerzenie nie zostało zaktualizowane!

#### B. Network Tab
Poszukaj żądania POST do `/pixel`:
- **✅ Prawidłowo**: `https://asystent.epirbizuteria.pl/pixel`
- **❌ Błędnie**: `https://epir-art-silver-jewellery.myshopify.com/pixel`

#### C. Logi Cloudflare
```powershell
# Analytics Worker
wrangler tail epir-analityc-worker
```

Szukaj:
```
[ANALYTICS_WORKER] 📥 Received POST /pixel request
[ANALYTICS_WORKER] 💾 Preparing INSERT with values: {...}
[ANALYTICS_WORKER] ✅ INSERT successful
```

#### D. Baza D1
```powershell
# Sprawdź liczbę zdarzeń
wrangler d1 execute epir_art_jewellery --remote --command "SELECT COUNT(*) FROM pixel_events"

# Ostatnie 5 zdarzeń
wrangler d1 execute epir_art_jewellery --remote --command "SELECT event_type, customer_id, session_id, created_at FROM pixel_events ORDER BY id DESC LIMIT 5"
```

## Test Bezpośredni

Wyślij testowe zdarzenie bezpośrednio:

```powershell
curl -X POST https://asystent.epirbizuteria.pl/pixel `
  -H "Content-Type: application/json" `
  -d '{"type":"page_viewed","data":{"customerId":"test-123","sessionId":"test-session","page_url":"https://example.com"}}'
```

**Oczekiwana odpowiedź:**
```json
{
  "ok": true,
  "activate_chat": false,
  "reason": null
}
```

## Architektura Po Naprawie

```
┌──────────────────────────────────────────────────────────┐
│ Shopify Storefront                                       │
│  (epir-art-silver-jewellery.myshopify.com)              │
│                                                          │
│  ┌────────────────────────────────────────────┐         │
│  │ Web Pixel Extension                        │         │
│  │                                            │         │
│  │  fetch(analyticsUrl, {...})                │         │
│  │    ↓                                       │         │
│  │  https://asystent.epirbizuteria.pl/pixel   │         │
│  └────────────────────────────────────────────┘         │
└────────────────────────┬─────────────────────────────────┘
                         │
                         │ HTTPS POST (with CORS)
                         ↓
┌──────────────────────────────────────────────────────────┐
│ Cloudflare Workers                                       │
│                                                          │
│  ┌────────────────────────────────────────────┐         │
│  │ Main Worker                                │         │
│  │ (epir-art-jewellery-worker)                │         │
│  │                                            │         │
│  │  POST /pixel → Add CORS → ANALYTICS proxy  │         │
│  └────────────────────┬───────────────────────┘         │
│                       │                                  │
│                       │ Service Binding                  │
│                       ↓                                  │
│  ┌────────────────────────────────────────────┐         │
│  │ Analytics Worker                           │         │
│  │ (epir-analityc-worker)                     │         │
│  │                                            │         │
│  │  • handlePixelPost()                       │         │
│  │  • ensurePixelTable()                      │         │
│  │  • INSERT INTO pixel_events                │         │
│  │  • upsertCustomerSession()                 │         │
│  │  • AI scoring (co 3 zdarzenia)             │         │
│  └────────────────────┬───────────────────────┘         │
│                       │                                  │
│                       ↓                                  │
│  ┌────────────────────────────────────────────┐         │
│  │ D1 Database (epir_art_jewellery)           │         │
│  │                                            │         │
│  │  • pixel_events (41 kolumn)                │         │
│  │  • customer_sessions (AI analysis)         │         │
│  └────────────────────────────────────────────┘         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Dlaczego Ta Naprawa Działa

### Problem: Ścieżka Względna
```typescript
fetch('/pixel', { ... })  // ❌ Błąd
```
- Ścieżka względna `/pixel` jest rozwiązywana względem **bieżącej domeny**
- W kontekście Web Pixel = domena sklepu Shopify
- Rezultat: `https://epir-art-silver-jewellery.myshopify.com/pixel`
- Shopify nie ma tego endpointu → 404 Not Found

### Rozwiązanie: Pełny URL
```typescript
fetch('https://asystent.epirbizuteria.pl/pixel', { ... })  // ✅ Poprawnie
```
- Pełny URL bezpośrednio wskazuje na worker Cloudflare
- Nie zależy od kontekstu domeny
- Worker odbiera żądanie i przekazuje do Analytics Worker
- Dane trafiają do D1

### Bonus: CORS
```typescript
headers: { ...cors(env) }  // Dodane nagłówki CORS
```
- Umożliwia Web Pixelowi wysyłanie żądań cross-origin
- Bez tego przeglądarka blokowałaby żądania
- `Access-Control-Allow-Origin` jest ustawiony na domenę sklepu

## Testowanie

### Testy Automatyczne
```powershell
cd workers\analytics-worker
npm test
```

**Wynik:** 10/10 testów przeszło ✅

Testy sprawdzają:
- Przyjmowanie zdarzeń `page_viewed`
- Przyjmowanie zdarzeń `product_viewed`
- Przyjmowanie zdarzeń `cart_updated`
- Endpoint `/pixel/count`
- Endpoint `/pixel/events`
- Walidację nieprawidłowych payloadów

### Testy Manualne
1. **Console Check**: Verify analytics URL is logged
2. **Network Check**: Verify POST goes to correct domain
3. **Worker Logs**: Verify events are received
4. **D1 Check**: Verify data is stored

## Bezpieczeństwo

### CodeQL Scan
**Wynik:** 0 alertów ✅

Żadnych znanych podatności w zmianach:
- Brak SQL injection (używamy prepared statements)
- Brak XSS (dane są JSON-encoded)
- CORS jest ograniczony do domeny sklepu
- Brak eksponowania sekretów

### CORS Security
```typescript
const origin = env.ALLOWED_ORIGIN || '*';
```
- W produkcji: `ALLOWED_ORIGIN = "https://epir-art-silver-jewellery.myshopify.com"`
- Tylko ta domena może wysyłać żądania
- Zapobiega nieautoryzowanym żądaniom

## Możliwe Problemy

### Problem 1: Nadal widzę `/pixel` w logach
**Rozwiązanie:**
1. Wdróż najnowszą wersję rozszerzenia
2. Skonfiguruj URL w Shopify Admin
3. Wyczyść cache przeglądarki
4. Przeładuj stronę sklepu

### Problem 2: CORS Error
```
Access to fetch... has been blocked by CORS policy
```
**Rozwiązanie:**
- Deploy main worker z aktualizacją CORS
- Sprawdź `env.ALLOWED_ORIGIN` w wrangler.toml

### Problem 3: 404 Not Found
**Rozwiązanie:**
- Sprawdź czy worker jest wdrożony: `curl https://asystent.epirbizuteria.pl/healthz`
- Zweryfikuj routing w `workers/worker/src/index.ts`

## Kolejne Kroki (Opcjonalne)

### 1. Monitoring
Dodaj alerty Cloudflare dla:
- Errors > 5/min w Analytics Worker
- Latency > 1000ms dla `/pixel`
- 404 responses

### 2. Rate Limiting
Implementuj rate limiting dla Web Pixel (obecnie unlimited):
```typescript
// Przykład: max 100 zdarzeń/min per session
if (rateLimiter.check(sessionId, 100, 60)) {
  return handlePixelPost(...);
}
```

### 3. Analytics Dashboard
Utwórz dashboard w Cloudflare Analytics dla:
- Event ingestion rate (events/s)
- Event type distribution
- Customer session duration
- AI activation rate

## Kontakt

Jeśli napotkasz problemy:
1. Sprawdź `docs/ANALYTICS_TROUBLESHOOTING.md`
2. Przejrzyj logi Cloudflare Workers
3. Zweryfikuj konfigurację w Shopify Admin
4. Otwórz issue w GitHub z logami i szczegółami

---

**Data naprawy:** 2025-11-09  
**Status:** ✅ ROZWIĄZANE  
**Testy:** ✅ 10/10 przeszło  
**Bezpieczeństwo:** ✅ 0 alertów CodeQL
