/**
 * worker/src/rate-limiter.ts
 *
 * Per-shop token bucket rate limiter using Durable Objects.
 * Chroni przed przekroczeniem limitów Shopify Admin API i MCP.
 */

export interface Env {
  RATE_LIMITER_DO: DurableObjectNamespace;
}

/**
 * Token bucket configuration per shop
 */
interface TokenBucketConfig {
  maxTokens: number;      // Max tokens in bucket (burst capacity)
  refillRate: number;     // Tokens per second
  refillInterval: number; // Milliseconds between refills
}

const DEFAULT_CONFIG: TokenBucketConfig = {
  maxTokens: 40,          // Shopify Admin API: 40 requests per second
  refillRate: 2,          // Refill 2 tokens per interval (40/sec = 2 per 50ms)
  refillInterval: 50      // Refill every 50ms
};

/**
 * Durable Object dla rate limiting per shop
 */
export class RateLimiterDO {
  private state: DurableObjectState;
  private tokens: number = DEFAULT_CONFIG.maxTokens;
  private lastRefill: number = Date.now();
  private config: TokenBucketConfig = DEFAULT_CONFIG;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = url.pathname.split('/').pop();

    switch (method) {
      case 'consume':
        return this.handleConsume(request);
      case 'check':
        return this.handleCheck();
      case 'reset':
        return this.handleReset();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  /**
   * Spróbuj skonsumować tokeny (domyślnie 1)
   */
  private async handleConsume(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({ tokens: 1 })) as { tokens?: number };
    const tokensToConsume = body.tokens || 1;

    this.refillTokens();

    if (this.tokens >= tokensToConsume) {
      this.tokens -= tokensToConsume;
      return Response.json({
        allowed: true,
        tokens: this.tokens,
        maxTokens: this.config.maxTokens
      });
    }

    // Oblicz retry-after (ile ms do następnego refill)
    const retryAfterMs = this.config.refillInterval;
    
    return Response.json({
      allowed: false,
      tokens: this.tokens,
      maxTokens: this.config.maxTokens,
      retryAfterMs
    }, { status: 429 });
  }

  /**
   * Sprawdź dostępne tokeny bez konsumpcji
   */
  private async handleCheck(): Promise<Response> {
    this.refillTokens();
    
    return Response.json({
      tokens: this.tokens,
      maxTokens: this.config.maxTokens,
      lastRefill: this.lastRefill
    });
  }

  /**
   * Resetuj bucket (tylko do testów)
   */
  private async handleReset(): Promise<Response> {
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
    
    return Response.json({ reset: true, tokens: this.tokens });
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const intervals = Math.floor(elapsed / this.config.refillInterval);

    if (intervals > 0) {
      const tokensToAdd = intervals * this.config.refillRate;
      this.tokens = Math.min(this.config.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
}

/**
 * Helper function to check rate limit for a shop
 */
export async function checkRateLimit(
  shopDomain: string,
  env: Env,
  tokensToConsume: number = 1
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const id = env.RATE_LIMITER_DO.idFromName(shopDomain);
  const stub = env.RATE_LIMITER_DO.get(id);
  
  const response = await stub.fetch('https://dummy/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens: tokensToConsume })
  });

  return await response.json();
}
