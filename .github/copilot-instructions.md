# Copilot instructions for EPIR Assistant (epir_asystent)

This file is a compact, actionable guide to help AI coding agents be immediately productive in this repository.

Overview
- Purpose: an AI-driven Shopify assistant (EPIR) implemented as a Shopify extension + Cloudflare Workers backend.
- Two main parts:
  - `extensions/` — Shopify app & extension assets (assistant UI: `extensions/asystent-klienta/*`).
  - `workers/worker/src` — Cloudflare Worker backend: session Durable Object, MCP orchestration, RAG helpers, Groq client.

# Instrukcje Copilot dla EPIR Assistant (epir_asystent)

Krótki, praktyczny przewodnik pomagający agentom AI szybko pracować nad tym repozytorium.

Przegląd
- Cel: asystent sklepu Shopify (EPIR) — UI jako rozszerzenie Shopify oraz backend jako Cloudflare Worker.
- Dwa główne obszary:
  - `extensions/` — assets rozszerzenia Shopify (UI asystenta w `extensions/asystent-klienta/*`).
  - `workers/worker/src` — backend Cloudflare Worker: Durable Object sesji, orkiestracja MCP, RAG, klient Groq.

Kluczowa architektura i kontrakty
- Session DO: `workers/worker/src/index.ts` — klasa `SessionDO` przechowuje historię rozmów, `cart_id` i metadane sesji. Interfejsy wewnętrzne: `/append`, `/history`, `/set-cart-id`, `/end`, itp.
- Token Vault: `workers/worker/src/token-vault.ts` — tworzy anonimowe tokeny klienta (używane w `handleChat` i bound jako `TOKEN_VAULT_DO`).
- Warstwa narzędzi (MCP): `workers/worker/src/mcp_server.ts` implementuje JSON-RPC 2.0 (metoda `tools/call`) oraz funkcję pomocniczą `callMcpToolDirect`. Schematy narzędzi generowane są przez `workers/worker/src/mcp/tool_schema.ts` — korzystaj z nich do przygotowania `tool_call`.
- Integracja z Shopify: preferuj MCP sklepu (`https://{shop}/api/mcp`) za pomocą `shopify-mcp-client.ts`. Jeśli MCP nie działa, plik zawiera fallback do Admin/Storefront GraphQL dla `getCart`, `updateCart`, zamówień.
- Klient LLM: `workers/worker/src/ai-client.ts` obsługuje wszystkie wywołania Groq (streaming i non-stream). WAŻNE: `GROQ_MODEL_ID` jest HARDO-CODED i nie zmieniaj go bez konta/zgody.
- Prompt / kontrakt agenta: `workers/worker/src/prompts/luxury-system-prompt.ts` definiuje format odpowiedzi — agent MUSI zwrócić dokładnie jeden z kształtów JSON: { reply } OR { tool_call } OR { error }.

Ważne wzorce i zasady projektowe (repo-specyfic)
- Kontrakt JSON (egzekwowany przez prompt): zwróć dokładnie jeden z:
  - { "reply": "..." }
  - { "tool_call": { "name": "...", "arguments": {...} } }
  - { "error": "..." }
  Nie wysyłaj surowego tekstu poza tymi kształtami w ścieżce asystenta.
- Narzędzia: zawsze używaj `generateMcpToolSchema()` (w `mcp/tool_schema.ts`) do pobrania poprawnych sygnatur funkcji (np. `search_shop_catalog`, `get_cart`, `update_cart`). Waliduj argumenty przed wysłaniem.
- Streaming: `ai-client.ts` udostępnia `streamGroqResponse` i `streamGroqHarmonyEvents`. Parsowanie „Harmony-style” (znaczniki <|call|> / <|end|>) realizuje `createHarmonyTransform()`; używaj tego przy implementacji streamingu narzędzi.
- Sekrety i bindingi środowiskowe (używane w `workers/worker/src/index.ts`):
  - GROQ_API_KEY (wymagany)
  - SHOP_DOMAIN (polecany)
  - SHOPIFY_STOREFRONT_TOKEN (do wywołań Storefront/MCP)
  - SHOPIFY_ADMIN_TOKEN (fallback/admin GraphQL)
  - SESSION_DO, TOKEN_VAULT_DO, RATE_LIMITER_DO (Durable Object bindings)
  - DB (D1) i VECTOR_INDEX (opcjonalny index wektorowy)
  Ustawiaj sekrety przy pomocy `wrangler secret put` i zmienne `vars` w `wrangler.toml`.

Workflow deweloperskie (jak uruchomić, testy, deploy)
- Lokalny development Workera (PowerShell):
  ```powershell
  cd .\workers\worker
  npm install
  npm run dev    # uruchamia `wrangler dev`
  ```
- Deployment Workera:
  ```powershell
  cd .\workers\worker
  npm run deploy # uruchamia `wrangler deploy`
  ```
- Testy jednostkowe (Vitest):
  ```powershell
  cd .\workers\worker
  npm install
  npm run test
  ```
- Sekrety: `wrangler secret put GROQ_API_KEY`, `wrangler secret put SHOPIFY_ADMIN_TOKEN`, itd.; `SHOP_DOMAIN` jako var w `wrangler.toml`.

Gdzie szukać zmian i co sprawdzić przy modyfikacjach
- Routing i przepływ chat: `workers/worker/src/index.ts` (funkcja `handleChat`, streamAssistantResponse, szybkie odpowiedzi powitalne).
- Orkiestracja narzędzi i RPC: `workers/worker/src/mcp_server.ts` i `workers/worker/src/mcp/tool_schema.ts`.
- Shopify MCP i fallbacky GraphQL: `workers/worker/src/shopify-mcp-client.ts`.
- Klient Groq i parser strumieniowy: `workers/worker/src/ai-client.ts` (logowanie usage i kosztów jeśli podane stawki).
- System prompt i kontrakt: `workers/worker/src/prompts/luxury-system-prompt.ts` — stosuj go bez modyfikacji formatu odpowiedzi.

Szybkie wskazówki integracyjne dla agentów AI
- Zawsze odczytuj `generateMcpToolSchema()` przed przygotowaniem `tool_call` — tam są szczegóły pól (np. `search_shop_catalog` oczekuje `query` jako obiekt z `type`, opcjonalnie `metal`, `stones`).
- Jeśli zmieniasz kształt prompta lub wywołań modelu, sprawdź, czy `GROQ_MODEL_ID` i streaming helpers w `ai-client.ts` pozostają kompatybilne.
- Dla modyfikacji związanych z Shopify zawsze próbuj użyć MCP (`/api/mcp`) — `callShopifyMcpTool` centralizuje ten flow i zawiera fallbacky do GraphQL.


Chcesz rozszerzyć tę instrukcję? Napisz które sekcje rozwinąć (przykłady `tool_call`, testy jednostkowe, stubowanie Groq, przykładowe prompty).

Powiązany README i uwaga o niezmienności
---------------------------------------
- Zobacz także `README.md` w katalogu głównym repo — zawiera listę ustawień kanonicznych (np. `SHOP_DOMAIN`, `CANONICAL_MCP_URL`, `GROQ_MODEL_ID`) i instrukcje uruchomienia.
- WAŻNE: Ta zmiana ma charakter wyłącznie dokumentacyjny. Nie modyfikuj kodu ani wartości konfiguracyjnych w plikach źródłowych podczas edycji tego pliku. Jeśli potrzebna jest zmiana kanonicznych ustawień, najpierw uzyskaj zgodę właściciela repozytorium i wprowadź zmianę formalnie (issue/PR).

Gdy chcesz, mogę automatycznie dodać krótki przykład `tool_call` lub przykładowy test Vitest do repo, ale nie dokonam żadnych zmian w kodzie bez Twojego potwierdzenia.
