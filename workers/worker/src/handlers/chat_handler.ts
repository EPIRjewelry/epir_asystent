/**
 * workers/worker/src/handlers/chat_handler.ts
 * 
 * Chat Handler - Main request handler for chat endpoint
 * 
 * Purpose:
 * - Handle incoming chat requests from Shopify App Proxy
 * - Verify HMAC signatures for security
 * - Orchestrate MCP fetching and RAG context building
 * - Manage session state via SessionDO
 * - Integrate with LLM for response generation
 * 
 * Flow:
 * 1. Verify HMAC (security)
 * 2. Extract shop domain and session info
 * 3. Fetch top-k passages from MCP
 * 4. Build RAG context
 * 5. Call LLM (placeholder for Groq/AI service)
 * 6. Save messages to SessionDO
 * 7. Return formatted response
 * 
 * Usage:
 * ```typescript
 * import { handleChatRequest } from './handlers/chat_handler';
 * 
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     if (url.pathname === '/apps/assistant/chat') {
 *       return handleChatRequest(request, env);
 *     }
 *   }
 * }
 * ```
 */

import { verifyHmac } from '../hmac';
import { fetchMCP, buildRagContextSummary, MCPPassage } from './mcp_fetcher';
import { EPIR_MCP_BASED_SYSTEM_PROMPT } from '../prompts/epir_mcp_system_prompt';
import type { MessageRecord } from '../durable_objects/session_do';

/**
 * Environment bindings (should match your Env interface)
 */
export interface Env {
  /** Shopify shared secret for HMAC verification */
  SHOPIFY_SHARED_SECRET?: string;
  
  /** Shopify Admin API token */
  SHOPIFY_ADMIN_TOKEN?: string;
  
  /** Shop domain */
  SHOP_DOMAIN?: string;
  
  /** SessionDO namespace */
  SESSION_DO?: DurableObjectNamespace;
  
  /** Groq API key (for LLM) */
  GROQ_API_KEY?: string;
  
  /** Dev bypass flag (skip HMAC in development) */
  DEV_BYPASS?: string;
  
  /** Vectorize index binding (for embeddings) */
  VECTOR_INDEX?: any;
  
  /** AI binding (Cloudflare AI) */
  AI?: any;
}

/**
 * Chat request payload structure
 */
interface ChatRequestPayload {
  /** User message text */
  message: string;
  
  /** Session ID (for state continuity) */
  sessionId?: string;
  
  /** Customer ID (Shopify customer ID) */
  customerId?: string;
  
  /** Cart ID (Shopify cart token) */
  cartId?: string;
  
  /** Enable streaming response (not implemented yet) */
  stream?: boolean;
}

/**
 * Chat response structure
 */
interface ChatResponse {
  /** Assistant reply text */
  reply: string;
  
  /** RAG sources used */
  sources: Array<{
    text: string;
    score: number;
    source: string;
  }>;
  
  /** Suggested actions (e.g., add to cart, view product) */
  actions?: Array<{
    type: string;
    [key: string]: any;
  }>;
  
  /** Session ID for continuity */
  sessionId?: string;
}

/**
 * Handle chat request
 * 
 * Main entry point for chat endpoint. Verifies HMAC, fetches MCP data,
 * generates response, and manages session state.
 * 
 * @param request - Incoming HTTP request
 * @param env - Cloudflare Worker environment
 * @returns Promise<Response> - JSON response with chat reply
 * 
 * @example
 * const response = await handleChatRequest(request, env);
 * // Returns: { reply: '...', sources: [...], sessionId: '...' }
 */
export async function handleChatRequest(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*', // TODO: Restrict to allowed origins
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Shopify-Shop-Domain',
      'Content-Type': 'application/json'
    };
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Only accept POST
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: corsHeaders }
      );
    }
    
    // Extract shop domain from header or query param
    const url = new URL(request.url);
    const shopDomain = 
      request.headers.get('X-Shopify-Shop-Domain') ||
      url.searchParams.get('shop') ||
      env.SHOP_DOMAIN ||
      'epir-art-silver-jewellery.myshopify.com';
    
    // Verify HMAC (skip in dev mode)
    const devBypass = env.DEV_BYPASS === '1' || env.DEV_BYPASS === 'true';
    
    if (!devBypass && env.SHOPIFY_SHARED_SECRET) {
      const isValid = await verifyRequestHmac(request, env.SHOPIFY_SHARED_SECRET);
      
      if (!isValid) {
        console.error('handleChatRequest: HMAC verification failed');
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Invalid signature' }),
          { status: 401, headers: corsHeaders }
        );
      }
    }
    
    // Parse request payload
    const payload = await parseRequestPayload(request);
    
    if (!payload) {
      return new Response(
        JSON.stringify({ error: 'Bad request: Invalid payload' }),
        { status: 400, headers: corsHeaders }
      );
    }
    
    // Generate or retrieve session ID
    const sessionId = payload.sessionId || generateSessionId();
    
    // Fetch MCP passages (RAG step 1)
    let passages: MCPPassage[] = [];
    try {
      passages = await fetchMCP(shopDomain, payload.message, {
        adminToken: env.SHOPIFY_ADMIN_TOKEN,
        topK: 5,
        method: 'search_dev_docs'
      });
      
      console.log(`handleChatRequest: Fetched ${passages.length} MCP passages`);
    } catch (error) {
      console.error('handleChatRequest: MCP fetch error', error);
      // Continue without passages (graceful degradation)
    }
    
    // Build RAG context summary
    const ragContext = buildRagContextSummary(passages, 5);
    
    // TODO: Vectorize/Embedding Integration
    // If VECTOR_INDEX is available, perform semantic search:
    //
    // if (env.VECTOR_INDEX && env.AI) {
    //   const embedding = await generateEmbedding(env.AI, payload.message);
    //   const vectorResults = await env.VECTOR_INDEX.query(embedding, { topK: 5 });
    //   // Merge with MCP passages
    // }
    
    // Build system prompt
    const systemPrompt = EPIR_MCP_BASED_SYSTEM_PROMPT(shopDomain);
    
    // Build conversation context
    const conversationHistory = await getSessionHistory(env, sessionId);
    
    // TODO: Groq LLM Integration
    // Call Groq API to generate response:
    //
    // const messages = [
    //   { role: 'system', content: systemPrompt },
    //   { role: 'system', content: `RAG Context:\n${ragContext}` },
    //   ...conversationHistory,
    //   { role: 'user', content: payload.message }
    // ];
    //
    // const llmResponse = await callGroqAPI(env.GROQ_API_KEY, messages);
    //
    // For now, placeholder response:
    
    const assistantReply = generatePlaceholderReply(payload.message, passages);
    
    // Save messages to SessionDO
    if (env.SESSION_DO) {
      try {
        await saveMessageToSession(env, sessionId, {
          role: 'user',
          content: payload.message,
          timestamp: Date.now()
        });
        
        await saveMessageToSession(env, sessionId, {
          role: 'assistant',
          content: assistantReply,
          timestamp: Date.now()
        });
        
        // Update session metadata if customer ID provided
        if (payload.customerId || payload.cartId) {
          await updateSessionMetadata(env, sessionId, {
            customer_id: payload.customerId,
            cart_id: payload.cartId
          });
        }
      } catch (error) {
        console.error('handleChatRequest: Error saving to SessionDO', error);
        // Continue despite error (non-critical)
      }
    }
    
    // Format response
    const response: ChatResponse = {
      reply: assistantReply,
      sources: passages.map(p => ({
        text: p.text.slice(0, 200),
        score: p.score,
        source: p.source
      })),
      sessionId
    };
    
    return new Response(
      JSON.stringify(response),
      { headers: corsHeaders }
    );
    
  } catch (error) {
    console.error('handleChatRequest: Unexpected error', error);
    
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Verify HMAC signature on request
 * 
 * Shopify App Proxy signs requests with HMAC-SHA256.
 * This function verifies the signature to prevent tampering.
 * 
 * @param request - HTTP request
 * @param sharedSecret - Shopify shared secret
 * @returns Promise<boolean> - True if valid
 */
async function verifyRequestHmac(
  request: Request,
  sharedSecret: string
): Promise<boolean> {
  try {
    const url = new URL(request.url);
    const hmacHeader = url.searchParams.get('hmac') || request.headers.get('X-Shopify-Hmac-SHA256');
    
    if (!hmacHeader) {
      console.warn('verifyRequestHmac: No HMAC header found');
      return false;
    }
    
    // Build canonical query string (excluding hmac and signature)
    const params = new URLSearchParams(url.search);
    params.delete('hmac');
    params.delete('signature');
    
    const sortedParams = Array.from(params.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    
    // Verify HMAC
    const isValid = await verifyHmac(hmacHeader, sharedSecret, sortedParams);
    
    return isValid;
    
  } catch (error) {
    console.error('verifyRequestHmac: Error', error);
    return false;
  }
}

/**
 * Parse request payload
 */
async function parseRequestPayload(request: Request): Promise<ChatRequestPayload | null> {
  try {
    const body = await request.json() as any;
    
    if (!body || typeof body.message !== 'string' || body.message.trim().length === 0) {
      return null;
    }
    
    return {
      message: body.message,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      customerId: typeof body.customerId === 'string' ? body.customerId : undefined,
      cartId: typeof body.cartId === 'string' ? body.cartId : undefined,
      stream: typeof body.stream === 'boolean' ? body.stream : false
    };
  } catch (error) {
    console.error('parseRequestPayload: Error', error);
    return null;
  }
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get session history from SessionDO
 */
async function getSessionHistory(env: Env, sessionId: string): Promise<MessageRecord[]> {
  if (!env.SESSION_DO) {
    return [];
  }
  
  try {
    const doId = env.SESSION_DO.idFromName(sessionId);
    const doStub = env.SESSION_DO.get(doId);
    
    const response = await doStub.fetch(new Request('http://do/messages?limit=20'));
    const data = await response.json() as { messages: MessageRecord[] };
    
    return data.messages || [];
  } catch (error) {
    console.error('getSessionHistory: Error', error);
    return [];
  }
}

/**
 * Save message to SessionDO
 */
async function saveMessageToSession(
  env: Env,
  sessionId: string,
  message: MessageRecord
): Promise<void> {
  if (!env.SESSION_DO) {
    return;
  }
  
  try {
    const doId = env.SESSION_DO.idFromName(sessionId);
    const doStub = env.SESSION_DO.get(doId);
    
    await doStub.fetch(new Request('http://do/messages', {
      method: 'POST',
      body: JSON.stringify(message)
    }));
  } catch (error) {
    console.error('saveMessageToSession: Error', error);
    throw error;
  }
}

/**
 * Update session metadata
 */
async function updateSessionMetadata(
  env: Env,
  sessionId: string,
  metadata: Record<string, any>
): Promise<void> {
  if (!env.SESSION_DO) {
    return;
  }
  
  try {
    const doId = env.SESSION_DO.idFromName(sessionId);
    const doStub = env.SESSION_DO.get(doId);
    
    await doStub.fetch(new Request('http://do/metadata', {
      method: 'POST',
      body: JSON.stringify(metadata)
    }));
  } catch (error) {
    console.error('updateSessionMetadata: Error', error);
    // Non-critical, don't throw
  }
}

/**
 * Generate placeholder reply (until LLM integration is complete)
 * 
 * TODO: Replace with actual Groq API call
 */
function generatePlaceholderReply(userMessage: string, passages: MCPPassage[]): string {
  const hasPassages = passages.length > 0;
  
  if (hasPassages) {
    const topSource = passages[0].source;
    return `Thank you for your question about "${userMessage}". Based on our documentation (${topSource}), I can help with that. [PLACEHOLDER: Replace with Groq LLM response]\n\nRelevant information found: ${passages.length} passages.`;
  }
  
  return `Thank you for your message: "${userMessage}". [PLACEHOLDER: Replace with Groq LLM response]\n\nNote: No specific documentation found for this query.`;
}

/**
 * TODO: Implement Groq API client
 * 
 * This function should call the Groq API to generate a response.
 * 
 * @example
 * ```typescript
 * async function callGroqAPI(apiKey: string, messages: any[]): Promise<string> {
 *   const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
 *     method: 'POST',
 *     headers: {
 *       'Authorization': `Bearer ${apiKey}`,
 *       'Content-Type': 'application/json'
 *     },
 *     body: JSON.stringify({
 *       model: 'llama-3.3-70b-versatile',
 *       messages,
 *       temperature: 0.7,
 *       max_tokens: 500
 *     })
 *   });
 *   
 *   const data = await response.json();
 *   return data.choices[0].message.content;
 * }
 * ```
 */

/**
 * TODO: Implement embedding generation
 * 
 * Use Cloudflare AI binding to generate embeddings for semantic search.
 * 
 * @example
 * ```typescript
 * async function generateEmbedding(ai: any, text: string): Promise<number[]> {
 *   const response = await ai.run('@cf/baai/bge-large-en-v1.5', {
 *     text: [text]
 *   });
 *   
 *   return response.data[0];
 * }
 * ```
 */
