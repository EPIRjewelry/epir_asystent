import { describe, it, expect } from 'vitest';
import { SessionDO } from '../src/index';

function makeDurableStateStub() {
  const storage = new Map<string, any>();
  return {
    storage: {
      async get(key: string) {
        return storage.has(key) ? storage.get(key) : undefined;
      },
      async put(key: string, value: any) {
        storage.set(key, value);
      }
    },
    async blockConcurrencyWhile(cb: () => Promise<void>) {
      // simply call the block
      await cb();
    }
  } as unknown as DurableObjectState;
}

const mockEnv = {} as any;

describe('SessionDO', () => {
  it('should append and retrieve history', async () => {
    const state = makeDurableStateStub();
    const doStub = new SessionDO(state, mockEnv);

    const req = new Request('https://session/append', {
      method: 'POST',
      body: JSON.stringify({ role: 'user', content: 'Hello', ts: Date.now() }),
      headers: { 'Content-Type': 'application/json' }
    });

    const res = await doStub.fetch(req);
    expect(res.status).toBe(200);

    const historyRes = await doStub.fetch(new Request('https://session/history'));
    const history = (await historyRes.json()) as any[];
    expect(Array.isArray(history)).toBeTruthy();
    expect(history.length).toBe(1);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('Hello');
  });

  it('should set and get session id and cart id', async () => {
    const state = makeDurableStateStub();
    const doStub = new SessionDO(state, mockEnv);

    const setSession = await doStub.fetch(new Request('https://session/set-session-id', {
      method: 'POST',
      body: JSON.stringify({ session_id: 'abc-123' }),
      headers: { 'Content-Type': 'application/json' }
    }));
    expect(setSession.ok).toBeTruthy();

    const setCart = await doStub.fetch(new Request('https://session/set-cart-id', {
      method: 'POST',
      body: JSON.stringify({ cart_id: 'gid://shopify/Cart/xyz' }),
      headers: { 'Content-Type': 'application/json' }
    }));
    expect(setCart.ok).toBeTruthy();

    const cartRes = await doStub.fetch(new Request('https://session/cart-id'));
    const cartData = (await cartRes.json()) as any;
    expect(cartData.cart_id).toBe('gid://shopify/Cart/xyz');
  });

  it('should enforce local rate limit for DO endpoints', async () => {
    const state = makeDurableStateStub();
    const doStub = new SessionDO(state, mockEnv);

    // hit the endpoint many times
    for (let i = 0; i < 21; i++) {
      const r = await doStub.fetch(new Request('https://session/history'));
      if (i < 20) expect(r.status).toBe(200);
      else expect(r.status).toBe(429);
    }

  });
});
