import { createCustomerAccountClient } from '@shopify/hydrogen';

export function getCustomerClient(env: Env, request: Request) {
  const { PUBLIC_CUSTOMER_ACCOUNT_API_URL, CUSTOMER_ACCOUNT_ID, SESSION_SECRET } = env;

  if (!PUBLIC_CUSTOMER_ACCOUNT_API_URL || !CUSTOMER_ACCOUNT_ID || !SESSION_SECRET) {
    throw new Error('Missing customer account env vars');
  }

  return createCustomerAccountClient({
    request,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    customerAccountUrl: PUBLIC_CUSTOMER_ACCOUNT_API_URL,
    sessionStorageSecret: SESSION_SECRET,
  });
}
