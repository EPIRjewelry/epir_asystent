import { describe, it, expect } from 'vitest';
import type { GroqMessage } from '../src/ai-client';

describe('Tool calls message structure', () => {
  it('should include tool_calls when assistant invokes a function', () => {
    const toolName = 'search_shop_catalog';
    const toolArgs = { query: 'rings', limit: 10 };
    const toolCallId = 'call_1';

    const groqMessage: GroqMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(toolArgs),
          },
        },
      ],
    };

    expect(groqMessage.role).toBe('assistant');
    expect(groqMessage.content).toBeNull();
    expect(groqMessage.tool_calls?.[0].function.name).toBe(toolName);
    expect(groqMessage.tool_calls?.[0].function.arguments).toContain('rings');
  });
  
  it('should construct valid GroqMessage for tool results with tool_call_id', () => {
    const toolName = 'search_shop_catalog';
    const toolCallId = 'call_2';
    const toolResult = { results: [{ id: 1, name: 'Ring' }] };
    
    const groqMessage: GroqMessage = {
      role: 'tool',
      name: toolName,
      tool_call_id: toolCallId,
      content: JSON.stringify(toolResult),
    };
    
    expect(groqMessage.role).toBe('tool');
    expect(groqMessage.name).toBe(toolName);
    expect(groqMessage.tool_call_id).toBe(toolCallId);
    expect(groqMessage.content).toBe(JSON.stringify(toolResult));
  });
  
  it('should maintain correct message array structure for Groq API with tool_calls', () => {
    const toolCallId = 'call_3';
    const messages: GroqMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Show me rings' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: 'function',
            function: { name: 'search_shop_catalog', arguments: '{"query":"rings"}' },
          },
        ],
      },
      { role: 'tool', name: 'search_shop_catalog', tool_call_id: toolCallId, content: '{"results":[{"id":1,"name":"Ring"}]}' },
    ];
    
    messages.forEach((msg) => {
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
    });
    
    const serialized = JSON.stringify({ messages });
    expect(serialized).toContain('"tool_calls"');
    expect(serialized).toContain(toolCallId);
  });

  it('should serialize multi-turn conversation with native tool calls', () => {
    const toolName = 'search_shop_catalog';
    const toolCallId = 'call_4';
    const toolArgs = { query: 'gold rings', category: 'rings' };
    
    const currentMessages: GroqMessage[] = [
      { role: 'system', content: 'You are a luxury jewelry assistant.' },
      { role: 'user', content: 'Show me your rings' },
      { role: 'assistant', content: 'I will search our catalog for rings.' },
      { role: 'user', content: 'What about gold rings?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: 'function',
            function: { name: toolName, arguments: JSON.stringify(toolArgs) },
          },
        ],
      },
      {
        role: 'tool',
        name: toolName,
        tool_call_id: toolCallId,
        content: JSON.stringify({ results: [{ name: 'Gold Ring', price: 1500 }] }),
      },
    ];
    
    const payload = JSON.stringify({ messages: currentMessages });
    expect(payload).toContain('"tool_calls"');
    expect(payload).toContain(toolName);
    expect(payload).toContain(toolCallId);
  });
});
