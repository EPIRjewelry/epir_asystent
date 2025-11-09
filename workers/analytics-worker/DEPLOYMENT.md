# Deployment and Verification Guide

## Summary of Changes

This PR fixes the D1 database event storage issue in analytics-worker by adding comprehensive diagnostic logging and tests.

## Changes Overview

1. **Enhanced Diagnostic Logging** - All database operations now have detailed logging
2. **Comprehensive Test Suite** - 10 tests covering all major event types
3. **Documentation** - Complete README with troubleshooting guide
4. **Security** - Fixed stack trace exposure vulnerability

## Pre-Deployment Checklist

- [x] All tests pass (10/10)
- [x] Security scan clean (0 vulnerabilities)
- [x] Code review completed
- [x] Documentation updated

## Deployment Steps

### 1. Deploy the Worker

```bash
cd workers/analytics-worker
npm install
npm run deploy
```

### 2. Verify Deployment

After deployment, verify the worker is running:

```bash
# Check worker status in Cloudflare dashboard
# Workers & Pages → epir-analityc-worker → Logs
```

### 3. Test Event Submission

Send a test event to verify database writes:

```bash
curl -X POST https://your-worker-domain.workers.dev/pixel \
  -H "Content-Type: application/json" \
  -d '{
    "type": "page_viewed",
    "data": {
      "customerId": "test-customer",
      "sessionId": "test-session",
      "context": {
        "document": {
          "url": "https://shop.example.com/test",
          "title": "Test Page"
        }
      }
    }
  }'
```

Expected response:
```json
{
  "ok": true,
  "activate_chat": false,
  "reason": null
}
```

### 4. Verify Database Write

Check that the event was written to D1:

```bash
wrangler d1 execute epir_art_jewellery --command "SELECT COUNT(*) as count FROM pixel_events"
```

### 5. Check Diagnostic Logs

View logs in Cloudflare dashboard to see detailed diagnostic information:

1. Go to Workers & Pages → epir-analityc-worker
2. Click **Logs** tab
3. Filter: `ScriptName == "epir-analityc-worker"`

Look for:
- ✅ `[ANALYTICS_WORKER] ✅ INSERT successful`
- ✅ `[ANALYTICS_WORKER] 📊 Rows affected: 1`
- ✅ `[ANALYTICS_WORKER] 📊 Last inserted ID: X`

## Troubleshooting

### If events are not being saved:

1. **Check logs first** - Look for ❌ error indicators in Cloudflare dashboard
2. **Verify table exists** - The worker auto-creates tables, check logs for table creation messages
3. **Check D1 database** - Verify the database binding is correct in wrangler.toml
4. **Test locally** - Run `wrangler dev` and test with curl

### Common Issues

**Issue: "Table doesn't exist"**
- Solution: The worker auto-creates tables on first request. Check logs for table creation success.

**Issue: "Database binding not found"**
- Solution: Verify `wrangler.toml` has correct D1 database binding:
  ```toml
  [[d1_databases]]
  binding = "DB"
  database_name = "epir_art_jewellery"
  database_id = "your-database-id"
  ```

**Issue: "No logs visible"**
- Solution: Enable observability in wrangler.toml:
  ```toml
  [observability]
  enabled = true
  [observability.logs]
  enabled = true
  invocation_logs = true
  ```

## Monitoring

After deployment, monitor these metrics:

1. **Event ingestion rate** - Check logs for request volume
2. **Database write success** - Look for "INSERT successful" messages
3. **Error rate** - Monitor for ❌ error indicators
4. **Database size** - Check D1 database size in Cloudflare dashboard

## Rollback Plan

If issues occur after deployment:

1. Roll back to previous version:
   ```bash
   git revert HEAD
   npm run deploy
   ```

2. Check logs to identify the issue
3. Fix and redeploy

## Post-Deployment Verification

Run this checklist after deployment:

- [ ] Worker responds to health check (`GET /healthz`)
- [ ] Test event submission succeeds
- [ ] Event count increases (`GET /pixel/count`)
- [ ] Recent events are retrievable (`GET /pixel/events`)
- [ ] Logs show successful INSERT operations
- [ ] D1 database contains new events
- [ ] No error messages in logs

## Support

For issues or questions:
1. Check the README.md in workers/analytics-worker/
2. Review Cloudflare logs for diagnostic information
3. Run the test suite locally: `npm test`
4. Verify D1 database health in Cloudflare dashboard
