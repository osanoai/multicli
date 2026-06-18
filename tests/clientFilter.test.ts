import { describe, it, expect } from 'vitest';
import {
  getExcludedCategory,
  getExcludedCategories,
  filterToolsForClient,
  isToolBlockedForClient,
} from '../src/clientFilter.js';
import { type UnifiedTool } from '../src/tools/registry.js';

// ---------------------------------------------------------------------------
// Helper to create minimal mock UnifiedTool objects
// ---------------------------------------------------------------------------

function mockTool(name: string, category: UnifiedTool['category']): UnifiedTool {
  return { name, category } as UnifiedTool;
}

// ===========================================================================
// getExcludedCategory
// ===========================================================================

describe('getExcludedCategory', () => {
  it('should map "claude-code" to "claude"', () => {
    expect(getExcludedCategory('claude-code')).toBe('claude');
  });

  it('should map "codex-mcp-client" to "codex"', () => {
    expect(getExcludedCategory('codex-mcp-client')).toBe('codex');
  });

  it('should map "gemini-cli-mcp-client" to "gemini"', () => {
    expect(getExcludedCategory('gemini-cli-mcp-client')).toBe('antigravity');
    expect(getExcludedCategories('gemini-cli-mcp-client')).toEqual(['antigravity', 'gemini']);
  });

  it('should map "antigravity-cli-mcp-client" to both antigravity and gemini', () => {
    expect(getExcludedCategories('antigravity-cli-mcp-client')).toEqual(['antigravity', 'gemini']);
  });

  it('should return undefined for an unknown client name', () => {
    expect(getExcludedCategory('unknown-client')).toBeUndefined();
  });

  it('should return undefined when clientName is undefined', () => {
    expect(getExcludedCategory(undefined)).toBeUndefined();
  });
});

// ===========================================================================
// filterToolsForClient
// ===========================================================================

describe('filterToolsForClient', () => {
  const tools: UnifiedTool[] = [
    mockTool('ask-antigravity', 'antigravity'),
    mockTool('ask-gemini', 'gemini'),
    mockTool('ask-codex', 'codex'),
    mockTool('ask-claude', 'claude'),
    mockTool('fetch-chunk', 'utility'),
  ];

  it('should remove tools matching the excluded category', () => {
    const result = filterToolsForClient(tools, 'claude-code');

    expect(result).toHaveLength(4);
    expect(result.map(t => t.name)).not.toContain('ask-claude');
    expect(result.map(t => t.name)).toContain('ask-gemini');
    expect(result.map(t => t.name)).toContain('ask-codex');
    expect(result.map(t => t.name)).toContain('fetch-chunk');
  });

  it('should return all tools for an unknown client name', () => {
    const result = filterToolsForClient(tools, 'some-random-client');

    expect(result).toHaveLength(5);
    expect(result).toEqual(tools);
  });

  it('should return all tools when clientName is undefined', () => {
    const result = filterToolsForClient(tools, undefined);

    expect(result).toHaveLength(5);
    expect(result).toEqual(tools);
  });

  it('should preserve utility tools for all known clients', () => {
    for (const client of ['claude-code', 'codex-mcp-client', 'gemini-cli-mcp-client']) {
      const result = filterToolsForClient(tools, client);
      expect(result.map(t => t.name)).toContain('fetch-chunk');
    }
  });

  it('should remove both antigravity and deprecated gemini tools for Google clients', () => {
    const result = filterToolsForClient(tools, 'antigravity-cli-mcp-client');
    const names = result.map(t => t.name);

    expect(names).not.toContain('ask-antigravity');
    expect(names).not.toContain('ask-gemini');
    expect(names).toContain('ask-codex');
    expect(names).toContain('ask-claude');
  });
});

// ===========================================================================
// isToolBlockedForClient
// ===========================================================================

describe('isToolBlockedForClient', () => {
  it('should return true when the tool category matches the excluded category', () => {
    const tool = mockTool('ask-claude', 'claude');
    expect(isToolBlockedForClient(tool, 'claude-code')).toBe(true);
  });

  it('should return false when the tool category does not match the excluded category', () => {
    const tool = mockTool('ask-gemini', 'gemini');
    expect(isToolBlockedForClient(tool, 'claude-code')).toBe(false);
  });

  it('should block both antigravity and gemini alias tools for Google clients', () => {
    expect(isToolBlockedForClient(mockTool('ask-antigravity', 'antigravity'), 'gemini-cli-mcp-client')).toBe(true);
    expect(isToolBlockedForClient(mockTool('ask-gemini', 'gemini'), 'gemini-cli-mcp-client')).toBe(true);
  });

  it('should return false when the tool is undefined', () => {
    expect(isToolBlockedForClient(undefined, 'claude-code')).toBe(false);
  });

  it('should return false when the clientName is undefined', () => {
    const tool = mockTool('ask-claude', 'claude');
    expect(isToolBlockedForClient(tool, undefined)).toBe(false);
  });
});
