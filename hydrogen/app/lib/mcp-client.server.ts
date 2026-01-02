interface McpPayload {
  query: string;
  customerAccessToken?: string | null;
  cartId?: string | null;
  customerId?: string | null;
  apiType: 'storefront' | 'admin';
}

export async function callMcp(env: Env, payload: McpPayload): Promise<any> {
  const endpoint = env.MCP_ENDPOINT;
  const key = env.MCP_API_KEY;
  if (!endpoint || !key) throw new Error('MCP_ENDPOINT/MCP_API_KEY missing');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      tool: 'shopify_chat',
      params: {
        query: payload.query,
        context: {
          customerAccessToken: payload.customerAccessToken ?? undefined,
          cartId: payload.cartId ?? undefined,
          customerId: payload.customerId ?? undefined,
          apiType: payload.apiType,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`MCP error ${res.status}: ${text}`);
  }

  return res.json();
}
