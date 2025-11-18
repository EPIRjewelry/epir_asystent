// Type declarations for @shopify/web-pixels-extension
// This package is provided by Shopify runtime and should not be bundled

declare module "@shopify/web-pixels-extension" {
  export function register(callback: (context: any) => void | Promise<void>): void;
}
