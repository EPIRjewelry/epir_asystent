# Sekrety i zmienne środowiskowe (PROD)

Poniżej minimalny, uporządkowany zestaw. Podzielone na: Cloudflare Workers (wrangler secrets) i Oxygen/Hydrogen (zmienne/sekrety runtime).

## Workers (wrangler secrets)
| Nazwa | Cel | Uwagi |
| --- | --- | --- |
| EPIR_INTERNAL_KEY | Autoryzacja wewnętrzna Hydrogen → Worker (`X-EPIR-Internal-Key`). | Musi być identyczny z Oxygen. Nie ujawniać. |
| SHOPIFY_APP_SECRET | Weryfikacja HMAC App Proxy. | Musi zgadzać się z App w Shopify. |
| CUSTOMER_ACCOUNT_API_CLIENT_SECRET | Wymiana tokenów Customer Account (jeśli używasz). | Opcjonalny, ale zalecany. |

## Oxygen / Hydrogen (zmienne runtime)
| Nazwa | Publiczna? | Cel |
| --- | --- | --- |
| PUBLIC_STORE_DOMAIN | Tak | `your-store.myshopify.com` |
| PUBLIC_STOREFRONT_API_VERSION | Tak | Np. `2024-01` |
| PUBLIC_STOREFRONT_API_TOKEN | Tak | Publiczny token Storefront |
| PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID | Tak | Client ID dla Customer Account |
| PUBLIC_MCP_ORIGIN | Tak | URL produkcyjnego Workera, np. `https://asystent.epirbizuteria.pl` |
| EPIR_INTERNAL_KEY | Nie | Ten sam co w Workerze; nie używać prefixu PUBLIC_ |
| CUSTOMER_ACCOUNT_API_CLIENT_SECRET | Nie | Serwerowy sekret do Customer Account |
| SESSION_SECRET | Nie | Losowy silny sekret dla sesji Hydrogen |

## Szybkie komendy (prod)
```bash
# Workers
wrangler secret put EPIR_INTERNAL_KEY
wrangler secret put SHOPIFY_APP_SECRET
wrangler secret put CUSTOMER_ACCOUNT_API_CLIENT_SECRET

# Oxygen/Hydrogen (panel lub plik .env production)
# Ustaw wartości powyższych zmiennych; brak prefixu PUBLIC_ dla sekretów serwerowych.
```

## Minimalny zestaw do startu E2E
- EPIR_INTERNAL_KEY
- SHOPIFY_APP_SECRET
- PUBLIC_STORE_DOMAIN, PUBLIC_STOREFRONT_API_TOKEN, PUBLIC_STOREFRONT_API_VERSION
- PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID (+ CLIENT_SECRET jeśli potrzebny)
- PUBLIC_MCP_ORIGIN
- SESSION_SECRET

## Notatki
- Nigdy nie ustawiaj sekretów z prefixem PUBLIC_.
- EPIR_INTERNAL_KEY musi być identyczny w Oxygen i Workerze.
- Po ustawieniu sekretów: `wrangler deploy` (Worker) oraz build+deploy Hydrogen na Oxygen.
