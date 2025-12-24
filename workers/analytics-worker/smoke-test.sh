#!/bin/bash

# ============================================================================
# Analytics Worker Smoke Test
# ============================================================================
# Purpose: Verify that production traffic is being captured correctly in D1
# Usage: ./smoke-test.sh
# ============================================================================

set -e

WORKER_URL="https://epir-analityc-worker.krzysztofdzugaj.workers.dev"
TEST_CUSTOMER_ID="smoke-test-customer-$(date +%s)"
TEST_SESSION_ID="smoke-test-session-$(date +%s)"

echo "=========================================="
echo "Analytics Worker Smoke Test"
echo "=========================================="
echo ""
echo "Worker URL: $WORKER_URL"
echo "Customer ID: $TEST_CUSTOMER_ID"
echo "Session ID: $TEST_SESSION_ID"
echo ""

# Test 1: page_viewed event (Shopify standard format)
echo "Test 1: Sending page_viewed event (Shopify format)..."
curl -X POST "$WORKER_URL/pixel" \
  -H "Content-Type: application/json" \
  -H "Origin: https://epirbizuteria.pl" \
  -d '{
    "type": "page_viewed",
    "data": {
      "customerId": "'"$TEST_CUSTOMER_ID"'",
      "sessionId": "'"$TEST_SESSION_ID"'",
      "context": {
        "document": {
          "location": {
            "href": "https://epirbizuteria.pl/products/gold-ring"
          },
          "title": "Gold Ring - EPIR Jewelry"
        }
      }
    }
  }' | jq .

echo ""
sleep 1

# Test 2: product_viewed event
echo "Test 2: Sending product_viewed event..."
curl -X POST "$WORKER_URL/pixel" \
  -H "Content-Type: application/json" \
  -H "Origin: https://epirbizuteria.pl" \
  -d '{
    "type": "product_viewed",
    "data": {
      "customerId": "'"$TEST_CUSTOMER_ID"'",
      "sessionId": "'"$TEST_SESSION_ID"'",
      "productVariant": {
        "id": "variant-smoke-test-123",
        "product": {
          "id": "product-smoke-test-456",
          "title": "Smoke Test Product",
          "type": "Ring",
          "vendor": "EPIR Jewelry"
        }
      }
    }
  }' | jq .

echo ""
sleep 1

# Test 3: click_with_position event (tracking.js format with url field)
echo "Test 3: Sending click_with_position event (tracking.js format)..."
curl -X POST "$WORKER_URL/pixel" \
  -H "Content-Type: application/json" \
  -H "Origin: https://epirbizuteria.pl" \
  -d '{
    "type": "click_with_position",
    "data": {
      "customerId": "'"$TEST_CUSTOMER_ID"'",
      "sessionId": "'"$TEST_SESSION_ID"'",
      "x": 450,
      "y": 300,
      "element": "button",
      "id": "add-to-cart",
      "url": "https://epirbizuteria.pl/products/gold-ring",
      "viewport": {
        "w": 1920,
        "h": 1080
      }
    }
  }' | jq .

echo ""
sleep 1

# Test 4: scroll_depth event with pageUrl field
echo "Test 4: Sending scroll_depth event (pageUrl variant)..."
curl -X POST "$WORKER_URL/pixel" \
  -H "Content-Type: application/json" \
  -H "Origin: https://epirbizuteria.pl" \
  -d '{
    "type": "scroll_depth",
    "data": {
      "customerId": "'"$TEST_CUSTOMER_ID"'",
      "sessionId": "'"$TEST_SESSION_ID"'",
      "depth": 75,
      "pageUrl": "https://epirbizuteria.pl/collections/rings"
    }
  }' | jq .

echo ""
sleep 1

# Test 5: page_exit event with page_url field
echo "Test 5: Sending page_exit event (page_url variant)..."
curl -X POST "$WORKER_URL/pixel" \
  -H "Content-Type: application/json" \
  -H "Origin: https://epirbizuteria.pl" \
  -d '{
    "type": "page_exit",
    "data": {
      "customerId": "'"$TEST_CUSTOMER_ID"'",
      "sessionId": "'"$TEST_SESSION_ID"'",
      "time_on_page_seconds": 45,
      "max_scroll_percent": 80,
      "page_url": "https://epirbizuteria.pl/products/gold-ring"
    }
  }' | jq .

echo ""
echo "=========================================="
echo "Smoke test completed!"
echo "=========================================="
echo ""
echo "Now verify the data in D1 with the following commands:"
echo ""
echo "# 1. Check total event count"
echo "wrangler d1 execute jewelry-analytics-db --remote \\"
echo "  --command=\"SELECT COUNT(*) as total_events FROM pixel_events;\""
echo ""
echo "# 2. Check events from this smoke test"
echo "wrangler d1 execute jewelry-analytics-db --remote \\"
echo "  --command=\"SELECT event_type, page_url, customer_id, session_id, created_at FROM pixel_events WHERE customer_id = '$TEST_CUSTOMER_ID' ORDER BY created_at DESC LIMIT 10;\""
echo ""
echo "# 3. Verify page_url is not null"
echo "wrangler d1 execute jewelry-analytics-db --remote \\"
echo "  --command=\"SELECT event_type, page_url FROM pixel_events WHERE customer_id = '$TEST_CUSTOMER_ID' AND page_url IS NOT NULL;\""
echo ""
echo "# 4. Check recent production events (last 24 hours)"
echo "wrangler d1 execute jewelry-analytics-db --remote \\"
echo "  --command=\"SELECT event_type, page_url, customer_id, session_id, created_at FROM pixel_events WHERE created_at > \$(date -d '24 hours ago' +%s)000 ORDER BY created_at DESC LIMIT 20;\""
echo ""
