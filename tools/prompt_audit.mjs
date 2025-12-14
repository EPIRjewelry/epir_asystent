#!/usr/bin/env node
/**
 * tools/prompt_audit.mjs
 * 
 * Prompt Audit Script (ES Module)
 * 
 * Purpose:
 * - Audit prompt files in the repository for best practices
 * - Check for memory instructions, Chain of Thought (CoT), consent requirements
 * - Validate prompt length and structure
 * - Provide actionable warnings and recommendations
 * 
 * Usage:
 * ```bash
 * # Run with Node.js
 * node tools/prompt_audit.mjs
 * 
 * # Or with tsx
 * npx tsx tools/prompt_audit.mjs
 * ```
 * 
 * Checks performed:
 * - Prompt files exist
 * - Prompts mention "memory" or "remember" (context retention)
 * - Prompts include "think" or "reasoning" (Chain of Thought)
 * - Prompts require consent for PII usage
 * - Prompt length is reasonable (not too short/long)
 * - Prompts export proper TypeScript functions
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current directory (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

/**
 * Prompt files to audit
 */
const PROMPT_FILES = [
  {
    path: 'workers/worker/src/prompts/epir_mcp_system_prompt.ts',
    name: 'EPIR MCP System Prompt',
    required: true
  },
  {
    path: 'workers/worker/src/prompts/luxury-system-prompt.ts',
    name: 'Luxury System Prompt',
    required: false
  },
  {
    path: 'workers/worker/src/prompts/luxury-system-prompt-v1-backup.ts',
    name: 'Luxury System Prompt V1 (Backup)',
    required: false
  }
];

/**
 * Audit checks configuration
 */
const AUDIT_CHECKS = {
  /** Minimum prompt length (characters) */
  minLength: 500,
  
  /** Maximum prompt length (characters) */
  maxLength: 20000,
  
  /** Keywords for memory/context retention */
  memoryKeywords: ['memory', 'remember', 'recall', 'context', 'history'],
  
  /** Keywords for Chain of Thought */
  cotKeywords: ['think', 'reasoning', 'step', 'analyze', 'consider'],
  
  /** Keywords for consent/PII */
  consentKeywords: ['consent', 'permission', 'pii', 'personal', 'privacy'],
  
  /** Required exports */
  requiredExports: ['export function', 'export const', 'export default']
};

/**
 * Main audit function
 */
function auditPrompts() {
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}EPIR Prompt Audit Script${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}\n`);
  
  const results = [];
  const rootDir = join(__dirname, '..');
  
  for (const promptFile of PROMPT_FILES) {
    const result = auditPromptFile(rootDir, promptFile);
    results.push(result);
    printAuditResult(result);
  }
  
  // Summary
  console.log(`\n${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}Audit Summary${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}\n`);
  
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  
  console.log(`Total files audited: ${total}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  
  if (failed > 0) {
    console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  }
  
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
  
  if (totalWarnings > 0) {
    console.log(`\n${colors.yellow}Total warnings: ${totalWarnings}${colors.reset}`);
  } else {
    console.log(`\n${colors.green}No warnings! All prompts look good.${colors.reset}`);
  }
  
  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Audit a single prompt file
 */
function auditPromptFile(rootDir, promptFile) {
  const filePath = join(rootDir, promptFile.path);
  const result = {
    file: promptFile.name,
    exists: false,
    warnings: [],
    info: [],
    passed: true
  };
  
  // Check existence
  if (!existsSync(filePath)) {
    if (promptFile.required) {
      result.warnings.push(`File does not exist: ${promptFile.path}`);
      result.passed = false;
    } else {
      result.info.push(`Optional file not found: ${promptFile.path}`);
    }
    return result;
  }
  
  result.exists = true;
  
  try {
    // Read file content
    const content = readFileSync(filePath, 'utf-8');
    
    // Check length
    if (content.length < AUDIT_CHECKS.minLength) {
      result.warnings.push(
        `Prompt is very short (${content.length} chars). Consider adding more guidance.`
      );
    }
    
    if (content.length > AUDIT_CHECKS.maxLength) {
      result.warnings.push(
        `Prompt is very long (${content.length} chars). Consider condensing for token efficiency.`
      );
    }
    
    // Check for memory/context instructions
    const hasMemoryKeywords = AUDIT_CHECKS.memoryKeywords.some(
      keyword => content.toLowerCase().includes(keyword)
    );
    
    if (!hasMemoryKeywords) {
      result.warnings.push(
        'Prompt does not mention memory/context retention. Consider adding instructions for conversation history.'
      );
    }
    
    // Check for Chain of Thought
    const hasCotKeywords = AUDIT_CHECKS.cotKeywords.some(
      keyword => content.toLowerCase().includes(keyword)
    );
    
    if (!hasCotKeywords) {
      result.warnings.push(
        'Prompt does not encourage reasoning/thinking. Consider adding Chain of Thought instructions.'
      );
    }
    
    // Check for consent/PII
    const hasConsentKeywords = AUDIT_CHECKS.consentKeywords.some(
      keyword => content.toLowerCase().includes(keyword)
    );
    
    if (!hasConsentKeywords) {
      result.warnings.push(
        'Prompt does not mention consent or PII protection. Consider adding privacy guidelines.'
      );
    }
    
    // Check for TypeScript exports
    const hasExport = AUDIT_CHECKS.requiredExports.some(
      exportType => content.includes(exportType)
    );
    
    if (!hasExport) {
      result.warnings.push(
        'File does not export a function or constant. Ensure prompt is properly exported.'
      );
    }
    
    // Check for MCP/RAG mentions (for MCP-specific prompts)
    if (promptFile.path.includes('mcp')) {
      const hasMcp = content.toLowerCase().includes('mcp') || 
                     content.toLowerCase().includes('model context protocol');
      
      if (!hasMcp) {
        result.warnings.push(
          'MCP prompt does not mention MCP or Model Context Protocol.'
        );
      }
      
      const hasRag = content.toLowerCase().includes('rag') || 
                     content.toLowerCase().includes('retrieval');
      
      if (!hasRag) {
        result.warnings.push(
          'MCP prompt does not mention RAG or retrieval. Consider adding RAG instructions.'
        );
      }
    }
    
    // Info: word count
    const wordCount = content.split(/\s+/).length;
    result.info.push(`Word count: ${wordCount}`);
    result.info.push(`Character count: ${content.length}`);
    
    // Determine pass/fail
    result.passed = result.warnings.length === 0;
    
  } catch (error) {
    result.warnings.push(`Error reading file: ${error.message || 'Unknown error'}`);
    result.passed = false;
  }
  
  return result;
}

/**
 * Print audit result for a single file
 */
function printAuditResult(result) {
  const statusIcon = result.passed ? '✓' : '✗';
  const statusColor = result.passed ? colors.green : colors.red;
  
  console.log(`${statusColor}${statusIcon} ${result.file}${colors.reset}`);
  
  if (!result.exists) {
    console.log(`  ${colors.red}File not found${colors.reset}`);
  }
  
  if (result.warnings.length > 0) {
    console.log(`  ${colors.yellow}Warnings:${colors.reset}`);
    result.warnings.forEach(warning => {
      console.log(`    - ${warning}`);
    });
  }
  
  if (result.info.length > 0 && result.exists) {
    console.log(`  ${colors.blue}Info:${colors.reset}`);
    result.info.forEach(info => {
      console.log(`    - ${info}`);
    });
  }
  
  console.log('');
}

// Run audit
auditPrompts();
