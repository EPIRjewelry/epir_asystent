## Description

This PR implements MCP-based RAG (Retrieval-Augmented Generation) orchestration with a serverless backend on Cloudflare Workers. It includes:

- **MCP-based system prompt** that instructs the AI model to use MCP as the source of truth
- **SessionDO (Durable Object)** for managing chat sessions with message history and metadata
- **HMAC verification** for secure request validation
- **MCP fetcher** for JSON-RPC calls to Shopify MCP endpoint
- **Chat handler** orchestrating the complete flow: HMAC → MCP → RAG → LLM → SessionDO
- **Prompt audit script** for validating prompt quality and best practices

## Implementation Details

### New Files

1. **`workers/worker/src/prompts/epir_mcp_system_prompt.ts`**
   - Exports `EPIR_MCP_BASED_SYSTEM_PROMPT(shopDomain)` function
   - Instructs model to use MCP as source of truth
   - Enforces top-k passage retrieval, limited citations, consent before PII access
   - Supports JSON response format when needed

2. **`workers/worker/src/durable_objects/session_do.ts`**
   - `SessionDO` class with message management (save, list, count, delete)
   - Session metadata tracking (cart_id, customer_id, timestamps)
   - Rate limiting (20 requests/minute)
   - Archival mechanism (placeholder for D1/external storage)

3. **`workers/worker/src/handlers/mcp_fetcher.ts`**
   - `fetchMCP()` function for JSON-RPC calls to MCP endpoint
   - Normalizes responses to standard passage format `{text, score, source}`
   - Handles errors and provides graceful fallbacks
   - `buildRagContextSummary()` for formatting passages

4. **`workers/worker/src/handlers/chat_handler.ts`**
   - `handleChatRequest()` main entry point for chat endpoint
   - HMAC verification using `verifyHmac()` from existing `hmac.ts`
   - Orchestrates: MCP fetch → RAG context → LLM (placeholder) → SessionDO save
   - Includes TODOs for Groq LLM and Vectorize integration

5. **`tools/prompt_audit.ts`**
   - Standalone TypeScript script for auditing prompt files
   - Checks: memory/context, Chain of Thought, consent/PII, length, exports
   - Runnable with: `node --input-type=module tools/prompt_audit.ts`

6. **`.github/PULL_REQUEST_TEMPLATE.md`**
   - This template for consistent PR documentation

## Architecture

```
User Request
    ↓
[HMAC Verification] ← SHOPIFY_SHARED_SECRET
    ↓
[Chat Handler]
    ↓
[MCP Fetcher] ← Shopify MCP endpoint (https://{shop}.myshopify.com/api/mcp)
    ↓
[RAG Context Builder] ← top-k passages
    ↓
[LLM Service] ← Groq API (TODO: integration)
    ↓
[SessionDO] ← save messages
    ↓
Response (JSON: {reply, sources, actions, sessionId})
```

## Placeholders & TODOs

The following integrations are marked with TODO comments and placeholders:

- **Groq LLM client**: `chat_handler.ts` includes placeholder for Groq API call
- **Vectorize/Embeddings**: `chat_handler.ts` includes TODO for semantic search with Cloudflare AI
- **D1 Archival**: `session_do.ts` includes placeholder for archiving old messages to D1 database

These are intentionally left as placeholders to keep this PR focused on the core MCP-RAG orchestration structure.

## Security

✅ **No secrets in code**
- All secrets are expected via environment variables or `wrangler secrets`
- HMAC verification prevents request tampering
- PII consent enforced in system prompt
- Rate limiting in SessionDO prevents abuse

## Testing Instructions

### 1. Run Prompt Audit

```bash
# From repository root
node --input-type=module tools/prompt_audit.ts

# Or with tsx
npx tsx tools/prompt_audit.ts
```

Expected output: All prompts should pass with minimal warnings.

### 2. Set Wrangler Secrets

Before deploying or testing locally, set required secrets:

```bash
cd workers/worker

# Required secret
wrangler secret put GROQ_API_KEY
# Enter your Groq API key from https://console.groq.com/keys

# Optional secrets (for HMAC verification and MCP auth)
wrangler secret put SHOPIFY_SHARED_SECRET
# Enter your Shopify app's shared secret (from Shopify Partner Dashboard)

wrangler secret put SHOPIFY_ADMIN_TOKEN
# Enter your Shopify Admin API access token (for MCP authenticated requests)
```

### 3. Run Worker Locally

```bash
cd workers/worker

# Install dependencies (if needed)
npm install

# Start local dev server
wrangler dev
```

### 4. Test Endpoints

#### Test chat endpoint (basic)

```bash
# New session (no HMAC in dev mode with DEV_BYPASS=1)
curl -X POST http://localhost:8787/apps/assistant/chat \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Shop-Domain: epir-art-silver-jewellery.myshopify.com" \
  -d '{
    "message": "What is your return policy?",
    "sessionId": "test_session_1"
  }'
```

Expected response:
```json
{
  "reply": "Thank you for your question...",
  "sources": [
    {
      "text": "...",
      "score": 0.95,
      "source": "FAQ: Return Policy"
    }
  ],
  "sessionId": "test_session_1"
}
```

#### Test SessionDO directly

```bash
# Save message
curl -X POST http://localhost:8787/session/test_session_1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "role": "user",
    "content": "Hello!",
    "timestamp": 1702500000000
  }'

# Get messages
curl http://localhost:8787/session/test_session_1/messages

# Get message count
curl http://localhost:8787/session/test_session_1/count
```

### 5. Manual Test Scenarios

#### Scenario 1: New Customer
- Send chat message with no `sessionId`
- Verify new session ID is generated
- Verify message is saved to SessionDO
- Verify response includes sources from MCP

#### Scenario 2: Returning Customer
- Send chat message with existing `sessionId`
- Verify conversation history is retrieved
- Verify new messages are appended
- Verify session metadata is preserved

#### Scenario 3: No MCP Results
- Send query that MCP cannot answer (e.g., "What is the weather?")
- Verify graceful fallback (no sources)
- Verify response still generated

#### Scenario 4: HMAC Verification
- Set `DEV_BYPASS=0` in `.dev.vars`
- Send request without HMAC → expect 401 Unauthorized
- Send request with valid HMAC → expect 200 OK

## Checklist

- [x] Created `prompts/epir_mcp_system_prompt.ts` with MCP-based prompt
- [x] Created `durable_objects/session_do.ts` with message management
- [x] Created `handlers/mcp_fetcher.ts` with JSON-RPC MCP client
- [x] Created `handlers/chat_handler.ts` with complete flow orchestration
- [x] Created `tools/prompt_audit.ts` for prompt quality validation
- [x] Added `.github/PULL_REQUEST_TEMPLATE.md`
- [x] No secrets in code (all via env/wrangler secrets)
- [x] TypeScript ESM with full types
- [x] Error handling (try/catch) in all key functions
- [x] Inline comments and JSDoc documentation
- [ ] Run prompt audit script successfully
- [ ] Test chat handler with mock requests
- [ ] Verify SessionDO persistence
- [ ] Test HMAC verification
- [ ] Integration with Groq LLM (TODO)
- [ ] Integration with Vectorize (TODO)
- [ ] Integration with D1 archival (TODO)

## Future Work

This PR establishes the foundation for MCP-based RAG orchestration. Future PRs should address:

1. **Groq LLM Integration**: Replace placeholder in `chat_handler.ts` with actual Groq API client
2. **Vectorize Integration**: Add semantic search with Cloudflare AI embeddings
3. **D1 Archival**: Implement message archival from SessionDO to D1 database
4. **Streaming Responses**: Add SSE (Server-Sent Events) support for streaming LLM responses
5. **Advanced RAG**: Hybrid search combining MCP, Vectorize, and keyword search
6. **Analytics**: Track RAG passage relevance and user satisfaction

## Related Issues

<!-- Link to related issues or discussions -->

## Deployment Notes

**DO NOT DEPLOY** - This PR is for review only. No deployment should be made until:
1. Groq LLM integration is complete
2. All secrets are properly configured in production environment
3. Code review and approval received
4. Security scan passes

---

**Ready for Review**: This PR is complete and ready for code review. All core functionality is implemented with appropriate placeholders for future integrations.
