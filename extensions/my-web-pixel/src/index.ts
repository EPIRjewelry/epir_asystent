import {register} from "@shopify/web-pixels-extension";

register(({ analytics }) => {
    // Funkcja wysyłająca zdarzenie pixelowe do Workera
  async function sendPixelEvent(eventType: string, eventData: unknown): Promise<void> {
      try {
        await fetch('/pixel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: eventType, data: eventData })
        });
      } catch (err) {
        console.warn('Pixel event send failed:', err);
      }
    }

    // Subskrybuj wybrane zdarzenia klienta
    analytics.subscribe('page_viewed', (event: unknown) => {
      console.log('Page viewed', event);
      sendPixelEvent('page_viewed', event);
    });

    analytics.subscribe('product_viewed', (event: unknown) => {
      console.log('Product viewed', event);
      sendPixelEvent('product_viewed', event);
    });

    analytics.subscribe('cart_updated', (event: unknown) => {
      console.log('Cart updated', event);
      sendPixelEvent('cart_updated', event);
    });

    analytics.subscribe('checkout_started', (event: unknown) => {
      console.log('Checkout started', event);
      sendPixelEvent('checkout_started', event);
    });

    analytics.subscribe('purchase_completed', (event: unknown) => {
      console.log('Purchase completed', event);
      sendPixelEvent('purchase_completed', event);
    });
});
