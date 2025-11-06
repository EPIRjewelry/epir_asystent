/**
 * Lightweight MCP shims with normalized error handling.
 * Exports functions that return a consistent { ok: boolean, result?, error? } shape
 * so callers can handle errors without try/catch if desired.
 */
import type { RagResultItem } from '../rag';

export async function embedTextSafe(env: any, text: string): Promise<{ ok: true; vector: Float32Array } | { ok: false; error: string }> {
  try {
    if (!env?.AI || typeof env.AI.run !== 'function') {
      return { ok: false, error: 'No embedding provider configured' };
    }
    const res = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [text] });
    const vec = res?.data?.[0];
    if (!Array.isArray(vec)) return { ok: false, error: 'Invalid embedding response' };
    return { ok: true, vector: Float32Array.from(vec as number[]) };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function searchSafe(env: any, query: string, topK = 5): Promise<{ ok: true; results: Array<Partial<RagResultItem>> } | { ok: false; error: string }> {
  try {
    if (!env?.VECTOR_INDEX || typeof env.VECTOR_INDEX.query !== 'function') {
      return { ok: false, error: 'VECTOR_INDEX binding not available' };
    }
    // Obtain embedding
    if (!env?.AI || typeof env.AI.run !== 'function') {
      return { ok: false, error: 'No embedding provider configured' };
    }
    const embedRes = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [query] });
    const vector = embedRes?.data?.[0] ?? [];
    const vres = await env.VECTOR_INDEX.query(vector, { topK });
    const results = (vres.matches || []).map((m: any) => ({ id: m.id, text: m.metadata?.text || '', score: m.score, metadata: m.metadata }));
    return { ok: true, results };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function upsertDocumentsSafe(env: any, docs: Array<{ id: string; text: string; metadata?: any }>): Promise<{ ok: true; mutationId?: string } | { ok: false; error: string }> {
  try {
    if (!Array.isArray(docs) || docs.length === 0) return { ok: true };
    if (!env?.VECTOR_INDEX || typeof env.VECTOR_INDEX.upsert !== 'function') return { ok: false, error: 'VECTOR_INDEX binding not available' };
    if (!env?.AI || typeof env.AI.run !== 'function') return { ok: false, error: 'No embedding provider configured' };

    const toUpsert: any[] = [];
    for (const doc of docs) {
      const embedRes = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [doc.text] });
      const vec = embedRes?.data?.[0] ?? [];
      toUpsert.push({ id: doc.id, values: Float32Array.from(vec as number[]), metadata: doc.metadata || {} });
    }
    const res = await env.VECTOR_INDEX.upsert(toUpsert);
    return { ok: true, mutationId: res?.mutationId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export default {
  embedTextSafe,
  searchSafe,
  upsertDocumentsSafe,
};
