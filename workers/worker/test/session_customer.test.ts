import { describe, it, expect } from 'vitest';
import { SessionDO } from '../src/index';

function makeDurableStateStub() {
  const storage = new Map<string, any>();
  return {
    storage: {
      async get(key: string) { return storage.has(key) ? storage.get(key) : undefined; },
      async put(key: string, value: any) { storage.set(key, value); }
    },
    async blockConcurrencyWhile(cb: () => Promise<void>) { await cb(); }
  } as unknown as DurableObjectState;
}

describe('SessionDO customer', () => {
  it('should set and return customer', async () => {
    const state = makeDurableStateStub();
    const doStub = new SessionDO(state, {} as any);

    const res = await doStub.fetch(new Request('https://session/set-customer', {
      method: 'POST', body: JSON.stringify({ customer_id: 'gid://shopify/Customer/123', first_name: 'Anna' }), headers: { 'Content-Type': 'application/json' }
    }));
    expect(res.status).toBe(200);

    const get = await doStub.fetch(new Request('https://session/customer', { method: 'GET' }));
    const json = await get.json();
    expect(json.customer).not.toBeNull();
    expect(json.customer.customer_id).toBe('gid://shopify/Customer/123');
    expect(json.customer.first_name).toBe('Anna');
  });
});
