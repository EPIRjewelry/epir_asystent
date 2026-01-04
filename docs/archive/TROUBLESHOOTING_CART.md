# 🔴 PROBLEMY Z KOSZYKIEM - Analiza i Rozwiązania

**Data:** 2026-01-03  
**Version ID:** 3343af82-1600-4df7-9308-c6f455608675

---

## ZIDENTYFIKOWANE PROBLEMY:

### 1. **AI odpowiada "Gotowe" zamiast pełnych zdań**
**Status:** ⚠️ CZĘŚCIOWO NAPRAWIONE

**Przyczyna:**  
- AI (Llama 3.3 70B) odpowiada jednym słowem "Gotowe" lub "OK" zamiast pełnych zdań
- Brak wyraźnej instrukcji w promptcie zakazującej takich odpowiedzi

**Naprawa:**  
✅ Dodano do promptu: `**NIGDY nie odpowiadaj jednym słowem jak "Gotowe", "OK", "Tak"** - zawsze pełne zdanie!`

**Test:** Wymaga weryfikacji w produkcji

---

### 2. **Koszyk - AI nie umie usuwać produktów**
**Status:** ⚠️ CZĘŚCIOWO NAPRAWIONE

**Przyczyna:**  
AI używała `merchandise_id` z `quantity: 0` do usuwania, ale **Shopify MCP wymaga `line_item_id`**!

**Przykład błędnego wywołania:**
```json
{
  "lines": [
    { "merchandise_id": "gid://shopify/ProductVariant/53287163167052", "quantity": 0 },
    { "merchandise_id": "gid://shopify/ProductVariant/52166540034380", "quantity": 0 }
  ]
}
```

**Poprawne wywołanie:**
```json
{
  "lines": [
    { "line_item_id": "gid://shopify/CartLine/abc123", "quantity": 0 },
    { "line_item_id": "gid://shopify/CartLine/def456", "quantity": 0 }
  ]
}
```

**Naprawa:**  
✅ Zaktualizowano prompt z wyraźnymi instrukcjami:
- DODAWANIE: `merchandise_id` + quantity
- USUWANIE: `line_item_id` (z get_cart) + quantity: 0
- AKTUALIZACJA: `line_item_id` + nowa quantity

✅ Dodano przykład usuwania do promptu

**Test:** Wymaga weryfikacji - AI musi najpierw wywołać get_cart, aby uzyskać line_item_id

---

### 3. **Historia resetuje się (0 messages)**
**Status:** ⚠️ ZIDENTYFIKOWANY - PROBLEM PO STRONIE FRONTENDU

**Symptom:**
```
[streamAssistant] 📚 History entries (before truncation): 0
[streamAssistant] 📨 Total messages (after truncation): 1
```

**Przyczyna:**  
Widget nie wysyła `session_id` w niektórych żądaniach → backend tworzy NOWĄ sesję → historia znika

**Lokalizacja problemu:**
- Backend: `workers/worker/src/index.ts` linia 405
- Frontend: `extensions/asystent-klienta/blocks/assistant.liquid` lub `assets/assistant.js`

**Wymaga naprawy po stronie widgetu:** Widget musi:
1. Zapisać `session_id` z pierwszej odpowiedzi
2. Wysyłać go w każdym kolejnym żądaniu

---

### 4. **Parsowanie cart_id (czy to Harmony?)**
**Status:** ✅ ROZWIĄZANE - NIE JEST ZWIĄZANE Z HARMONY

**Pytanie użytkownika:**  
> "upewnij się ze parsowanie o ktorym mowisz nie jest z wiazane z Harmony"

**Odpowiedź:**  
**NIE** - parsowanie cart_id NIE jest związane z protokołem Harmony.

**Mechanizm:**
1. AI (Llama 3.3) odbierała cart_id w system prompt: `gid://shopify/Cart/abc?key=xyz`
2. Model **obcinał** część `?key=xyz` (traktując jako URL query parameter)
3. Wysyłała niepełny cart_id: `gid://shopify/Cart/abc`
4. Shopify MCP odrzucał: "Invalid cart_id format"

**Naprawa:**
✅ Usunięto cart_id z system prompt (linia 573)  
✅ Dodano auto-inject cart_id w momencie wywołania get_cart/update_cart (linia 678-683)

**Potwierdzenie:**
- ✅ Brak referencji do Harmony w `mcp_server.ts`
- ✅ Brak referencji do Harmony w `mcp_tools.ts`
- ✅ `normalizeCartArgs()` to standardowa normalizacja GID (nie związana z Harmony)

---

## WNIOSKI:

### Poprawione:
1. ✅ Nazwa bota: "Aura" → "Gemma"
2. ✅ Auto-inject cart_id (fix parsowania)
3. ✅ Instrukcje koszyka w promptcie (line_item_id vs merchandise_id)
4. ✅ Zakaz odpowiedzi "Gotowe" w promptcie
5. ✅ Przykład usuwania z koszyka

### Wymaga dalszej pracy:
1. ⚠️ Widget - fix `session_id` persistence
2. ⚠️ Test flow koszyka: get_cart → extract line_item_id → update_cart z line_item_id
3. ⚠️ Monitorowanie odpowiedzi "Gotowe" (czy naprawione)

### Protokół Harmony:
- ✅ **POTWIERDZENIE:** Parsowanie cart_id NIE jest związane z Harmony
- ✅ Wszystkie pliki Harmony oznaczone jako `_LEGACY_`
- ✅ Kod korzysta z natywnego OpenAI function-calling

---

## NASTĘPNE KROKI:

1. **Test koszyka:**
   - Dodaj produkt do koszyka
   - Wywołaj get_cart → sprawdź, czy AI widzi line_item_id
   - Poproś o usunięcie → sprawdź, czy AI używa line_item_id

2. **Fix widget session_id:**
   - Sprawdź `extensions/asystent-klienta/assets/assistant.js`
   - Upewnij się, że session_id jest zapisywany w localStorage/sessionStorage
   - Upewnij się, że jest wysyłany w każdym żądaniu

3. **Monitorowanie:**
   - Sprawdź logi Groq API - czy model generuje "Gotowe" często
   - Rozważ dodanie post-processingu w backendzie (filtrowanie odpowiedzi "Gotowe")

---

**Deployed Version:** 3343af82-1600-4df7-9308-c6f455608675  
**Timestamp:** 2026-01-03T17:30:00Z
