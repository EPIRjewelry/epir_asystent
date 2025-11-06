/**
 * token-vault.ts
 * Skarbiec tokenów dla customer_id (Shopify) — Cloudflare Durable Object
 * - Mapuje customer_id <-> losowy token (SHA-256 hash)
 * - Przechowuje powiązanie z shop_id
 * - Persystencja w DO SQLite
 * - Obsługuje wygaszanie/usuwanie tokenów (RODO)
 * - Zgodny z zasadami bezpieczeństwa Shopify
 */

import { DurableObject } from 'cloudflare:workers';

interface TokenRecord {
  token: string;
  customerId: string;
  shopId: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt?: number;
}

/**
 * TokenVaultDO - Durable Object dla persystentnego przechowywania tokenów
 */
export class TokenVaultDO extends DurableObject {
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    
    // Inicjalizacja tabeli przy pierwszym uruchomieniu
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS token_mappings (
        token TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        expires_at INTEGER
      )
    `);
    
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_customer_shop 
      ON token_mappings(customer_id, shop_id)
    `);
  }

  /**
   * Fetch handler dla DO
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();

    if (action === 'get-or-create') {
      return this.handleGetOrCreate(request);
    } else if (action === 'delete') {
      return this.handleDelete(request);
    } else if (action === 'lookup') {
      return this.handleLookup(request);
    } else if (action === 'is-valid') {
      return this.handleIsValid(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * GET lub CREATE token
   */
  private async handleGetOrCreate(request: Request): Promise<Response> {
    const body = await request.json() as { customerId?: string; shopId?: string };
    const { customerId, shopId } = body;

    if (!customerId || !shopId) {
      return new Response(JSON.stringify({ error: 'Missing customerId or shopId' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Sprawdź czy token już istnieje
    const existing = this.sql
      .exec('SELECT token, expires_at FROM token_mappings WHERE customer_id = ? AND shop_id = ?', customerId, shopId)
      .one() as { token: string; expires_at: number | null } | null;

    if (existing) {
      // Sprawdź czy nie wygasł
      if (existing.expires_at && Date.now() > existing.expires_at) {
        // Token wygasł, usuń i utwórz nowy
        this.sql.exec('DELETE FROM token_mappings WHERE token = ?', existing.token);
      } else {
        // Zaktualizuj last_used_at
        this.sql.exec(
          'UPDATE token_mappings SET last_used_at = ? WHERE token = ?',
          Date.now(),
          existing.token
        );
        return new Response(JSON.stringify({ token: existing.token }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Stwórz nowy token (SHA-256 hash customer_id + shop_id + random salt)
    const token = await this.generateToken(customerId, shopId);
    const now = Date.now();

    this.sql.exec(
      'INSERT INTO token_mappings (token, customer_id, shop_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      token,
      customerId,
      shopId,
      now,
      now,
      null
    );

    return new Response(JSON.stringify({ token }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * DELETE token (RODO compliance)
   */
  private async handleDelete(request: Request): Promise<Response> {
    const body = await request.json() as { customerId?: string; shopId?: string; token?: string };
    const { customerId, shopId, token } = body;

    if (token) {
      // Usuń po tokenie
      this.sql.exec('DELETE FROM token_mappings WHERE token = ?', token);
    } else if (customerId && shopId) {
      // Usuń po customer_id + shop_id
      this.sql.exec(
        'DELETE FROM token_mappings WHERE customer_id = ? AND shop_id = ?',
        customerId,
        shopId
      );
    } else {
      return new Response(JSON.stringify({ error: 'Missing token or customerId+shopId' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * LOOKUP token -> customer_id (tylko do audytu/administracji)
   */
  private async handleLookup(request: Request): Promise<Response> {
    const body = await request.json() as { token?: string };
    const { token } = body;

    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing token' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = this.sql
      .exec('SELECT customer_id, shop_id, created_at, last_used_at, expires_at FROM token_mappings WHERE token = ?', token)
      .one();

    if (!result) {
      return new Response(JSON.stringify({ error: 'Token not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Sprawdź czy token jest ważny
   */
  private async handleIsValid(request: Request): Promise<Response> {
    const body = await request.json() as { token?: string };
    const { token } = body;

    if (!token) {
      return new Response(JSON.stringify({ valid: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = this.sql
      .exec('SELECT expires_at FROM token_mappings WHERE token = ?', token)
      .one() as { expires_at: number | null } | null;

    if (!result) {
      return new Response(JSON.stringify({ valid: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const valid = !result.expires_at || Date.now() <= result.expires_at;
    return new Response(JSON.stringify({ valid }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Generuj unikalny token (SHA-256)
   */
  private async generateToken(customerId: string, shopId: string): Promise<string> {
    const salt = crypto.randomUUID();
    const data = `${customerId}:${shopId}:${salt}:${Date.now()}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * Helper class dla łatwego użycia w index.ts
 */
export class TokenVault {
  constructor(private stub: DurableObjectStub) {}

  async getOrCreateToken(customerId: string, shopId: string): Promise<string> {
    const response = await this.stub.fetch('https://token-vault/get-or-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, shopId }),
    });

    const result = await response.json() as { token?: string; error?: string };
    if (result.error) {
      throw new Error(`TokenVault error: ${result.error}`);
    }
    return result.token!;
  }

  async deleteToken(customerId: string, shopId: string): Promise<void> {
    await this.stub.fetch('https://token-vault/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, shopId }),
    });
  }

  async deleteTokenByValue(token: string): Promise<void> {
    await this.stub.fetch('https://token-vault/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }

  async lookupToken(token: string): Promise<{ customerId: string; shopId: string } | null> {
    const response = await this.stub.fetch('https://token-vault/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (response.status === 404) {
      return null;
    }

    return await response.json() as { customerId: string; shopId: string };
  }

  async isTokenValid(token: string): Promise<boolean> {
    const response = await this.stub.fetch('https://token-vault/is-valid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const result = await response.json() as { valid: boolean };
    return result.valid;
  }
}

// Przykład użycia w index.ts:
// const tokenVaultId = env.TOKEN_VAULT_DO.idFromName('global');
// const tokenVaultStub = env.TOKEN_VAULT_DO.get(tokenVaultId);
// const vault = new TokenVault(tokenVaultStub);
// const token = await vault.getOrCreateToken(customerId, shopId);
// // Przekaż token do AI, nigdy customerId
