import { createStorefrontClient } from '@shopify/hydrogen';

export function getStorefront(env: Env, request?: Request) {
  const { PUBLIC_STOREFRONT_DOMAIN, PUBLIC_STOREFRONT_API_TOKEN, PUBLIC_STOREFRONT_API_VERSION } = env;

  if (!PUBLIC_STOREFRONT_DOMAIN || !PUBLIC_STOREFRONT_API_TOKEN || !PUBLIC_STOREFRONT_API_VERSION) {
    throw new Error('Missing storefront environment variables');
  }

  return createStorefrontClient({
    publicStorefrontToken: PUBLIC_STOREFRONT_API_TOKEN,
    storeDomain: PUBLIC_STOREFRONT_DOMAIN,
    storefrontApiVersion: PUBLIC_STOREFRONT_API_VERSION,
    buyerIp: undefined,
    request,
    i18n: { language: 'PL', country: 'PL' },
  });
}
