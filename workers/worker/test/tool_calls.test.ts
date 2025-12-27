import { describe, it, expect } from 'vitest';
import type { GroqMessage } from '../src/ai-client';

/**
 * Test suite for verifying correct OpenAI Function Calling structure
 * 
 * After migration from Harmony protocol to native OpenAI Function Calling,
 * this test validates the correct structure for tool calls in messages.
 * 
 * According to OpenAI/Groq API spec, tool_calls must follow this format:
 * - Assistant messages WITH tool calls: include tool_calls array
 * - Tool result messages: include tool_call_id and name
 * 
 * OpenAI tool_calls format:
 * {
 *   id: string,
 *   type: 'function',
 *   function: {
 *     name: string,
 *     arguments: string  // JSON stringified
 *   }
 * }
 */
describe('OpenAI Function Calling message structure', () => {
  it('should include tool_calls field in assistant message when using OpenAI format', () => {
    // Simulate what happens in streamAssistantResponse when a tool call is detected
    const toolName = 'search_shop_catalog';
    const toolArgs = { query: 'rings', limit: 10 };
    const toolCallId = 'call_abc123';
    
    // This is the correct OpenAI format for assistant with tool calls
    const assistantMessage: GroqMessage & { tool_calls?: any[] } = {
      role: 'assistant',
      content: '', // Can be empty when only tool calls
      tool_calls: [{
        id: toolCallId,
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(toolArgs)
        }
      }]
    };
    
    // Verify the message has tool_calls
    expect(assistantMessage).toHaveProperty('tool_calls');
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls![0].id).toBe(toolCallId);
    expect(assistantMessage.tool_calls![0].type).toBe('function');
    expect(assistantMessage.tool_calls![0].function.name).toBe(toolName);
    
    // Verify no Harmony tags
    expect(assistantMessage.content).not.toContain('<|call|>');
    expect(assistantMessage.content).not.toContain('<|end|>');
  });
  
  it('should construct valid GroqMessage for tool results with tool_call_id', () => {
    const toolName = 'search_shop_catalog';
    const toolCallId = 'call_abc123';
    const toolResult = { results: [{ id: 1, name: 'Ring' }] };
    
    // This is what we send to Groq for tool results (OpenAI format)
    const groqMessage: GroqMessage = {
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: JSON.stringify(toolResult),
    };
    
    // Verify structure
    expect(groqMessage.role).toBe('tool');
    expect(groqMessage.tool_call_id).toBe(toolCallId);
    expect(groqMessage.name).toBe(toolName);
    expect(groqMessage.content).toBe(JSON.stringify(toolResult));
    
    // Verify it doesn't have invalid fields
    expect(groqMessage).not.toHaveProperty('ts');
  });
  
  it('should maintain correct message array structure for OpenAI Function Calling', () => {
    const toolCallId = 'call_xyz789';
    
    // Simulate a conversation with a tool call (OpenAI format)
    const messages: (GroqMessage & { tool_calls?: any[] })[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Show me rings' },
      // Assistant decides to call a tool (OpenAI format)
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: toolCallId,
          type: 'function',
          function: {
            name: 'search_shop_catalog',
            arguments: JSON.stringify({ query: 'rings' })
          }
        }]
      },
      // Tool returns result (OpenAI format)
      {
        role: 'tool',
        tool_call_id: toolCallId,
        name: 'search_shop_catalog',
        content: '{"results":[{"id":1,"name":"Ring"}]}'
      },
    ];
    
    // Verify all messages are valid
    messages.forEach((msg, idx) => {
      expect(msg, `Message ${idx} should have role`).toHaveProperty('role');
      expect(msg, `Message ${idx} should have content`).toHaveProperty('content');
      
      // Assistant message with tools should have tool_calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        expect(msg.tool_calls).toBeInstanceOf(Array);
        msg.tool_calls.forEach(tc => {
          expect(tc).toHaveProperty('id');
          expect(tc).toHaveProperty('type');
          expect(tc.type).toBe('function');
          expect(tc).toHaveProperty('function');
          expect(tc.function).toHaveProperty('name');
          expect(tc.function).toHaveProperty('arguments');
        });
      }
      
      // Tool messages should have tool_call_id
      if (msg.role === 'tool') {
        expect(msg).toHaveProperty('tool_call_id');
        expect(msg).toHaveProperty('name');
      }
    });
    
    // Verify the array can be serialized (as it would be sent to Groq)
    const serialized = JSON.stringify({ messages });
    expect(serialized).toContain('"tool_calls"');
    expect(serialized).toContain('"tool_call_id"');
    
    // Verify NO Harmony tags
    expect(serialized).not.toContain('<|call|>');
    expect(serialized).not.toContain('<|end|>');
  });

  it('should handle multi-turn conversation with OpenAI Function Calling', () => {
    // Build a message array as it would be in a real conversation
    const toolCallId1 = 'call_001';
    const toolCallId2 = 'call_002';
    
    const currentMessages: (GroqMessage & { tool_calls?: any[] })[] = [
      { role: 'system', content: 'You are a luxury jewelry assistant.' },
      { role: 'user', content: 'Show me your rings' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: toolCallId1,
          type: 'function',
          function: {
            name: 'search_shop_catalog',
            arguments: JSON.stringify({ query: 'rings' })
          }
        }]
      },
      {
        role: 'tool',
        tool_call_id: toolCallId1,
        name: 'search_shop_catalog',
        content: '{"results":[{"id":1,"name":"Silver Ring"}]}'
      },
      { role: 'assistant', content: 'I found some beautiful silver rings. Would you like to see gold rings as well?' },
      { role: 'user', content: 'What about gold rings?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: toolCallId2,
          type: 'function',
          function: {
            name: 'search_shop_catalog',
            arguments: JSON.stringify({ query: 'gold rings', category: 'rings' })
          }
        }]
      },
      {
        role: 'tool',
        tool_call_id: toolCallId2,
        name: 'search_shop_catalog',
        content: '{"results":[{"id":2,"name":"Gold Ring"}]}'
      },
    ];
    
    // Verify the final message array is valid for OpenAI API
    expect(currentMessages).toHaveLength(8);
    
    // Check message structure
    currentMessages.forEach((msg, idx) => {
      expect(msg, `Message ${idx} should have role`).toHaveProperty('role');
      expect(msg, `Message ${idx} should have content`).toHaveProperty('content');
      
      // Verify tool_calls format for assistant
      if (msg.tool_calls) {
        expect(msg.role).toBe('assistant');
        msg.tool_calls.forEach(tc => {
          expect(tc.id).toBeTruthy();
          expect(tc.type).toBe('function');
          expect(tc.function.name).toBeTruthy();
          expect(tc.function.arguments).toBeTruthy();
        });
      }
      
      // Verify tool results have tool_call_id
      if (msg.role === 'tool') {
        expect(msg.tool_call_id).toBeTruthy();
        expect(msg.name).toBeTruthy();
      }
    });
    
    // Verify JSON serialization includes OpenAI format
    const payload = JSON.stringify({ messages: currentMessages });
    expect(payload).toContain('"tool_calls"');
    expect(payload).toContain('"tool_call_id"');
    
    // Verify NO Harmony format
    expect(payload).not.toContain('<|call|>');
    expect(payload).not.toContain('<|end|>');
  });

  it('should handle assistant messages with both text and tool calls', () => {
    const toolCallId = 'call_mixed_123';
    
    // Assistant can respond with both text AND tool calls
    const assistantMessage: GroqMessage & { tool_calls?: any[] } = {
      role: 'assistant',
      content: 'Let me search our catalog for you.',
      tool_calls: [{
        id: toolCallId,
        type: 'function',
        function: {
          name: 'search_shop_catalog',
          arguments: JSON.stringify({ query: 'bracelets' })
        }
      }]
    };
    
    expect(assistantMessage.content).toBe('Let me search our catalog for you.');
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls![0].id).toBe(toolCallId);
  });
});
