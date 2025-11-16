/**
 * Shared JSON-RPC 2.0 types and utilities for MCP communication
 * Extracted from duplicated interfaces across the codebase
 */

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JsonRpcResponse<T = any> {
  jsonrpc: '2.0';
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

/**
 * MCP-specific request format
 */
export interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

/**
 * MCP-specific response format
 */
export interface McpResponse<T = any> {
  jsonrpc?: '2.0';
  id?: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * MCP content item format
 */
export interface McpContentItem {
  type: string;
  text?: string;
  title?: string;
  [key: string]: any;
}

/**
 * Create a JSON-RPC 2.0 success response
 */
export function createJsonRpcSuccess<T>(id: string | number, result: T): JsonRpcResponse<T> {
  return {
    jsonrpc: '2.0',
    result,
    id
  };
}

/**
 * Create a JSON-RPC 2.0 error response
 */
export function createJsonRpcError(
  id: string | number,
  code: number,
  message: string,
  data?: any
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error: { code, message, data },
    id
  };
}

/**
 * Extract text content from MCP response content array
 */
export function extractMcpTextContent(content: McpContentItem[] | undefined): string {
  if (!content || !Array.isArray(content)) return '';
  
  const textContent = content.find((c) => c.type === 'text');
  return textContent?.text || '';
}
