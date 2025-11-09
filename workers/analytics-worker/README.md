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

### pixel_events Table
Stores all tracking events with:
- Basic event metadata (type, timestamp)
- Customer & session identification
- Product information (for product-related events)
- Cart information (for cart events)
- Page context (URL, title, type)
- Heatmap data (click coordinates, scroll depth, time on page)
- Search & collection data
- Checkout & order information

### customer_sessions Table
Aggregates customer behavior by session:
- Event counts and timestamps
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
- Solution: The code uses INTEGER timestamps and AUTOINCREMENT id
- If you manually created the table, ensure it matches the schema in `ensurePixelTable()`

**Issue: Events show in logs but not in database**
- Check the INSERT result metadata in logs
- Verify `changes: 1` and `last_row_id` are present
- Check D1 database size hasn't exceeded limits

## Development

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

The worker auto-creates tables, but you can also run migrations manually:

1. **Base schema:**
   ```bash
   wrangler d1 execute epir_art_jewellery --file=./schema-pixel-events-base.sql
   ```

2. **Heatmap extensions:**
   ```bash
   wrangler d1 execute epir_art_jewellery --file=./schema-pixel-events-v3-heatmap.sql
   ```

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
