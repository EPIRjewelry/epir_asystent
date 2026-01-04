# ✅ EPIR ASYSTENT - Produkcyjny Checklist (Widget + Worker)

> ARCHIWALNE — NIEAKTUALNE

Oryginalna treść tego dokumentu została przeniesiona do `docs/archive/PRODUCTION_CHECKLIST.md`.

Zachowano kopię oryginału w katalogu `docs/archive/`. Jeśli dokument powinien pozostać aktywny, zaktualizuj go w archiwum i przywróć tutaj.
## 🎯 ARCHITEKTURA PRODUKCYJNA

`
Widget (Theme Extension) 
    ↓ fetch('/apps/assistant/chat')
App Proxy w Shopify
    ↓ proxy
Cloudflare Worker (asystent.epirbizuteria.pl)
    ↓
SessionDO + RAG + AI + D1
`

---

## 🔐 SEKRETY DO SPRAWDZENIA

### Worker (wrangler secret list):
- GROQ_API_KEY ✅ (obecny)
- SHOPIFY_APP_SECRET ✅ (obecny)
- EPIR_INTERNAL_KEY ❓ (sprawdź czy obecny)
- SHOPIFY_ADMIN_TOKEN ❓ (sprawdź czy obecny)

### Sprawdzenie:
```powershell
cd workers\worker
wrangler secret list
```

### Dodanie brakujących:
```powershell
wrangler secret put EPIR_INTERNAL_KEY
wrangler secret put SHOPIFY_ADMIN_TOKEN
```

---

## 🚀 DEPLOY WORKFLOW

### 1. Worker Deploy
```powershell
cd workers\worker
wrangler deploy
```

### 2. Analytics Worker Deploy
```powershell
cd workers\analytics-worker
wrangler deploy
```

### 3. Shopify Extension Deploy
```powershell
cd c:\Users\user\epir_asystent
shopify app deploy
```

---

## ✅ E2E VERIFICATION

### 1. Test Workera
```powershell
# Healthcheck
Invoke-RestMethod -Uri "https://asystent.epirbizuteria.pl/" -Method GET
# Powinno zwrócić: ok
```

### 2. Test Bazy D1
```powershell
wrangler d1 execute jewelry-analytics-db --remote --command="SELECT COUNT(*) FROM pixel_events;"
```

### 3. Test Widgetu (manual)
- Otwórz https://epirbizuteria.pl
- Sprawdź czy widget się ładuje
- Napisz wiadomość do chatbota
- Sprawdź Console przeglądarki (F12) → brak błędów

### 4. Test Trackingu
```powershell
# Sprawdź ostatnie eventy
wrangler d1 execute jewelry-analytics-db --remote --command="SELECT event_type, page_url, created_at FROM pixel_events ORDER BY id DESC LIMIT 5;"
```

---

## 📊 MONITORING

### Logi Workera
```powershell
wrangler tail epir-art-jewellery-worker --format pretty
```

### Logi Analytics
```powershell
cd workers\analytics-worker
wrangler tail epir-analityc-worker --format pretty
```

### Statystyki D1
```powershell
wrangler d1 execute jewelry-analytics-db --remote --command="SELECT event_type, COUNT(*) as count FROM pixel_events GROUP BY event_type;"
```

---

## 🛠️ SZLIFOWANIE SYSTEMU

### Priorytet 1: Weryfikacja sekretów
```powershell
cd workers\worker
wrangler secret list
```
Upewnij się że są wszystkie wymagane sekrety (patrz sekcja SEKRETY).

### Priorytet 2: Test E2E
Przeprowadź pełny test: Widget → Chat → D1 logs

### Priorytet 3: Optymalizacja
- Sprawdź logi w dashboard Cloudflare
- Zweryfikuj czasy odpowiedzi
- Sprawdź użycie D1 i Workers KV

---

## �� UWAGI

- **Brak Hydrogen** — widget komunikuje się bezpośrednio z Workerem przez App Proxy
- **Brak Vercel** — niepotrzebne, Worker hostowany na Cloudflare
- **Brak Oxygen** — tylko Shopify Plus, używamy natywnego routingu

System jest **prosty, szybki i działa**! 🚀
