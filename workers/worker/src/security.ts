// Przykład: worker/src/security.ts
// Funkcja weryfikująca HMAC przychodzący przez App Proxy.
// Uwaga: dostosuj nazwy headerów/parametrów do finalnej specyfikacji projektu.
// Nie umieszczaj tajnych kluczy w kodzie — używaj ENV (wrangler secrets).

import { verifyHmac, parseSignature, canonicalizeParams, verifyTimestamp } from './hmac';

export async function verifyAppProxyHmac(request: Request, secret: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    // 1) Pobierz podpis (header lub query param)
    const headerSig = request.headers.get('x-shopify-hmac-sha256') ?? undefined;
    const url = new URL(request.url);
    const querySig = url.searchParams.get('signature') ?? url.searchParams.get('hmac') ?? undefined;
    const signatureRaw = headerSig ?? querySig;
    if (!signatureRaw) return { ok: false, reason: 'missing_signature' };

    // 2) Sprawdź timestamp (opcjonalnie) - chroni przed replay
    const tsParam = url.searchParams.get('timestamp');
    if (tsParam) {
      const ts = Number(tsParam);
      if (!Number.isFinite(ts) || ts <= 0) {
        return { ok: false, reason: 'invalid_timestamp' };
      }
      // Verify timestamp is within 5 minute window
      const isValid = verifyTimestamp(ts, 300);
      if (!isValid) {
        return { ok: false, reason: 'timestamp_out_of_range' };
      }
    }

    // 3) Zbuduj canonical string z paramów (usuń signature/hmac/shopify_hmac)
    const canonical = canonicalizeParams(url.searchParams, ['signature', 'hmac', 'shopify_hmac']);

    // 4) Pobierz raw body jako ArrayBuffer
    const cloned = request.clone();
    const bodyBuffer = await cloned.arrayBuffer();
    const bodyBytes = new Uint8Array(bodyBuffer);
    const bodyStr = new TextDecoder().decode(bodyBytes);

    // 5) Połącz params + body
    const message = canonical + bodyStr;

    // 6) Verify HMAC using constant-time comparison from hmac.ts
    const verified = await verifyHmac(signatureRaw, secret, message);
    
    if (!verified) {
      console.error('HMAC verification failed: invalid');
      return { ok: false, reason: 'hmac_mismatch' };
    }

    // 8) (Opcjonalnie) Replay protection: odnotuj signature/timestamp w Durable Object (nie tutaj).
    return { ok: true };
  } catch (err) {
    // Nie logujemy secretów ani raw signature
    console.error('verifyAppProxyHmac error', (err as Error).message);
    return { ok: false, reason: 'internal_error' };
  }
}

/**
 * Funkcja do sprawdzania replay attack poprzez Durable Object.
 * Wywołuje DO SessionDO z endpointem '/replay-check'.
 * @param sessionDo DurableObjectStub dla sesji
 * @param signature Podpis do sprawdzenia
 * @param timestamp Timestamp z requestu
 * @returns Promise<{ok: boolean, reason?: string}>
 */
export async function replayCheck(
  sessionDo: DurableObjectStub,
  signature: string,
  timestamp: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const response = await sessionDo.fetch('/replay-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature, timestamp }),
    });
    if (!response.ok) {
      return { ok: false, reason: `DO error: ${response.status}` };
    }
    const data = await response.json() as { used?: boolean; error?: string };
    if (data.error) return { ok: false, reason: data.error };
    if (data.used) return { ok: false, reason: 'signature_already_used' };
    return { ok: true };
  } catch (err) {
    console.error('replayCheck error', (err as Error).message);
    return { ok: false, reason: 'internal_error' };
  }
}