# 📊 Przewodnik po odpytywaniu bazy danych analitycznych

## 🔗 Endpointy API

Worker analityczny (`epir-analityc-worker`) udostępnia następujące endpointy:

### 1. **Droga klienta w sklepie** (`/journey`)

Zwraca wszystkie zdarzenia klientów, pogrupowane według klientów i sesji.

**Przykłady:**

```bash
# Wszystkie zdarzenia (ostatnie 100)
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/journey"

# Zdarzenia konkretnego klienta (wszystkie sesje)
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/journey?customer_id=gid://shopify/Customer/123"

# Zdarzenia konkretnej sesji
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/journey?session_id=session_1234567890_abc"

# Limit wyników
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/journey?limit=50"
```

**Odpowiedź:**

```json
{
  "journey": [
    {
      "customer_id": "gid://shopify/Customer/123",
      "sessions": [
        {
          "session_id": "session_1234567890_abc",
          "events": [
            {
              "event_type": "page_viewed",
              "timestamp": 1699459200000,
              "page_url": "https://example.com/",
              "page_title": "Home"
            },
            {
              "event_type": "product_viewed",
              "timestamp": 1699459210000,
              "product_id": "gid://shopify/Product/456",
              "product_title": "Silver Ring",
              "page_url": "https://example.com/products/silver-ring"
            },
            {
              "event_type": "cart_updated",
              "timestamp": 1699459220000,
              "cart_token": "abc123"
            },
            {
              "event_type": "checkout_started",
              "timestamp": 1699459230000,
              "cart_token": "abc123"
            }
          ]
        }
      ]
    }
  ]
}
```

### 2. **Podsumowanie sesji klientów** (`/sessions`)

Zwraca zagregowane dane o sesjach (liczba zdarzeń, scoring AI, aktywacja chatu).

**Przykłady:**

```bash
# Wszystkie sesje (ostatnie 50)
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/sessions"

# Sesje konkretnego klienta
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/sessions?customer_id=gid://shopify/Customer/123"

# Limit wyników
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/sessions?limit=20"
```

**Odpowiedź:**

```json
{
  "sessions": [
    {
      "customer_id": "gid://shopify/Customer/123",
      "session_id": "session_1234567890_abc",
      "event_count": 8,
      "first_event_at": 1699459200000,
      "last_event_at": 1699459230000,
      "ai_score": 85.5,
      "should_activate_chat": 1,
      "chat_activated_at": 1699459220000,
      "activation_reason": "high_engagement_score"
    }
  ]
}
```

### 3. **Surowe zdarzenia** (`/pixel/events`)

Stare zdarzenia z tabeli `pixel_events` (zachowane dla kompatybilności).

```bash
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/pixel/events?limit=20"
```

---

## 🗄️ Bezpośrednie zapytania SQL (Wrangler CLI)

### Instalacja Wrangler

```bash
npm install -g wrangler
wrangler login
```

### Podstawowe zapytania

```bash
# 1. Lista tabel
wrangler d1 execute epir_art_jewellery --remote --command="SELECT name FROM sqlite_master WHERE type='table';"

# 2. Liczba zdarzeń
wrangler d1 execute epir_art_jewellery --remote --command="SELECT COUNT(*) as total FROM customer_events;"

# 3. Ostatnie 10 zdarzeń
wrangler d1 execute epir_art_jewellery --remote --command="SELECT customer_id, event_type, event_timestamp, page_url FROM customer_events ORDER BY event_timestamp DESC LIMIT 10;"

# 4. Zdarzenia konkretnego klienta
wrangler d1 execute epir_art_jewellery --remote --command="SELECT event_type, event_timestamp, product_title, page_url FROM customer_events WHERE customer_id='gid://shopify/Customer/123' ORDER BY event_timestamp;"

# 5. Zdarzenia w konkretnej sesji
wrangler d1 execute epir_art_jewellery --remote --command="SELECT event_type, event_timestamp, product_title FROM customer_events WHERE session_id='session_1234567890_abc' ORDER BY event_timestamp;"
```

### Analityczne zapytania

```bash
# 1. Najpopularniejsze produkty
wrangler d1 execute epir_art_jewellery --remote --command="SELECT product_id, product_title, COUNT(*) as views FROM customer_events WHERE event_type='product_viewed' AND product_id IS NOT NULL GROUP BY product_id, product_title ORDER BY views DESC LIMIT 10;"

# 2. Ścieżka konwersji (funnel)
wrangler d1 execute epir_art_jewellery --remote --command="SELECT event_type, COUNT(*) as count FROM customer_events WHERE event_type IN ('page_viewed', 'product_viewed', 'cart_updated', 'checkout_started') GROUP BY event_type;"

# 3. Średnia liczba zdarzeń na sesję
wrangler d1 execute epir_art_jewellery --remote --command="SELECT AVG(event_count) as avg_events FROM customer_sessions;"

# 4. Sesje z wysokim zaangażowaniem (AI score > 70)
wrangler d1 execute epir_art_jewellery --remote --command="SELECT customer_id, session_id, event_count, ai_score FROM customer_sessions WHERE ai_score > 70 ORDER BY ai_score DESC LIMIT 10;"

# 5. Sesje z aktywowanym chatem
wrangler d1 execute epir_art_jewellery --remote --command="SELECT customer_id, session_id, event_count, ai_score, activation_reason FROM customer_sessions WHERE chat_activated_at IS NOT NULL ORDER BY chat_activated_at DESC LIMIT 10;"
```

### Grupowanie zdarzeń według klientów

```bash
# Liczba zdarzeń na klienta
wrangler d1 execute epir_art_jewellery --remote --command="SELECT customer_id, COUNT(*) as total_events, COUNT(DISTINCT session_id) as sessions FROM customer_events GROUP BY customer_id ORDER BY total_events DESC LIMIT 20;"

# Szczegółowa droga klienta
wrangler d1 execute epir_art_jewellery --remote --command="SELECT customer_id, session_id, event_type, datetime(event_timestamp/1000, 'unixepoch') as time, product_title, page_url FROM customer_events WHERE customer_id='gid://shopify/Customer/123' ORDER BY event_timestamp;"
```

---

## 📈 Wizualizacja danych

### Eksport do CSV

```bash
# Eksport wszystkich zdarzeń
wrangler d1 execute epir_art_jewellery --remote --command="SELECT * FROM customer_events ORDER BY event_timestamp DESC LIMIT 1000;" --json > events.json

# Konwersja JSON → CSV (przykład w Node.js)
node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('events.json')); console.log(Object.keys(data[0]).join(',')); data.forEach(r=>console.log(Object.values(r).join(',')))" > events.csv
```

### Przykładowe narzędzia do wizualizacji

1. **Excel/Google Sheets**: Importuj CSV i twórz wykresy
2. **Python + Pandas**: Analiza danych i wizualizacja (Matplotlib, Seaborn)
3. **Grafana**: Integracja z D1 przez Cloudflare Analytics API
4. **Tableau**: Import CSV i tworzenie dashboardów

---

## 🔍 Przykładowe scenariusze

### Scenario 1: Analiza zachowania konkretnego klienta

```bash
# 1. Pobierz ID klienta z sesji
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/sessions?limit=10"

# 2. Pobierz szczegółową drogę klienta
curl "https://epir-analityc-worker.YOUR_ACCOUNT.workers.dev/journey?customer_id=gid://shopify/Customer/123"
```

### Scenario 2: Znajdź sesje z niekompletną konwersją

```bash
# Sesje z wyświetleniem produktu, ale bez checkout
wrangler d1 execute epir_art_jewellery --remote --command="SELECT DISTINCT ce.customer_id, ce.session_id, cs.event_count FROM customer_events ce JOIN customer_sessions cs ON ce.customer_id = cs.customer_id AND ce.session_id = cs.session_id WHERE ce.event_type = 'product_viewed' AND cs.session_id NOT IN (SELECT session_id FROM customer_events WHERE event_type = 'checkout_started');"
```

### Scenario 3: Optymalizacja produktów

```bash
# Produkty z najwyższym wskaźnikiem odrzuceń
wrangler d1 execute epir_art_jewellery --remote --command="SELECT product_id, product_title, COUNT(*) as views, SUM(CASE WHEN event_type='cart_updated' THEN 1 ELSE 0 END) as adds_to_cart FROM customer_events WHERE product_id IS NOT NULL GROUP BY product_id ORDER BY views DESC LIMIT 20;"
```

---

## 🛠️ Debugowanie

### Sprawdź, czy tabele istnieją

```bash
wrangler d1 execute epir_art_jewellery --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

### Sprawdź strukturę tabeli

```bash
wrangler d1 execute epir_art_jewellery --remote --command="PRAGMA table_info(customer_events);"
```

### Sprawdź najnowsze zdarzenia

```bash
wrangler d1 execute epir_art_jewellery --remote --command="SELECT * FROM customer_events ORDER BY created_at DESC LIMIT 5;"
```

---

## 📝 Uwagi

- **Timestampy**: Wszystkie timestampy są w formacie Unix (milisekundy). Użyj `datetime(timestamp/1000, 'unixepoch')` aby przekonwertować na czytelny format.
- **Customer ID**: Format Shopify: `gid://shopify/Customer/123456`
- **Session ID**: Format: `session_<timestamp>_<random>`
- **Limity**: Endpointy API mają domyślne limity (50-100 wyników). Użyj parametru `?limit=200` aby zwiększyć.

---

**🚀 Gotowe do analizy!** Jeśli potrzebujesz więcej zapytań lub pomocy, sprawdź `schema-events.sql` lub `schema-customer-sessions.sql`.
