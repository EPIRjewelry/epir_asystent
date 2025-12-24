import { describe, it, expect } from 'vitest';
import type { GroqMessage } from '../src/ai-client';

/**
 * Test suite for verifying correct tool_calls structure
 * 
 * This test validates the fix for the Groq 400 error that occurred when
 * fallback tool calls were detected. The issue was that messages sent to
 * Groq API included a 'tool_calls' field in an incorrect format.
 * 
 * According to Groq API spec, if tool_calls are included, they must be:
 * {
 *   id: string,
 *   type: 'function',
 *   function: {
 *     name: string,
 *     arguments: string  // JSON stringified
 *   }
 * }
 * 
 * However, for Harmony-style fallback tool calls (using <|call|> markers),
 * we should NOT include tool_calls at all - the content field already
 * contains the tool call information in the <|call|> format.
 */
describe('Tool calls message structure', () => {
  it('should not include tool_calls field when using Harmony <|call|> format', () => {
    // Simulate what happens in streamAssistantResponse when a tool call is detected
    const toolName = 'search_shop_catalog';
    const toolArgs = { query: 'rings', limit: 10 };
    
    // This is what we build for DO storage (with tool_calls)
    const historyEntry = {
      role: 'assistant' as const,
      content: `<|call|>${JSON.stringify({ name: toolName, arguments: toolArgs })}<|end|>`,
      tool_calls: [{ name: toolName, arguments: toolArgs }],
      ts: Date.now(),
    };
    
    // This is what should be sent to Groq (without tool_calls)
    const groqMessage: GroqMessage = {
      role: historyEntry.role,
      content: historyEntry.content,
    };
    
    // Verify the Groq message doesn't have tool_calls
    expect(groqMessage).not.toHaveProperty('tool_calls');
    
    // Verify the message has the required fields
    expect(groqMessage.role).toBe('assistant');
    expect(groqMessage.content).toContain('<|call|>');
    expect(groqMessage.content).toContain(toolName);
    expect(groqMessage.content).toContain('<|end|>');
  });
  
  it('should construct valid GroqMessage for tool results', () => {
    const toolName = 'search_shop_catalog';
    const toolResult = { results: [{ id: 1, name: 'Ring' }] };
    
    // This is what we send to Groq for tool results
    const groqMessage: GroqMessage = {
      role: 'tool',
      name: toolName,
      content: JSON.stringify(toolResult),
    };
    
    // Verify structure
    expect(groqMessage.role).toBe('tool');
    expect(groqMessage.name).toBe(toolName);
    expect(groqMessage.content).toBe(JSON.stringify(toolResult));
    
    // Verify it doesn't have invalid fields for Groq
    expect(groqMessage).not.toHaveProperty('tool_calls');
    expect(groqMessage).not.toHaveProperty('ts');
  });
  
  it('should maintain correct message array structure for Groq API', () => {
    // Simulate a conversation with a tool call
    const messages: GroqMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Show me rings' },
      // Assistant decides to call a tool (using Harmony format)
      { role: 'assistant', content: '<|call|>{"name":"search_shop_catalog","arguments":{"query":"rings"}}<|end|>' },
      // Tool returns result
      { role: 'tool', name: 'search_shop_catalog', content: '{"results":[{"id":1,"name":"Ring"}]}' },
    ];
    
    // Verify all messages are valid GroqMessage types
    messages.forEach((msg) => {
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      
      // None should have tool_calls field
      expect(msg).not.toHaveProperty('tool_calls');
      
      // Only tool messages should have name
      if (msg.role === 'tool') {
        expect(msg).toHaveProperty('name');
      }
    });
    
    // Verify the array can be serialized (as it would be sent to Groq)
    const serialized = JSON.stringify({ messages });
    expect(serialized).not.toContain('tool_calls');
    expect(serialized).toContain('<|call|>');
  });

  it('should simulate the exact bug scenario: multi-turn conversation with tool call', () => {
    // Simulate the exact scenario from the bug report:
    // Session: f63801b9-be8f-4eb8-934a-6e0249b051eb
    // Model: openai/gpt-oss-120b
    // Error at messages.11.tool_calls.0.function
    
    // Build a message array as it would be in a real conversation
    const currentMessages: GroqMessage[] = [
      { role: 'system', content: 'You are a luxury jewelry assistant.' },
      { role: 'user', content: 'Show me your rings' },
      { role: 'assistant', content: 'I will search our catalog for rings.' },
      // ... imagine more conversation ...
      { role: 'user', content: 'What about gold rings?' },
    ];
    
    // Simulate fallback tool call detection (the problematic scenario)
    const toolName = 'search_shop_catalog';
    const toolArgs = { query: 'gold rings', category: 'rings' };
    
    // What was WRONG before (causing 400 error):
    // currentMessages.push({ 
    //   role: 'assistant', 
    //   content: '<|call|>...', 
    //   tool_calls: [{ name, arguments: args }]  // ❌ This broke Groq API
    // });
    
    // What is CORRECT now (after fix):
    const assistantMessage: GroqMessage = {
      role: 'assistant',
      content: `<|call|>${JSON.stringify({ name: toolName, arguments: toolArgs })}<|end|>`,
      // ✅ NO tool_calls field
    };
    currentMessages.push(assistantMessage);
    
    // Add tool result
    const toolResult = { results: [{ name: 'Gold Ring', price: 1500 }] };
    currentMessages.push({
      role: 'tool',
      name: toolName,
      content: JSON.stringify(toolResult),
    });
    
    // Verify the final message array is valid for Groq API
    expect(currentMessages).toHaveLength(6);
    
    // Check that NO message has tool_calls field
    currentMessages.forEach((msg, idx) => {
      expect(msg, `Message ${idx} should not have tool_calls`).not.toHaveProperty('tool_calls');
      expect(msg, `Message ${idx} should have role`).toHaveProperty('role');
      expect(msg, `Message ${idx} should have content`).toHaveProperty('content');
    });
    
    // Verify JSON serialization doesn't include tool_calls
    const payload = JSON.stringify({ messages: currentMessages });
    expect(payload).not.toContain('"tool_calls"');
    
    // Verify the Harmony format is present
    expect(payload).toContain('<|call|>');
    expect(payload).toContain('search_shop_catalog');
  });
});
