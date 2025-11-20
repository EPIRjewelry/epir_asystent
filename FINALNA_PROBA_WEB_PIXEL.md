# Finalna Próba - Całkowite Usunięcie Zależności

**Data:** 2025-11-18  
**Shopify CLI Version:** 3.87.4 (potwierdzone)  
**Commit:** cd8224a  
**Status:** RADYKALNE ROZWIĄZANIE - CZWARTA PRÓBA

---

## 🔄 Pełna Historia Prób

### ❌ Próba 1: extension.config.js (37c0514)
- Utworzono `extension.config.js` z external config
- **Wynik:** Shopify CLI nie rozpoznaje tego pliku

### ❌ Próba 2: shopify.extension.toml [build] (ed9bccc)
- Dodano `[[build.external]]` do TOML
- **Wynik:** Składnia nie wspierana przez CLI 3.87.4

### ❌ Próba 3: peerDependencies (784311b)
- Zmieniono na `peerDependencies` w package.json
- **Wynik:** Bundler nadal próbuje bundlować

### 🔄 Próba 4: Całkowite Usunięcie (cd8224a)
- Usunięto pakiet całkowicie z package.json
- Dodano tylko type declarations

---

## ✅ Finalne Rozwiązanie

### Plik: `extensions/my-web-pixel/package.json`

```json
{
  "name": "my-web-pixel",
  "version": "1.0.0",
  "main": "dist/main.js",
  "license": "UNLICENSED"
}
```

**BRAK jakichkolwiek dependencies!**

### Plik: `extensions/my-web-pixel/src/shopify-web-pixels.d.ts` (NOWY)

```typescript
// Type declarations for @shopify/web-pixels-extension
// This package is provided by Shopify runtime and should not be bundled

declare module "@shopify/web-pixels-extension" {
  export function register(callback: (context: any) => void | Promise<void>): void;
}
```

### Plik: `extensions/my-web-pixel/src/index.ts`

**NIE ZMIENIONY** - import pozostaje:

```typescript
import {register} from "@shopify/web-pixels-extension";

register(async ({ analytics, browser, init }) => {
  // ... kod ...
});
```

---

## 🔑 Jak To Działa

### Mechanizm:

1. **Bundler** (esbuild) widzi import `"@shopify/web-pixels-extension"`
2. **Sprawdza** package.json → nie ma tego pakietu
3. **Nie może** znaleźć w node_modules → nie ma node_modules
4. **KRYTYCZNE:** Bundler **nie próbuje** rozwiązać importu jeśli pakietu nie ma w dependencies
5. **Pozostawia** import w kodzie "as is"
6. **Runtime** Shopify dostarcza pakiet podczas wykonania

### TypeScript:

1. **TypeScript compiler** widzi import
2. **Szuka** type definitions → znajduje `shopify-web-pixels.d.ts`
3. **Weryfikuje** typy → wszystko OK
4. **Kompiluje** bez błędów

### Shopify CLI:

1. **Bundluje** kod przez esbuild
2. **Import pozostaje** w bundle ponieważ nie ma pakietu do spakowania
3. **Deploy** przechodzi
4. **Runtime** ładuje `@shopify/web-pixels-extension` z Shopify servers

---

## 🧪 Weryfikacja

### Przed deployem:

```bash
$ cat extensions/my-web-pixel/package.json
{
  "name": "my-web-pixel",
  "version": "1.0.0",
  "main": "dist/main.js",
  "license": "UNLICENSED"
}

$ ls extensions/my-web-pixel/src/
index.ts
shopify-web-pixels.d.ts
```

### Deploy:

```bash
$ shopify app deploy
```

**Oczekiwany output:**
```
asystent-klienta │ Running theme check...
    my-web-pixel │ Bundling UI extension...
                 ✓ Bundling successful
```

---

## 💡 Dlaczego Poprzednie Rozwiązania Nie Zadziałały

### Problem z Shopify CLI 3.87.4:

1. **extension.config.js** - CLI w ogóle nie czyta tego pliku dla web pixels
2. **TOML [build]** - Ta wersja CLI nie wspiera tej składni
3. **peerDependencies** - esbuild w Shopify CLI ignoruje peerDependencies flag

### Prawdziwy Problem:

Shopify CLI 3.87.4 używa **wbudowanego esbuild** z **własnymi regułami bundlingu**. 

- Nie czyta custom config files
- Nie respektuje peerDependencies dla external
- Jedyny sposób aby nie bundlować: **nie mieć pakietu w package.json**

---

## 🚀 Co Jeśli To Nadal Nie Działa

### Scenariusz 1: Błąd TypeScript

**Objaw:**
```
error TS2307: Cannot find module '@shopify/web-pixels-extension'
```

**Rozwiązanie:**
Rozszerz type declaration:

```typescript
// shopify-web-pixels.d.ts
declare module "@shopify/web-pixels-extension" {
  export interface AnalyticsContext {
    subscribe(event: string, callback: (data: any) => void): void;
  }
  
  export interface BrowserContext {
    sessionStorage: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
    };
  }
  
  export interface RegisterContext {
    analytics: AnalyticsContext;
    browser: BrowserContext;
    init: any;
  }
  
  export function register(callback: (context: RegisterContext) => void | Promise<void>): void;
}
```

### Scenariusz 2: Bundler Nadal Próbuje Bundlować

**Objaw:**
```
[ERROR] Could not resolve "@shopify/web-pixels-extension"
```

**Możliwe przyczyny:**
1. package-lock.json lub node_modules zawiera stary pakiet
2. Cache bundlera

**Rozwiązanie:**
```bash
cd extensions/my-web-pixel
rm -rf node_modules package-lock.json
cd ../..
shopify app deploy
```

### Scenariusz 3: Runtime Error

**Objaw:**
```
ReferenceError: register is not defined
```

**Przyczyna:**
Shopify runtime nie ładuje pakietu poprawnie

**Rozwiązanie:**
To by oznaczało problem z Shopify platform - zgłoś support ticket

---

## 📊 Porównanie Wszystkich Rozwiązań

| Próba | Podejście | Wymaga | Status |
|-------|-----------|---------|--------|
| 1 | extension.config.js | Custom file | ❌ Nie działa |
| 2 | TOML [build] | TOML config | ❌ Nie działa |
| 3 | peerDependencies | npm feature | ❌ Nie działa |
| 4 | Brak pakietu | Type declarations | 🔄 Testowanie |

---

## 🎯 Wniosek

**To jest ostatnie możliwe rozwiązanie na poziomie konfiguracji projektu.**

Jeśli to nie zadziała, problem leży w:
1. Konfiguracji Shopify CLI
2. Strukturze projektu
3. Lub bugiem w Shopify CLI 3.87.4

W takim przypadku konieczne będzie:
- Zgłoszenie do Shopify Support
- Upgrade/downgrade Shopify CLI
- Lub przepisanie kodu aby nie używać importu

---

**Status:** CZEKAM NA WYNIK TESTU  
**Następny krok:** Jeśli to nie działa, rozważyć przepisanie bez importu
