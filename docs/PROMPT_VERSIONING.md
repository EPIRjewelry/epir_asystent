# Prompt Versioning Strategy

**Project:** EPIR Assistant (epir_asystent)  
**Created:** 2025-01-06  
**Last Updated:** 2025-01-06  

---

## Overview

This document describes the versioning strategy for AI system prompts in the EPIR Assistant project.

**Why versioning?**
- A/B testing different prompt strategies
- Rollback capability if new prompt degrades quality
- Historical record of prompt evolution
- Easier experimentation without breaking production

---

## Versioning Scheme

We use **semantic versioning** for prompts:

```
v<MAJOR>.<MINOR>.<PATCH>
```

### Version Components

- **MAJOR** (v1, v2, v3...): Complete prompt rewrite or fundamental strategy change
  - Example: v1 → v2 when switching from JSON contract to Harmony protocol
- **MINOR** (v1.1, v1.2...): Significant additions or changes to sections
  - Example: Adding new tool schema, new persona guidelines
- **PATCH** (v1.1.1, v1.1.2...): Small tweaks, typo fixes, clarifications
  - Example: Fixing example responses, adjusting tone

### Git Tags

Each prompt version should be tagged in Git:

```powershell
git tag -a prompt-v2.0.0 -m "Prompt v2.0.0: Harmony protocol integration"
git push origin prompt-v2.0.0
```

---

## File Naming Convention

### Backup Files

When creating a new version, backup the previous as:

```
luxury-system-prompt-v<VERSION>-backup.ts
```

**Examples:**
- `luxury-system-prompt-v1-backup.ts` - Original prompt (before Harmony)
- `luxury-system-prompt-v2-backup.ts` - Harmony protocol version

### Active File

The **active** prompt is always:

```
luxury-system-prompt.ts
```

This is the only file imported by `index.ts` and other modules.

---

## Version History

### v1.0.0 (Baseline)
**Date:** 2025-01-06  
**File:** `luxury-system-prompt-v1-backup.ts`  
**Git Tag:** `prompt-v1.0.0` (to be created)

**Features:**
- Chain-of-Thought (CoT) reasoning section
- JSON contract: `{ reply }`, `{ tool_call }`, `{ error }`
- Luxury brand voice (EPIR-ART-JEWELLERY)
- Session memory and personalization rules
- 7 MCP tools (search_shop_catalog, get_product, update_cart, etc.)
- Polish language, formal tone

**Strengths:**
- Clear structure (ETAP 1: CoT, ETAP 2: Action)
- Explicit tool call format
- Strong brand voice guidelines

**Weaknesses:**
- No Harmony protocol support (limited to basic JSON)
- No explicit MoE expert activation signals
- Limited RAG source citation examples

---

### v2.0.0 (Current - Planned)
**Date:** TBD  
**File:** `luxury-system-prompt.ts` (active)  
**Git Tag:** `prompt-v2.0.0` (to be created after testing)

**Planned Changes:**
- Add Harmony protocol support (`<|call|>`, `<|end|>`, `<|return|>` tokens)
- Add MoE expert activation signals (semantic keywords for 128 experts)
- Improve RAG source citation format (clickable links)
- Add examples for multi-turn tool orchestration
- Update tool list to match EXACT Shopify MCP names:
  - `search_shop_catalog` → Verify exact name from MCP spec
  - `get_cart`, `update_cart`, `get_most_recent_order_status`
  - `search_shop_policies_and_faqs`

**Migration Plan:**
1. Test v2 in development environment
2. Run A/B test (50% v1, 50% v2) for 7 days
3. Monitor metrics: task completion rate, customer satisfaction
4. If v2 performs ≥10% better → promote to 100%
5. If v2 regresses → rollback to v1

---

## A/B Testing Procedure

### 1. Prepare Test Environment

```typescript
// workers/worker/src/index.ts

import { LUXURY_SYSTEM_PROMPT as PROMPT_V1 } from './prompts/luxury-system-prompt-v1-backup';
import { LUXURY_SYSTEM_PROMPT as PROMPT_V2 } from './prompts/luxury-system-prompt';

function selectPrompt(sessionId: string): string {
  // Hash session ID to get deterministic A/B assignment
  const hash = hashString(sessionId);
  return (hash % 2 === 0) ? PROMPT_V1 : PROMPT_V2;
}
```

### 2. Log Version in Analytics

```typescript
// Log which prompt version was used
await env.ANALYTICS?.fetch('https://analytics/log', {
  method: 'POST',
  body: JSON.stringify({
    event: 'prompt_version_used',
    session_id: sessionId,
    version: (hash % 2 === 0) ? 'v1' : 'v2',
    timestamp: new Date().toISOString(),
  }),
});
```

### 3. Monitor Metrics

Track these metrics for each version:
- **Task Completion Rate**: % of sessions where user successfully completed purchase/inquiry
- **Average Response Quality**: Manual review score (1-5 scale)
- **Tool Call Accuracy**: % of tool calls that succeeded on first attempt
- **Customer Satisfaction**: Feedback scores (if available)
- **Conversation Length**: Average turns to resolution

### 4. Statistical Significance

Use **chi-squared test** or **t-test** to determine if performance difference is statistically significant:
- Minimum sample size: 1000 sessions per version
- Significance level: p < 0.05 (95% confidence)

---

## Rollback Procedure

If a new prompt version causes issues:

### 1. Immediate Rollback (Production Emergency)

```powershell
# In workers/worker/src/prompts/
Copy-Item luxury-system-prompt-v1-backup.ts luxury-system-prompt.ts -Force

# Deploy immediately
cd ..\..
npm run deploy
```

### 2. Git Revert (Controlled Rollback)

```powershell
git revert <commit-hash-of-new-prompt>
git push origin main
npm run deploy
```

---

## Best Practices

1. **Never edit luxury-system-prompt.ts directly in production**
   - Always test in dev environment first
   - Use feature flags or A/B testing for gradual rollout

2. **Document changes in commit messages**
   ```
   git commit -m "prompt: v2.1.0 - Add Harmony protocol examples

   - Added <|call|> token examples for tool orchestration
   - Improved RAG citation format with clickable links
   - Added semantic keywords for MoE expert activation
   
   Testing: Passed 50-session dev test (0 errors)
   "
   ```

3. **Keep backups for at least 3 versions**
   - v1-backup.ts (baseline)
   - v2-backup.ts (previous stable)
   - luxury-system-prompt.ts (current active)

4. **Use config files for brand voice**
   - Extract brand-specific strings to `config/brand-voice.ts`
   - This allows updating brand voice WITHOUT changing prompt version

---

## Future Improvements

- **Automated Testing**: Unit tests for prompt format validation
- **Prompt Templates**: Jinja2-style templating for dynamic sections
- **Version Selector UI**: Admin panel to switch versions without deployment
- **Prompt Analytics Dashboard**: Real-time metrics per version

---

## Related Documentation

- `README.md` - Canonical settings (GROQ_MODEL_ID, SHOP_DOMAIN)
- `.github/copilot-instructions.md` - Architecture overview
- `workers/worker/src/config/brand-voice.ts` - Brand voice configuration
- `workers/worker/src/config/model-params.ts` - Model parameters

---

**Maintained by:** EPIR Development Team  
**Contact:** [repository owner]
