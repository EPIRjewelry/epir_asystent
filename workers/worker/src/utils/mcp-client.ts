/**
 * Shared MCP (Model Context Protocol) client utilities
 * Extracted from duplicated MCP calling logic across the codebase
 */

import { type McpRequest, type McpResponse } from './jsonrpc';
import { isString, isRecord, safeJsonParse } from './json';

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

/**
 * Execute MCP tool call with retry logic and rate limiting
 * 
 * @param endpoint - MCP endpoint URL
 * @param toolName - Name of the tool to call
 * @param args - Tool arguments
 * @param config - Retry configuration
 * @returns Parsed result or null on error
 */
export async function callMcpWithRetry(
  endpoint: string,
  toolName: string,
  args: Record<string, any>,
  config: McpRetryConfig = DEFAULT_MCP_RETRY_CONFIG
): Promise<any> {
  const payload: McpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
    id: Date.now(),
  };

  console.log(`[MCP] 📤 Calling tool: ${toolName} at ${endpoint}`, args);

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt < config.MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Handle rate limiting (429)
      if (res.status === 429) {
        const backoff = Math.min(
          config.INITIAL_BACKOFF_MS * (2 ** attempt),
          config.MAX_BACKOFF_MS
        );
        console.warn(`[MCP] ⚠️ Rate limited (429), retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      // Handle other HTTP errors
      if (!res.ok) {
        const errorText = await res.text().catch(() => '<no body>');
        console.error(`[MCP] ❌ HTTP ${res.status}:`, errorText);
        
        if (attempt < config.MAX_ATTEMPTS - 1) {
          const backoff = config.INITIAL_BACKOFF_MS * (2 ** attempt);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        return null;
      }

      // Parse response
      let response: unknown = await res.json().catch(() => null);
      
      // Handle double-encoded JSON
      if (isString(response)) {
        response = safeJsonParse(response);
      }

      if (!isRecord(response)) {
        console.error('[MCP] ❌ Invalid response format');
        return null;
      }

      const mcpResponse = response as McpResponse;

      // Check for JSON-RPC error
      if (mcpResponse.error) {
        console.error('[MCP] ❌ RPC Error:', mcpResponse.error);
        return null;
      }

      // Extract result
      const result = mcpResponse.result;
      if (!result) {
        console.warn('[MCP] ⚠️ Empty result');
        return null;
      }

      console.log(`[MCP] ✅ Tool ${toolName} succeeded`);
      
      // Handle double-encoded result
      if (isString(result)) {
        return safeJsonParse(result);
      }

      return result;

    } catch (err) {
      console.error(`[MCP] ❌ Attempt ${attempt + 1} failed:`, err);
      
      if (attempt < config.MAX_ATTEMPTS - 1) {
        const backoff = config.INITIAL_BACKOFF_MS * (2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        return null;
      }
    }
  }

  return null;
}

/**
 * Extract text content from MCP response content array
 */
export function extractMcpTextContent(result: any): string {
  if (!result) return '';
  
  // Extract text from MCP content array
  if (isRecord(result) && Array.isArray(result.content)) {
    const textContent = result.content
      .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n');
    
    return textContent || '';
  }

  // Fallback: stringify result
  return typeof result === 'string' ? result : JSON.stringify(result);
}
