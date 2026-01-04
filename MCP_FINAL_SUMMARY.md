# 🎯 MCP Server Refactor: Plan A & Plan B

> ARCHIWALNE — NIEAKTUALNE

Oryginalna treść tego dokumentu została przeniesiona do `docs/archive/MCP_FINAL_SUMMARY.md`.

Zachowano kopię oryginału w katalogu `docs/archive/`. Jeśli dokument powinien pozostać aktywny, zaktualizuj go w archiwum i przywróć tutaj.
---

## Architektura

### Plan A: Oficjalny endpoint MCP (Happy Path)
```
Request (JSON-RPC 2.0)
  ↓
Worker callShopMcp()
  ├─ Normalizuj parametry (context: 'biżuteria', first: 5)
  ├─ Ustaw timeout: 5s AbortController
  └─ Fetch https://{shop_domain}/api/mcp
     ├─ Odpowiedź 200 OK → Zwróć wynik do AI
     └─ Error/timeout → Przejdź do Plan B
```

### Plan B: Fallback na Błąd Sieci (Safety Net)
```
Błąd MCP (timeout/522/503/network error)
  ├─ Dla search_shop_catalog:
  │   └─ Zwróć fallback: {"products": [], "system_note": "..."}
  │       └─ AI: "Sklep niedostępny, spróbuj za chwilę"
  │
  └─ Dla innych narzędzi:
      └─ Zwróć JSON-RPC error (nie fallback)
          └─ Asystent: "Nie mogę pobrać koszyka, spróbuj za chwilę"
```

---

## Zmienione Pliki & Krótki Opis

### 1. ✅ `mcp_server.ts`
**Co**: Nowa funkcja `callShopMcp()`, fallback strategia, logowanie
**Dlaczego**: Plan A + Plan B w jednym miejscu
**Efekt**: Żaden fallback na Storefront API, graceful degradation

### 2. ✅ `shopify-mcp-client.ts`
**Co**: Usunął fallbacki GraphQL, delegacja MCP
**Dlaczego**: Zmniejsza złożoność, unika zależności od tokenów
**Efekt**: Klient MCP jest czysty (tylko MCP, nie GraphQL)

### 3. ✅ `mcp.ts`
**Co**: `searchProductCatalog()` → MCP zamiast Storefront API
**Dlaczego**: Zmniejsza użycie tokenu, używa oficjalnego endpoint
**Efekt**: Produkt/polityki zawsze przez MCP

### 4. ✅ `rag.ts`
**Co**: Dynamiczny endpoint MCP, timeout 5s, fallback na timeout
**Dlaczego**: Nie hardcoded domena, uniwersalna dla każdego sklepu
**Efekt**: RAG jest niezależne od sklepu

### 5. ✅ `rag-client-wrapper.ts`
**Co**: Usunięty hardcoded shop domain
**Dlaczego**: Konfiguracja pochodzi z env
**Efekt**: Mniejsza złożoność

### 6. ✅ `mcp_tools.ts`
**Co**: Dodał `context` jako required parameter dla search_shop_catalog
**Dlaczego**: Specyficzność wyszukiwania
**Efekt**: Llama zawsze wysyła kontekst (biżuteria, etc.)

### 7. ✅ `index.ts`
**Verified**: Routing `/mcp/tools/list` + `/mcp/tools/call` → handleMcpRequest
**Status**: Już naprawiony wcześniej

---

## Zmienione Zachowanie

### Przed
```
search_shop_catalog("pierścionek")
  ↓
callMcp() → https://epir-art-silver-jewellery.myshopify.com/api/mcp
  ├─ 200 OK → Zwróć produkty ✅
  ├─ Timeout → Fallback: searchProductCatalog() → Storefront API
  │            ├─ SHOPIFY_STOREFRONT_TOKEN valid → Zwróć produkty ✅
  │            └─ SHOPIFY_STOREFRONT_TOKEN invalid → 401 ❌
  └─ 522 → Fallback GraphQL → 401 ❌

Wynik: App Proxy timeout, AI crash, ChatBot "Connection refused"
```

### Po (Plan A + Plan B)
```
search_shop_catalog("pierścionek", context: "biżuteria")
  ↓
callShopMcp() → https://{shop_domain}/api/mcp (5s timeout)
  ├─ 200 OK → Zwróć produkty ✅
  ├─ 522/503/timeout → Fallback: {"products": [], "system_note": "..."} ✅
  └─ Network error → Fallback: {"products": [], "system_note": "..."} ✅

Wynik: App Proxy 200 OK, AI responds "Sklep niedostępny", ChatBot graceful
```

---

## Dokumentacja & Testy

### 📄 Dokumentacja
- `MCP_SERVER_REFACTOR_SUMMARY.md` — Pełny opis zmian
- `MCP_SERVER_VERIFICATION.md` — Testy curl i scenariusze
- `MCP_DEPLOYMENT_CHECKLIST.md` — Checklist wdrożenia

### 🧪 Test Cases
1. `/mcp/tools/list` → 200 OK + tools
2. `/mcp/tools/call` + search_shop_catalog → produkty lub fallback
3. Timeout → Fallback bez 401
4. Logowanie → Bezpieczne, bez danych użytkownika

---

## Bezpieczeństwo & Conformance

✅ **Bez tokenów w kodzie** (SHOP_DOMAIN z env)
✅ **HMAC verification** dla App Proxy
✅ **Rate limiting** (per shop)
✅ **5s timeout** (AbortController, szybko przechodzi do fallbacku)
✅ **Safe fallback** (AI dostaje informację, nie crash)
✅ **Minimalne logowanie** (narzędzie, status, argumenty summary)
✅ **JSON-RPC 2.0** (spec compliant)

---

## Wdrożenie

### Krok 1: Deploy
```bash
cd workers/worker
wrangler deploy
```

### Krok 2: Weryfikacja Origin
```bash
curl -X POST http://localhost:8787/mcp/tools/list \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### Krok 3: Test App Proxy
1. Otwórz ChatBot na sklepie
2. Poproś o "Szukaj pierścionka"
3. Sprawdź logi Worker (Cloudflare)
4. AI powinien odpowiedzieć normalnie lub "sklep niedostępny"

---

## Podsumowanie

| Aspekt | Przed | Po |
|--------|-------|-------|
| Fallback | GraphQL (401 risk) | Safe fallback (puste + note) |
| Timeout | Brak (App Proxy 522) | 5s AbortController |
| Token dependency | SHOPIFY_STOREFRONT_TOKEN | Brak |
| Endpoint | Hardcoded domena | Dynamiczny {shop_domain} |
| AI response | Crash (502/522) | Graceful: "niedostępny" |
| Logowanie | Pełne (risky) | Minimal summary |

---

## 🎉 Wynik

✅ **Architektura**: Czysty plan A (MCP) + plan B (fallback)
✅ **Kod**: Refaktoryzowany, bez fallbacków GraphQL
✅ **Bezpieczeństwo**: HMAC, rate limit, safe fallback
✅ **Dokumentacja**: Kompletna (3 pliki)
✅ **Gotowy do produkcji**: TAK

---

## Następne Kroki

1. `wrangler deploy` 
2. Weryfikacja curl na Origin
3. Konfiguracja App Proxy w Shopify (jeśli trzeba)
4. E2E testy na ChatBot
5. Monitorowanie logów w Cloudflare

---

**Autor**: AI Architecture
**Data**: 28 grudnia 2025
**Status**: ✅ Ready for Production
