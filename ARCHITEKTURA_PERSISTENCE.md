# 📊 Architektura Persistence - SessionDO → D1

> ARCHIWALNE — NIEAKTUALNE

Oryginalna treść tego dokumentu została przeniesiona do `docs/archive/ARCHITEKTURA_PERSISTENCE.md`.

Zachowano kopię oryginału w katalogu `docs/archive/`. Jeśli dokument powinien pozostać aktywny, zaktualizuj go w archiwum i przywróć tutaj.
## 🏗️ STRUKTURA

### 1. SessionDO (Durable Object)
**Rola:** Pamięć operacyjna dla aktywnej sesji użytkownika

**Storage:**
- `history` - ostatnie 100 wiadomości (HistoryEntry[])
- `cart_id` - ID koszyka Shopify
- `session_id` - unikalny ID sesji
- `conversation_id` - ID konwersacji w D1
- `customer` - dane klienta (jeśli zalogowany)
- `product_views` - ostatnie 10 wyświetleń produktów

**Zachowanie:**
- Każdy użytkownik ma swoje DO identyfikowane przez `session_id`
- DO jest tworzone przy pierwszym żądaniu z danym `session_id`
- Historia w DO jest ograniczona do 100 ostatnich wiadomości
- DO archiwizuje do D1 automatycznie

---

### 2. DB_CHATBOT (D1 Database)
**Rola:** Trwałe przechowywanie rozmów i akcji koszyka

**Tabele:**

#### `conversations`
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,  -- timestamp pierwszej wiadomości
  ended_at INTEGER NOT NULL      -- timestamp ostatniej archivizacji
);
```

#### `messages`
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,             -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
);
```

#### `cart_actions`
```sql
CREATE TABLE cart_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  cart_id TEXT,
  action TEXT NOT NULL,           -- 'cart_initialized' | 'item_added' | 'item_removed'
  details TEXT,                   -- JSON z dodatkowymi danymi
  created_at INTEGER NOT NULL
);
```

---

### 3. DB (D1 Database - Analytics)
**Rola:** Tracking zachowań użytkowników (Web Pixel events)

**Tabele:**
- `pixel_events` - zdarzenia z Shopify Web Pixel
- `customer_sessions` - sesje klientów z AI analysis

**WAŻNE:** Ta baza jest **całkowicie oddzielona** od DB_CHATBOT!

---

## 🔄 PRZEPŁYW DANYCH

### A. Przy inicjalizacji SessionDO

```typescript
constructor() {
  // 1. Załaduj dane z DO Storage
  this.history = await storage.get('history');
  this.conversationId = await storage.get('conversation_id');
  
  // 2. Jeśli DO jest świeże (brak historii), załaduj z D1
  if (this.history.length === 0 && this.sessionId) {
    await this.loadFromD1();
  }
}
```

**Metoda `loadFromD1()`:**
1. Znajdź najnowszą konwersację dla `session_id`
2. Pobierz ostatnie 100 wiadomości
3. Załaduj do `this.history`
4. Zapisz `conversation_id` w DO Storage

---

### B. Przy dodawaniu wiadomości

```typescript
async append(message: HistoryEntry) {
  // 1. Dodaj do historii w pamięci
  this.history.push(message);
  
  // 2. Zapisz w DO Storage
  await this.state.storage.put('history', this.history);
  
  // 3. Zwiększ licznik wiadomości
  this.messagesCount++;
  
  // 4. Sprawdź warunki archivizacji
  if (this.messagesCount >= 5 || timeSinceLastArchive > 5min) {
    // Archivizuj asynchronicznie (nie blokuj)
    this.archiveToD1().catch(console.error);
  }
}
```

---

### C. Archivizacja do D1

**Wyzwalacze:**
- ✅ Co 5 wiadomości
- ✅ Co 5 minut (jeśli były nowe wiadomości)
- ✅ Asynchronicznie (nie blokuje append)

**Metoda `archiveToD1()`:**
1. Jeśli brak `conversation_id` → utwórz nową konwersację
2. INSERT wszystkich wiadomości z `this.history` do `messages`
3. UPDATE `conversations.ended_at`
4. Reset licznika `messagesCount`

```typescript
async archiveToD1() {
  // Utwórz konwersację jeśli nie istnieje
  if (!this.conversationId) {
    const result = await DB_CHATBOT.prepare(
      'INSERT INTO conversations (session_id, started_at, ended_at) VALUES (?, ?, ?) RETURNING id'
    ).bind(sessionId, startedAt, now()).first();
    
    this.conversationId = result.id;
  }
  
  // Batch insert wiadomości
  const batch = this.history.map(msg => 
    DB_CHATBOT.prepare(
      'INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).bind(conversationId, msg.role, msg.content, msg.ts)
  );
  
  await DB_CHATBOT.batch(batch);
  
  // Aktualizuj ended_at
  await DB_CHATBOT.prepare(
    'UPDATE conversations SET ended_at = ? WHERE id = ?'
  ).bind(now(), conversationId).run();
}
```

---

### D. Tracking akcji koszyka

```typescript
// Przy inicjalizacji koszyka (set-cart-id)
if (isNewCart) {
  await this.trackCartAction('cart_initialized', { cart_id });
}

async trackCartAction(action, details) {
  await DB_CHATBOT.prepare(
    'INSERT INTO cart_actions (session_id, cart_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, cartId, action, JSON.stringify(details), now()).run();
}
```

---

## 🚀 KORZYŚCI ARCHITEKTURY

### 1. **Szybki dostęp**
- Aktywne sesje w DO Storage (in-memory)
- Brak zapytań D1 przy każdej wiadomości
- Archivizacja asynchroniczna (nie spowalnia chat)

### 2. **Trwałość danych**
- Historia w D1 przeżyje eviction DO
- Możliwość odzyskania sesji po restarcie DO
- Backup automatyczny co 5 wiadomości/5 minut

### 3. **Analityka**
- Wszystkie rozmowy w SQL database
- Możliwość analizy trendów, częstych pytań
- Tracking akcji koszyka dla conversion analytics

### 4. **Pamięć długoterminowa modelu**
- Model może pobierać kontekst z poprzednich sesji
- Rozpoznawanie powracających klientów
- Personalizacja na podstawie historii

### 5. **Skalowalnośc**
- DO handling concurrent requests per user
- D1 batch operations (efektywne INSERT)
- Oddzielenie hot data (DO) od cold data (D1)

---

## 📝 LIMITY I UWAGI

### Cloudflare Durable Objects:
- ✅ Unlimited storage per DO
- ✅ Persistence across requests
- ⚠️ May be evicted if inactive (hours/days)

### Cloudflare D1:
- ✅ Free tier: 5 GB storage
- ✅ 100k reads/day, 50k writes/day (free)
- ⚠️ Batch limit: 1000 statements per batch

### Historia:
- DO: ostatnie 100 wiadomości (`MAX_HISTORY_IN_DO`)
- D1: wszystkie wiadomości (unlimited)
- Archivizacja: co 5 wiadomości lub 5 minut

---

## 🔍 MONITOROWANIE

### Logi do sprawdzania:

**Inicjalizacja:**
```
[SessionDO] 📥 Loading history from D1 for session abc123...
[SessionDO] ✅ Loaded 42 messages from D1 conversation 5
```

**Archivizacja:**
```
[SessionDO] 📦 Archiving 5 messages to D1...
[SessionDO] ✅ Created conversation 6 for session abc123
[SessionDO] ✅ Archived 5 messages to conversation 6
```

**Cart tracking:**
```
[SessionDO] 🛒 Cart action tracked: cart_initialized
```

---

## 🎓 USE CASES

### 1. Pamięć długoterminowa AI
```typescript
// Model może pobierać kontekst z poprzednich sesji klienta
const previousConversations = await DB_CHATBOT.prepare(
  'SELECT c.id, m.content FROM conversations c JOIN messages m ON c.id = m.conversation_id WHERE c.session_id = ? ORDER BY m.created_at DESC LIMIT 50'
).bind(sessionId).all();

// Dodaj do kontekstu AI: "W poprzedniej rozmowie pytałeś o..."
```

### 2. Analiza konwersji
```sql
-- Ile sesji z cart_initialized zakończyło się checkout?
SELECT 
  ca.session_id,
  ca.cart_id,
  COUNT(DISTINCT pe.id) as checkout_events
FROM cart_actions ca
LEFT JOIN pixel_events pe ON ca.session_id = pe.session_id 
  AND pe.event_type = 'checkout_started'
WHERE ca.action = 'cart_initialized'
GROUP BY ca.session_id;
```

### 3. FAQ analysis
```sql
-- Najczęstsze pytania użytkowników
SELECT 
  content,
  COUNT(*) as frequency
FROM messages
WHERE role = 'user' 
  AND content LIKE '%jak%' OR content LIKE '%co%'
GROUP BY content
ORDER BY frequency DESC
LIMIT 20;
```

---

## 🚦 STATUS

**Version ID:** acd43077-9236-4a2e-abca-f29cbac2c533  
**Status:** ✅ DEPLOYED  
**Tested:** ⏳ Wymaga testów produkcyjnych

**Następne kroki:**
1. Test pełnego flow: nowa sesja → chat → evict DO → nowa sesja → load from D1
2. Monitoring logów archivizacji
3. Dashboard analytics (opcjonalnie)
4. Model context injection z D1 (pamięć długoterminowa)
