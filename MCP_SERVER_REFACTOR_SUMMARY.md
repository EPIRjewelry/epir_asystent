# Podsumowanie: Refactor MCP Server (Plan A & Plan B)

> ARCHIWALNE — NIEAKTUALNE

Oryginalna treść tego dokumentu została przeniesiona do `docs/archive/MCP_SERVER_REFACTOR_SUMMARY.md`.

Zachowano kopię oryginału w katalogu `docs/archive/`. Jeśli dokument powinien pozostać aktywny, zaktualizuj go w archiwum i przywróć tutaj.
---

## Zmienione Pliki

### 1. `workers/worker/src/mcp_server.ts`
**Co zmieniłem**:
- Dodał architekturę dokumentacji (Plan A/B)
- Funkcja `callShopMcp()` — delegowanie do `https://{shop_domain}/api/mcp` z 5s timeoutem
- Fallback dla `search_shop_catalog`: 522/503/timeout → puste produkty + system_note
- Uprościł logowanie: `[mcp] call { tool, status, args_summary, timestamp }`
- Usunął wszystkie fallbacki na Storefront/Admin API
- `handleToolsCall()` — uproszczone wołania callShopMcp, żaden try-catch
- `callMcpToolDirect()` — wrapper dla wywołań wewnętrznych (index.ts, rag.ts)

**Efekt**: Nigdy nie ma 401 z Storefront API. AI zawsze dostaje bezpieczną odpowiedź.

### 2. `workers/worker/src/shopify-mcp-client.ts`
**Co zmieniłem**:
- Usunął import `adminGraphql` i `ShopifyEnv`
- Funkcja `callShopifyMcpTool()` — 5s timeout, fallback dla search_shop_catalog
- `updateCart()`, `getCart()`, `getOrderStatus()`, `getMostRecentOrderStatus()` — usunął fallbacki GraphQL
- Wszystkie funkcje teraz delegują wyłącznie do MCP sklepu

**Efekt**: Klient MCP jest czysty i prosty, bez zależności od tokenów Storefront.

### 3. `workers/worker/src/mcp.ts`
**Co zmieniłem**:
- `searchProductCatalog()` — wołaj `callShopifyMcpTool()` zamiast Storefront API
- `getShopPolicies()` — wołaj `callShopifyMcpTool()` zamiast Admin API
- Domyślny `context: 'biżuteria'` dla search_shop_catalog

**Efekt**: Produkt/polityki idą przez oficjalny MCP, nie przez API.

### 4. `workers/worker/src/rag.ts`
**Co zmieniłem**:
- Usunął hardcoded `CANONICAL_MCP_URL`
- Dodał `mcpEndpointForShop(shopDomain)` — dynamiczny builder URL
- `searchProductCatalogWithMCP()` — 5s timeout, fallback na timeout/network error, domyślny context
- Fallback zwraca `JSON.stringify(CATALOG_FALLBACK)`

**Efekt**: RAG używa dynamicznego endpoint, bez twardych domen.

### 5. `workers/worker/src/rag-client-wrapper.ts`
**Co zmieniłem**:
- Usunął hardcoded shop domain w fallbacku (`'epir-art-silver-jewellery.myshopify.com'`)
- Teraz używa `env.SHOP_DOMAIN || ''`

**Efekt**: Konfiguracja pochodzi z env, nie z kodu.

### 6. `workers/worker/src/mcp_tools.ts`
**Co zmieniłem**:
- Dodał `context` jako wymagany parametr dla `search_shop_catalog`
- Schema: `required: ['query', 'context']`

**Efekt**: Llama zawsze wysyła context dla wyszukiwania.

---

## Architektura (Wizualnie)

```
┌─────────────────────────────────────────────────────────────┐
│                  App Proxy (Shopify)                        │
│                   /apps/assistant/mcp                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ HMAC signed
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                 Worker Origin (Cloudflare)                  │
│                  POST /mcp/tools/call                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ↓
                  callShopMcp(env, toolName, args)
                           │
                           ├─ SHOP_DOMAIN from env
                           ├─ Normalize args (context, first)
                           ├─ Timeout: 5s AbortController
                           └─ Fetch https://{shop_domain}/api/mcp (JSON-RPC 2.0)
                           │
                    ┌──────┴──────────────────┐
                    │                         │
                   ✅ 200 OK                 ❌ Error (522/503/timeout)
                    │                         │
         Return result from MCP      Return fallback (search only)
         │                              │
         └─ callMcpToolDirect()      CATALOG_FALLBACK {
         └─ AI processes                 "products": [],
                                         "system_note": "..."
                                      }
                                      │
                                      └─ AI responds: "niedostępny"
```

---

## Tests & Verification

Stworzył plik: `MCP_SERVER_VERIFICATION.md`

Zawiera:
- Test curl dla `/mcp/tools/list`
- Test curl dla `/mcp/tools/call` z search_shop_catalog
- Scenariusze błędów (522, timeout)
- Checklist weryfikacji
- Deploy instrukcje

---

## Bezpieczeństwo & Conformance

✅ **Bez fallbacków na Storefront API** — zmniejsza złożoność, unika problemów z tokenami
✅ **5s timeout** — szybki fallback, unika timeoutów Cloudflare (30s)
✅ **Graceful degradation** — AI dostaje informację, nie crash
✅ **Minimalne logowanie** — narzędzie, status, argumenty (bez danych użytkownika)
✅ **JSON-RPC 2.0** — zgodne z spec
✅ **HMAC verification** — App Proxy requests są podpisane
✅ **Rate limiting** — chronione przed abuse

---

## Wdrożenie

```bash
cd workers/worker
npm install  # Jeśli potrzeba
wrangler deploy
```

## Weryfikacja

```bash
# Test Origin
curl -X POST http://localhost:8787/mcp/tools/list \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Oczekiwany wynik: 200 OK + lista tools
```

## Status

🟢 **Architektura gotowa**
🟡 **Wdrożenie pending** (wrangler deploy)
🟡 **Testy integracyjne pending** (App Proxy config na Shopify)

---

## Notatki

1. **Fallback TYLKO dla search_shop_catalog**: To jedyne narzędzie, które nie ma bezpośredniego powodu do crasha, jeśli sklep MCP nie odpowiada. Inne narzędzia (cart, order) zwracają błąd JSON-RPC.

2. **Timeout 5s**: Wybrany empirycznie. Wystarczająco krótki, aby AI czekał mniej, ale wystarczająco długi dla normalnych zapytań.

3. **Brak Storefront fallback**: Przywołuje ducha czystej architektury — jeśli sklep MCP nie żyje, sklep jest niedostępny. Nie próbujemy "ratować" z innym API, bo to tylko pogorszy sytuację (401, token timeout, etc.).

4. **Streaming w index.ts**: Bez zmian. `callMcpToolDirect()` zwraca `{ result }` lub `{ error }`, które trafiają do streamu SSE.
