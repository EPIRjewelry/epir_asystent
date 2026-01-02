# Dodanie Hydrogenu – 02.01.2026

## Co zostało zrobione
- Utworzono szkic integracji Hydrogen/Remix z MCP: workspace `hydrogen/` (już dodany wcześniej) uzupełniono trasę `app/routes/chat.tsx` z loaderem zwracającym `customerAccessToken`, dane klienta i koszyk (Storefront API + Customer Account API).
- Dodano plik `.env.example` w `hydrogen/` z wymaganymi zmiennymi dla Storefront, Customer Account, MCP oraz `SESSION_SECRET`.
- Klienci i helpersy (już istniejące pliki) wykorzystane w loaderze: `lib/storefront.server.ts`, `lib/customer.server.ts`, `lib/cart.server.ts`, `lib/mcp-client.server.ts`, `gql/customer.ts`, `gql/cart.ts`.

## Zakres zmian w plikach
- `hydrogen/app/routes/chat.tsx`: pełny loader i prosty widok debugujący kontekst (customer, cart, cartId, customerAccessToken).
- `hydrogen/.env.example`: placeholdery env dla Storefront, Customer Account, MCP, SESSION_SECRET.

## Do wykonania / następne kroki
1) Uzupełnić realne wartości w `hydrogen/.env` (na bazie `.env.example`).
2) (Opcjonalnie) Dodać obsługę `cartCreate` + zapisu `cartId` w cookie, jeśli brak koszyka.
3) (Opcjonalnie) Dodać trasy `account.tsx` / `cart.tsx` jeśli potrzebne na froncie.
4) (Opcjonalnie) Rozszerzyć MCP router/tools o wariant Storefront vs Admin (jeśli nie ma w workerze).
5) Uruchomić lokalnie: `cd hydrogen && npm install && npm run dev`; deploy po `shopify login`: `npm run hydrogen:deploy`.
6) Brak testów uruchomionych w tej iteracji; zalecane dodać e2e/smoke.
