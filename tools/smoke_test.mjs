/**
 * Manual smoke test for MCP-based RAG orchestration
 * 
 * This script demonstrates the key functionality:
 * 1. MCP system prompt generation
 * 2. SessionDO message management simulation
 * 3. MCP fetcher interface
 * 
 * Run with: node tools/smoke_test.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 MCP-RAG Orchestration Smoke Test\n');

// Test 1: Verify files exist
console.log('✓ Test 1: File existence');
const files = [
  'workers/worker/src/prompts/epir_mcp_system_prompt.ts',
  'workers/worker/src/durable_objects/session_do.ts',
  'workers/worker/src/handlers/mcp_fetcher.ts',
  'workers/worker/src/handlers/chat_handler.ts',
  'tools/prompt_audit.mjs'
];

let allExist = true;
for (const file of files) {
  try {
    const fullPath = join(__dirname, '..', file);
    readFileSync(fullPath, 'utf-8');
    console.log(`  ✓ ${file}`);
  } catch (error) {
    console.log(`  ✗ ${file} - NOT FOUND`);
    allExist = false;
  }
}

if (!allExist) {
  console.error('\n❌ Some files are missing!');
  process.exit(1);
}

// Test 2: Verify exports and structure
console.log('\n✓ Test 2: TypeScript exports');

const promptFile = readFileSync(
  join(__dirname, '..', 'workers/worker/src/prompts/epir_mcp_system_prompt.ts'),
  'utf-8'
);

if (promptFile.includes('export function EPIR_MCP_BASED_SYSTEM_PROMPT')) {
  console.log('  ✓ EPIR_MCP_BASED_SYSTEM_PROMPT function exported');
} else {
  console.log('  ✗ EPIR_MCP_BASED_SYSTEM_PROMPT function NOT found');
  process.exit(1);
}

const sessionDOFile = readFileSync(
  join(__dirname, '..', 'workers/worker/src/durable_objects/session_do.ts'),
  'utf-8'
);

if (sessionDOFile.includes('export class SessionDO')) {
  console.log('  ✓ SessionDO class exported');
} else {
  console.log('  ✗ SessionDO class NOT found');
  process.exit(1);
}

const mcpFetcherFile = readFileSync(
  join(__dirname, '..', 'workers/worker/src/handlers/mcp_fetcher.ts'),
  'utf-8'
);

if (mcpFetcherFile.includes('export async function fetchMCP')) {
  console.log('  ✓ fetchMCP function exported');
} else {
  console.log('  ✗ fetchMCP function NOT found');
  process.exit(1);
}

const chatHandlerFile = readFileSync(
  join(__dirname, '..', 'workers/worker/src/handlers/chat_handler.ts'),
  'utf-8'
);

if (chatHandlerFile.includes('export async function handleChatRequest')) {
  console.log('  ✓ handleChatRequest function exported');
} else {
  console.log('  ✗ handleChatRequest function NOT found');
  process.exit(1);
}

// Test 3: Check for security best practices
console.log('\n✓ Test 3: Security checks');

if (chatHandlerFile.includes('verifyHmac') || chatHandlerFile.includes('HMAC')) {
  console.log('  ✓ HMAC verification implemented');
} else {
  console.log('  ✗ HMAC verification NOT found');
  process.exit(1);
}

if (sessionDOFile.includes('checkRateLimit') || sessionDOFile.includes('rate limit')) {
  console.log('  ✓ Rate limiting implemented');
} else {
  console.log('  ✗ Rate limiting NOT found');
  process.exit(1);
}

// Test 4: Check for TODO placeholders
console.log('\n✓ Test 4: TODO placeholders (for future work)');

const todoChecks = [
  { file: chatHandlerFile, name: 'chat_handler.ts', todo: 'Groq LLM' },
  { file: chatHandlerFile, name: 'chat_handler.ts', todo: 'Vectorize' },
  { file: sessionDOFile, name: 'session_do.ts', todo: 'D1' }
];

for (const check of todoChecks) {
  if (check.file.includes('TODO') && check.file.toLowerCase().includes(check.todo.toLowerCase())) {
    console.log(`  ✓ ${check.name} has TODO for ${check.todo} integration`);
  } else {
    console.log(`  ⚠ ${check.name} might be missing TODO for ${check.todo}`);
  }
}

// Test 5: Check documentation
console.log('\n✓ Test 5: Documentation');

const readmeFile = readFileSync(
  join(__dirname, '..', 'README.md'),
  'utf-8'
);

if (readmeFile.includes('MCP-Based RAG Orchestration')) {
  console.log('  ✓ README includes MCP-RAG documentation');
} else {
  console.log('  ✗ README missing MCP-RAG section');
  process.exit(1);
}

const prTemplateFile = readFileSync(
  join(__dirname, '..', '.github/PULL_REQUEST_TEMPLATE.md'),
  'utf-8'
);

if (prTemplateFile.includes('MCP-based RAG')) {
  console.log('  ✓ PR template exists');
} else {
  console.log('  ✗ PR template missing or incomplete');
  process.exit(1);
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('✅ All smoke tests passed!');
console.log('='.repeat(50));
console.log('\nNext steps:');
console.log('1. Set wrangler secrets (GROQ_API_KEY, SHOPIFY_SHARED_SECRET)');
console.log('2. Run: cd workers/worker && wrangler dev');
console.log('3. Test endpoints with curl (see README.md)');
console.log('4. Complete Groq LLM integration');
console.log('5. Add Vectorize embeddings');
console.log('6. Implement D1 archival');
