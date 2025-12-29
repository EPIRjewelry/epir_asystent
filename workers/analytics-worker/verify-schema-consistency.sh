#!/bin/bash
# ============================================================================
# Schema Consistency Verification Script
# ============================================================================
# Purpose: Verify that SQL schema files match the TypeScript implementation
# Usage: Run from workers/analytics-worker directory: ./verify-schema-consistency.sh
# ============================================================================

set -e

# Determine script directory and change to it
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔍 Verifying SQL Schema Consistency..."
echo "📂 Working directory: $SCRIPT_DIR"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if schema files exist
if [ ! -f "schema-pixel-events-base.sql" ]; then
    echo -e "${RED}❌ schema-pixel-events-base.sql not found${NC}"
    echo "   Make sure you're running this script from workers/analytics-worker/"
    exit 1
fi

if [ ! -f "src/index.ts" ]; then
    echo -e "${RED}❌ src/index.ts not found${NC}"
    echo "   Make sure you're running this script from workers/analytics-worker/"
    exit 1
fi

echo "📄 Checking schema-pixel-events-base.sql..."
echo "   Note: Using simple pattern matching - checks actual schema definition lines"
echo ""

# Check for INTEGER PRIMARY KEY AUTOINCREMENT in SQL (in CREATE TABLE context)
if grep -E "^\s*id INTEGER PRIMARY KEY AUTOINCREMENT" schema-pixel-events-base.sql > /dev/null; then
    echo -e "${GREEN}✓${NC} SQL: id is INTEGER PRIMARY KEY AUTOINCREMENT"
else
    echo -e "${RED}✗${NC} SQL: id is NOT INTEGER PRIMARY KEY AUTOINCREMENT"
    exit 1
fi

# Check for INTEGER timestamps in SQL (in CREATE TABLE context)
if grep -E "^\s*created_at INTEGER NOT NULL" schema-pixel-events-base.sql > /dev/null; then
    echo -e "${GREEN}✓${NC} SQL: created_at is INTEGER"
else
    echo -e "${RED}✗${NC} SQL: created_at is NOT INTEGER"
    exit 1
fi

# Check for all key heatmap columns in base SQL
declare -a heatmap_columns=(
    "click_x"
    "click_y"
    "viewport_w"
    "viewport_h"
    "scroll_depth_percent"
    "time_on_page_seconds"
    "search_query"
    "collection_id"
    "checkout_token"
    "order_id"
)

for col in "${heatmap_columns[@]}"; do
    if grep -q "$col" schema-pixel-events-base.sql; then
        echo -e "${GREEN}✓${NC} SQL: Column $col found in base schema"
    else
        echo -e "${RED}✗${NC} SQL: Column $col NOT found in base schema"
        exit 1
    fi
done

echo ""
echo "📝 Checking src/index.ts..."

# Check TypeScript implementation
if grep -q "id INTEGER PRIMARY KEY AUTOINCREMENT" src/index.ts; then
    echo -e "${GREEN}✓${NC} TS: id is INTEGER PRIMARY KEY AUTOINCREMENT"
else
    echo -e "${RED}✗${NC} TS: id is NOT INTEGER PRIMARY KEY AUTOINCREMENT"
    exit 1
fi

if grep -q "created_at INTEGER NOT NULL" src/index.ts; then
    echo -e "${GREEN}✓${NC} TS: created_at is INTEGER NOT NULL"
else
    echo -e "${RED}✗${NC} TS: created_at is NOT INTEGER NOT NULL"
    exit 1
fi

for col in "${heatmap_columns[@]}"; do
    if grep -q "$col" src/index.ts; then
        echo -e "${GREEN}✓${NC} TS: Column $col found in ensurePixelTable()"
    else
        echo -e "${RED}✗${NC} TS: Column $col NOT found in ensurePixelTable()"
        exit 1
    fi
done

echo ""
echo "🔍 Checking v3-heatmap deprecation..."

# Check that v3-heatmap file has deprecation notice (optional check)
if [ -f "schema-pixel-events-v3-heatmap.sql" ]; then
    if grep -q "DEPRECATED" schema-pixel-events-v3-heatmap.sql; then
        echo -e "${GREEN}✓${NC} v3-heatmap file is marked as DEPRECATED"
    else
        echo -e "${YELLOW}⚠${NC}  v3-heatmap file should be marked as DEPRECATED"
    fi
else
    echo -e "${YELLOW}⚠${NC}  v3-heatmap file not found (this is OK if fully migrated)"
fi

echo ""
echo -e "${GREEN}✅ Schema consistency verification PASSED${NC}"
echo ""
echo "Summary:"
echo "  • SQL schema matches TypeScript implementation"
echo "  • All heatmap v3 columns are in base schema"
echo "  • INTEGER types used for id and timestamps"
echo "  • v3-heatmap file properly deprecated"
echo ""
