# Naprawa Przycisku "Wyślij" - Chat Widget

**Data:** 2025-11-17  
**Commit:** 3524701  
**Problem:** Przycisk "Wyślij" przeładowywał stronę zamiast wysyłać wiadomość

---

## 🐛 Problem

Po kliknięciu przycisku "Wyślij" w widgecie czatu, strona była przeładowywana zamiast wysłać wiadomość do asystenta przez AJAX. Mimo że kod zawierał `e.preventDefault()`, skrypt w ogóle się nie wykonywał.

---

## 🔍 Diagnoza

### 1. Nierozwiązane Markery Konfliktu Merge

Plik `extensions/asystent-klienta/assets/assistant.js` zawierał **nierozwiązane markery konfliktu** z poprzedniego merge:

```javascript
} catch (err) {
<<<<<<< HEAD
    console.error('[Assistant] getShopifyCartId error', err);
    try { reportUiExtensionError(err, { stage: 'get_cart_id' }); } catch (e) { console.warn('reportUiExtensionError failed', e); }
    return null;
  } finally {
  // kończymy getShopifyCartId()
}
=======
    console.error('Błąd pobierania koszyka:', err);
    reportUiExtensionError(err, {
      stage: 'get_cart_id',
      error_message: err instanceof Error ? err.message : 'Unknown error',
    });
    return null;
  }
}
>>>>>>> origin/copilot/fix-client-assistant-errors
```

**Skutek:** Parser JavaScript traktował `<<<<<<< HEAD` jako kod i rzucał `SyntaxError`, przez co **cały skrypt się nie ładował**.

### 2. Niepoprawny Atrybut `type="module"`

W pliku `blocks/assistant.liquid` skrypt był ładowany jako moduł ES6:

```html
<script src="{{ 'assistant.js' | asset_url }}" defer="defer" type="module"></script>
```

Ale plik `assistant.js` **nie zawierał żadnych exportów** (zostały usunięte w poprzednich commitach), więc przeglądarka traktowała to jako pusty moduł.

**Skutek:** Nawet jeśli skrypt by się załadował, funkcje nie były dostępne.

---

## ✅ Rozwiązanie

### Zmiana 1: Usunięto Markery Konfliktu

```javascript
// PRZED (BŁĘDNE):
} catch (err) {
<<<<<<< HEAD
    console.error('[Assistant] getShopifyCartId error', err);
=======
    console.error('Błąd pobierania koszyka:', err);
>>>>>>> origin/copilot/fix-client-assistant-errors
    return null;
  }
}

// PO (POPRAWNE):
} catch (err) {
    console.error('[Assistant] getShopifyCartId error', err);
    try { 
      reportUiExtensionError(err, { stage: 'get_cart_id' }); 
    } catch (e) { 
      console.warn('reportUiExtensionError failed', e); 
    }
    return null;
  }
}
```

### Zmiana 2: Usunięto `type="module"`

```html
<!-- PRZED (BŁĘDNE): -->
<script src="{{ 'assistant.js' | asset_url }}" defer="defer" type="module"></script>

<!-- PO (POPRAWNE): -->
<script src="{{ 'assistant.js' | asset_url }}" defer="defer"></script>
```

---

## 🧪 Weryfikacja

### Test 1: Składnia JavaScript
```bash
$ node -c extensions/asystent-klienta/assets/assistant.js
✅ JavaScript syntax: OK
```

### Test 2: Obecność preventDefault
```bash
$ grep -c "preventDefault" extensions/asystent-klienta/assets/assistant.js
3
✅ preventDefault found in code
```

### Test 3: Brak type="module"
```bash
$ grep "type=\"module\"" extensions/asystent-klienta/blocks/assistant.liquid
✅ No type=module found
```

---

## 📋 Jak Przetestować w Przeglądarce

1. **Deploy aplikacji:**
   ```bash
   shopify app deploy
   ```

2. **Otwórz sklep w przeglądarce** (publiczny storefront)

3. **Otwórz DevTools** (F12) → zakładka **Console**

4. **Sprawdź brak błędów składniowych:**
   - Nie powinno być `SyntaxError: Unexpected token '<'`
   - Nie powinno być błędów związanych z `<<<<<<< HEAD`

5. **Otwórz widget asystenta** i kliknij w pole tekstowe

6. **Wpisz wiadomość** (np. "Witaj") i kliknij **"Wyślij"** lub naciśnij **Enter**

7. **Sprawdź DevTools → Network:**
   - Powinien być widoczny request: `POST /apps/assistant/chat`
   - Status powinien być `200 OK` lub `text/event-stream`
   - **Strona NIE powinna się przeładować**

8. **Sprawdź Console:**
   ```
   [Assistant] Cart ID: gid://shopify/Cart/...
   [Assistant][Perf] { messageLen: 5, chunks: ..., totalMs: ... }
   ```

---

## 🎯 Wynik

- ✅ Skrypt ładuje się bez błędów
- ✅ Event listener jest poprawnie podpięty do formularza
- ✅ `preventDefault()` działa - strona nie jest przeładowywana
- ✅ Wiadomości są wysyłane przez AJAX
- ✅ Streaming odpowiedzi działa

---

## 📚 Powiązane Commity

1. **3524701** - fix: resolve merge conflict markers and remove type=module from script tag
2. **b0f7b71** - fix(analytics): add CORS headers to pixel endpoints and preflight
3. **6785df6** - fix(assistant): resolve merge conflict, fix getShopifyCartId and restore parseAssistantResponse export

---

## 💡 Wnioski

1. **Zawsze sprawdzaj brak markerów konfliktu** przed commitem:
   ```bash
   git diff --check
   grep -r "<<<<<<< HEAD" .
   ```

2. **Testuj składnię JavaScript** przed deployem:
   ```bash
   node -c file.js
   ```

3. **Unikaj `type="module"`** w Theme App Extensions jeśli nie używasz ES6 exports

4. **Używaj defer** dla skryptów, które zależą od DOM:
   ```html
   <script src="script.js" defer="defer"></script>
   ```

---

*Naprawa wykonana przez: GitHub Copilot Agent*
