import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.test.ts'],
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
