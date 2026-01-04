/**
 * Skrypt weryfikujący poprawność implementacji SQLite w SessionDO.
 * Uruchomienie: node tools/verify_session_sql.mjs
 * Wymaga uruchomionego workera lokalnie: npx wrangler dev
 */

const WORKER_URL = "http://localhost:8787"; // Upewnij się, że port jest poprawny

async function runTest() {
  console.log("🔍 Rozpoczynam testy SessionDO (SQLite)...");

  // 1. Wyczyść stan (żeby zacząć od czystej tabeli)
  console.log("🧹 Czyszczenie stanu...");
  await fetch(`${WORKER_URL}/clear`, { method: "POST" });

  // 2. Dodaj wiadomość testową (złożony obiekt z JSON w treści)
  const testMessage = {
    role: "user",
    content: "Test message with complex content",
    timestamp: Date.now(),
    tool_calls: [{ name: "search_product", args: { query: "ring" } }] // Test serializacji JSON w SQL
  };

  console.log("📝 Zapisywanie wiadomości...");
  const appendRes = await fetch(`${WORKER_URL}/append`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testMessage)
  });

  if (appendRes.status !== 200) {
    console.error("❌ Błąd zapisu (Append Failed):", await appendRes.text());
    process.exit(1);
  }
  console.log("✅ Zapis OK");

  // 3. Pobierz historię i zweryfikuj
  console.log("📖 Pobieranie historii...");
  const historyRes = await fetch(`${WORKER_URL}/history`);
  const history = await historyRes.json();

  if (!Array.isArray(history) || history.length === 0) {
    console.error("❌ Historia jest pusta lub błędna:", history);
    process.exit(1);
  }

  const savedMsg = history[0];
  
  // Weryfikacja poprawności danych (czy SQLite nie zgubił pól)
  if (savedMsg.content !== testMessage.content) {
    console.error("❌ Niezgodność treści (Content mismatch)");
    process.exit(1);
  }
  
  // Weryfikacja czy tool_calls zostały poprawnie zdeserializowane z TEXT w bazie
  if (!savedMsg.tool_calls || savedMsg.tool_calls[0].name !== "search_product") {
    console.error("❌ Błąd deserializacji JSON w tool_calls (SQL TEXT -> JSON problem)");
    console.log("Otrzymano:", savedMsg.tool_calls);
    process.exit(1);
  }

  console.log("✅ Odczyt OK. Struktura danych zachowana.");
  console.log("🚀 SessionDO działa poprawnie na silniku SQL!");
}

runTest().catch(err => { console.error(err); process.exit(1); });
