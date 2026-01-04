# Podsumowanie Stanu Aplikacji `epir_asystent` (Obecny Stan Repozytorium)

## Data Analizy: 2026-01-04

Niniejszy dokument przedstawia faktyczny stan architektury i implementacji aplikacji `epir_asystent`, bazując na analizie plików `wrangler.toml` oraz `src/index.ts` w istniejącym repozytorium. Skupia się na tym, co *jest wdrożone*, identyfikując kluczowe komponenty oraz występujące problemy.

---

## 1. Architektura Workerów Cloudflare (Obecny Stan)

Repozytorium zawiera cztery aktywne workery, każdy z własnym plikiem `wrangler.toml` i punktem wejścia `src/index.ts`.

### 1.1. `epir-ai-worker` (`services/ai-worker`)
*   **Rola:** Dedykowany worker do inferencji AI, obsługujący komunikację z Groq API. Zaprojektowany jako serwis wywoływany przez Service Binding.
*   **Bindingi:** Brak D1, DO, KV, Vectorize. Wymaga `GROQ_API_KEY`.
*   **Implementacja:** Eksponuje endpointy `/stream`, `/harmony`, `/complete` dla streamingu i kompletowania odpowiedzi AI. Model AI jest **hardkodowany** jako `openai/gpt-oss-120b`.

### 1.2. `epir-analityc-worker` (`services/analytics-worker`)
*   **Rola:** Worker analityczny, przeznaczony do zbierania zdarzeń z Shopify Web Pixel i analizy zachowań klientów. Odpowiedzialny za tworzenie i zarządzanie tabelami analitycznymi.
*   **Bindingi:**
    *   D1: `DB` do bazy `jewelry-analytics-db` (ID: `6a4f7cbb-3c1c-42c7-9d79-4ef74d421f23`).
    *   Durable Object: `SESSION_DO` (wskazuje na klasę zdefiniowaną w `epir-art-jewellery-worker`).
    *   Service Binding: `AI_WORKER` do `epir-ai-worker` (do analizy zachowań/rekomendacji).
*   **Implementacja (`src/index.ts`):** Tworzy i zarządza własnymi tabelami (`pixel_events`, `customer_sessions`, `customer_events`) w bazie `jewelry-analytics-db`. Zawiera logikę do analizy zachowań klientów i potencjalnej aktywacji czatu.

### 1.3. `epir-rag-worker` (`services/rag-worker`)
*   **Rola:** Worker dedykowany do orkiestracji Retrieval Augmented Generation (RAG).
*   **Bindingi:**
    *   Vectorize: `VECTOR_INDEX` do `autorag-epir-chatbot-rag`.
    *   AI: `AI` (do generowania embeddingów).
    *   D1: `DB` do bazy `epir_art_jewellery` (ID: `6a4f7cbb-3c1c-42c7-9d79-4ef74d421f23`) – **fizycznie jest to ta sama baza co `jewelry-analytics-db`**.
*   **Implementacja (`src/index.ts`):** Eksponuje endpointy `/search/products`, `/search/policies`, `/context/build` do wyszukiwania produktów (MCP), polityk (Vectorize) i budowania pełnego kontekstu RAG.

### 1.4. `epir-art-jewellery-worker` (`services/worker`)
*   **Rola:** Główny worker aplikacji, hostujący Durable Objects sesji czatu. Pełni rolę koordynatora dialogu z klientem.
*   **Bindingi:**
    *   Durable Objects: `SESSION_DO`, `RATE_LIMITER_DO`, `TOKEN_VAULT_DO`.
    *   D1: `DB` do bazy `jewelry-analytics-db` (ID: `6a4f7cbb-3c1c-42c7-9d79-4ef74d421f23`).
    *   D1: `DB_CHATBOT` do bazy `ai-assistant-sessions-db` (ID: `475a1cb7-f1b5-47ba-94ed-40fd64c32451`).
    *   KV: `SESSIONS_KV`.
    *   AI: `AI` (bezpośrednie połączenie z Groq API).
    *   Fetcher: `RAG_WORKER` (do `epir-rag-worker`).
*   **Implementacja (`src/index.ts`):** Zarządza `SessionDO` (sesje czatu). Posiada własne, **bezpośrednie połączenie z modelem AI (Groq API), mimo istnienia `epir-ai-worker`**. Importuje funkcje RAG (`searchShopPoliciesAndFaqs` itp.) z `rag-client-wrapper`, ale logika RAG jest realizowana poprzez narzędzia wywoływane przez AI, co budzi wątpliwości co do jej efektywności.

---

## 2. Zdiagnozowane Problemy Architektoniczne

1.  **Krytyczny Konflikt D1: Współdzielenie `jewelry-analytics-db`**
    *   **Problem:** Baza D1 o `database_id = "6a4f7cbb-3c1c-42c7-9d79-4ef74d421f23"` jest współdzielona przez `epir-analityc-worker` (dla danych web-pixela), `epir-rag-worker` (dla cachingu RAG) oraz `epir-art-jewellery-worker` (ogólny binding `DB`).
    *   **Konsekwencje:** Prowadzi to do konfliktów schematów (np. błędy "no such column"), utraty integralności danych i utrudnia zrozumienie, kto jest właścicielem jakich danych.

2.  **Nieskuteczność i Niejasność RAG**
    *   **Problem:** Pomimo istnienia dedykowanego `epir-rag-worker` i bindingów do Vectorize/AI, rzeczywista efektywność RAG jest niska (jak zgłoszono: "realnie nie działa"). `epir-art-jewellery-worker` importuje komponenty RAG, ale polega na narzędziach wywoływanych przez AI, co może być źródłem problemu.
    *   **Konsekwencje:** Model AI nie wykorzystuje w pełni dostępnego kontekstu, prowadząc do mniej precyzyjnych lub "halucynowanych" odpowiedzi.

3.  **"Niewidzialne" Dane z Web-Pixela**
    *   **Problem:** `epir-analityc-worker` aktywnie zbiera i zapisuje dane z Web Pixela do `jewelry-analytics-db`, tworząc rozbudowany schemat tabel (`pixel_events`, `customer_sessions`, `customer_events`). Jednak brakuje jasnej warstwy konsumpcji i wizualizacji tych danych.
    *   **Konsekwencje:** Zebrane dane analityczne mają niską wartość biznesową, ponieważ nie są łatwo dostępne ani wykorzystywane do raportowania czy podejmowania decyzji.

4.  **Brak Spójnej Orkiestracji AI i Złożoność Ról Workerów**
    *   **Problem:** `epir-art-jewellery-worker` (główny worker czatu) ma bezpośrednie połączenie z Groq API (hardkodowany model), mimo istnienia `epir-ai-worker` dedykowanego do inferencji. To samo dotyczy RAG, gdzie funkcje są importowane, ale nie ma klarownego, scentralizowanego podejścia do orkiestracji AI.
    *   **Konsekwencje:** Duplikacja funkcjonalności, trudności w zarządzaniu modelami AI, brak jasnego podziału odpowiedzialności i zwiększona złożoność kodu.

5.  **Ograniczenie Shopify App Proxy**
    *   **Problem:** Konieczność kierowania całego ruchu aplikacji przez jedno Shopify App Proxy wymusza skomplikowany routing lub tendencje do tworzenia monolitycznych workerów (np. `epir-art-jewellery-worker`), co obniża klarowność i skalowalność.
    *   **Konsekwencje:** Zwiększona złożoność w routerze, trudności w izolacji i skalowaniu poszczególnych funkcjonalności.

6.  **Historyczne Obciążenie `epir-art-jewellery-worker` jako "main"**
    *   **Problem:** Nazwa workera i jego historyczna rola jako "głównego" doprowadziły do kumulacji wielu odpowiedzialności, które powinny być rozdzielone na bardziej wyspecjalizowane komponenty.
    *   **Konsekwencje:** Brak jasnej pojedynczej odpowiedzialności, utrudniający rozwój i utrzymanie.

---

## 3. Kluczowe Funkcjonalności (Obecny Stan)

Poniżej przedstawiono zaimplementowane funkcjonalności i ich obecny stan:

### 3.1. Schemat D1 dla Archiwizacji Sesji (Częściowo wdrożony)
*   **Plik:** `workers/worker/migrations/001_create_analytics_schema.sql` (schemat ten, z tabelami `sessions`, `messages`, `tool_calls`, `usage_stats`, `cart_activity`, jest aplikowany do `jewelry-analytics-db`).
*   **`epir-art-jewellery-worker`** posiada binding `DB_CHATBOT` do dedykowanej bazy `ai-assistant-sessions-db` (`475a1cb7-f1b5-47ba-94ed-40fd64c32451`) dla archiwizacji sesji.

### 3.2. Funkcja Archiwizacji w Durable Object (`SessionDO`)
*   **Plik:** `workers/worker/src/durable_objects/session_do.ts`
*   **Implementacja:** `SessionDO` zawiera logikę do archiwizacji wiadomości do D1 (prawdopodobnie do `env.DB_CHATBOT`) po przekroczeniu progu (`ARCHIVE_THRESHOLD`) wiadomości. Używa wewnętrznego bufora w pamięci, a nie wewnętrznego SQLite DO.

### 3.3. Normalizacja `cart_id` i Retry Logic
*   **Pliki:** `workers/worker/src/utils/cart.ts`, `workers/worker/src/utils/retry.ts`, `workers/worker/src/mcp_server.ts`
*   **Implementacja:** Funkcje takie jak `normalizeCartId()` i `withRetry()` są zaimplementowane w celu obsługi błędów formatowania `cart_id` i ponawiania operacji sieciowych. Zintegrowane w wywołaniach MCP.

### 3.4. Optymalizacja System Prompt
*   **Plik:** `workers/worker/src/prompts/luxury-system-prompt.ts`
*   **Implementacja:** Systemowy prompt został zredukowany (~62% redukcji znaków) w celu obniżenia kosztów tokenów i przyspieszenia przetwarzania.

### 3.5. Truncation Historii (Sliding Window)
*   **Pliki:** `workers/worker/src/utils/history.ts`, `workers/worker/src/index.ts`
*   **Implementacja:** Funkcje `estimateTokens()`, `truncateHistory()`, `truncateWithSummary()` są używane do zarządzania długością historii konwersacji, zapobiegając przepełnieniu kontekstu LLM.

---

## 4. Wdrożenie i Testy (Obecny Stan)

*   **Migracje D1:** Wdrożenie schematu odbywa się poprzez `wrangler d1 execute jewelry-analytics-db --remote --file=./migrations/001_create_analytics_schema.sql`.
*   **Deploy Worker:** `wrangler deploy` w katalogu `workers/worker`.
*   **Weryfikacja:** Instrukcje testowania obejmują sprawdzenie logów, normalizacji `cart_id` i archiwizacji D1.

---

## 5. Pliki Zmienione / Dodane (Obecny Stan)

*   **Nowe pliki:** `workers/worker/migrations/001_create_analytics_schema.sql`, `workers/worker/src/utils/cart.ts`, `workers/worker/src/utils/retry.ts`, `workers/worker/src/utils/history.ts`.
*   **Zmodyfikowane pliki:** `workers/worker/src/durable_objects/session_do.ts`, `workers/worker/src/mcp_server.ts`, `workers/worker/src/prompts/luxury-system-prompt.ts`, `workers/worker/src/index.ts`, `.gitignore`.

---

## 6. Wnioski (Obecny Stan)

Obecna architektura `epir_asystent` wprowadza szereg optymalizacji i funkcjonalności (archiwizacja DO->D1, normalizacja `cart_id`, optymalizacja promptu, sliding window). Jednakże, złożoność wynikająca z wielu workerów, współdzielonej bazy D1 i braku spójnej orkiestracji AI (szczególnie w zakresie RAG i wykorzystania dedykowanych workerów AI) prowadzi do problemów z klarownością, utrzymywalnością i pełnym wykorzystaniem potencjału danych. Dane analityczne z Web Pixela są zbierane, ale ich wizualizacja i konsumpcja nie są w pełni zaimplementowane.

**Status:** Aplikacja jest funkcjonalna w pewnym zakresie, ale boryka się z fundamentalnymi problemami architektonicznymi, które wymagają refaktoryzacji.

