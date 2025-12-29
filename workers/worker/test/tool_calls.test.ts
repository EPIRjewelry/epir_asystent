import { describe, it, expect } from 'vitest';
import type { GroqMessage } from '../src/ai-client';

/**
 * Test suite for verifying correct tool_calls structure (native OpenAI style)
 */
describe('Tool calls message structure (native)', () => {
  it('should include tool_calls with stringified arguments and no content when calling a tool', () => {
    const toolName = 'search_shop_catalog';
    const toolArgs = { query: 'rings', limit: 10 };

    const assistantMessage: GroqMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(toolArgs),
          },
        },
      ],
    };

    expect(assistantMessage.tool_calls).toBeDefined();
    expect(assistantMessage.content).toBeNull();
    expect(assistantMessage.tool_calls?.[0].function.name).toBe(toolName);
    expect(assistantMessage.tool_calls?.[0].function.arguments).toBe(JSON.stringify(toolArgs));
  });

  it('should construct valid GroqMessage for tool results', () => {
    const toolName = 'search_shop_catalog';
    const toolResult = { results: [{ id: 1, name: 'Ring' }] };

    const groqMessage: GroqMessage = {
      role: 'tool',
      name: toolName,
      tool_call_id: 'call_1',
      content: JSON.stringify(toolResult),
    };

    expect(groqMessage.role).toBe('tool');
    expect(groqMessage.name).toBe(toolName);
    expect(groqMessage.content).toBe(JSON.stringify(toolResult));
    expect(groqMessage.tool_call_id).toBe('call_1');
    expect(groqMessage).not.toHaveProperty('tool_calls');
  });

  it('should maintain correct message array structure for Groq API', () => {
    const messages: GroqMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Show me rings' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'search_shop_catalog',
              arguments: JSON.stringify({ query: 'rings' }),
            },
          },
        ],
      },
      { role: 'tool', name: 'search_shop_catalog', tool_call_id: 'call_1', content: '{"results":[{"id":1,"name":"Ring"}]}' },
    ];

    messages.forEach((msg) => {
      expect(msg).toHaveProperty('role');
      // tool_calls only allowed on assistant role
      if (msg.role === 'assistant') {
        expect(msg.tool_calls).toBeDefined();
      } else {
        expect(msg).not.toHaveProperty('tool_calls');
      }
    });

    const serialized = JSON.stringify({ messages });
    expect(serialized).toContain('tool_calls');
    expect(serialized).toContain('search_shop_catalog');
    expect(serialized).not.toContain('<|call|>');
  });

  it('should represent multi-turn conversation with tool call without Harmony markers', () => {
    const currentMessages: GroqMessage[] = [
      { role: 'system', content: 'You are a luxury jewelry assistant.' },
      { role: 'user', content: 'Show me your rings' },
      { role: 'assistant', content: 'Jasne, sprawdzę katalog.' },
      { role: 'user', content: 'What about gold rings?' },
    ];

    const toolName = 'search_shop_catalog';
    const toolArgs = { query: 'gold rings', category: 'rings' };

    currentMessages.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_gold_1',
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(toolArgs),
          },
        },
      ],
    });

    const toolResult = { results: [{ name: 'Gold Ring', price: 1500 }] };
    currentMessages.push({
      role: 'tool',
      name: toolName,
      tool_call_id: 'call_gold_1',
      content: JSON.stringify(toolResult),
    });

    expect(currentMessages).toHaveLength(6);
    currentMessages.forEach((msg, idx) => {
      expect(msg, `Message ${idx} should have role`).toHaveProperty('role');

      if (msg.role === 'assistant' && msg.tool_calls) {
        // Tool-calling assistant messages should have content explicitly set to null
        expect(msg.content, `Message ${idx} (assistant with tool_calls) should have null content`).toBeNull();
      } else {
        // Other messages should have a content property
        expect(msg, `Message ${idx} should have content`).toHaveProperty('content');
      }
    });

    const payload = JSON.stringify({ messages: currentMessages });
    expect(payload).toContain('tool_calls');
    expect(payload).toContain('search_shop_catalog');
    expect(payload).not.toContain('<|call|>');
  });
});
