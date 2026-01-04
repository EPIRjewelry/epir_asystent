# REFACTORING_IMPACT.md (archiwum)

Oryginalna treść pliku została skopiowana tutaj podczas czyszczenia dokumentacji.

---

```markdown
# Refactoring Impact Analysis

## Visual Overview

### Before Refactoring
```
workers/worker/src/
├── rag.ts (718 lines)
│   ├── isString() ❌ duplicated
│   ├── isRecord() ❌ duplicated  
│   ├── safeJsonParse() ❌ duplicated
│   ├── asStringField() ❌ duplicated
│   └── callMcpTool() with retry ❌ duplicated
├── shopify-mcp-client.ts (438 lines)
│   ├── adminGraphql() ❌ duplicated
│   ├── JsonRpcRequest ❌ duplicated
│   └── JsonRpcResponse ❌ duplicated
└── mcp_server.ts (367 lines)
    ├── adminGraphql() ❌ duplicated
    ├── JsonRpcRequest ❌ duplicated
    └── JsonRpcResponse ❌ duplicated

workers/rag-worker/src/services/
└── shopify-mcp.ts (265 lines)
    ├── isString() ❌ duplicated
    ├── isRecord() ❌ duplicated
    ├── safeJsonParse() ❌ duplicated
    └── callShopifyMcp() with retry ❌ duplicated
```

... (skrócono dla archiwum)

```
