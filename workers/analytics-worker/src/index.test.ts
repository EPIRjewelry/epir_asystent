import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('Analytics Worker - /pixel endpoint', () => {
    beforeAll(async () => {
        // Ensure tables are created before tests
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS pixel_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id TEXT,
                session_id TEXT,
                event_type TEXT NOT NULL,
                event_name TEXT,
                product_id TEXT,
                product_handle TEXT,
                product_type TEXT,
                product_vendor TEXT,
                product_title TEXT,
                variant_id TEXT,
                cart_id TEXT,
                page_url TEXT,
                page_title TEXT,
                page_type TEXT,
                event_data TEXT,
                created_at INTEGER NOT NULL,
                click_x INTEGER,
                click_y INTEGER,
                viewport_w INTEGER,
                viewport_h INTEGER,
                scroll_depth_percent INTEGER,
                time_on_page_seconds INTEGER,
                element_tag TEXT,
                element_id TEXT,
                element_class TEXT,
                input_name TEXT,
                form_id TEXT,
                search_query TEXT,
                collection_id TEXT,
                collection_handle TEXT,
                checkout_token TEXT,
                order_id TEXT,
                order_value REAL,
                alert_type TEXT,
                alert_message TEXT,
                error_message TEXT,
                extension_id TEXT,
                mouse_x INTEGER,
                mouse_y INTEGER
            )
        `).run();
    });

    afterEach(async () => {
        // Clean up test data after each test
        await env.DB.prepare('DELETE FROM pixel_events').run();
    });

    it('should accept valid page_viewed event', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'page_viewed',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    context: {
                        document: {
                            url: 'https://shop.example.com/products/ring',
                            title: 'Beautiful Ring'
                        }
                    }
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify data was written to D1
        const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM pixel_events').first();
        expect(count?.cnt).toBe(1);

        // Verify event details
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('page_viewed')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.customer_id).toBe('test-customer-123');
        expect(event?.session_id).toBe('test-session-456');
        expect(event?.page_url).toContain('products/ring');
    });

    it('should accept valid product_viewed event', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'product_viewed',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    productVariant: {
                        id: 'variant-789',
                        product: {
                            id: 'product-123',
                            title: 'Gold Ring',
                            type: 'Ring',
                            vendor: 'EPIR Jewelry'
                        }
                    }
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify product data was written
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('product_viewed')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.product_id).toBe('product-123');
        expect(event?.product_title).toBe('Gold Ring');
        expect(event?.product_type).toBe('Ring');
        expect(event?.variant_id).toBe('variant-789');
    });

    it('should accept cart_updated event', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'cart_updated',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    cart: {
                        id: 'cart-abc-123',
                        token: 'cart-token-xyz'
                    }
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify cart data was written
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('cart_updated')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.cart_id).toBe('cart-abc-123');
    });

    it('should accept heatmap events with coordinates', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'click_with_position',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    x: 450,
                    y: 300,
                    element: 'button',
                    id: 'add-to-cart-btn',
                    className: 'btn-primary',
                    viewport: {
                        w: 1920,
                        h: 1080
                    }
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify heatmap data was written
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('click_with_position')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.click_x).toBe(450);
        expect(event?.click_y).toBe(300);
        expect(event?.viewport_w).toBe(1920);
        expect(event?.viewport_h).toBe(1080);
        expect(event?.element_tag).toBe('button');
        expect(event?.element_id).toBe('add-to-cart-btn');
    });

    it('should reject invalid payload with missing type', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: { customerId: 'test' }
            })
        });

        expect(response.status).toBe(400);
        const result = await response.json();
        expect(result).toHaveProperty('ok', false);
        expect(result).toHaveProperty('error', 'Invalid payload');

        // Verify no data was written
        const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM pixel_events').first();
        expect(count?.cnt).toBe(0);
    });

    it('should reject malformed JSON', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'invalid json {'
        });

        expect(response.status).toBe(400);
        const result = await response.json();
        expect(result).toHaveProperty('ok', false);
    });

    it('should handle checkout_started event', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'checkout_started',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    checkout: {
                        token: 'checkout-token-abc'
                    }
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify checkout data was written
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('checkout_started')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.checkout_token).toBe('checkout-token-abc');
    });

    it('should handle search_submitted event', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'search_submitted',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    searchQuery: 'gold ring'
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify search data was written
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('search_submitted')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.search_query).toBe('gold ring');
    });

    // ============================================================================
    // Tests for page_url extraction from various field naming conventions
    // ============================================================================
    
    it('should extract page_url from data.url field (tracking.js format)', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'click_with_position',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    x: 100,
                    y: 200,
                    url: 'https://epirbizuteria.pl/products/gold-ring'
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify page_url was extracted from data.url
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('click_with_position')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.page_url).toBe('https://epirbizuteria.pl/products/gold-ring');
    });

    it('should extract page_url from data.pageUrl field (camelCase variant)', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'scroll_depth',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    depth: 75,
                    pageUrl: 'https://epirbizuteria.pl/collections/rings'
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify page_url was extracted from data.pageUrl
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('scroll_depth')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.page_url).toBe('https://epirbizuteria.pl/collections/rings');
    });

    it('should extract page_url from data.page_url field (snake_case variant)', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'page_exit',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    time_on_page_seconds: 45,
                    page_url: 'https://epirbizuteria.pl/pages/about'
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify page_url was extracted from data.page_url
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('page_exit')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.page_url).toBe('https://epirbizuteria.pl/pages/about');
    });

    it('should extract page_url from data.href field (href variant)', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'mouse_sample',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    x: 500,
                    y: 300,
                    href: 'https://epirbizuteria.pl/'
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify page_url was extracted from data.href
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('mouse_sample')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.page_url).toBe('https://epirbizuteria.pl/');
    });

    it('should prioritize context.document.location.href over data.url for page_viewed events', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'page_viewed',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    url: 'https://epirbizuteria.pl/fallback',
                    context: {
                        document: {
                            location: {
                                href: 'https://epirbizuteria.pl/products/silver-necklace'
                            },
                            title: 'Silver Necklace'
                        }
                    }
                }
            })
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('ok', true);

        // Verify page_url was extracted from context.document.location.href (higher priority)
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('page_viewed')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.page_url).toBe('https://epirbizuteria.pl/products/silver-necklace');
    });

    it('should ensure page_url is never null for events with url data', async () => {
        const response = await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'epir:custom_event',
                data: {
                    customerId: 'test-customer-123',
                    sessionId: 'test-session-456',
                    url: 'https://epirbizuteria.pl/test-page'
                }
            })
        });

        expect(response.status).toBe(200);

        // Verify page_url is not null
        const event = await env.DB.prepare('SELECT * FROM pixel_events WHERE event_type = ?')
            .bind('epir:custom_event')
            .first();
        
        expect(event).toBeTruthy();
        expect(event?.page_url).not.toBeNull();
        expect(event?.page_url).toBe('https://epirbizuteria.pl/test-page');
    });
});

describe('Analytics Worker - /pixel/count endpoint', () => {
    it('should return event count', async () => {
        // Insert test event
        await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'page_viewed',
                data: {
                    customerId: 'test-customer',
                    sessionId: 'test-session'
                }
            })
        });

        const response = await SELF.fetch('https://example.com/pixel/count');
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result).toHaveProperty('count');
        expect(typeof result.count).toBe('number');
        expect(result.count).toBeGreaterThan(0);
    });
});

describe('Analytics Worker - /pixel/events endpoint', () => {
    it('should return recent events', async () => {
        // Insert test event
        await SELF.fetch('https://example.com/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'product_viewed',
                data: {
                    customerId: 'test-customer',
                    sessionId: 'test-session',
                    productVariant: {
                        product: {
                            id: 'product-123',
                            title: 'Test Product'
                        }
                    }
                }
            })
        });

        const response = await SELF.fetch('https://example.com/pixel/events?limit=10');
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result).toHaveProperty('events');
        expect(Array.isArray(result.events)).toBe(true);
        expect(result.events.length).toBeGreaterThan(0);
    });
});