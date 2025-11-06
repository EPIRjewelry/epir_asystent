import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, 'test/__mocks__/cloudflare-workers.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10000,
    env: {
      SHOP_DOMAIN: 'test-shop.myshopify.com',
      SHOPIFY_STOREFRONT_TOKEN: 'mock-storefront-token-12345',
      SHOPIFY_ACCESS_TOKEN: 'mock-admin-token-12345',
      SHOPIFY_ADMIN_TOKEN: 'mock-admin-token-12345',
      SHOPIFY_APP_SECRET: 'mock-app-secret-12345',
      GROQ_API_KEY: 'mock-groq-key-12345',
      WORKER_ORIGIN: 'https://test-worker.workers.dev'
    }
  },
});
