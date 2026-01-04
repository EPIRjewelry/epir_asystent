## EPIR Asystent — Pełna Analityka i AI-Driven Chat

Autor: Krzysztof Dżugaj

Krótki opis
---------
Repozytorium zawiera zaawansowaną implementację AI asystenta sklepu z **pełnym trackingiem 25 eventów** (16 standardowych Shopify + 5 DOM + 4 custom heatmap). System wykorzystuje Cloudflare Workers, Durable Objects, D1 oraz Shopify Extensions zgodnie z best practices.

## 🎯 Architektura Rozszerzeń (Shopify Best Practices)

### ✅ Dlaczego 2 Rozszerzenia?
Zgodnie z dokumentacją Shopify i weryfikacją x.ai, **heatmap tracking wymaga 2 typów rozszerzeń**:

1. **Theme App Extension** (`asystent-klienta`)
   - Pełny dostęp do DOM
   - Publikuje custom events przez `Shopify.analytics.publish()`
   - Zawiera: tracking.js (heatmap) + assistant.js (UI czatu)

2. **Web Pixel Extension** (`my-web-pixel`)
   - Sandbox (strict) - tylko `analytics.subscribe()`
   - Subskrybuje WSZYSTKIE 25 eventów
   - Wysyła dane do analytics-worker

### 📊 Pełne Pokrycie Eventów (25/25)
#### 16 Standardowych Shopify:
`page_viewed`, `product_viewed`, `collection_viewed`, `search_submitted`, `product_added_to_cart`, `product_removed_from_cart`, `cart_viewed`, `cart_updated`, `checkout_started`, `checkout_contact_info_submitted`, `checkout_address_info_submitted`, `checkout_shipping_info_submitted`, `payment_info_submitted`, `checkout_completed`, `purchase_completed`, `alert_displayed`

#### 5 DOM Events:
`clicked`, `input_focused`, `input_blurred`, `input_changed`, `form_submitted`

#### 4 Custom Heatmap Events:
`epir:click_with_position` (x/y koordynaty), `epir:scroll_depth` (%), `epir:page_exit` (czas), `epir:mouse_sample` (hover)

Główne komponenty
------------------
- `extensions/my-web-pixel` — Web Pixel Extension (26 subskrypcji), wysyła wszystkie eventy do `analytics-worker`
- `extensions/asystent-klienta` — Theme App Extension z:
  - `tracking.js` — zbiera dane heatmap (DOM access) i publikuje custom events
  - `assistant.js` — UI czatu AI, nasłuchuje `epir:activate-chat`
- `workers/analytics-worker` — backend analytics, ekstrahuje dane do D1 (41 kolumn), wywołuje AI scoring
- `workers/worker` (e-a-j.worker) — SessionDO, chat AI, MCP orchestration

Najważniejsze pliki zmodyfikowane/utworzone
-----------------------------------------
### Shopify Extensions:
- `extensions/my-web-pixel/src/index.ts` — 26 subskrypcji eventów (16+5+4+1 ui_extension_errored)
- `extensions/asystent-klienta/assets/tracking.js` — tracking heatmap z DOM access
- `extensions/asystent-klienta/blocks/tracking.liquid` — wstrzyknięcie skryptu tracking
- `extensions/asystent-klienta/assets/assistant.js` — UI czatu AI

### Cloudflare Workers:
- `workers/analytics-worker/src/index.ts` — ekstrakcja 41 kolumn z eventów, AI scoring
- `workers/analytics-worker/schema-pixel-events-base.sql` — bazowa tabela (18 kolumn)
- `workers/analytics-worker/schema-pixel-events-v3-heatmap.sql` — rozszerzenie (+23 kolumny heatmap)
- `workers/analytics-worker/schema-customer-sessions.sql` — sesje AI
- `workers/worker/src/index.ts` — SessionDO, chat AI, MCP routing

Jak uruchomić lokalnie / migracje D1
-----------------------------------
### 1. Migracja D1 Database (analytics-worker)

**UWAGA:** Nazwa bazy: `jewelry-analytics-db` (binding: `DB` w wrangler.toml)

```powershell
cd workers\analytics-worker

# Bazowa tabela pixel_events (18 kolumn)
wrangler d1 execute jewelry-analytics-db --remote --file=./schema-pixel-events-base.sql

# Rozszerzenie heatmap (+23 kolumny) - WYMAGANE!
wrangler d1 execute jewelry-analytics-db --remote --file=./schema-pixel-events-v3-heatmap.sql

# Tabela customer_sessions (AI scoring)
wrangler d1 execute jewelry-analytics-db --remote --file=./schema-customer-sessions.sql

# Weryfikacja schematu (powinno być 41 kolumn w pixel_events)
wrangler d1 execute jewelry-analytics-db --remote --command="PRAGMA table_info(pixel_events);"
```

**KRYTYCZNE:** Bez migracji heatmap analytics worker zwróci błąd `insert_failed`!

### 2. Deploy Workers

```powershell
# Analytics Worker
cd workers\analytics-worker
wrangler deploy

# Chat Worker (SessionDO)
cd ..\worker
wrangler deploy
```

### 3. Deploy Shopify Extensions

```powershell
cd c:\Users\user\epir_asystent
shopify app deploy
```

**Uwaga:** Shopify pozwala na **1 Theme App Extension na aplikację**. Dlatego tracking.js jest zintegrowany z asystent-klienta.

## 📊 Database Schema (D1)

### Tabela: `pixel_events` (41 kolumn)
**Bazowe (18):** id, event_type, event_name, created_at, customer_id, session_id, page_url, page_title, referrer, user_agent, product_id, product_title, product_variant_id, product_price, product_quantity, cart_total, raw_data, updated_at

**Heatmap (23):** click_x, click_y, viewport_w, viewport_h, scroll_depth_percent, time_on_page_seconds, element_tag, element_id, element_class, input_name, form_id, search_query, collection_id, collection_handle, checkout_token, order_id, order_value, alert_type, alert_message, error_message, extension_id, mouse_x, mouse_y

### Tabela: `customer_sessions`
Kolumny: customer_id, session_id, event_count, first_event_at, last_event_at, ai_score, ai_analysis, should_activate_chat, chat_activated_at, activation_reason, created_at, updated_at

Walidacja i testy po wdrożeniu
------------------------------
### 1. Test Analytics Worker (bezpośredni)
```powershell
# Test healthcheck
Invoke-RestMethod -Uri "https://epir-analityc-worker.krzysztofdzugaj.workers.dev/healthz" -Method GET

# Test zapisu eventu
Invoke-RestMethod -Uri "https://epir-analityc-worker.krzysztofdzugaj.workers.dev/pixel" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"type":"page_viewed","data":{"customerId":"test-123","sessionId":"session-456","page_url":"https://test.com"}}'
```

### 2. Sprawdź dane w D1
```powershell
# Ostatnie eventy
wrangler d1 execute jewelry-analytics-db --remote --command="SELECT event_type, customer_id, session_id, page_url, created_at FROM pixel_events ORDER BY id DESC LIMIT 5;"

# Liczba eventów według typu
wrangler d1 execute jewelry-analytics-db --remote --command="SELECT event_type, COUNT(*) as count FROM pixel_events GROUP BY event_type;"

# Sesje klientów
wrangler d1 execute jewelry-analytics-db --remote --command="SELECT * FROM customer_sessions ORDER BY last_event_at DESC LIMIT 5;"
```

### 3. Logi Cloudflare Workers
```powershell
# Analytics Worker
wrangler tail epir-analityc-worker --format pretty

# Main Worker (Chat)
wrangler tail epir-art-jewellery-worker --format pretty
```

### 4. Smoke Test (Automatic Verification)

```bash
cd workers/analytics-worker
./smoke-test.sh
```

This script sends test events with various `page_url` formats and provides verification commands. See `VERIFICATION.md` for detailed verification steps.

## 📚 Stan dokumentacji — uwaga

W repozytorium znajduje się wiele historycznych plików dokumentacyjnych (PR_*, REFACTORING_*, MCP_*, itp.), które mogą być nieaktualne lub wprowadzać w błąd. Aby ułatwić orientację, wszystkie podejrzane o nieaktualność pliki zostały zebrane w spisie: `docs/ARCHIVED_DOCS.md` oraz krótkim archiwum pod `docs/archive/`.

Zalecenie: przed usunięciem któregokolwiek z plików z archiwum wykonaj kopię zapasową i skonsultuj listę z zespołem. Pliki archiwalne pozostają w repozytorium, ale oznaczone jako historyczne.

Troubleshooting (częste problemy)
--------------------------------
### Błąd: "error code: 1042" lub "insert_failed"
- **Przyczyna 1:** `workers_dev = false` ale brak routes - worker niedostępny
- **Rozwiązanie:** Ustaw `workers_dev = true` w `wrangler.toml` i wdróż ponownie
- **Przyczyna 2:** Nazwa bazy D1 w `wrangler.toml` nie pasuje do rzeczywistej (użyj `wrangler d1 list`)
- **Rozwiązanie:** Popraw `database_name` na `jewelry-analytics-db`
- **Przyczyna 3:** Brak kolumn heatmap w tabeli `pixel_events`
- **Rozwiązanie:** Wykonaj migrację `schema-pixel-events-v3-heatmap.sql`

### Błąd: "Couldn't find a D1 DB with the name"
- **Przyczyna:** Nazwa w CLI nie odpowiada `database_name` w `wrangler.toml`
- **Rozwiązanie:** Sprawdź `[[d1_databases]]` - powinno być `jewelry-analytics-db`

### Błąd: "Unable to read SQL text file"
- **Przyczyna:** Uruchamiasz z złego katalogu
- **Rozwiązanie:** `cd workers\analytics-worker` i uruchom stamtąd

### Błąd: "You cannot add module... maximum number of 1 module allowed"
- **Przyczyna:** Shopify **ogranicza do 1 Theme App Extension** na aplikację
- **Rozwiązanie:** Połącz tracking.js z istniejącym Theme Extension (jak w `asystent-klienta`)

### Błąd: "Tag 'schema' is missing" w .liquid
- **Przyczyna:** Brak `{% schema %}` w Liquid block
- **Rozwiązanie:** Dodaj:
```liquid
{% schema %}
{
  "name": "Block Name",
  "target": "body",
  "settings": []
}
{% endschema %}
```

### Web Pixel nie zbiera custom events
- **Przyczyna:** Theme App Extension nie publikuje eventów lub brak wczytania tracking.js
- **Rozwiązanie:** 
  1. Sprawdź, czy `tracking.liquid` wczytuje `<script src="{{ 'tracking.js' | asset_url }}">`
  2. Włącz block w Theme Editor (Shopify Admin → Themes → Customize)
  3. Sprawdź Console przeglądarki: powinno być `[EPIR Tracking] initialized`

### page_url zapisuje się jako null w D1
- **Przyczyna:** Brak fallback extraction dla różnych formatów pola page_url (url, pageUrl, page_url, href)
- **Rozwiązanie:** Fixed in latest version - analytics worker now extracts page_url from multiple field naming conventions
- **Weryfikacja:** `wrangler d1 execute jewelry-analytics-db --remote --command="SELECT event_type, page_url FROM pixel_events WHERE page_url IS NOT NULL LIMIT 10;"`
- **Więcej informacji:** Zobacz `workers/analytics-worker/VERIFICATION.md`

## 🎯 Architektura Kompletna (Flow Diagram)

```
┌─────────────────────────────────────────────────────────────┐
│  STOREFRONT (Sklep Shopify)                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Theme App Extension: asystent-klienta               │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  1. tracking.js (DOM access)                        │   │
│  │     • document.addEventListener('click', ...)       │   │
│  │     • Shopify.analytics.publish('epir:click_with... │   │
│  │     • 4 custom events → Web Pixel                   │   │
│  │                                                     │   │
│  │  2. assistant.js (UI czatu AI)                      │   │
│  │     • Nasłuchuje 'epir:activate-chat'               │   │
│  │     • WebSocket do chat workera                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Web Pixel Extension: my-web-pixel (sandbox)         │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  • analytics.subscribe() x 26 eventów               │   │
│  │    - 16 standard (page_viewed, product_viewed...)   │   │
│  │    - 5 DOM (clicked, input_focused...)              │   │
│  │    - 4 custom (epir:click_with_position...)         │   │
│  │    - 1 error (ui_extension_errored)                 │   │
│  │  • fetch() → analytics-worker                       │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  CLOUDFLARE WORKERS                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  analytics-worker                                           │
│  ├─ POST /pixel                                             │
│  ├─ Ekstrahuje dane → 41 kolumn                            │
│  ├─ D1: pixel_events (base + heatmap)                      │
│  ├─ D1: customer_sessions (AI scoring)                     │
│  └─ Service Binding → AI_WORKER                            │
│                                                             │
│  chat-worker (epir-art-jewellery-worker)                   │
│  ├─ SessionDO (Durable Object)                             │
│  │  • Historia konwersacji (SQLite)                        │
│  │  • Cart tracking                                        │
│  │  • Product views (last 10)                             │
│  ├─ RAG Worker (Service Binding)                           │
│  │  └─ Shopify MCP → product catalog, cart, FAQ          │
│  └─ Groq API (gpt-oss-120b)                                │
│     • Streaming SSE responses                              │
│     • Tool calling (MCP tools)                             │
│                                                             │
│  D1 Database: epir_art_jewellery                           │
│  ├─ pixel_events (41 kolumn)                               │
│  └─ customer_sessions (AI analysis)                        │
└─────────────────────────────────────────────────────────────┘
``` 
## 🔗 Linki i Zasoby

- **Shopify Web Pixels API:** https://shopify.dev/docs/api/web-pixels-api
- **Theme App Extensions:** https://shopify.dev/docs/apps/build/online-store/theme-app-extensions
- **Cloudflare Workers:** https://developers.cloudflare.com/workers/
- **Durable Objects:** https://developers.cloudflare.com/durable-objects/
- **D1 Database:** https://developers.cloudflare.com/d1/

## 📝 Autorstwo i Kontakt

**Autor:** Krzysztof Dżugaj  
**Projekt:** EPIR Art Jewellery AI Assistant  
**Data:** Listopad 2025

### Propozycje Dalszego Rozwoju:
1. ✅ **Dodać testy integracyjne** - symulacja sekwencji eventów do analytics-worker
2. ✅ **Monitoring i alerting** - Sentry/Cloudflare Logs dla krytycznych błędów
3. ✅ **Dashboard analityczny** - wizualizacja heatmap i customer journey
4. ✅ **A/B testing** - warianty wiadomości AI dla optymalizacji konwersji
5. ✅ **Multi-language support** - rozszerzenie na inne języki (PL/EN/DE)

---

**Status Projektu:** ✅ Production Ready (Listopad 2025)  
**Wersja:** 1.0 - Full Analytics (25 events) + AI Chat

- **D1 Database** for analytics and conversation historyŚrodowisko i sekretne zmienne (ważne)

- **Vectorize** for FAQ/policy embeddings (fallback)------------------------------------

- `GROQ_API_KEY` — wymagane do wywołań Groq.

**Live URL:** https://asystent.epirbizuteria.pl/- `SHOP_DOMAIN` — domyślna domena sklepu (powinna być zgodna z ustawieniem kanonicznym powyżej).

- `SHOPIFY_STOREFRONT_TOKEN` — do wywołań Storefront/MCP (do MCP nie wymagane).

---- `SHOPIFY_ADMIN_TOKEN` — do fallbacków GraphQL (ustawić przez `wrangler secret put`).

- Durable Object bindings: `SESSION_DO`, `TOKEN_VAULT_DO`, `RATE_LIMITER_DO`.

## 🏗️ **Architecture**- `DB` (D1) i `VECTOR_INDEX` — opcjonalne (analityka i vector search).



### **Microservices (Cloudflare Workers)**Jak uruchomić lokalnie (PowerShell)

-----------------------------------

```1. Worker — tryb deweloperski

┌─────────────────────────────────────────────────────────────┐```powershell

│  FRONTEND (Shopify Theme Extension)                         │cd .\workers\worker

│  - Web Pixel: Tracks customer behavior                      │npm install

│  - Assistant UI: Chat interface                             │npm run dev    # uruchamia `wrangler dev`

└────────────┬────────────────────────────────────────────────┘```

             │

             ├─────────► Analytics Worker (epir-analityc-worker)2. Deploy Workera

             │           - Receives Web Pixel events```powershell

             │           - Stores to D1 (pixel_events table)cd .\workers\worker

             │           - Notifies Session DO on product viewsnpm run deploy # uruchamia `wrangler deploy`

             │```

             └─────────► Chat Worker (epir-art-jewellery-worker)

                         │3. Testy jednostkowe

                         ├─► Session DO (Durable Object)```powershell

                         │   - Conversation historycd .\workers\worker

                         │   - Cart tracking (cart_id, cart_logs)npm install

                         │   - Product view trackingnpm run test   # uruchamia Vitest

                         │```

                         ├─► RAG Worker (epir-rag-worker) [Service Binding]

                         │   │Uwaga dotycząca modyfikacji

                         │   ├─► MCP (Shopify API) [PRIMARY]---------------------------

                         │   │   - Product catalog- Ponieważ repo zawiera kilka jawnych, kanonicznych wartości (powyżej), każda zmiana tych wartości powinna być: przemyślana, skonsultowana i zatwierdzona.

                         │   │   - Cart operations- Jeśli potrzebujesz innej konfiguracji środowiska do testów/developu, zamiast modyfikować wartości kanoniczne, użyj lokalnych `wrangler.toml` override lub zmiennych środowiskowych w CI.

                         │   │   - Order status

                         │   │   - FAQ/policiesChcesz zmianę? Powiedz dokładnie co zmienić (np. przełączyć CANONICAL_MCP_URL na dynamiczne użycie `env.SHOP_DOMAIN`) — „niezmienność” można zrewidować po uzgodnieniu z właścicielem projektu.

                         │   │

                         │   └─► Vectorize [FALLBACK]Kontakt

                         │       - FAQ embeddings-------

                         │Jeśli potrzebujesz wyjaśnień lub autoryzacji na zmianę kanonicznych ustawień, skontaktuj się z właścicielem repozytorium/zespołem EPIRjewelry.

                         └─► Groq API (openai/gpt-oss-120b)

                             - Streaming responses*** EOF

                             - Tool calling support
```

### **Key Principles**

✅ **MCP as Primary Source** — Anti-hallucination strategy (Shopify MCP provides ground truth)  
✅ **Service Bindings** — Zero-cost inter-worker communication (Cloudflare Best Practices)  
✅ **Separation of Concerns** — Each worker has a single responsibility  
✅ **Observability** — Individual log streams per worker  

---

## 🚀 **Key Features**

### **1. Customer Behavior Tracking**
- **Web Pixel Integration**: Tracks `page_viewed`, `product_viewed`, `cart_updated`, `checkout_started`, `purchase_completed`
- **D1 Storage**: Structured columns (17 fields) matching Shopify Web Pixels API
- **Session DO Integration**: Real-time product view tracking (last 10 views)

### **2. AI-Powered Chat**
- **Groq LLM**: `openai/gpt-oss-120b` model (HARDCODED for prompt stability)
- **Streaming Responses**: Server-Sent Events (SSE) for real-time UI updates
- **Tool Calling**: MCP tools (search_shop_catalog, get_cart, update_cart, etc.)
- **Harmony-Style Parsing**: `<|call|>` / `<|end|>` markers for structured responses

### **3. MCP Orchestration**
- **RAG Worker**: Centralized MCP → Vectorize fallback logic
- **Intent Detection**: Automatic classification (search, cart, order, faq)
- **Retry Logic**: Exponential backoff for rate-limited MCP endpoints

### **4. Session Management**
- **Durable Objects**: SQLite-backed persistent sessions
- **Cart Tracking**: Stores last 50 cart actions per session
- **Rate Limiting**: 20 requests per 60s window (per session)

---

## 🔒 **Canonical Settings (IMMUTABLE)**

These values are **hardcoded** and should NOT be changed without team approval:

| Setting | Value | Location |
|---------|-------|----------|
| **SHOP_DOMAIN** | `epir-art-silver-jewellery.myshopify.com` | `workers/*/wrangler.toml` → `[vars]` |
| **CANONICAL_MCP_URL** | `https://epir-art-silver-jewellery.myshopify.com/api/mcp` | `workers/rag-worker/wrangler.toml` → `[vars]` |
| **GROQ_MODEL_ID** | `openai/gpt-oss-120b` | `workers/worker/src/ai-client.ts` (const) |
| **MAX_HISTORY** | `30` | `workers/worker/src/index.ts` (SessionDO) |
| **RATE_LIMIT_MAX_REQUESTS** | `20` | `workers/worker/src/index.ts` (SessionDO) |

**Why immutable?**
- Prompts and streaming parsers are calibrated for `gpt-oss-120b`
- MCP URL is public (no auth required), changing it breaks integration
- Rate limits prevent abuse of Groq API

---

## 📁 **Project Structure**

```
epir_asystent/
├── extensions/
│   ├── asystent-klienta/          # Shopify Theme Extension (Chat UI)
│   │   ├── assistant.liquid       # Main template
│   │   ├── assets/
│   │   │   ├── assistant.js       # Frontend logic (SSE, DOM)
│   │   │   └── assistant.css      # Styling
│   │   └── shopify.extension.toml
│   └── my-web-pixel/              # Shopify Web Pixel (Tracking)
│       └── src/index.ts           # Event subscriptions
├── workers/
│   ├── worker/                    # Main Chat Worker
│   │   ├── src/
│   │   │   ├── index.ts           # Routing + SessionDO
│   │   │   ├── ai-client.ts       # Groq API client (GROQ_MODEL_ID here)
│   │   │   ├── mcp_server.ts      # MCP JSON-RPC handler
│   │   │   ├── shopify-mcp-client.ts  # MCP tools + GraphQL fallback
│   │   │   ├── rag.ts             # RAG helpers (deprecated, use RAG Worker)
│   │   │   └── prompts/luxury-system-prompt.ts  # System prompt
│   │   ├── schema.sql             # D1 database schema
│   │   ├── schema-v2-migration.sql # Migration script (pixel_events v1→v2)
│   │   └── wrangler.toml          # Worker config + bindings
│   ├── analytics-worker/          # Web Pixel Event Handler
│   │   ├── src/index.ts           # POST /pixel endpoint
│   │   └── wrangler.toml          # Bindings: DB, SESSION_DO
│   ├── rag-worker/                # RAG Orchestrator (MCP + Vectorize)
│   │   ├── src/
│   │   │   ├── index.ts           # REST API (/context/build)
│   │   │   ├── domain/orchestrator.ts  # Intent detection + MCP/Vectorize logic
│   │   │   └── services/shopify-mcp.ts # MCP client
│   │   └── wrangler.toml          # Bindings: VECTOR_INDEX, AI, DB
│   └── ai-worker/                 # AI API Wrapper (fallback, rarely used)
│       ├── src/index.ts
│       └── wrangler.toml
├── README.md                      # This file
└── shopify.app.toml               # Shopify CLI config
```

---

## 🔐 **Environment Variables & Secrets**

### **Required Secrets (set via `wrangler secret put`)**

```powershell
# Groq API (REQUIRED)
wrangler secret put GROQ_API_KEY --env production

# Shopify Admin API (for GraphQL fallback)
wrangler secret put SHOPIFY_ADMIN_TOKEN --env production

# Shopify Storefront API (optional, MCP doesn't require auth)
wrangler secret put SHOPIFY_STOREFRONT_TOKEN --env production
```

### **Environment Variables (`wrangler.toml` → `[vars]`)**

| Variable | Description | Worker |
|----------|-------------|--------|
| `SHOP_DOMAIN` | Shopify store domain | All workers |
| `CANONICAL_MCP_URL` | MCP endpoint URL | RAG Worker |
| `ALLOWED_ORIGIN` | CORS allowed origin | Chat Worker |
| `WORKER_ORIGIN` | Worker URL (for internal calls) | Chat Worker |

### **Bindings**

| Binding | Type | Workers |
|---------|------|---------|
| `SESSION_DO` | Durable Object | Chat Worker, Analytics Worker |
| `RATE_LIMITER_DO` | Durable Object | Chat Worker |
| `TOKEN_VAULT_DO` | Durable Object | Chat Worker |
| `DB` | D1 Database | Chat Worker, Analytics Worker, RAG Worker |
| `VECTOR_INDEX` | Vectorize Index | Chat Worker, RAG Worker |
| `AI` | Cloudflare AI | Chat Worker, RAG Worker |
| `RAG_WORKER` | Service Binding | Chat Worker |
| `ANALYTICS` | Service Binding | Chat Worker |
| `AI_WORKER` | Service Binding | Chat Worker |

---

## 💻 **Development Workflow**

### **1. Local Development**

```powershell
# Chat Worker
cd .\workers\worker
npm install
npm run dev    # Runs wrangler dev (localhost:8787)

# RAG Worker
cd .\workers\rag-worker
npm install
npm run dev

# Analytics Worker
cd .\workers\analytics-worker
npm install
npm run dev
```

### **2. Testing**

```powershell
# Unit tests (Vitest)
cd .\workers\worker
npm run test

# Integration test (simulate chat request)
curl -X POST http://localhost:8787/chat `
  -H "Content-Type: application/json" `
  -d '{"message":"Jakie masz pierścionki?","session_id":"test-123"}'
```

### **3. Deployment**

```powershell
# Deploy all workers
cd .\workers\worker
npm run deploy

cd .\workers\analytics-worker
npm run deploy

cd .\workers\rag-worker
npm run deploy

cd .\workers\ai-worker
npm run deploy
```

---

## 🗄️ **Database Schema**

### **D1 Tables**

#### **1. `pixel_events` (Customer Behavior Tracking)**
```sql
CREATE TABLE pixel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Identifiers
  customer_id TEXT,
  session_id TEXT,
  
  -- Event metadata (Shopify standard)
  event_type TEXT NOT NULL,  -- 'product_viewed', 'page_viewed', etc.
  event_name TEXT,
  
  -- Product context
  product_id TEXT,
  product_handle TEXT,
  product_type TEXT,          -- e.g., 'pierścionek', 'Ring'
  product_vendor TEXT,
  product_title TEXT,
  variant_id TEXT,
  
  -- Cart context
  cart_id TEXT,
  
  -- Page context
  page_url TEXT,
  page_title TEXT,
  page_type TEXT,
  
  -- Raw event data (JSON)
  event_data TEXT,
  
  -- Timestamp
  created_at INTEGER NOT NULL
);
```

**Indexes:**
- `idx_pixel_customer` (customer_id, created_at)
- `idx_pixel_session` (session_id, created_at)
- `idx_pixel_product` (product_id, created_at)
- `idx_pixel_event_type` (event_type, created_at)
- `idx_pixel_created_at` (created_at)

#### **2. `conversations` (Chat History)**
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
```

#### **3. `messages` (Chat Messages)**
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
);
```

#### **4. `cart_actions` (Cart Analytics)**
```sql
CREATE TABLE cart_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  cart_id TEXT,
  action TEXT NOT NULL,        -- 'add', 'remove', 'update'
  details TEXT,                -- JSON
  created_at INTEGER NOT NULL
);
```

### **Durable Object Storage**

**SessionDO** stores (SQLite-backed):
- `history: HistoryEntry[]` — Last 30 chat messages
- `cart_id: string` — Shopify cart token
- `session_id: string` — Session identifier
- `cart_logs: CartAction[]` — Last 50 cart actions
- `product_views: ProductView[]` — Last 10 product views

---

## 📊 **Logging & Monitoring**

### **Individual Log Streams**

Each worker has **separate logs** in Cloudflare:

```powershell
# Real-time logs (CLI)
wrangler tail epir-art-jewellery-worker      # Chat Worker
wrangler tail epir-analityc-worker           # Analytics Worker
wrangler tail epir-rag-worker                # RAG Worker
wrangler tail epir-ai-worker                 # AI Worker
```

### **Log Prefixes (for easy filtering)**

| Worker | Prefix | Example |
|--------|--------|---------|
| Chat Worker | `[handleChat]` | `[handleChat] 🔍 RAG_WORKER: Delegating...` |
| Analytics Worker | `[ANALYTICS_WORKER]` | `[ANALYTICS_WORKER] ✅ Event stored` |
| RAG Worker | `[RAG_WORKER]` | `[RAG_WORKER/Orchestrator] 🛒 Cart intent` |
| Session DO | `[SessionDO]` | `[SessionDO] 👁️ Product view tracked` |

### **Cloudflare Dashboard**

1. Navigate to: **Workers & Pages** → `[Worker Name]` → **Logs**
2. Filter: `ScriptName == "epir-analityc-worker"`
3. View: Request logs, Console output, Errors

### **Observability Config (wrangler.toml)**

```toml
[observability]
enabled = true
[observability.logs]
enabled = true
head_sampling_rate = 1
invocation_logs = true
```

---

## 🚀 **Deployment**

### **Current Deployed Versions**

| Worker | Version ID | Status |
|--------|------------|--------|
| Chat Worker | `9cc19e45-aa9e-45f0-a87f-b5ce3d2ea7cd` | ✅ LIVE |
| Analytics Worker | `5fd46f70-9b36-4b39-8afd-155bcef93b84` | ✅ LIVE |
| RAG Worker | `e644ffb7-bdb7-4964-8358-f37144af33e2` | ✅ LIVE |
| AI Worker | (active) | ✅ LIVE |

### **Deployment Checklist**

1. ✅ Update `wrangler.toml` bindings if needed
2. ✅ Run `npm run test` (unit tests)
3. ✅ Deploy workers in order:
   - RAG Worker (dependency for Chat Worker)
   - Analytics Worker
   - Chat Worker
4. ✅ Verify logs: `wrangler tail [worker-name]`
5. ✅ Test live endpoint: https://asystent.epirbizuteria.pl/chat

### **Migration (D1 Schema Updates)**

```powershell
# Run migration script
cd .\workers\worker
npx wrangler d1 execute epir_art_jewellery --remote --file=schema-v2-migration.sql

# Verify migration
npx wrangler d1 execute epir_art_jewellery --remote --command "SELECT COUNT(*) FROM pixel_events"
```

---

## 🧪 **Testing**

### **Unit Tests (Vitest)**

```powershell
cd .\workers\worker
npm run test

# Watch mode
npm run test -- --watch
```

### **Integration Tests**

```powershell
# Test RAG Worker directly
curl -X POST https://epir-rag-worker.krzysztofdzugaj.workers.dev/context/build `
  -H "Content-Type: application/json" `
  -d '{"query":"polityka zwrotów","intent":"faq"}'

# Test Chat Worker
curl -X POST https://asystent.epirbizuteria.pl/chat `
  -H "Content-Type: application/json" `
  -d '{"message":"Jakie masz pierścionki?","session_id":"test-456"}'
```

### **Web Pixel Test**

1. Open Shopify storefront: https://epirbizuteria.pl
2. Navigate to product page
3. Check Analytics Worker logs:
   ```powershell
   wrangler tail epir-analityc-worker
   ```
4. Verify D1 insert:
   ```powershell
   npx wrangler d1 execute epir_art_jewellery --remote --command "SELECT * FROM pixel_events ORDER BY id DESC LIMIT 1"
   ```

---

## 📞 **Contact**

**Owner:** EPIRjewelry  
**Repository:** https://github.com/EPIRjewelry/epir_asystent

For questions about:
- **Canonical settings changes** → Contact repository owner
- **MCP integration** → See `workers/rag-worker/src/services/shopify-mcp.ts`
- **Groq model updates** → See `workers/worker/src/ai-client.ts` (HARDCODED)

---

## 📝 **Change Log**

### **2025-11-07 — Architecture Refactoring**
- ✅ Implemented **microservices pattern**: Chat Worker → RAG Worker (Service Binding)
- ✅ Migrated `pixel_events` table to **structured schema** (17 columns, Shopify API compliant)
- ✅ Added **Session DO product tracking** (`/track-product-view` endpoint)
- ✅ Integrated **Analytics Worker → Session DO** notification flow
- ✅ Configured **individual log streams** per worker (`[WORKER_NAME]` prefixes)
- ✅ Updated Wrangler to **4.46.0** across all workers

### **Previous Updates**
- Deployed 3-worker architecture (Chat, AI, RAG)
- Implemented SessionDO with cart tracking
- Added Vitest unit tests
- Configured D1 database with 4 tables

---

**Last Updated:** November 7, 2025  
**Architecture Version:** 2.0 (Microservices + Structured Tracking)

---

## 🛠️ Recent changes & priorities (12-11-2025)

Ten projekt jest aktywnie utrzymywany — poniżej znajdują się najnowsze zmiany i priorytety, które zostały wprowadzone lokalnie oraz wdrożone na cloudflare workerze (wersja z dnia 2025-11-12):

- Poprawka typowania TypeScript
  - Plik: `workers/worker/src/security.ts`
  - Opis: Zmieniono sygnaturę `verifyAppProxyHmac` na `Request<any, any>` aby zgadzać się z typami Cloudflare (`Request<CfHostMetadata, Cf>`) i wyeliminować błąd kompilacji TS2345. Zmiana nie modyfikuje logiki weryfikacji HMAC — tylko sygnaturę typu.

- Mitigacja hardkodowanego MCP endpoint (runtime resolution)
  - Plik: `workers/worker/src/rag.ts` (lokalnie zmodyfikowany)
  - Opis: Usunięto użycie kanonicznego, jawnie zakodowanego `CANONICAL_MCP_URL`. Zaimplementowano preferencję: najpierw próbuj worker-proxy / lokalnego end-pointu narzędzi MCP, a dopiero potem bezpośredni sklep (shop storefront MCP) jako fallback. Dodano debug logging pokazujący, które URL-e były próbowane oraz status odpowiedzi — ułatwi to śledzenie, dlaczego zapisy wiedzy (Knowledge Base) mogły nie być widoczne.

- Wdrożenie
  - Worker: `epir-art-jewellery-worker` został wdrożony (Current Version ID: e3a06b22-0c6b-42ac-8f79-b0ce943f6f43).
  - Akcja: Po poprawce typowania uruchomiono `npx tsc --noEmit` (kompilacja: PASS) i `wrangler deploy` (deploy: PASS).

- Priorytety krótkoterminowe
  1. Sprawdzić runtime logs (`wrangler tail`) i potwierdzić, że zapisy do DO/D1 występują przy rzeczywistych requestach App Proxy.
  2. Dodać integracyjne testy symulujące MCP 429/5xx aby upewnić się, że fallback i retry działają poprawnie.
  3. Utworzyć PR z tymi drobnymi poprawkami (typy + dokumentacja) i krótkim changelogiem dla zespołu.

- Next steps (zalecane)
  - Uruchomić tail logów i przeprowadzić kontrolowane testy frontendowe (wywołania App Proxy → worker) aby zweryfikować, czy interakcje czatu są zapisywane w KB/D1.
  - Jeśli logi pokażą brak zapisu, zbadać: autoryzację MCP (tokeny), 429/ratelimit oraz zmiany commitów z końca października 2025 (które wcześniej wprowadziły kanoniczny endpoint).

Jeśli chcesz, mogę od razu uruchomić tail logów i zebrać pierwsze dowody (kilka próbek SSE / MCP callów). Możemy też przygotować PR z tą dokumentacją i kodowymi poprawkami.

---

## 🚀 MCP-Based RAG Orchestration (New Feature)

### Przegląd

Nowa funkcjonalność implementuje MCP-based RAG (Retrieval-Augmented Generation) orchestration z serverless backend na Cloudflare Workers:

- **System prompt oparty na MCP** — instrukcje dla AI do używania MCP jako źródła prawdy
- **SessionDO** — zarządzanie sesjami czatu z historią wiadomości i metadanymi
- **HMAC weryfikacja** — bezpieczna walidacja requestów z Shopify App Proxy
- **MCP fetcher** — klient JSON-RPC do Shopify MCP endpoint
- **Chat handler** — orkiestracja: HMAC → MCP → RAG → LLM → SessionDO
- **Prompt audit** — skrypt walidujący jakość promptów

### Konfiguracja Secrets

```bash
cd workers/worker

# Wymagany secret
wrangler secret put GROQ_API_KEY
# Wprowadź swój klucz API z https://console.groq.com/keys

# Opcjonalne secrets (dla HMAC i MCP auth)
wrangler secret put SHOPIFY_SHARED_SECRET
# Wprowadź shared secret z Shopify Partner Dashboard

wrangler secret put SHOPIFY_ADMIN_TOKEN
# Wprowadź Admin API access token dla uwierzytelnionych requestów MCP
```

### Uruchamianie Lokalnie

```bash
cd workers/worker

# Instalacja zależności
npm install

# Uruchom dev server
wrangler dev
```

### Testowanie

#### 1. Audit Promptów

```bash
# Z głównego katalogu repo
node tools/prompt_audit.mjs

# Lub z tsx (jeśli zainstalowane)
npx tsx tools/prompt_audit.mjs
```

Oczekiwany output: Wszystkie prompty powinny przejść z minimalnymi ostrzeżeniami.

#### 2. Test Chat Endpoint

```bash
# Nowa sesja (bez HMAC w trybie dev z DEV_BYPASS=1)
curl -X POST http://localhost:8787/apps/assistant/chat \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Shop-Domain: epir-art-silver-jewellery.myshopify.com" \
  -d '{
    "message": "Co to jest polityka zwrotów?",
    "sessionId": "test_session_1"
  }'
```

Oczekiwana odpowiedź:
```json
{
  "reply": "Dziękuję za pytanie...",
  "sources": [
    {
      "text": "...",
      "score": 0.95,
      "source": "FAQ: Return Policy"
    }
  ],
  "sessionId": "test_session_1"
}
```

#### 3. Test SessionDO

```bash
# Zapisz wiadomość
curl -X POST http://localhost:8787/session/test_session_1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "role": "user",
    "content": "Witaj!",
    "timestamp": 1702500000000
  }'

# Pobierz wiadomości
curl http://localhost:8787/session/test_session_1/messages

# Liczba wiadomości
curl http://localhost:8787/session/test_session_1/count
```

### Scenariusze Testowe

#### Scenariusz 1: Nowy Klient
- Wyślij wiadomość bez `sessionId`
- Sprawdź, czy nowy ID sesji jest generowany
- Sprawdź, czy wiadomość jest zapisana w SessionDO
- Sprawdź, czy odpowiedź zawiera źródła z MCP

#### Scenariusz 2: Powracający Klient
- Wyślij wiadomość z istniejącym `sessionId`
- Sprawdź, czy historia rozmów jest pobierana
- Sprawdź, czy nowe wiadomości są dodawane
- Sprawdź, czy metadane sesji są zachowane

#### Scenariusz 3: Brak Wyników z MCP
- Wyślij zapytanie, na które MCP nie może odpowiedzieć (np. "Jaka jest pogoda?")
- Sprawdź graceful fallback (brak źródeł)
- Sprawdź, czy odpowiedź jest nadal generowana

#### Scenariusz 4: Weryfikacja HMAC
- Ustaw `DEV_BYPASS=0` w `.dev.vars`
- Wyślij request bez HMAC → oczekuj 401 Unauthorized
- Wyślij request z poprawnym HMAC → oczekuj 200 OK

### Pliki i Struktura

```
workers/worker/src/
├── prompts/
│   └── epir_mcp_system_prompt.ts    # System prompt dla MCP-RAG
├── durable_objects/
│   └── session_do.ts                 # SessionDO z zarządzaniem wiadomościami
├── handlers/
│   ├── mcp_fetcher.ts                # Klient JSON-RPC dla MCP
│   └── chat_handler.ts               # Główny handler dla /chat endpoint

tools/
└── prompt_audit.ts                   # Skrypt auditujący prompty

.github/
└── PULL_REQUEST_TEMPLATE.md          # Szablon PR
```

### TODOs i Placeholdery

Następujące integracje są oznaczone jako TODO/PLACEHOLDER:

1. **Groq LLM Client** — w `chat_handler.ts` jest placeholder dla wywołania Groq API
2. **Vectorize/Embeddings** — w `chat_handler.ts` jest TODO dla semantic search z Cloudflare AI
3. **D1 Archival** — w `session_do.ts` jest placeholder dla archiwizacji starych wiadomości do D1

Te integracje są celowo pozostawione jako placeholdery, aby PR skupiał się na podstawowej strukturze MCP-RAG orchestration.

### Bezpieczeństwo

✅ **Brak sekretów w kodzie**
- Wszystkie sekrety są przekazywane przez zmienne środowiskowe lub `wrangler secrets`
- Weryfikacja HMAC zapobiega manipulacji requestów
- PII consent wymuszony w system prompt
- Rate limiting w SessionDO zapobiega nadużyciom

### Przyszłe Prace

Ten PR ustanawia fundament dla MCP-based RAG orchestration. Przyszłe PRy powinny rozwiązać:

1. Integracja Groq LLM (zamiana placeholdera)
2. Integracja Vectorize (semantic search z embeddings)
3. Archiwizacja D1 (przeniesienie starych wiadomości z SessionDO do D1)
4. Streaming responses (SSE dla odpowiedzi LLM)
5. Advanced RAG (hybrydowe wyszukiwanie: MCP + Vectorize + keyword)
6. Analytics (tracking trafności passages i satysfakcji użytkowników)
