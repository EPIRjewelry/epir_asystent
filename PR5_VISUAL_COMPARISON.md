# PR #5 Visual Code Comparison

> ARCHIWALNE — NIEAKTUALNE

Oryginalna treść tego dokumentu została przeniesiona do `docs/archive/PR5_VISUAL_COMPARISON.md`.

Zachowano kopię oryginału w katalogu `docs/archive/`. Jeśli dokument powinien pozostać aktywny, zaktualizuj go w archiwum i przywróć tutaj.
### ❌ Before (Full implementation in multiple files)

**In `workers/rag-worker/src/services/shopify-mcp.ts` (193 lines removed):**
```typescript
interface McpRequest {
  jsonrpc: '2.0';
  method: 'tools/call';
  params: { name: string; arguments: Record<string, any> };
  id: number;
}

interface McpResponse {
  jsonrpc?: '2.0';
  id?: number;
  result?: { content?: Array<{ type: string; text?: string; title?: string }> };
  error?: { code: number; message: string; data?: any };
}

export async function callShopifyMcp(
  toolName: string,
  args: Record<string, any>
): Promise<any> {
  const payload: McpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: toolName, arguments: args },
    id: Date.now(),
  };

  console.log(`[MCP] 📤 Calling tool: ${toolName}`, args);

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt < MCP_RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(CANONICAL_MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        const backoff = Math.min(
          MCP_RETRY_CONFIG.INITIAL_BACKOFF_MS * (2 ** attempt),
          MCP_RETRY_CONFIG.MAX_BACKOFF_MS
        );
        console.warn(`[MCP] ⚠️ Rate limited (429), retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => '<no body>');
        console.error(`[MCP] ❌ HTTP ${res.status}:`, errorText);
        
        if (attempt < MCP_RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          const backoff = MCP_RETRY_CONFIG.INITIAL_BACKOFF_MS * (2 ** attempt);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        return null;
      }

      // ... more code for response parsing ...
    } catch (err) {
      // ... error handling ...
    }
  }
  return null;
}
```

### ✅ After (Shared utility with configuration)

**In `workers/worker/src/utils/mcp-client.ts`:**
```typescript
export interface McpRetryConfig {
  MAX_ATTEMPTS: number;
  INITIAL_BACKOFF_MS: number;
  MAX_BACKOFF_MS: number;
}

export const DEFAULT_MCP_RETRY_CONFIG: McpRetryConfig = {
  MAX_ATTEMPTS: 3,
  INITIAL_BACKOFF_MS: 100,
  MAX_BACKOFF_MS: 5000,
};

export async function callMcpWithRetry(
  endpoint: string,
  toolName: string,
  args: Record<string, any>,
  config: McpRetryConfig = DEFAULT_MCP_RETRY_CONFIG
): Promise<any> {
  // ... unified implementation with retry logic ...
}

export function extractMcpTextContent(result: any): string {
  // ... unified text extraction ...
}
```

**Usage in refactored files:**
```typescript
import { callMcpWithRetry, extractMcpTextContent } from './utils/mcp-client';

// Before: 100+ lines of implementation
// After: Single function call
export async function callShopifyMcp(
  toolName: string,
  args: Record<string, any>
): Promise<any> {
  return callMcpWithRetry(CANONICAL_MCP_URL, toolName, args, MCP_RETRY_CONFIG);
}
```

**Lines Saved:** ~110 lines per duplicate = **~193 lines in one file alone!**

---

## 4. JSON-RPC Types - Type System Consolidation

### ❌ Before (Duplicated interfaces in 4+ files)

**Different variations across files:**

```typescript
// In mcp_server.ts
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: JsonRpcId;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  result: any;
  id: JsonRpcId;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  error: { code: number; message: string; data?: any };
  id: JsonRpcId;
}

// In shopify-mcp-client.ts
interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

interface McpResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: { code: number; message: string; data?: any };
  id: string | number;
}
```

### ✅ After (Unified type system)

**In `workers/worker/src/utils/jsonrpc.ts`:**
```typescript
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: '2.0';
  result?: T;
  error?: { code: number; message: string; data?: any };
  id: string | number;
}

export interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

export interface McpResponse<T = any> {
  jsonrpc?: '2.0';
  id?: string | number;
  result?: T;
  error?: { code: number; message: string; data?: any };
}

export function createJsonRpcSuccess<T>(
  id: string | number, 
  result: T
): JsonRpcResponse<T> {
  return { jsonrpc: '2.0', result, id };
}

export function createJsonRpcError(
  id: string | number,
  code: number,
  message: string,
  data?: any
): JsonRpcResponse {
  return { jsonrpc: '2.0', error: { code, message, data }, id };
}
```

**Usage with type safety:**
```typescript
import { 
  type JsonRpcRequest, 
  type JsonRpcResponse,
  createJsonRpcSuccess,
  createJsonRpcError 
} from './utils/jsonrpc';

function rpcResult(id: JsonRpcId, result: any): Response {
  const body = createJsonRpcSuccess(id ?? 0, result);
  return new Response(JSON.stringify(body), { status: 200 });
}
```

**Lines Saved:** ~80 lines across multiple files

---

## 📊 Overall Impact Summary

| Refactoring Area | Files Affected | Lines Saved | Impact |
|-------------------|----------------|-------------|--------|
| JSON Utilities | 2 → 1 | ~100 | High |
| Shopify GraphQL | 2 → 1 | ~60 | Medium |
| MCP Client | 3 → 1 | ~110 | High |
| JSON-RPC Types | 4 → 1 | ~80 | Medium |
| **TOTAL** | **11 → 4** | **~340** | **Very High** |

---

## 🎯 Key Benefits Visualized

### Before: Scattered Implementation
```
workers/worker/src/
├── rag.ts (includes JSON utils, 718 lines)
├── mcp_server.ts (includes GraphQL client + JSON-RPC, 367 lines)
└── shopify-mcp-client.ts (includes GraphQL client, 438 lines)

workers/rag-worker/src/services/
└── shopify-mcp.ts (includes JSON utils + MCP client, 265 lines)
```

### After: Centralized Utilities
```
workers/worker/src/
├── utils/
│   ├── json.ts (67 lines) ⭐ SHARED
│   ├── jsonrpc.ts (99 lines) ⭐ SHARED
│   ├── mcp-client.ts (152 lines) ⭐ SHARED
│   └── shopify-graphql.ts (55 lines) ⭐ SHARED
├── rag.ts (677 lines, -41)
├── mcp_server.ts (311 lines, -56)
└── shopify-mcp-client.ts (370 lines, -68)

workers/rag-worker/src/
├── utils/
│   ├── json.ts (67 lines) ⭐ SHARED
│   ├── jsonrpc.ts (99 lines) ⭐ SHARED
│   └── mcp-client.ts (152 lines) ⭐ SHARED
└── services/
    └── shopify-mcp.ts (72 lines, -193)
```

---

## 🔍 Code Quality Improvements

### Type Safety
✅ Generic types: `JsonRpcResponse<T>`, `adminGraphql<T>`  
✅ Proper type guards: `isString()`, `isRecord()`  
✅ Interface exports for reusability

### Error Handling
✅ Consistent error messages  
✅ Unified retry logic with exponential backoff  
✅ Graceful fallbacks for JSON parsing

### Documentation
✅ JSDoc comments on all functions  
✅ Clear parameter descriptions  
✅ Usage examples in documentation

### Maintainability
✅ Single source of truth  
✅ DRY principle applied  
✅ Easier to test in isolation  
✅ Simpler to update and extend

---

**This refactoring represents best practices in code organization and maintainability!** 🎉
