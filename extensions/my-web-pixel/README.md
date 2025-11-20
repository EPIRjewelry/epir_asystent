# Web Pixel Extension - Setup

## Instalacja Zależności

Przed deployem aplikacji, musisz zainstalować zależności dla tego rozszerzenia:

```bash
cd extensions/my-web-pixel
npm install
```

To zainstaluje pakiet `@shopify/web-pixels-extension` w `node_modules/`.

## Dlaczego To Jest Konieczne?

Shopify CLI wymaga aby:
1. Pakiet był zadeklarowany w `package.json` ✅ (jest)
2. Pakiet był zainstalowany w `node_modules/` ⚠️ (musisz zainstalować)
3. Konfiguracja `extension.config.mjs` oznacza go jako external ✅ (jest)

## Deploy

Po instalacji zależności:

```bash
cd ../..  # Powrót do głównego katalogu
shopify app deploy
```

## Struktura

```
extensions/my-web-pixel/
├── package.json              ← Dependencies zadeklarowane
├── extension.config.mjs      ← External config
├── node_modules/             ← ZAINSTALUJ przez npm install
│   └── @shopify/web-pixels-extension/
├── src/
│   └── index.ts
└── shopify.extension.toml
```

## Uwaga

`node_modules/` jest w `.gitignore` i nie jest commitowany do repozytorium.
Każdy developer musi uruchomić `npm install` lokalnie.
