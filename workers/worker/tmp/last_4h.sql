SELECT id, event_type, created_at, event_data
FROM pixel_events
WHERE created_at >= (strftime('%s','now') * 1000) - (4 * 60 * 60 * 1000)
ORDER BY created_at DESC
LIMIT 200;