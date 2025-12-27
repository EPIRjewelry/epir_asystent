import { describe, test, expect } from 'vitest';
import { TOOL_SCHEMAS } from '../src/mcp_tools';
import fs from 'fs';
import path from 'path';

describe('MCP system prompt tool names', () => {
  test('prompt contains all MCP tool names defined in TOOL_SCHEMAS', () => {
    const promptPath = path.resolve(__dirname, '../src/prompts/epir_mcp_system_prompt.ts');
    const prompt = fs.readFileSync(promptPath, 'utf8');

    const keys = Object.keys(TOOL_SCHEMAS);
    const missing: string[] = [];

    for (const key of keys) {
      // TOOL_SCHEMAS keys are the canonical tool identifiers
      if (!prompt.includes(key) && !prompt.includes(TOOL_SCHEMAS[key].name)) {
        missing.push(key);
      }
    }

    expect(missing, `Missing tool names in system prompt: ${missing.join(', ')}`).toHaveLength(0);
  });
});
