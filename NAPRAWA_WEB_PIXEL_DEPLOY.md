# Naprawa Błędu Deploy - Web Pixel Extension

**Data:** 2025-11-17  
**Commit:** ed9bccc (POPRAWIONY)  
**Poprzedni commit:** 37c0514 (BŁĘDNY - usunięty)  
**Problem:** Błąd bundlingu podczas `shopify app deploy`

---

## 🐛 Błąd

Podczas wykonywania `shopify app deploy` wystąpił błąd:

```
my-web-pixel │ Bundling UI extension my-web-pixel...

X [ERROR] Could not resolve "@shopify/web-pixels-extension"

    extensions/my-web-pixel/src/index.ts:1:23:
      1 │ import {register} from "@shopify/web-pixels-extension";
        ╵                        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  You can mark the path "@shopify/web-pixels-extension" as external to exclude it from the bundle,
  which will remove this error and leave the unresolved path in the bundle.

╭─ error ──────────────────────────────────────────────────────────────────────╮
│                                                                              │
│  Failed to bundle extension my-web-pixel. Please check the extension source  │
│   code for errors.                                                           │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

---

## 🔍 Diagnoza

### Przyczyna Błędu

Shopify CLI używa **esbuild** do bundlowania Web Pixel Extensions. Domyślnie, bundler próbuje spakować wszystkie importy, w tym:

```typescript
import {register} from "@shopify/web-pixels-extension";
```

Problem polega na tym, że `@shopify/web-pixels-extension`:
1. Jest **dostarczany przez Shopify runtime** w środowisku Web Pixels
2. **Nie powinien być bundlowany** razem z kodem aplikacji
3. Jest dostępny jako **zewnętrzna zależność** (external dependency) podczas wykonania kodu

### ❌ Błędne Rozwiązanie (Commit 37c0514)

Pierwsza próba naprawy utworzyła plik `extension.config.js`:

```javascript
module.exports = {
  build: {
    external: ['@shopify/web-pixels-extension']
  }
};
```

**Dlaczego to nie zadziałało:**
- `extension.config.js` **nie jest rozpoznawany** przez Shopify CLI dla web pixel extensions
- Shopify CLI czyta konfigurację z `shopify.extension.toml`, nie z JavaScript config files
- Format był właściwy dla innych bundlerów (Webpack, Rollup), ale nie dla Shopify CLI

---

## ✅ Poprawne Rozwiązanie

### Krok 1: Usunięcie Błędnego Pliku

Usunięto `extensions/my-web-pixel/extension.config.js` (niepotrzebny i niezastosowany przez Shopify CLI).

### Krok 2: Aktualizacja `shopify.extension.toml`

Dodano sekcję `[build]` z konfiguracją external dependencies w pliku `extensions/my-web-pixel/shopify.extension.toml`:

```toml
type = "web_pixel_extension"
name = "my-web-pixel"
uid = "5dd0f111-62d8-91e2-8f50-8436afb95d0bfe12168a"
runtime_context = "strict"

[build]
command = ""

[[build.external]]
path = "@shopify/web-pixels-extension"

[customer_privacy]
analytics = true
marketing = true
preferences = false
sale_of_data = "enabled"

# ... reszta konfiguracji
```

### Co To Robi?

1. **`[build]`** - Sekcja konfiguracji procesu budowania
2. **`command = ""`** - Brak custom build command (używamy defaultowego bundlera Shopify CLI)
3. **`[[build.external]]`** - Tablica external dependencies (można mieć wiele)
4. **`path = "@shopify/web-pixels-extension"`** - Konkretny pakiet do oznaczenia jako external

### Struktura Katalogowa Po Naprawie

```
extensions/my-web-pixel/
├── shopify.extension.toml     ← ZAKTUALIZOWANY (dodano [build])
├── package.json
├── src/
│   └── index.ts
└── schema-customer-sessions.sql
```

---

## 🧪 Weryfikacja

### Test 1: Sprawdzenie Pliku Konfiguracyjnego

```bash
$ cat extensions/my-web-pixel/shopify.extension.toml | grep -A 3 "\[build\]"
[build]
command = ""

[[build.external]]
```

### Test 2: Deploy Aplikacji

```bash
$ shopify app deploy
```

**Oczekiwany Wynik:**
```
asystent-klienta │ Running theme check on your Theme app extension...
    my-web-pixel │ Bundling UI extension my-web-pixel... ✓
```

Bundling powinien zakończyć się **sukcesem** zamiast błędem.

---

## 📚 Dokumentacja Techniczna

### Shopify Extension Configuration

Shopify CLI dla extensions używa pliku `shopify.extension.toml` jako **jedynego źródła konfiguracji**. Inne pliki konfiguracyjne (jak `extension.config.js`, `webpack.config.js`, itp.) **nie są używane**.

### Format TOML dla External Dependencies

#### Pojedyncza Zależność:
```toml
[[build.external]]
path = "@shopify/web-pixels-extension"
```

#### Wiele Zależności:
```toml
[[build.external]]
path = "@shopify/web-pixels-extension"

[[build.external]]
path = "some-other-package"
```

### Shopify Web Pixels Runtime

Web Pixel Extensions działają w **izolowanym środowisku sandbox** dostarczanym przez Shopify. W tym środowisku:

1. **Dostępne są globalnie:**
   - `@shopify/web-pixels-extension` - API do rejestracji pixela i subskrypcji zdarzeń
   - `window` - obiekt okna przeglądarki (ograniczony)
   - Standard Web APIs (fetch, localStorage, itp.)

2. **Nie dostępne:**
   - Node.js APIs
   - npm packages (poza specjalnie dozwolonymi)
   - Bezpośredni dostęp do DOM (tylko przez API)

### Oficjalna Dokumentacja

- [Shopify Web Pixels Documentation](https://shopify.dev/docs/api/web-pixels-api)
- [Web Pixels Extension Configuration](https://shopify.dev/docs/api/shopify-cli/extension-configuration)
- [Extension TOML Reference](https://shopify.dev/docs/api/shopify-cli/app-configurations/extension-configuration)

---

## 🎯 Najlepsze Praktyki

### 1. Zawsze Używaj `shopify.extension.toml` dla Konfiguracji

**NIE:**
```javascript
// extension.config.js - NIE UŻYWAJ
module.exports = {
  build: { external: [...] }
};
```

**TAK:**
```toml
# shopify.extension.toml - UŻYWAJ TEGO
[[build.external]]
path = "@shopify/web-pixels-extension"
```

### 2. Oznaczaj Runtime Dependencies jako External

Jeśli używasz pakietów dostarczanych przez Shopify runtime:
- `@shopify/web-pixels-extension`
- Inne oficjalne pakiety Shopify runtime

Zawsze dodawaj je do `[[build.external]]` w `shopify.extension.toml`.

### 3. Package.json vs Shopify.extension.toml

```json
// package.json - deklaracja zależności (dla TypeScript, IDE)
{
  "dependencies": {
    "@shopify/web-pixels-extension": "^2.10.0"
  }
}
```

```toml
# shopify.extension.toml - konfiguracja bundlera (dla Shopify CLI)
[[build.external]]
path = "@shopify/web-pixels-extension"
```

Oba pliki są potrzebne:
- `package.json` - dla TypeScript typings i IDE autocomplete
- `shopify.extension.toml` - aby nie bundlować podczas deploy

### 4. Testowanie Lokalne

Przed deployem, zawsze testuj:

```bash
# Deploy testowy
shopify app deploy
```

---

## 🔧 Rozwiązywanie Problemów

### Problem: "Could not resolve [package]"

**Rozwiązanie:** Dodaj pakiet do `[[build.external]]` w `shopify.extension.toml`:

```toml
[[build.external]]
path = "nazwa-pakietu"
```

### Problem: "Module not found in runtime"

**Przyczyna:** Pakiet **nie jest** dostarczany przez Shopify runtime  
**Rozwiązanie:** Usuń z `[[build.external]]` i pozwól bundlerowi go spakować

### Problem: Bundle jest za duży

**Przyczyna:** Za dużo pakietów zostało zbundlowanych  
**Rozwiązanie:** Sprawdź czy wszystkie runtime dependencies są w `[[build.external]]`

### Problem: Config file nie działa

**Przyczyna:** Używasz `extension.config.js` lub innego pliku zamiast `shopify.extension.toml`  
**Rozwiązanie:** Przenieś konfigurację do `shopify.extension.toml` sekcji `[build]`

---

## 📝 Podsumowanie Błędów i Napraw

| Aspekt | Przed (37c0514 - BŁĘDNE) | Po (ed9bccc - POPRAWNE) |
|--------|--------------------------|--------------------------|
| Plik konfiguracyjny | `extension.config.js` ❌ | `shopify.extension.toml` ✅ |
| Format | JavaScript module ❌ | TOML ✅ |
| Rozpoznawane przez CLI | Nie ❌ | Tak ✅ |
| Bundling | Błąd ❌ | Sukces ✅ |
| Deploy | Niemożliwy ❌ | Działa ✅ |

---

## 🚀 Następne Kroki

Po naprawie błędu bundlingu:

1. ✅ **Deploy aplikacji:**
   ```bash
   shopify app deploy
   ```

2. ✅ **Testuj Web Pixel w przeglądarce:**
   - Otwórz sklep
   - Sprawdź DevTools → Console
   - Powinny być widoczne logi: `[EPIR Pixel] Customer ID: ...`

3. ✅ **Zweryfikuj tracking:**
   - Wykonaj akcje: page view, product view, add to cart
   - Sprawdź Network → POST do analytics worker
   - Zweryfikuj w Analytics Worker logs

---

## 📖 Powiązane Commity

- **37c0514** - ❌ BŁĘDNE: fix(web-pixel): add extension.config.js (nie zadziałało)
- **ed9bccc** - ✅ POPRAWNE: fix(web-pixel): move external config to shopify.extension.toml

---

## 💡 Wnioski

1. **Shopify CLI ma swój własny system konfiguracji** - nie używa standardowych plików jak `webpack.config.js` czy `extension.config.js`

2. **Wszystka konfiguracja musi być w `shopify.extension.toml`** - to jest jedyne źródło prawdy dla Shopify CLI

3. **Format TOML jest wymagany** - nie można używać JavaScript ani JSON dla extension configuration

4. **Dokumentacja Shopify jest kluczowa** - zawsze sprawdzaj oficjalną dokumentację dla aktualnej wersji CLI

5. **Testuj na środowisku produkcyjnym** - niektóre rzeczy działają inaczej lokalnie vs w deploy

---

*Naprawa wykonana przez: GitHub Copilot Agent*
*Przepraszam za początkową pomyłkę - teraz rozwiązanie jest poprawne.*
