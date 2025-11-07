README — EPIR Assistant (epir_asystent)

Krótkie streszczenie
-------------------
To repozytorium zawiera rozszerzenie Shopify (UI) oraz backend Cloudflare Worker obsługujący asystenta sklepu EPIR.

Ustawienia kanoniczne (NIEZMIENNE)
---------------------------------
Te ustawienia i wartości w repo są traktowane jako kanoniczne i nie powinny być zmieniane bez uprzedniej zgody zespołu:

- SHOP_DOMAIN: epir-art-silver-jewellery.myshopify.com
  - Gdzie: `workers/worker/wrangler.toml` (pole `SHOP_DOMAIN`) oraz `workers/worker/src/*` wykorzystują `env.SHOP_DOMAIN`.

- CANONICAL_MCP_URL: https://epir-art-silver-jewellery.myshopify.com/api/mcp
  - Gdzie: `workers/worker/src/rag.ts` definiuje `CANONICAL_MCP_URL` używane przez RAG.
  - Uwagi: Kod ogólnie konstruuje MCP URL z `env.SHOP_DOMAIN` (np. `https://{shop}/api/mcp`). Jednak w repo występuje jawny canonical URL — traktuj go jako źródło prawdy.

- Model LLM (HARDCODED): `openai/gpt-oss-120b`
  - Gdzie: `workers/worker/src/ai-client.ts` w stałej `GROQ_MODEL_ID`.
  - UWAGA: Prompty, parsowanie streamingu i ogólny kontrakt są zaprojektowane dla tego modelu — nie modyfikuj wartości bez autoryzacji.

Kluczowe pliki i ich rola
-------------------------
- `extensions/asystent-klienta/` — frontend rozszerzenia Shopify (UI, assets).
- `workers/worker/src/index.ts` — główny routing Workera i `SessionDO` (Durable Object) przechowujący historię sesji i `cart_id`.
- `workers/worker/src/mcp_server.ts` i `workers/worker/src/mcp/tool_schema.ts` — warstwa narzędzi (MCP) i schematy funkcji.
- `workers/worker/src/shopify-mcp-client.ts` — klient MCP / fallback do GraphQL (Admin/Storefront).
- `workers/worker/src/ai-client.ts` — klient Groq (streaming/non-streaming). Zawiera HARDCODED `GROQ_MODEL_ID`.
- `workers/worker/src/rag.ts` — RAG helpers i stały `CANONICAL_MCP_URL`.

Środowisko i sekretne zmienne (ważne)
------------------------------------
- `GROQ_API_KEY` — wymagane do wywołań Groq.
- `SHOP_DOMAIN` — domyślna domena sklepu (powinna być zgodna z ustawieniem kanonicznym powyżej).
- `SHOPIFY_STOREFRONT_TOKEN` — do wywołań Storefront/MCP (do MCP nie wymagane).
- `SHOPIFY_ADMIN_TOKEN` — do fallbacków GraphQL (ustawić przez `wrangler secret put`).
- Durable Object bindings: `SESSION_DO`, `TOKEN_VAULT_DO`, `RATE_LIMITER_DO`.
- `DB` (D1) i `VECTOR_INDEX` — opcjonalne (analityka i vector search).

Jak uruchomić lokalnie (PowerShell)
-----------------------------------
1. Worker — tryb deweloperski
```powershell
cd .\workers\worker
npm install
npm run dev    # uruchamia `wrangler dev`
```

2. Deploy Workera
```powershell
cd .\workers\worker
npm run deploy # uruchamia `wrangler deploy`
```

3. Testy jednostkowe
```powershell
cd .\workers\worker
npm install
npm run test   # uruchamia Vitest
```

Uwaga dotycząca modyfikacji
---------------------------
- Ponieważ repo zawiera kilka jawnych, kanonicznych wartości (powyżej), każda zmiana tych wartości powinna być: przemyślana, skonsultowana i zatwierdzona.
- Jeśli potrzebujesz innej konfiguracji środowiska do testów/developu, zamiast modyfikować wartości kanoniczne, użyj lokalnych `wrangler.toml` override lub zmiennych środowiskowych w CI.

Chcesz zmianę? Powiedz dokładnie co zmienić (np. przełączyć CANONICAL_MCP_URL na dynamiczne użycie `env.SHOP_DOMAIN`) — „niezmienność” można zrewidować po uzgodnieniu z właścicielem projektu.

Kontakt
-------
Jeśli potrzebujesz wyjaśnień lub autoryzacji na zmianę kanonicznych ustawień, skontaktuj się z właścicielem repozytorium/zespołem EPIRjewelry.

*** EOF
