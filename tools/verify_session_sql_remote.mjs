// Remote verification script for deployed SessionDO
// Run: node tools/verify_session_sql_remote.mjs

const WORKER_URL = 'https://asystent.epirbizuteria.pl';

async function run() {
  console.log('🔍 Starting remote verification against', WORKER_URL);

  // Clear
  console.log('🧹 Clearing state...');
  let res = await fetch(`${WORKER_URL}/clear`, { method: 'POST' });
  console.log('Clear status:', res.status, 'body:', await res.text());

  // Append
  const testMessage = {
    role: 'user',
    content: 'Test message with complex content',
    timestamp: Date.now(),
    tool_calls: [{ name: 'search_product', args: { query: 'ring' } }]
  };

  console.log('📝 Appending message...');
  res = await fetch(`${WORKER_URL}/append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testMessage)
  });
  console.log('Append status:', res.status, 'body:', await res.text());

  // History
  console.log('📖 Fetching history...');
  res = await fetch(`${WORKER_URL}/history`);
  console.log('History status:', res.status);
  const body = await res.text();
  console.log('History raw:', body);

  let ok = false;
  try {
    const json = JSON.parse(body);
    const first = Array.isArray(json) ? json[0] : json[0] || json.messages?.[0];
    console.log('First message:', first);
    if (first && first.content === testMessage.content && first.tool_calls && first.tool_calls[0].name === 'search_product') {
      ok = true;
    }
  } catch (e) {
    console.error('JSON parse error:', e.message);
  }

  if (ok) {
    console.log('✅ Remote verification OK');
    process.exit(0);
  } else {
    console.error('❌ Remote verification FAILED');
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
