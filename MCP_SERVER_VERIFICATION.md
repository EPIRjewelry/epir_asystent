# Weryfikacja MCP Server - Plan A & Plan B

> ARCHIWALNE — NIEAKTUALNE

Oryginalna treść tego dokumentu została przeniesiona do `docs/archive/MCP_SERVER_VERIFICATION.md`.

Zachowano kopię oryginału w katalogu `docs/archive/`. Jeśli dokument powinien pozostać aktywny, zaktualizuj go w archiwum i przywróć tutaj.
### Test 2: Sprawdzenie `search_shop_catalog` z parametrami

```bash
curl -X POST http://localhost:8787/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "search_shop_catalog",
      "arguments": {
        "query": "pierścionek",
        "context": "biżuteria",
        "first": 5
      }
    },
    "id": 2
  }'
```

Oczekiwane zachowanie:
- **Jeśli sklep MCP działa**: Zwróć produkty.
- **Jeśli sklep MCP zwróci 522/timeout**: Zwróć fallback:
  ```json
  {
    "jsonrpc": "2.0",
    "result": {
      "products": [],
      "system_note": "Sklep jest chwilowo niedostępny (Connection Timeout). Poinformuj klienta o problemie technicznym."
    },
    "id": 2
  }
  ```

**Sukces**: Nigdy nie ma 401 z Storefront API. 🟢

---

## Plan B: Fallback na brak odpowiedzi

Jeśli sklep MCP zwróci błąd (522, timeout, network error), worker **NIE** próbuje Storefront API. Zamiast tego zwraca bezpieczny fallback.

### Scenariusz: Sklep MCP niedostępny (522)

```bash
# Symulacja: Worker spróbuje wołać https://{shop_domain}/api/mcp
# Sklep MCP zwróci 522 Service Unavailable
# Worker NIE będzie wołać Storefront API
# Worker zwróci fallback: puste produkty + system_note
```

**Log Worker**:
```
[mcp] call { tool: 'search_shop_catalog', status: 522, ... }
[mcp] Shop MCP 522 for search_shop_catalog, returning safe fallback
```

**Wynik dla AI**:
```json
{
  "result": {
    "products": [],
    "system_note": "Sklep jest chwilowo niedostępny (Connection Timeout). Poinformuj klienta o problemie technicznym."
  }
}
```

AI powinien odpowiedzieć: "Przepraszamy, sklep jest chwilowo niedostępny. Spróbuj za chwilę."

**Sukces**: Żaden 401, żaden crash. 🟢

---

## Plan B: Timeout (5s)

Jeśli fetch do sklepu MCP zajmuje >5s, AbortController przerywa request.

```bash
# Symulacja: network bardzo powolna
# Po 5s Worker przerywa fetch
# Worker zwraca fallback
```

**Log Worker**:
```
[mcp] Timeout/Network error for search_shop_catalog, returning safe fallback
```

**Wynik**: Fallback (puste produkty + system_note). 🟢

---

## Architektura (bez fallbacków na Storefront API)

```
App Proxy (/apps/assistant/mcp)
    ↓
Worker MCP Server (mcp_server.ts)
    ↓
callShopMcp() → https://{shop_domain}/api/mcp (5s timeout)
    ↓
    ├─ Success (200) → Zwróć wynik
    ├─ 522/503 (dla search_shop_catalog) → Fallback (puste + note)
    ├─ Timeout/AbortError (dla search_shop_catalog) → Fallback
    └─ Inne błędy → JSON-RPC error (nie fallback)
```

**Brak**: Storefront API, `callInternalWorkerTool()`, SHOPIFY_STOREFRONT_TOKEN

---

## Deploy & Veryfikacja

1. **Deploy zmienionych plików**:
   ```bash
   wrangler deploy
   ```

2. **Test `/mcp/tools/list` na Originie**:
   ```bash
   curl -X POST https://{your-worker}.workers.dev/mcp/tools/list \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

3. **Jeśli Origin zwraca 200 + tools**: ✅ Plan A działa.

4. **Test Shopify App Proxy** (jeśli skonfigurowany):
   - Uruchom chatbot na sklepie
   - Poproś o wyszukiwanie produktu
   - Sprawdź logi Worker w Cloudflare
   - Jeśli sklep MCP zwraca 522 → AI powinien otrzymać fallback, nie błąd 401.

---

## Checklist

- [ ] Worker `/mcp/tools/list` zwraca 200 OK
- [ ] `search_shop_catalog` wymaga `query` i `context`
- [ ] `search_shop_catalog` z timeoutem zwraca fallback (puste produkty)
- [ ] `search_shop_catalog` z 522 zwraca fallback (puste produkty)
- [ ] Żaden błąd 401 z Storefront API
- [ ] Logi Worker pokazują `[mcp] call` i timestamps
- [ ] AI otrzymuje fallback zamiast błędu systemowego
- [ ] Streaming w index.ts nadal działa

---

## Notatki

- **Fallback TYLKO dla `search_shop_catalog`**: Inne narzędzia (get_cart, update_cart, itp.) zwracają JSON-RPC error.
- **Timeout 5s**: Cloudflare Workers mają timeout 30s, ale my zatrzymujemy fetch po 5s, aby szybko przejść do fallbacku.
- **Brak Storefront fallback**: Dzięki temu unikamy problemów z tokenami i podwójnymi timeoutami.
