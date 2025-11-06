/**
 * RAG Worker - Domain: Context Formatter
 * 
 * Formats retrieved context (from MCP/Vectorize) for AI consumption.
 * Output must be compatible with Harmony protocol and MoE requirements.
 * 
 * @see workers/worker/src/rag.ts - formatRagContextForPrompt
 * @see Harmony Chat_ Shopify, MCP, API, UX.txt - Section II (Harmony Format)
 */

import { VectorizeResultItem } from '../services/vectorize';

/**
 * RAG result item (unified format for MCP + Vectorize results)
 */
export interface RagResultItem {
  id: string;
  title?: string;
  text?: string;
  snippet?: string;
  source?: string;
  score?: number;
  metadata?: any;
}

/**
 * RAG search result
 */
export interface RagSearchResult {
  query?: string;
  results: RagResultItem[];
}

/**
 * RAG document (normalized format)
 */
export interface RagDoc {
  id?: string;
  text: string;
  meta?: Record<string, unknown>;
}

/**
 * RAG context (for prompt injection)
 */
export interface RagContext {
  retrieved_docs: RagDoc[];
}

/**
 * Format RAG results for AI prompt injection
 * 
 * Creates structured context that activates proper MoE experts.
 * Format is optimized for Harmony protocol consumption.
 * 
 * @param rag - RAG search result
 * @returns Formatted context string
 * 
 * @example
 * ```typescript
 * const formatted = formatRagContextForPrompt({
 *   query: 'polityka zwrotów',
 *   results: [...]
 * });
 * // Output:
 * // Context (retrieved documents for query: "polityka zwrotów")
 * //
 * // [Doc 1] (85.3%) Polityka zwrotów: Masz 30 dni...
 * // ...
 * ```
 */
export function formatRagContextForPrompt(rag: RagSearchResult): string {
  if (!rag || !Array.isArray(rag.results) || rag.results.length === 0) {
    return '';
  }

  let output = '';
  
  if (rag.query) {
    output += `Context (retrieved documents for query: "${rag.query}")\n\n`;
  }

  const parts = rag.results.map((r, index) => {
    const docNum = index + 1;
    const title = r.title ? `${r.title}: ` : '';
    const text = (r.text || r.snippet || '') as string;
    const score = r.score ? `${(r.score * 100).toFixed(1)}%` : '';
    const metadata = r.metadata ? `\n${JSON.stringify(r.metadata)}` : '';
    return `[Doc ${docNum}] ${score ? `(${score}) ` : ''}${title}${text}${metadata}`;
  });

  output += parts.join('\n\n');

  if (rag.results.length > 0) {
    output += '\n\nOdpowiedz używając powyższego kontekstu. Jeśli brak wystarczających informacji, powiedz to wprost.';
  }

  return output;
}

/**
 * Format product results for AI prompt
 * 
 * @param products - Product list
 * @param query - Original query
 * @returns Formatted product context
 */
export function formatMcpProductsForPrompt(
  products: Array<{
    name?: string;
    price?: string;
    url?: string;
    description?: string;
    image?: string;
  }>,
  query: string
): string {
  if (!products || products.length === 0) return '';

  let output = `Produkty znalezione dla zapytania: "${query}"\n\n`;
  
  products.forEach((product, index) => {
    output += `[Produkt ${index + 1}]\n`;
    output += `Nazwa: ${product.name || 'Brak nazwy'}\n`;
    if (product.price) output += `Cena: ${product.price}\n`;
    if (product.url) output += `Link: ${product.url}\n`;
    if (product.description) output += `Opis: ${product.description}\n`;
    if (product.image) output += `Zdjęcie: ${product.image}\n`;
    output += '\n';
  });

  return output;
}

/**
 * Format RagContext (normalized docs) for prompt
 * 
 * @param ctx - RAG context with normalized documents
 * @returns Formatted context string
 */
export function formatRagForPrompt(ctx: RagContext): string {
  if (!ctx || !Array.isArray(ctx.retrieved_docs) || ctx.retrieved_docs.length === 0) {
    return '';
  }

  const lines: string[] = ['KONTEKST RAG (retrieved_docs):'];
  
  for (const d of ctx.retrieved_docs) {
    const idPart = d.id ? `${d.id}: ` : '';
    let metaPart = '';
    
    if (d.meta && typeof d.meta === 'object' && Object.keys(d.meta).length) {
      const entries = Object.entries(d.meta)
        .filter(([k, v]) => k && (typeof v === 'string' || typeof v === 'number'))
        .map(([k, v]) => `${k}=${String(v)}`);
      if (entries.length) metaPart = ` (${entries.join(', ')})`;
    }
    
    const snippet = d.text.length > 300 ? d.text.slice(0, 300) + '…' : d.text;
    lines.push(`- ${idPart}${snippet}${metaPart}`);
  }
  
  return lines.join('\n');
}

/**
 * Check if RAG results have high confidence scores
 * 
 * @param rag - RAG search result
 * @param threshold - Minimum score threshold (0-1)
 * @returns True if any result exceeds threshold
 */
export function hasHighConfidenceResults(
  rag: RagSearchResult,
  threshold: number = 0.7
): boolean {
  if (!rag || !Array.isArray(rag.results) || rag.results.length === 0) {
    return false;
  }
  
  return rag.results.some(r => (r.score ?? 0) >= threshold);
}

/**
 * Extract keywords from Polish query
 * 
 * Removes filler words to improve search quality.
 * 
 * @param query - User query in Polish
 * @returns Cleaned keywords
 */
export function extractKeywords(query: string): string {
  const lowerQuery = query.toLowerCase();
  
  // Remove common Polish filler words
  const fillerWords = [
    'wymien', 'pokaż', 'pokaz', 'mi', 'masz', 'czy', 'jest',
    'jakies', 'jakie', 'szukam', 'poszukuje', 'poszukuję', 'chce', 'chcę'
  ];
  
  let keywords = lowerQuery;
  fillerWords.forEach(word => {
    keywords = keywords.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
  });
  
  // Clean up extra spaces
  keywords = keywords.replace(/\s+/g, ' ').trim();
  
  return keywords || lowerQuery; // fallback to original if empty
}
