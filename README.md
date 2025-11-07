# EPIR Assistant (epir_asystent)README — EPIR Assistant (epir_asystent)



AI-driven Shopify assistant for EPIR Art Jewellery — microservices architecture with Cloudflare Workers, MCP integration, and real-time customer behavior tracking.Krótkie streszczenie

-------------------

---To repozytorium zawiera rozszerzenie Shopify (UI) oraz backend Cloudflare Worker obsługujący asystenta sklepu EPIR.



## 📋 **Table of Contents**Ustawienia kanoniczne (NIEZMIENNE)

---------------------------------

1. [Overview](#overview)Te ustawienia i wartości w repo są traktowane jako kanoniczne i nie powinny być zmieniane bez uprzedniej zgody zespołu:

2. [Architecture](#architecture)

3. [Key Features](#key-features)- SHOP_DOMAIN: epir-art-silver-jewellery.myshopify.com

4. [Canonical Settings (IMMUTABLE)](#canonical-settings-immutable)  - Gdzie: `workers/worker/wrangler.toml` (pole `SHOP_DOMAIN`) oraz `workers/worker/src/*` wykorzystują `env.SHOP_DOMAIN`.

5. [Project Structure](#project-structure)

6. [Environment Variables & Secrets](#environment-variables--secrets)- CANONICAL_MCP_URL: https://epir-art-silver-jewellery.myshopify.com/api/mcp

7. [Development Workflow](#development-workflow)  - Gdzie: `workers/worker/src/rag.ts` definiuje `CANONICAL_MCP_URL` używane przez RAG.

8. [Database Schema](#database-schema)  - Uwagi: Kod ogólnie konstruuje MCP URL z `env.SHOP_DOMAIN` (np. `https://{shop}/api/mcp`). Jednak w repo występuje jawny canonical URL — traktuj go jako źródło prawdy.

9. [Logging & Monitoring](#logging--monitoring)

10. [Deployment](#deployment)- Model LLM (HARDCODED): `openai/gpt-oss-120b`

11. [Testing](#testing)  - Gdzie: `workers/worker/src/ai-client.ts` w stałej `GROQ_MODEL_ID`.

12. [Contact](#contact)  - UWAGA: Prompty, parsowanie streamingu i ogólny kontrakt są zaprojektowane dla tego modelu — nie modyfikuj wartości bez autoryzacji.



---Kluczowe pliki i ich rola

-------------------------

## 🎯 **Overview**- `extensions/asystent-klienta/` — frontend rozszerzenia Shopify (UI, assets).

- `workers/worker/src/index.ts` — główny routing Workera i `SessionDO` (Durable Object) przechowujący historię sesji i `cart_id`.

EPIR Assistant is a production-grade AI chatbot integrated with Shopify, built using:- `workers/worker/src/mcp_server.ts` i `workers/worker/src/mcp/tool_schema.ts` — warstwa narzędzi (MCP) i schematy funkcji.

- **Cloudflare Workers** (microservices architecture)- `workers/worker/src/shopify-mcp-client.ts` — klient MCP / fallback do GraphQL (Admin/Storefront).

- **Shopify MCP** (Merchant Component Platform) as primary data source- `workers/worker/src/ai-client.ts` — klient Groq (streaming/non-streaming). Zawiera HARDCODED `GROQ_MODEL_ID`.

- **Groq API** (`openai/gpt-oss-120b` model)- `workers/worker/src/rag.ts` — RAG helpers i stały `CANONICAL_MCP_URL`.

- **Durable Objects** for session management

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
