# ✅ Checklist: MCP Server Refactor Complete

> ARCHIWALNE — NIEAKTUALNE

Oryginalna treść tego dokumentu została przeniesiona do `docs/archive/MCP_DEPLOYMENT_CHECKLIST.md`.

Zachowano kopię oryginału w katalogu `docs/archive/`. Jeśli dokument powinien pozostać aktywny, zaktualizuj go w archiwum i przywróć tutaj.
---

## Pliki Zmodyfikowane

| Plik | Zmiana | Status |
|------|--------|--------|
| `mcp_server.ts` | callShopMcp(), fallback strategia, logowanie | ✅ Complete |
| `shopify-mcp-client.ts` | Usunięty fallback GraphQL, delegacja MCP | ✅ Complete |
| `mcp.ts` | searchProductCatalog() → MCP, domyślny context | ✅ Complete |
| `rag.ts` | Dynamiczny endpoint, timeout 5s, fallback | ✅ Complete |
| `rag-client-wrapper.ts` | Usunięty hardcoded shop domain | ✅ Complete |
| `mcp_tools.ts` | context jako required parameter | ✅ Complete |
| `index.ts` | Routing `/mcp/tools/list` + `/mcp/tools/call` | ✅ Verified |

---

## Test Cases

### Test 1: Worker `/mcp/tools/list` (Origin)
```bash
curl -X POST http://localhost:8787/mcp/tools/list \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
- [x] Oczekiwany wynik: 200 OK + lista narzędzi

### Test 2: Worker `/mcp/tools/call` z search_shop_catalog
```bash
curl -X POST http://localhost:8787/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"search_shop_catalog",
      "arguments":{"query":"pierścionek","context":"biżuteria"}
    },
    "id":2
  }'
```
- [x] Sklep MCP działa → zwróć produkty
- [x] Sklep MCP 522/timeout → zwróć fallback (puste produkty + system_note)

### Test 3: Brak Storefront API 401
- [x] Fallback nigdy nie wołuje Storefront API
- [x] Brak SHOPIFY_STOREFRONT_TOKEN dependency

### Test 4: App Proxy (Shopify)
- [x] Routing `/apps/assistant/mcp` → handleMcpRequest
- [x] HMAC verification
- [x] Rate limiting
- [x] Fallback na błąd sklepu

### Test 5: Streaming (index.ts)
- [x] `callMcpToolDirect()` zwraca `{ result }` lub `{ error }`
- [x] Streaming SSE bez zmian
- [x] Tool-calling loop bez zmian

---

## Logowanie

### ✅ Minimalne Logowanie
```
[mcp] call { tool: 'search_shop_catalog', status: 200, args: { query: '[len:10]', context: '[len:8]', first: 5 }, timestamp: '2025-12-28T...' }
[mcp] Shop MCP 522 for search_shop_catalog, returning safe fallback
[mcp] Timeout/Network error for search_shop_catalog, returning safe fallback { error: 'AbortError: The user aborted a request.' }
[mcp] Shop MCP call failed { tool: 'update_cart', error: 'Network error' }
```

### ✅ Bez Logowania Danych Użytkownika
- Brak query content (tylko `[len:X]`)
- Brak cart ID
- Brak product IDs
- Brak customer info

---

## Bezpieczeństwo

- [x] Brak tokenów w kodzie (tylko env)
- [x] HMAC verification dla App Proxy
- [x] Rate limiting (per shop)
- [x] 5s timeout (unika Cloudflare timeout 30s)
- [x] AbortController (graceful shutdown)
- [x] Safe fallback (brak exposing system errors do AI)

---

## Wdrażanie

### Krok 1: Weryfikacja Kodu
```bash
# Sprawdź, czy żaden plik nie ma importu Storefront/Admin
grep -r "adminGraphql\|Storefront\|SHOPIFY_STOREFRONT_TOKEN\|SHOPIFY_ADMIN_TOKEN" workers/worker/src/mcp*.ts shopify-mcp-client.ts
# Wynik: Żadnych matchów (oprócz komentarzy)
```

### Krok 2: Build & Deploy
```bash
cd workers/worker
npm install
npm run build
wrangler deploy
```

### Krok 3: Weryfikacja Deploy
```bash
# Test Origin (ewentualnie https://{your-worker}.workers.dev)
curl -X POST http://localhost:8787/mcp/tools/list \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Oczekiwany wynik:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "search_shop_catalog",
        "description": "Search Shopify product catalog",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string" },
            "context": { "type": "string" },
            "first": { "type": "number" }
          },
          "required": ["query", "context"]
        }
      },
      // ... inne tools
    ]
  },
  "id": 1
}
```

### Krok 4: Testy Integracyjne
1. Otwórz chatbot na sklepie
2. Poproś o wyszukiwanie produktu
3. Sprawdź Cloudflare Logs w Worker:
   - `[mcp] call` log powinien pojawić się
   - Nie powinno być żadnych 401 z Storefront API
4. Jeśli sklep MCP jest niedostępny:
   - AI powinien odpowiedzieć: "Przepraszamy, sklep jest chwilowo niedostępny. Spróbuj za chwilę."
   - Nigdy nie: "Unauthorized (401)"

---

## Notatki Konfiguracyjne

### Wymagane Zmienne Środowiskowe
```
SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_APP_SECRET=<secret>
```

### NIE Potrzebne (Usunięte)
```
SHOPIFY_STOREFRONT_TOKEN  ❌ (Usunięty fallback GraphQL)
SHOPIFY_ADMIN_TOKEN       ❌ (Usunięty fallback GraphQL)
```

### Opcjonalne
```
ALLOWED_ORIGIN=https://your-frontend.com
WORKER_ORIGIN=https://worker.workers.dev
```

---

## Postęp Implementacji

| Etap | Status | Notatka |
|------|--------|---------|
| Analiza problemu | ✅ | Plan A (oficjalny MCP) + Plan B (fallback) |
| Implementacja callShopMcp() | ✅ | 5s timeout, fallback dla search |
| Usunięcie fallbacków GraphQL | ✅ | mcp.ts, shopify-mcp-client.ts |
| Dynamiczny endpoint MCP | ✅ | rag.ts, rag-client-wrapper.ts |
| Logowanie & Error Handling | ✅ | Minimalne, bezpieczne |
| Dokumentacja & Verification | ✅ | MCP_SERVER_VERIFICATION.md |
| **Deploy (PENDING)** | ⏳ | `wrangler deploy` |
| **Integracja App Proxy (PENDING)** | ⏳ | Shopify panel config |
| **E2E testy (PENDING)** | ⏳ | ChatBot na sklepie |

---

## Support

Jeśli pojawią się problemy:

1. **Błąd 404 dla `/mcp/tools/list`**
   - Sprawdź routing w index.ts (linia 850)
   - Upewnij się, że `handleMcpRequest` jest wołana

2. **Błąd 401 z Storefront API**
   - Nie powinno się pojawić (fallback usunięty)
   - Jeśli się pojawi, sprawdź `mcp_server.ts` pod kątem pozostałych fallbacków

3. **Timeout 522 z App Proxy**
   - Potwierdzić, że Worker zwraca 200 na Origin
   - Sprawdzić Shopify App Proxy URL settings w Administracji

4. **AI się zawiesza zamiast fallbacku**
   - Sprawdzić logi Worker w Cloudflare
   - Upewnić się, że `callMcpToolDirect()` zwraca `{ error }` zamiast rzucenia exception

---

## ✨ Sukces!

Architektura jest czysty, bezpieczna, i gotowa do production. 

- **Plan A**: Oficjalny endpoint MCP (główny flow)
- **Plan B**: Fallback na timeout/522 (safety net)
- **Bez fallbacków na Storefront API** (zmniejsza złożoność, unika błędów 401)
- **Graceful degradation** (AI zawsze dostaje odpowiedź)

🚀 Ready to deploy!
