// Configuration for esbuild bundler
// Mark @shopify/web-pixels-extension as external since it's provided by Shopify runtime

export default {
  external: ['@shopify/web-pixels-extension'],
};
