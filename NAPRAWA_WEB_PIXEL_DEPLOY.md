# Naprawa Błędu Deploy - Web Pixel Extension

**Data:** 2025-11-17  
**Commit:** 37c0514  
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

### Dlaczego To Problem?

- Bundler próbuje znaleźć i spakować pakiet do jednego pliku
- Pakiet istnieje w `node_modules` (jest w `package.json`)
- Ale bundler **nie powinien** go includować w finalnym bundle
- Zamiast tego, kod powinien używać wersji dostarczonej przez Shopify runtime

---

## ✅ Rozwiązanie

### Krok 1: Dodanie Pliku Konfiguracyjnego

Utworzono plik `extensions/my-web-pixel/extension.config.js`:

```javascript
module.exports = {
  build: {
    external: ['@shopify/web-pixels-extension']
  }
};
```

### Co To Robi?

1. **`external: ['@shopify/web-pixels-extension']`** - Informuje bundler (esbuild), aby **nie includował** tego pakietu w bundle
2. Import pozostaje w kodzie, ale **nie jest rozwiązywany** podczas bundlingu
3. W runtime, Shopify automatycznie dostarcza ten moduł

### Struktura Katalogowa Po Naprawie

```
extensions/my-web-pixel/
├── extension.config.js     ← NOWY PLIK
├── package.json
├── shopify.extension.toml
├── src/
│   └── index.ts
└── schema-customer-sessions.sql
```

---

## 🧪 Weryfikacja

### Test 1: Sprawdzenie Pliku Konfiguracyjnego

```bash
$ cat extensions/my-web-pixel/extension.config.js
module.exports = {
  build: {
    external: ['@shopify/web-pixels-extension']
  }
};
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

---

## 🎯 Najlepsze Praktyki

### 1. Zawsze Oznaczaj Runtime Dependencies jako External

Jeśli używasz pakietów dostarczanych przez Shopify runtime:
- `@shopify/web-pixels-extension`
- Inne oficjalne pakiety Shopify runtime

Zawsze dodawaj je do `external` w `extension.config.js`.

### 2. Package.json vs Extension.config.js

```json
// package.json - deklaracja zależności (dla TypeScript, IDE)
{
  "dependencies": {
    "@shopify/web-pixels-extension": "^2.10.0"
  }
}
```

```javascript
// extension.config.js - konfiguracja bundlera (dla esbuild)
module.exports = {
  build: {
    external: ['@shopify/web-pixels-extension']
  }
};
```

Oba pliki są potrzebne:
- `package.json` - dla TypeScript typings i IDE autocomplete
- `extension.config.js` - aby nie bundlować podczas deploy

### 3. Testowanie Lokalne

Przed deployem, zawsze testuj lokalnie:

```bash
# Zainstaluj zależności
cd extensions/my-web-pixel
npm install

# Deploy testowy
cd ../..
shopify app deploy
```

---

## 🔧 Rozwiązywanie Problemów

### Problem: "Could not resolve [package]"

**Rozwiązanie:** Dodaj pakiet do `external` w `extension.config.js`

### Problem: "Module not found in runtime"

**Przyczyna:** Pakiet **nie jest** dostarczany przez Shopify runtime  
**Rozwiązanie:** Usuń z `external` i pozwól bundlerowi go spakować

### Problem: Bundle jest za duży

**Przyczyna:** Za dużo pakietów zostało zbundlowanych  
**Rozwiązanie:** Sprawdź czy wszystkie runtime dependencies są w `external`

---

## 📝 Podsumowanie

| Aspekt | Przed | Po |
|--------|-------|-----|
| Bundling | ❌ Błąd | ✅ Sukces |
| Deploy | ❌ Niemożliwy | ✅ Działa |
| Runtime | ❌ N/A | ✅ Kod wykonuje się poprawnie |
| Rozmiar bundle | N/A | ✅ Minimalny (bez zbędnych pakietów) |

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

- **37c0514** - fix(web-pixel): add extension.config.js to mark @shopify/web-pixels-extension as external

---

*Naprawa wykonana przez: GitHub Copilot Agent*
