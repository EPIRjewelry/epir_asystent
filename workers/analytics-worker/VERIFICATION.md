# Analytics Worker Fix - Verification Guide

## Problem Summary

**Issue**: Production traffic from `epirbizuteria.pl` was not being saved to D1 database. Only test events were recorded, with `page_url` fields saving as `null`.

**Root Cause**: The analytics worker only extracted `page_url` from `page_viewed` events using the Shopify Web Pixels API structure (`data.context.document.location.href`). Custom tracking events from `tracking.js` (click_with_position, scroll_depth, page_exit) send `page_url` under different field names (`url`, `pageUrl`, `page_url`, `href`), which were not being extracted.

## Fix Applied

Added a fallback extraction mechanism in `workers/analytics-worker/src/index.ts` that:

1. **Prioritizes Shopify standard format** for `page_viewed` events
2. **Falls back to multiple field naming conventions**:
   - `data.url` (used by tracking.js)
   - `data.pageUrl` (camelCase variant)
   - `data.page_url` (snake_case variant)
   - `data.href` (direct href variant)

This ensures `page_url` is captured for ALL event types, not just `page_viewed`.

## Verification Steps

### 1. Run Smoke Test (Local/CI)

Execute the smoke test script to send test events:

```bash
cd workers/analytics-worker
./smoke-test.sh
```

This sends 5 test events with different `page_url` formats:
- page_viewed (Shopify format)
- product_viewed
- click_with_position (url field)
- scroll_depth (pageUrl field)
- page_exit (page_url field)

### 2. Verify Data in D1

After running smoke test, verify events were recorded with non-null `page_url`:

```bash
# Get the TEST_CUSTOMER_ID from smoke-test.sh output
TEST_CUSTOMER_ID="smoke-test-customer-XXXXXXXXXX"

# Check events from smoke test
wrangler d1 execute jewelry-analytics-db --remote \
  --command="SELECT event_type, page_url, customer_id, created_at FROM pixel_events WHERE customer_id = '$TEST_CUSTOMER_ID' ORDER BY created_at DESC;"
```

**Expected Result**: All 5 events should have non-null `page_url` values:
- `https://epirbizuteria.pl/products/gold-ring`
- `https://epirbizuteria.pl/collections/rings`

### 3. Check Production Events (Last 24 Hours)

```bash
# Get current timestamp in milliseconds (24 hours ago)
TIMESTAMP_24H_AGO=$(node -e "console.log(Date.now() - 24*60*60*1000)")

# Query recent production events
wrangler d1 execute jewelry-analytics-db --remote \
  --command="SELECT event_type, page_url, customer_id, session_id, created_at FROM pixel_events WHERE created_at > $TIMESTAMP_24H_AGO AND customer_id NOT LIKE 'smoke-test-%' ORDER BY created_at DESC LIMIT 20;"
```

**Expected Result**: Should see real production events (page_viewed, product_viewed, etc.) with valid `page_url` values from `epirbizuteria.pl` domain.

### 4. Verify page_url is Never Null

```bash
# Count events with null page_url (should be 0 or very low)
wrangler d1 execute jewelry-analytics-db --remote \
  --command="SELECT COUNT(*) as null_page_url_count FROM pixel_events WHERE page_url IS NULL AND created_at > $TIMESTAMP_24H_AGO;"

# Check event types with null page_url (to identify remaining issues)
wrangler d1 execute jewelry-analytics-db --remote \
  --command="SELECT event_type, COUNT(*) as count FROM pixel_events WHERE page_url IS NULL AND created_at > $TIMESTAMP_24H_AGO GROUP BY event_type;"
```

**Expected Result**: 
- `null_page_url_count` should be 0 for events that include URL data
- Events without URL data (e.g., cart_updated without context) may legitimately have null `page_url`

### 5. Check Total Event Count Growth

```bash
# Check total events before fix
wrangler d1 execute jewelry-analytics-db --remote \
  --command="SELECT COUNT(*) as total_before FROM pixel_events WHERE created_at < $TIMESTAMP_DEPLOY;"

# Check total events after fix
wrangler d1 execute jewelry-analytics-db --remote \
  --command="SELECT COUNT(*) as total_after FROM pixel_events WHERE created_at >= $TIMESTAMP_DEPLOY;"

# Check event distribution by type
wrangler d1 execute jewelry-analytics-db --remote \
  --command="SELECT event_type, COUNT(*) as count FROM pixel_events WHERE created_at >= $TIMESTAMP_DEPLOY GROUP BY event_type ORDER BY count DESC;"
```

**Expected Result**: Should see significant increase in event count after deployment, with diverse event types (not just test events).

## Manual Verification (Browser)

### Test Web Pixel on Production

1. Open browser DevTools (F12)
2. Navigate to `https://epirbizuteria.pl`
3. Open Console tab
4. Look for EPIR Pixel logs:
   ```
   [EPIR Pixel] Customer ID: <customer-id-or-anonymous>
   [EPIR Pixel] Session ID: session_<timestamp>_<random>
   Page viewed {data: {...}}
   ```
5. Navigate to a product page
6. Check for `Product viewed` log
7. Verify Network tab shows successful POST to `https://epir-analityc-worker.krzysztofdzugaj.workers.dev/pixel`

### Test Tracking.js Events

1. On `https://epirbizuteria.pl`, open DevTools Console
2. Click anywhere on the page
3. Check for `[EPIR Tracking] initialized` log
4. Scroll down the page
5. Verify events are being published:
   - Click: `epir:click_with_position`
   - Scroll: `epir:scroll_depth`
   - Exit: `epir:page_exit` (on page unload)

## Test Suite Results

All unit tests passing (16/16):

```bash
cd workers/analytics-worker
npm test
```

**Test Coverage Includes**:
- ✅ page_viewed event with context.document.location.href
- ✅ product_viewed event
- ✅ cart_updated event
- ✅ heatmap events with coordinates
- ✅ checkout_started event
- ✅ search_submitted event
- ✅ **NEW**: Extract page_url from data.url field
- ✅ **NEW**: Extract page_url from data.pageUrl field
- ✅ **NEW**: Extract page_url from data.page_url field
- ✅ **NEW**: Extract page_url from data.href field
- ✅ **NEW**: Prioritize context.document.location.href over fallbacks
- ✅ **NEW**: Ensure page_url is never null for events with URL data

## Known Limitations

1. **Events without URL context**: Some events (e.g., `cart_updated` without page context) may legitimately have `null` page_url. This is expected behavior.

2. **CORS restrictions**: The worker only accepts requests from whitelisted origins:
   - `https://epirbizuteria.pl`
   - `https://epir-art-silver-jewellery.myshopify.com`
   - `https://asystent.epirbizuteria.pl`
   
   Events from other origins will be rejected with CORS warning in logs.

3. **Tracking.liquid activation**: The `tracking.liquid` block must be published and enabled in the theme for custom events (heatmap) to work. Standard Shopify events work regardless.

## Troubleshooting

### Still seeing null page_url?

1. Check event type: `wrangler d1 execute jewelry-analytics-db --remote --command="SELECT event_type, COUNT(*) FROM pixel_events WHERE page_url IS NULL GROUP BY event_type;"`
2. Check event payload in logs: Look for `[ANALYTICS_WORKER] 📊 Event data keys:` in Cloudflare logs
3. Verify tracking.js is loaded: Open DevTools Console on production site and look for `[EPIR Tracking] initialized`

### No events at all?

1. Check CORS: Look for `[ANALYTICS_WORKER] ⚠️ Rejected Origin` warnings in Cloudflare logs
2. Verify worker deployment: `wrangler deployments list --name epir-analityc-worker`
3. Check Web Pixel extension is active in Shopify admin

### Events recorded but no page_url?

1. Inspect raw event_data field: `wrangler d1 execute jewelry-analytics-db --remote --command="SELECT event_type, event_data FROM pixel_events WHERE page_url IS NULL LIMIT 5;"`
2. Check if URL data exists in different structure
3. Add additional fallback extraction logic if needed

## Success Criteria

✅ **Criteria 1**: New production events (page_viewed, product_viewed) are recorded with non-null `page_url`
✅ **Criteria 2**: All smoke test events have valid `page_url` values
✅ **Criteria 3**: Custom tracking events (click_with_position, scroll_depth) capture `page_url` correctly
✅ **Criteria 4**: Test suite passes (16/16 tests)
✅ **Criteria 5**: Event count increases significantly after deployment

## Rollback Plan

If issues arise:

```bash
# Revert to previous deployment
wrangler rollback epir-analityc-worker

# Or deploy specific version
git checkout <previous-commit>
cd workers/analytics-worker
wrangler deploy
```

## Contact

For issues or questions:
- Check Cloudflare Worker logs: `wrangler tail epir-analityc-worker --format json`
- Review D1 data: Commands above
- Contact: Repository maintainers
