/**
 * RAG Worker - Service: Vectorize (Similarity Search)
 * 
 * Handles FAQ/policies semantic search using Cloudflare Vectorize.
 * Used as FALLBACK when MCP is unavailable or for semantic search.
 * 
 * @see workers/worker/src/rag.ts - searchShopPoliciesAndFaqs function
 */

import { VECTORIZE_CONFIG } from '../config/sources';

/**
 * Vectorize Index binding (from Cloudflare Workers)
 */
export interface VectorizeIndex {
  query: (
    vector: number[],
    opts?: { topK?: number }
  ) => Promise<{
    matches: Array<{
      id: string;
      score: number;
      metadata?: any;
    }>;
    count: number;
  }>;
}

/**
 * AI Binding (Cloudflare Workers AI)
 */
export interface AIBinding {
  run: (
    model: string,
    input: { text: string[] }
  ) => Promise<{
    data: number[][];
  }>;
}

/**
 * Vectorize result item
 */
export interface VectorizeResultItem {
  id: string;
  title?: string;
  text?: string;
  snippet?: string;
  source: string;
  score: number;
  metadata?: any;
}

/**
 * Search FAQ/policies using semantic similarity (Vectorize)
 * 
 * @param query - User query
 * @param vectorIndex - Vectorize index binding
 * @param aiBinding - AI binding for embeddings
 * @param topK - Number of results to return
 * @returns Array of matched documents
 * 
 * @example
 * ```typescript
 * const results = await searchFaqVectorize(
 *   'polityka zwrotów',
 *   env.VECTOR_INDEX,
 *   env.AI,
 *   3
 * );
 * ```
 */
export async function searchFaqVectorize(
  query: string,
  vectorIndex: VectorizeIndex,
  aiBinding: AIBinding,
  topK: number = VECTORIZE_CONFIG.DEFAULT_TOP_K
): Promise<VectorizeResultItem[]> {
  try {
    console.log(`[Vectorize] 🔍 Searching FAQ for: "${query}"`);

    // Generate embedding for query using Cloudflare AI
    const embeddingResult = await aiBinding.run(
      VECTORIZE_CONFIG.EMBEDDING_MODEL,
      { text: [query] }
    );

    const queryVector = embeddingResult.data[0];
    if (!queryVector || queryVector.length === 0) {
      console.error('[Vectorize] ❌ Failed to generate embedding');
      return [];
    }

    console.log(`[Vectorize] 📊 Embedding generated (${queryVector.length} dimensions)`);

    // Query Vectorize index
    const vectorResults = await vectorIndex.query(queryVector, { topK });

    if (!vectorResults.matches || vectorResults.matches.length === 0) {
      console.warn('[Vectorize] ⚠️ No matches found');
      return [];
    }

    console.log(`[Vectorize] ✅ Found ${vectorResults.matches.length} matches`);

    // Transform results
    const results: VectorizeResultItem[] = vectorResults.matches
      .filter(match => match.score >= VECTORIZE_CONFIG.MIN_SCORE_THRESHOLD)
      .map(match => ({
        id: match.id,
        title: match.metadata?.title || match.id,
        text: match.metadata?.text || '',
        snippet: (match.metadata?.text || '').slice(0, 500),
        source: 'vectorize',
        score: match.score,
        metadata: match.metadata,
      }));

    return results;

  } catch (error) {
    console.error('[Vectorize] ❌ Search failed:', error);
    return [];
  }
}

/**
 * Embed text using Cloudflare AI
 * 
 * Helper function for generating embeddings.
 * Used when upserting documents to Vectorize.
 * 
 * @param text - Text to embed
 * @param aiBinding - AI binding
 * @returns Embedding vector
 */
export async function embedText(
  text: string,
  aiBinding: AIBinding
): Promise<number[]> {
  const result = await aiBinding.run(
    VECTORIZE_CONFIG.EMBEDDING_MODEL,
    { text: [text] }
  );

  return result.data[0] || [];
}

/**
 * Upsert documents to Vectorize index
 * 
 * @param docs - Documents to upsert
 * @param vectorIndex - Vectorize index binding
 * @param aiBinding - AI binding for embeddings
 */
export async function upsertDocuments(
  docs: Array<{ id: string; text: string; metadata?: any }>,
  vectorIndex: any, // VectorizeIndex doesn't expose upsert in types
  aiBinding: AIBinding
): Promise<void> {
  if (!docs || docs.length === 0) return;

  console.log(`[Vectorize] 📝 Upserting ${docs.length} documents...`);

  const toUpsert: any[] = [];
  
  for (const doc of docs) {
    const vector = await embedText(doc.text, aiBinding);
    toUpsert.push({
      id: doc.id,
      values: Float32Array.from(vector),
      metadata: doc.metadata || {},
    });
  }

  await vectorIndex.upsert(toUpsert);
  console.log(`[Vectorize] ✅ Upserted ${toUpsert.length} documents`);
}
