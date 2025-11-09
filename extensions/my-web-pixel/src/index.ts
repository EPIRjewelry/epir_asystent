import {register} from "@shopify/web-pixels-extension";

register(async ({ analytics, browser, init, settings }) => {
    // ============================================================================
    // CUSTOMER & SESSION TRACKING
    // ============================================================================
    // Extract customer_id from Shopify (null if not logged in)
    const customerId = init?.data?.customer?.id ?? null;
    
    // Generate or retrieve session_id from sessionStorage (browser session)
    let sessionId: string | null = null;
    try {
      sessionId = await browser.sessionStorage.getItem('_epir_session_id');
      if (!sessionId) {
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await browser.sessionStorage.setItem('_epir_session_id', sessionId);
      }
    } catch (e) {
      // Fallback if sessionStorage unavailable
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
    
    // ============================================================================
    // ANALYTICS URL CONFIGURATION
    // ============================================================================
    // Get analytics URL from extension settings (configured in Shopify Admin)
    // Fallback to production URL if not configured
    const analyticsUrl = (settings as any)?.analyticsUrl || 'https://asystent.epirbizuteria.pl/pixel';
    
    console.log('[EPIR Pixel] Customer ID:', customerId || 'anonymous');
    console.log('[EPIR Pixel] Session ID:', sessionId);
    console.log('[EPIR Pixel] Analytics URL:', analyticsUrl);
    
    // ============================================================================
    // Event Sending Function
    // ============================================================================
    // NOTE: No additional batching/rate limiting implemented here because:
    // 1. Shopify Web Pixels API has built-in batching and rate limiting
    // 2. tracking.js already implements debouncing (scroll: 200ms) and throttling (mouse: 5s)
    // 3. Batching would delay proactive chat activation signals
    // 4. High-value events (checkout, purchase) should be sent immediately
    // ============================================================================
    async function sendPixelEvent(eventType: string, eventData: unknown): Promise<void> {
      try {
        // Enrich event data with customer_id and session_id
        const enrichedData = {
          ...(typeof eventData === 'object' && eventData !== null ? eventData : {}),
          customerId: customerId,
          sessionId: sessionId
        };
        
        // Use configured analytics URL (full URL to worker, not relative path)
        const response = await fetch(analyticsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: eventType, data: enrichedData })
        });
        
        // ============================================================================
        // PROACTIVE CHAT ACTIVATION: Check response from analytics-worker
        // ============================================================================
        // Analytics worker returns { ok: true, activate_chat: true/false, reason: string }
        // If activate_chat=true, emit custom event to frontend
        if (response.ok) {
          const result = await response.json();
          
          // Type guard for result
          if (
            typeof result === 'object' && 
            result !== null && 
            'activate_chat' in result && 
            result.activate_chat === true
          ) {
            console.log('[EPIR Pixel] 🚀 Proactive chat activation detected:', (result as any).reason);
            
            // Emit custom event to frontend (assistant.js listens for this)
            window.dispatchEvent(new CustomEvent('epir:activate-chat', {
              detail: {
                reason: (result as any).reason,
                session_id: sessionId,
                customer_id: customerId,
                timestamp: Date.now()
              }
            }));
          }
        }
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

    // ============================================================================
    // ADDITIONAL STANDARD EVENTS (full spectrum)
    // ============================================================================
    // Cart events
    analytics.subscribe('cart_viewed', (event: unknown) => {
      console.log('Cart viewed', event);
      sendPixelEvent('cart_viewed', event);
    });

    analytics.subscribe('product_added_to_cart', (event: unknown) => {
      console.log('Product added to cart', event);
      sendPixelEvent('product_added_to_cart', event);
    });

    analytics.subscribe('product_removed_from_cart', (event: unknown) => {
      console.log('Product removed from cart', event);
      sendPixelEvent('product_removed_from_cart', event);
    });

    // Collection and search
    analytics.subscribe('collection_viewed', (event: unknown) => {
      console.log('Collection viewed', event);
      sendPixelEvent('collection_viewed', event);
    });

    analytics.subscribe('search_submitted', (event: unknown) => {
      console.log('Search submitted', event);
      sendPixelEvent('search_submitted', event);
    });

    // Checkout flow events
    analytics.subscribe('checkout_completed', (event: unknown) => {
      console.log('Checkout completed', event);
      sendPixelEvent('checkout_completed', event);
    });

    analytics.subscribe('checkout_contact_info_submitted', (event: unknown) => {
      console.log('Checkout contact info submitted', event);
      sendPixelEvent('checkout_contact_info_submitted', event);
    });

    analytics.subscribe('checkout_address_info_submitted', (event: unknown) => {
      console.log('Checkout address info submitted', event);
      sendPixelEvent('checkout_address_info_submitted', event);
    });

    analytics.subscribe('checkout_shipping_info_submitted', (event: unknown) => {
      console.log('Checkout shipping info submitted', event);
      sendPixelEvent('checkout_shipping_info_submitted', event);
    });

    analytics.subscribe('payment_info_submitted', (event: unknown) => {
      console.log('Payment info submitted', event);
      sendPixelEvent('payment_info_submitted', event);
    });

    // UI and alerts
    analytics.subscribe('alert_displayed', (event: unknown) => {
      console.log('Alert displayed', event);
      sendPixelEvent('alert_displayed', event);
    });

    analytics.subscribe('ui_extension_errored', (event: unknown) => {
      console.log('UI extension errored', event);
      sendPixelEvent('ui_extension_errored', event);
    });

    // ------------------------------------------------------------------------
    // Subscribe to DOM and custom events (heatmap-ready data)
    // ------------------------------------------------------------------------
    // Standard DOM events provided by Shopify Web Pixels
    try {
      // NOTE: 'clicked' event is redundant - we use custom 'epir:click_with_position' 
      // from TAE which provides richer data (x, y, viewport, element details)
      // analytics.subscribe('clicked', (event: any) => {
      //   console.log('DOM clicked event', event);
      //   sendPixelEvent('clicked', event);
      // });

      analytics.subscribe('form_submitted', (event: any) => {
        console.log('DOM form submitted', event);
        sendPixelEvent('form_submitted', event);
      });

      analytics.subscribe('input_focused', (event: any) => {
        console.log('DOM input focused', event);
        sendPixelEvent('input_focused', event);
      });

      analytics.subscribe('input_blurred', (event: any) => {
        console.log('DOM input blurred', event);
        sendPixelEvent('input_blurred', event);
      });

      analytics.subscribe('input_changed', (event: any) => {
        console.log('DOM input changed', event);
        sendPixelEvent('input_changed', event);
      });
    } catch (e) {
      // ignore if not available in this context
      console.warn('[EPIR Pixel] Some DOM events not available:', e);
    }

    // Custom events published by Theme App Extension (epir-tracking-extension)
    analytics.subscribe('epir:click_with_position', (event: any) => {
      console.log('Custom click with position', event);
      sendPixelEvent('click_with_position', event.customData || event);
    });

    analytics.subscribe('epir:scroll_depth', (event: any) => {
      console.log('Custom scroll depth', event);
      sendPixelEvent('scroll_depth', event.customData || event);
    });

    analytics.subscribe('epir:page_exit', (event: any) => {
      console.log('Custom page exit / time on page', event);
      sendPixelEvent('page_exit', event.customData || event);
    });

    analytics.subscribe('epir:mouse_sample', (event: any) => {
      console.log('Mouse sample event', event);
      sendPixelEvent('mouse_sample', event.customData || event);
    });
});
