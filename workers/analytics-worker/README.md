# Analytics Worker - Event Tracking and Storage

## Overview

The Analytics Worker is responsible for receiving and storing customer behavior events from the Shopify Web Pixel (`my-web-pixel`). It tracks 25 different event types including:
- 16 standard Shopify events (page views, product views, cart actions, checkout flow)
- 5 DOM events (clicks, form submissions, input focus/blur/change)
- 4 custom heatmap events (click positions, scroll depth, time on page, mouse movements)

## Architecture

```
Shopify Storefront → my-web-pixel → POST /pixel → analytics-worker → D1 Database
                                                   ↓
                                            Session DO (notifications)
                                                   ↓
                                            AI Worker (behavior analysis)
```

## Database Schema

### Schema Consistency (Updated 2025-12-29)

**Important:** The SQL schema files and TypeScript code are now fully synchronized:
- **Schema Source of Truth:** `schema-pixel-events-base.sql` matches the table structure in `index.ts`
- **Unified Schema:** All heatmap v3 columns are now inline in the base schema
- **DEPRECATED:** `schema-pixel-events-v3-heatmap.sql` is no longer needed (kept for reference only)

**Key Schema Details:**
- Primary key: `id INTEGER PRIMARY KEY AUTOINCREMENT` (not TEXT)
- Timestamps: `INTEGER` type using Unix milliseconds (not TEXT with datetime())
- All 25+ event types supported with a single unified table structure

### pixel_events Table
Stores all tracking events with:
- **Event identification:** auto-increment integer ID, event type, event name
- **Customer & session identification:** customer_id, session_id
- **Product information:** product_id, product_handle, product_type, product_vendor, product_title, variant_id
- **Cart information:** cart_id
- **Page context:** page_url, page_title, page_type
- **Timestamps:** created_at (INTEGER, Unix milliseconds)
- **Heatmap data:** click_x, click_y, viewport_w, viewport_h, scroll_depth_percent, time_on_page_seconds
- **DOM tracking:** element_tag, element_id, element_class, input_name, form_id
- **Search & collection:** search_query, collection_id, collection_handle
- **Checkout & order:** checkout_token, order_id, order_value
- **Alerts & errors:** alert_type, alert_message, error_message, extension_id
- **Mouse tracking:** mouse_x, mouse_y
- **Raw payload:** event_data (JSON)

### customer_sessions Table
Aggregates customer behavior by session:
- Event counts and timestamps (INTEGER, Unix milliseconds)
- AI engagement scores
- Proactive chat activation flags

## API Endpoints

### POST /pixel
Receives and stores tracking events from Web Pixel.

**Request Body:**
```json
{
  "type": "page_viewed|product_viewed|cart_updated|...",
  "data": {
    "customerId": "customer-123",
    "sessionId": "session-456",
    // ... event-specific data
  }
}
```

**Response:**
```json
{
  "ok": true,
  "activate_chat": false,
  "reason": null
}
```

### GET /pixel/count
Returns the total number of events stored.

**Response:**
```json
{
  "count": 12345
}
```

### GET /pixel/events?limit=20
Returns recent events (default: 20, max: 200).

**Response:**
```json
{
  "events": [
    {
      "id": 1,
      "event": "product_viewed",
      "data": { ... },
      "timestamp": 1234567890,
      "created_at": 1234567890
    }
  ]
}
```

## Diagnostic Logging

The worker includes comprehensive diagnostic logging to help debug issues:

### Log Prefixes
All logs use the prefix `[ANALYTICS_WORKER]` with emoji indicators:
- 📥 Request received
- 📊 Data processing
- 🔧 Table/index operations
- 💾 Database INSERT operations
- ✅ Success messages
- ⚠️ Warnings
- ❌ Errors

### Viewing Logs in Cloudflare Dashboard

1. Go to **Workers & Pages** → Select `epir-analityc-worker`
2. Click **Logs** tab
3. Filter by script name: `ScriptName == "epir-analityc-worker"`

### Key Diagnostic Messages

**Request Receipt:**
```
[ANALYTICS_WORKER] 📥 Received POST /pixel request
[ANALYTICS_WORKER] 📊 Event type: product_viewed
[ANALYTICS_WORKER] 📊 Event data keys: [ 'customerId', 'sessionId', 'productVariant' ]
```

**Table Setup:**
```
[ANALYTICS_WORKER] 🔧 Ensuring pixel_events table exists...
[ANALYTICS_WORKER] ✅ Table pixel_events ensured
[ANALYTICS_WORKER] 🔧 Creating indexes...
[ANALYTICS_WORKER] ✅ Indexes created successfully
```

**INSERT Preparation:**
```
[ANALYTICS_WORKER] 💾 Preparing INSERT with values: {
  eventType: 'product_viewed',
  customerId: 'customer-123',
  sessionId: 'session-456',
  productId: 'product-789',
  cartId: null,
  pageUrl: 'https://shop.example.com/products/ring',
  timestamp: 1234567890
}
```

**INSERT Success:**
```
[ANALYTICS_WORKER] ✅ INSERT successful, result: {
  success: true,
  meta: {
    served_by: 'miniflare.db',
    duration: 0,
    changes: 1,
    last_row_id: 123,
    changed_db: true,
    rows_read: 1,
    rows_written: 7
  }
}
[ANALYTICS_WORKER] 📊 Rows affected: 1
[ANALYTICS_WORKER] 📊 Last inserted ID: 123
```

**Errors:**
```
[ANALYTICS_WORKER] ❌ Insert failed with error: ...
[ANALYTICS_WORKER] ❌ Error details: {
  message: "SQL error message",
  stack: "...",
  eventType: "product_viewed"
}
```

## Troubleshooting

### Events Not Being Saved

1. **Check Cloudflare Logs** for error messages:
   - Look for `❌` emoji indicators
   - Check INSERT error details

2. **Verify D1 Database Connection:**
   ```bash
   wrangler d1 info epir_art_jewellery
   ```

3. **Check Table Schema:**
   ```bash
   wrangler d1 execute epir_art_jewellery --command "PRAGMA table_info(pixel_events);"
   ```

4. **Test Event Submission Locally:**
   ```bash
   curl -X POST http://localhost:8787/pixel \
     -H "Content-Type: application/json" \
     -d '{"type":"page_viewed","data":{"customerId":"test","sessionId":"test-session"}}'
   ```

5. **Check Event Count:**
   ```bash
   curl http://localhost:8787/pixel/count
   ```

### Common Issues

**Issue: Table doesn't exist**
- Solution: The worker auto-creates tables on first request
- Check logs for table creation messages

**Issue: Schema mismatch**
- Solution: Run the schema verification script: `./verify-schema-consistency.sh`
- The code uses INTEGER timestamps and AUTOINCREMENT id
- If you manually created the table, ensure it matches the schema in `ensurePixelTable()`
- SQL schema file: `schema-pixel-events-base.sql` should match TypeScript implementation

**Issue: Events show in logs but not in database**
- Check the INSERT result metadata in logs
- Verify `changes: 1` and `last_row_id` are present
- Check D1 database size hasn't exceeded limits

## Development

### Schema Consistency Verification
Verify that SQL schema files match the TypeScript implementation:
```bash
./verify-schema-consistency.sh
```

This script checks:
- ✓ SQL and TypeScript use same data types (INTEGER vs TEXT)
- ✓ All heatmap v3 columns are present in base schema
- ✓ Deprecated files are properly marked
- ✓ Primary key and timestamp definitions match

### Running Tests
```bash
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
```

### Local Development
```bash
npm run dev           # Start local worker with wrangler
```

### Deployment
```bash
npm run deploy        # Deploy to Cloudflare
```

## Schema Migration

**Current Schema (v3 - Unified):**
The worker auto-creates tables using the unified schema defined in `schema-pixel-events-base.sql`.

**Manual Migration (if needed):**

1. **Base schema (recommended):**
   ```bash
   wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-base.sql
   ```

2. **For production:**
   ```bash
   wrangler d1 execute epir_art_jewellery --remote --file=./schema-pixel-events-base.sql
   ```

3. **Verify schema:**
   ```bash
   wrangler d1 execute epir_art_jewellery --local --command="PRAGMA table_info(pixel_events);"
   ```

**Legacy Schema Files:**
- ⚠️ `schema-pixel-events-v3-heatmap.sql` is DEPRECATED (all columns are now in base schema)
- Do not use the heatmap file for new databases

**Schema Consistency:**
The TypeScript code in `index.ts` exactly matches `schema-pixel-events-base.sql`:
- Both use `INTEGER PRIMARY KEY AUTOINCREMENT` for id
- Both use `INTEGER` timestamps (Unix milliseconds)
- Both include all heatmap v3 columns inline

## Integration with Other Services

### Session DO
After storing events, the worker notifies the Session Durable Object about:
- Product views (for proactive chat triggers)
- Cart activity

### AI Worker
The worker calls the AI Worker (via Service Binding) to:
- Analyze customer behavior patterns
- Calculate engagement scores
- Recommend proactive chat activation

## Performance Monitoring

Key metrics to monitor:
- Event ingestion rate (events/second)
- INSERT latency (check `duration` in result metadata)
- Database size growth
- Error rate (check for `❌` logs)

## Security

- All events are stored with customer_id and session_id for privacy tracking
- No PII (personally identifiable information) should be stored in event_data
- Use Cloudflare dashboard for audit logs

## Support

For issues or questions:
1. Check the logs in Cloudflare dashboard
2. Run the test suite locally
3. Verify D1 database health
4. Review this README for troubleshooting steps
