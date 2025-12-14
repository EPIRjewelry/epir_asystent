/*
 * Theme App Extension tracking.js
 * - Captures click coordinates, scroll depth, time on page
 * - Publishes custom events via Shopify.analytics.publish so Web Pixel can subscribe
 * - Debounces scroll events to reduce noise
 * - Uses navigator.sendBeacon on unload for reliability where appropriate
 */
(function () {
  if (typeof Shopify === 'undefined' || !Shopify.analytics || !Shopify.analytics.publish) {
    console.warn('[EPIR Tracking] Shopify.analytics.publish not available');
    return;
  }

  // Click tracking (with coordinates and element info)
  document.addEventListener('click', (e) => {
    try {
      const target = e.target;
      const el = target && typeof target === 'object' ? target : {};
      const payload = {
        x: e.clientX,
        y: e.clientY,
        element: (el.tagName || '').toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        text: (el.innerText && el.innerText.substring && el.innerText.substring(0, 100)) || null,
        url: window.location.href,
        timestamp: Date.now(),
        viewport: {
          w: window.innerWidth,
          h: window.innerHeight
        }
      };

      Shopify.analytics.publish('epir:click_with_position', payload);
    } catch (err) {
      console.warn('[EPIR Tracking] click handler error', err);
    }
  }, { passive: true });

  // Scroll depth tracking (debounced)
  let maxScroll = 0;
  let scrollTimer = null;
  function handleScroll() {
    const scrollPercent = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100) || 0;
    if (scrollPercent > maxScroll) {
      maxScroll = scrollPercent;
      // publish immediate (but debounced)
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        Shopify.analytics.publish('epir:scroll_depth', {
          depth: maxScroll,
          url: window.location.href,
          timestamp: Date.now()
        });
      }, 200);
    }
  }
  window.addEventListener('scroll', handleScroll, { passive: true });

  // Time on page / before unload
  const startTime = Date.now();
  function sendTimeOnPage() {
    try {
      const timeOnPage = Math.round((Date.now() - startTime) / 1000);
      const payload = {
        time_on_page_seconds: timeOnPage,
        max_scroll_percent: maxScroll,
        url: window.location.href,
        timestamp: Date.now()
      };

      // Use analytics.publish first (so Web Pixel can pick it up)
      Shopify.analytics.publish('epir:page_exit', payload);

      // Also attempt navigator.sendBeacon to analytics worker as a fallback for reliability
      try {
        const beaconData = JSON.stringify({ type: 'epir:page_exit', data: payload });
        const pixelEndpoint = 'https://epir-analityc-worker.krzysztofdzugaj.workers.dev/pixel';
        if (navigator.sendBeacon) {
          navigator.sendBeacon(pixelEndpoint, beaconData);
        }
      } catch (err) {
        // ignore
      }
    } catch (err) {
      console.warn('[EPIR Tracking] sendTimeOnPage error', err);
    }
  }
  window.addEventListener('beforeunload', sendTimeOnPage);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendTimeOnPage();
  });

  // Optional: sample mousemove for hover heatmaps (low-frequency sampling)
  let lastPointerSample = 0;
  window.addEventListener('pointermove', (e) => {
    const now = Date.now();
    if (now - lastPointerSample < 5000) return; // sample every 5s
    lastPointerSample = now;
    try {
      Shopify.analytics.publish('epir:mouse_sample', {
        x: e.clientX,
        y: e.clientY,
        url: window.location.href,
        timestamp: now
      });
    } catch (err) {
      // ignore
    }
  }, { passive: true });

  console.log('[EPIR Tracking] initialized');
})();
