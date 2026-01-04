## Migracja środowiska deweloperskiego i backup projektu — EPIR Asystent

Dokument zawiera kompletny, powtarzalny zestaw kroków do przeniesienia pracy deweloperskiej na nowy komputer oraz do zarchiwizowania bieżącego stanu repozytorium wraz z sekretami (bez ich ujawniania w repo).

UWAGA: Nie commituj plików zawierających sekrety (.env z prawdziwymi kluczami, prywatnych kluczy SSH itp.). Zawsze szyfruj przed przeniesieniem.

1) Cel
- Zabezpieczyć wszystkie lokalne zmiany i historię git.
- Wyeksportować sekrety w postaci zaszyfrowanego archiwum.
- Przygotować instrukcję odtworzenia środowiska na nowym komputerze.

2) Szybki checklist (krótka wersja)
- Wykonać commit i push wszystkich branchy: `git push --all origin` oraz `git push --tags origin`.
- Stworzyć `git bundle` if remote not available: `git bundle create epir_backup.bundle --all`.
- Zaszyfrować sekrety (gpg / 7z) i przenieść plik na nową maszynę.
- Na nowej maszynie: sklonować repo, odszyfrować sekrety, zainstalować narzędzia, przywrócić sekrety do `wrangler secret` i `.env`.

3) Szczegółowe kroki na starym komputerze

a) Weryfikacja stanu repo

```bash
cd /path/to/epir_asystent
git status --porcelain
git branch --show-current
git rev-parse --abbrev-ref --all
```

b) Commit & push (zalecane)

```bash
git add -A
git commit -m "WIP: backup before machine move" || echo "no changes to commit"
git push --all origin
git push --tags origin
```

c) Stwórz `git bundle` (jeśli chcesz przenieść offline lub masz niestandardowe branche)

```bash
# utworzy plik epir_backup.bundle zawierający wszystkie branche i tagi
git bundle create epir_backup.bundle --all
```

d) Zabezpieczenie sekretów (zalecane: GPG)

1. Zidentyfikuj pliki i wartości: `.env`, `wrangler.toml` (sekretne pola), eksportowane `wrangler secret` (zapisz wartości ręcznie), `~/.ssh/id_ed25519` lub inny prywatny klucz, pliki certyfikatów.
2. Stwórz archiwum i zaszyfruj:

```bash
tar czf epir_secrets.tar.gz .env wrangler.toml path/to/other/keys
gpg -e -r "Twój GPG ID" -o epir_secrets.gpg epir_secrets.tar.gz
rm epir_secrets.tar.gz
```

Alternatywa (Windows bez GPG): 7zip z hasłem:

```powershell
7z a -pYOUR_PASSWORD epir_secrets.7z .env wrangler.toml
```

Przenieś `epir_backup.bundle` i `epir_secrets.gpg`/`epir_secrets.7z` na nową maszynę (SCP, USB, bezpieczny transfer).

4) Przygotowanie nowego komputera

a) Instalacja narzędzi (przykład dla PowerShell/Windows):

```powershell
# Node (nvm dla Windows lub instalator)
nvm install --lts
nvm use --lts

# git
# wrangler (Cloudflare)
npm install -g wrangler

# Shopify CLI
npm install -g @shopify/cli

# opcjonalnie: gh (GitHub CLI), gpg, 7zip
```

b) Utworzenie kluczy SSH i import GPG (jeśli używasz)

```bash
ssh-keygen -t ed25519 -C "you@example.com"
# Dodaj klucz publiczny do GitHub (UI) lub użyj gh cli
gh auth login
```

c) Sklonowanie repo

```bash
git clone git@github.com:EPIRjewelry/asystent.git
cd asystent
```

d) Jeżeli otrzymałeś `epir_backup.bundle` zamiast klonowania normalnego repo:

```bash
git clone epir_backup.bundle repo_from_bundle
# lub fetch z bundle
git fetch /path/to/epir_backup.bundle refs/heads/*:refs/heads/*
```

5) Odszyfrowanie i przywrócenie sekretów

a) Odszyfruj plik GPG (jeżeli używasz GPG):

```bash
gpg -d epir_secrets.gpg > epir_secrets.tar.gz
tar xzf epir_secrets.tar.gz
```

b) Ustaw wrangler i Cloudflare secrets:

```bash
wrangler login
# w razie potrzeby ustaw CF account id i token jako zmienne środowiskowe
export CF_ACCOUNT_ID="xxxx"
export CF_API_TOKEN="xxxx"

# dodaj secrete do workerów interaktywnie
wrangler secret put <SECRET_NAME>
```

c) Shopify: zaloguj się i skonfiguruj app

```bash
shopify login --store your-store.myshopify.com
# lub shopify app login
```

6) Instalacja zależności i uruchomienie

W katalogu projektu i w każdym serwisie:

```bash
npm install
cd services/customer-dialogue
npm install
cd ../web-pixel-ingestor
npm install
```

Uruchom lokalne środowisko (przykłady):

```bash
wrangler dev services/gateway --local
wrangler dev services/customer-dialogue --local
```

7) Weryfikacja (smoke tests)
- Uruchom `wrangler tail` by obserwować logi workerów.
- Wykonaj test POST do pixela:

```bash
curl -X POST https://<gateway-host>/api/pixel/ingest -H 'Content-Type: application/json' -d '{"event_type":"product_viewed","session_id":"test-1"}'
```

- Przetestuj chat flow: wyślij POST do `/api/chat/send?sessionId=...` i sprawdź, czy DO zapisuje wiadomość i czy Brain-Service zwraca odpowiedź.

8) Dobre praktyki po przenosinach
- Nie commituj `.env` z prawdziwymi kluczami.
- Używaj `wrangler secret put` do sensytywnych wartości.
- Regularnie pushuj branche i tagi. W razie awarii użyj `git bundle`.
- Dokumentuj wszelkie zmiany konfiguracji w `docs/`.

9) Załączniki i referencje
- Umieść kopię tego pliku w repo jako `docs/MACHINE_MIGRATION_AND_ARCHIVE.md` (ten plik).
- Jeżeli chcesz automatyzować, dodamy `scripts/migrate.ps1` oraz `scripts/deploy-all.ps1`.

---
Checklist po przeniesieniu (quick):
- [ ] Repo sklonowane i branche dostępne
- [ ] Sekrety odszyfrowane i załadowane do `wrangler secret` lub `.env` (lokalnie)
- [ ] `wrangler login` oraz `shopify login` wykonane
- [ ] `npm install` w root i serwisach
- [ ] `wrangler dev` uruchamia core workery bez błędów
- [ ] Smoke test chat i pixel przechodzi pomyślnie
