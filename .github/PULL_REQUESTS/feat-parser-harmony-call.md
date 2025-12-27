# PR Draft: feat/parser-harmony-call

Ten plik to propozycja PR zawierająca rekomendowane zmiany oraz patch-e do zaimplementowania parsera Harmony `<|call|>...<|end|>` po stronie klienta i notatek do workera.

## Cel
- Usunąć/ukryć surowe tagi `<|call|>` przed wyświetleniem w UI,
- Parsować JSON wewnątrz tagów i przekazywać jako struktury (actions.toolCalls),
- Zapewnić, że Worker nie wyśle surowego JSON klientowi (sanity check),
- Przygotować branch `feat/parser-harmony-call` z tymi zmianami (aktualnie to draft - wymagane utworzenie brancha i commity).

## Zmiany (sugerowane)

1) `extensions/asystent-klienta/assets/assistant.js`
- Zmodyfikować funkcję `parseAssistantResponse(text)` — dodać rozpoznawanie bloków Harmony i usuwać je z tekstu do renderowania.

Przykładowy patch (fragment):

```diff
-function parseAssistantResponse(text) {
-  const actions = {
-    hasCheckoutUrl: false,
-    checkoutUrl: null,
-    hasCartUpdate: false,
-    cartItems: [],
-    hasOrderStatus: false,
-    orderDetails: null
-  };
-  let cleanedText = text;
-  // existing logic ...
-  return { text: cleanedText, actions };
-}
+function parseAssistantResponse(text) {
+  const actions = {
+    hasCheckoutUrl: false,
+    checkoutUrl: null,
+    hasCartUpdate: false,
+    cartItems: [],
+    hasOrderStatus: false,
+    orderDetails: null,
+    toolCalls: []
+  };
+  let cleanedText = text;
+
+  // Harmony-style tool call blocks: <|call|>{...}<|end|>
+  const toolCallRegex = /<\|call\|>([\s\S]*?)<\|end\|>/g;
+  cleanedText = cleanedText.replace(toolCallRegex, (match, p1) => {
+    try {
+      const obj = JSON.parse(p1);
+      if (obj && obj.name) {
+        actions.toolCalls.push({ name: obj.name, arguments: obj.arguments || {} });
+      }
+    } catch (e) {
+      console.warn('[Assistant] Failed to parse <|call|> JSON', e);
+      try { reportUiExtensionError(e, { stage: 'parse_call', snippet: String(p1).slice(0, 500) }); } catch(e2){}
+    }
+    return '';
+  }).trim();
+
+  // existing detection (checkout URL, CART_UPDATED, ORDER_STATUS) should run against the cleaned text
+  const checkoutUrlMatch = cleanedText.match(/https:\/\/[^\n\s]+\/checkouts\/[^
\s]+/);
+  if (checkoutUrlMatch) {
+    actions.hasCheckoutUrl = true;
+    actions.checkoutUrl = checkoutUrlMatch[0];
+  }
+
+  const cartActionMatch = cleanedText.match(/\[CART_UPDATED:([^\]]+)\]/);
+  if (cartActionMatch) {
+    actions.hasCartUpdate = true;
+    cleanedText = cleanedText.replace(/\[CART_UPDATED:[^\]]+\]/, '').trim();
+  }
+
+  const orderStatusMatch = cleanedText.match(/\[ORDER_STATUS:([^\]]+)\]/);
+  if (orderStatusMatch) {
+    actions.hasOrderStatus = true;
+    try { actions.orderDetails = JSON.parse(orderStatusMatch[1]); } catch (e) { console.warn('Failed to parse order details:', e); }
+    cleanedText = cleanedText.replace(/\[ORDER_STATUS:[^\]]+\]/, '').trim();
+  }
+
+  return { text: cleanedText, actions };
+}
```

2) `workers/worker/src/index.ts`
- Sanity check: przed append do session i przed pushowaniem do klienta upewnić się, że `assistantToolCallEntry.content` nie zostanie użyty bezpośrednio do renderu lub dodać pole `display_text` które będzie pustym stringiem, jeśli odpowiedź jest tool_call.
- Alternatywnie: zamiast zapisywać `content: '<|call|>...<|end|>'`, zapisać `content: ''` i trzymać pełny JSON w `tool_calls` polu (już obecne).

Przykład notatki zmiany:
```ts
// zamiast
content: toolCallContent,
// użyj
content: '',
tool_calls: [{ name, arguments: args }],
```

(Worker już tworzy `tool_calls` pole; wystarczy zapobiec odsłonięciu `content` w finalnej odpowiedzi wysyłanej do klienta.)

## Testy
- Rozszerzyć `workers/worker/test/tool_calls.test.ts` o przypadki uwzględniające, że `assistant` w historii może mieć pusty `content` i jedynie `tool_calls`.
- Dodać testy frontendowe dla `parseAssistantResponse()` aby upewnić się, że:
  - usuwa bloki `<|call|>...<|end|>`,
  - poprawnie parsuje niepoprawny JSON i nie wyświetla go klientowi.

---

Jeśli potwierdzasz, mogę:
- utworzyć branch `feat/parser-harmony-call`,
- zaaplikować powyższe zmiany w osobnych commitach,
- uruchomić testy (jeśli dostępne w CI) i utworzyć PR.

(Pamiętaj: obecnie to draft plików PR w repozytorium; aby otworzyć prawdziwy PR, muszę wykonać commity na branchu.)
