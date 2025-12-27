# Implementacja parsera tagów <|call|> / <|end|> w worke­rze i aktualizacja frontend

## Cel
Zaimplementować parser, który wykrywa i przetwarza tagi Harmony `<|call|>...<|end|>` generowane przez model AI, aby: 
- zapobiec wyświetlaniu surowego JSON-a klientowi,
- zamieniać wywołania narzędzi na ustrukturyzowane obiekty w historii (lub wywoływać funkcje po stronie serwera),
- alternatywnie: przygotować integrację pod natywne `tool_calls` (np. Llama 3.3 / Groq spec change), co usunie potrzebę ręcznego parsowania.

## Problem
Aktualnie frontend (`extensions/asystent-klienta/assets/assistant.js`) nie rozpoznaje tagów `<|call|>...<|end|>` i wyświetla je jako zwykły tekst w interfejsie klienta. Worker (Cloudflare Worker) zapisuje wpisy asystenta z treścią zawierającą te tagi (zob. `workers/worker/src/index.ts` gdzie tworzony jest `toolCallContent`), a brak parsera po stronie klienta powoduje, że użytkownik widzi surowe JSON-y narzędzi.

## Dostępne informacje z lokalnego środowiska (PowerShell)
- Cwd: `C:\Users\user\epir_asystent\workers\worker`
- Last Command: `wrangler deploy`
- Exit Code: `0`

(Dodatkowe logi sesji terminala nie były dostępne; powyższe informacje pochodzą z kontekstu środowiska.)

## Wymagania
1. Backend (Worker):
   - W workerze dodać/udostępnić parser strumienia lub po-przetworzeniowy krok, który rozpoznaje sekwencję `<|call|>...<|end|>` i:
     - parsuje JSON wewnątrz tagów (z obsługą błędów), zapisuje strukturalnie w historii (pole `tool_calls` już istnieje) lub
     - natychmiast wykonuje odpowiadające narzędzie (RAG / MCP / Shopify API) i wstawia wynik jako wiadomość roli `tool` (już częściowo zaimplementowane),
     - NIE zwraca surowego JSON-a do klienta.
   - Upewnić się, że przypadki, gdzie model emituje "myśli" przed `<|call|>`, nie są ujawniane klientowi (worker już buforuje `iterationText` i pomija je jeśli wystąpi `tool_call`).

2. Frontend (`assistant.js`):
   - Zaktualizować `parseAssistantResponse` tak, aby wykrywała i usuwała fragmenty `<|call|>...<|end|>` z tekstu przeznaczonego do wyświetlenia,
   - Opcjonalnie: zwracać strukturę `actions.toolCall = { name, arguments }` do dalszego przetworzenia (np. dla UX),
   - Zapewnić odporność na niepoprawny JSON wewnątrz tagów (logowanie, telemetria), ale nigdy nie odsłaniać surowej zawartości klientowi.

3. Alternatywa: Migracja do modelu z natywnymi `tool_calls` (np. Llama 3.3 / Groq spec change). W takim scenariuszu:
   - Dostosować transformy w workerze, aby korzystały z natywnych eventów `tool_call` z modelu,
   - Usunąć konieczność stosowania tokenów Harmony `<|call|>` w system promptach.

## Kroki do wykonania (oczekiwane przez agenta)
- [ ] Dodać/zmodyfikować parser w `workers/worker/src/index.ts` (lub w module strumieni), aby zabezpieczyć zapis i wykonanie wywołań narzędzi bez ujawniania JSON klientowi.
- [ ] Zaktualizować `extensions/asystent-klienta/assets/assistant.js` — funkcja `parseAssistantResponse` — aby filtrowała `<|call|>` i ` <|end|>` przed renderowaniem.
- [ ] Dodać test(y) jednostkowe/ew. integracyjne (np. `workers/worker/test/tool_calls.test.ts` już istnieje — rozbudować).
- [ ] Przygotować PR z branch `feat/parser-harmony-call` zawierający zmiany i opisać testy/warunki akceptacji.

## Przykładowe fragmenty implementacji (sugestia)
- Regex do wykrywania bloków Harmony: `/<!\|call\|>([\s\S]*?)<\|end\|>/g` (uwaga na escape w JS)
- Parsowanie JSON: `JSON.parse(match[1])` z try/catch i fallbackem logującym błąd do telemetrii.

## Prośba o przypisanie
Proszę przypisać zadanie do GitHub Coding Agent (lub innego automatu CI/CD), który po utworzeniu Issue utworzy branch `feat/parser-harmony-call`, zaimplementuje zmiany, uruchomi testy i otworzy PR.

---

Jeśli potrzebujesz, mogę przygotować przykładowe poprawki dla plików:
- `extensions/asystent-klienta/assets/assistant.js` (aktualizacja `parseAssistantResponse`),
- `workers/worker/src/index.ts` (dodatkowy sanity check przy append do session oraz upewnienie się, że do klienta wysyłamy tylko treść bez tagów),
- testy: `workers/worker/test/tool_calls.test.ts`.

Proszę potwierdzić czy mam również automatycznie wygenerować branch i PR (mogę to zrobić tu przez GitHub API).