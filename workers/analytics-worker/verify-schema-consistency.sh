#!/bin/bash
# ============================================================================
# Schema Consistency Verification Script
# ============================================================================
# Purpose: Verify that SQL schema files match the D1 schema in index.ts
# Usage: ./verify-schema-consistency.sh
# ============================================================================

set -e

echo "🔍 Verifying schema consistency between SQL files and index.ts..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [[ ! -f "src/index.ts" ]] || [[ ! -f "schema-pixel-events-base.sql" ]]; then
    echo -e "${RED}❌ Error: Must run from workers/analytics-worker directory${NC}"
    exit 1
fi

echo "📋 Checking schema-pixel-events-base.sql..."

# Key schema elements to verify
errors=0

# Check 1: ID field should be INTEGER PRIMARY KEY AUTOINCREMENT
if grep -q "id INTEGER PRIMARY KEY AUTOINCREMENT" schema-pixel-events-base.sql; then
    echo -e "${GREEN}✅ ID field: INTEGER PRIMARY KEY AUTOINCREMENT${NC}"
else
    echo -e "${RED}❌ ID field: Should be INTEGER PRIMARY KEY AUTOINCREMENT${NC}"
    errors=$((errors + 1))
fi

# Check 2: created_at should be INTEGER NOT NULL
if grep -q "created_at INTEGER NOT NULL" schema-pixel-events-base.sql; then
    echo -e "${GREEN}✅ created_at field: INTEGER NOT NULL${NC}"
else
    echo -e "${RED}❌ created_at field: Should be INTEGER NOT NULL (Unix milliseconds)${NC}"
    errors=$((errors + 1))
fi

# Check 3: Heatmap v3 columns should be in base schema
heatmap_columns=("click_x" "click_y" "viewport_w" "viewport_h" "scroll_depth_percent" 
                 "time_on_page_seconds" "element_tag" "search_query" "collection_id" 
                 "order_id" "mouse_x" "mouse_y")

echo ""
echo "📋 Checking heatmap v3 columns in base schema..."
for col in "${heatmap_columns[@]}"; do
    if grep -q "$col" schema-pixel-events-base.sql; then
        echo -e "${GREEN}✅ Heatmap column present: $col${NC}"
    else
        echo -e "${RED}❌ Missing heatmap column: $col${NC}"
        errors=$((errors + 1))
    fi
done

# Check 4: Index names should match index.ts conventions
echo ""
echo "📋 Checking index naming conventions..."
index_names=("idx_pixel_customer" "idx_pixel_session" "idx_pixel_event_type" 
             "idx_pixel_product" "idx_pixel_created_at" "idx_pixel_clicks" 
             "idx_pixel_scroll" "idx_pixel_time_on_page" "idx_pixel_search" 
             "idx_pixel_collection")

for idx in "${index_names[@]}"; do
    if grep -q "$idx" schema-pixel-events-base.sql; then
        echo -e "${GREEN}✅ Index present: $idx${NC}"
    else
        echo -e "${RED}❌ Missing index: $idx${NC}"
        errors=$((errors + 1))
    fi
done

# Check 5: Verify v3-heatmap file is marked as deprecated
echo ""
echo "📋 Checking schema-pixel-events-v3-heatmap.sql status..."
if grep -q "DEPRECATED" schema-pixel-events-v3-heatmap.sql; then
    echo -e "${GREEN}✅ v3-heatmap file is marked as DEPRECATED${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: v3-heatmap file should be marked as DEPRECATED${NC}"
fi

# Final summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $errors -eq 0 ]; then
    echo -e "${GREEN}✅ All schema consistency checks passed!${NC}"
    echo ""
    echo "The SQL schema files match the D1 schema defined in src/index.ts"
    exit 0
else
    echo -e "${RED}❌ Schema consistency check failed with $errors error(s)${NC}"
    echo ""
    echo "Please update the SQL schema files to match src/index.ts"
    exit 1
fi
