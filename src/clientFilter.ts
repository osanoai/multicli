import { UnifiedTool } from './tools/registry.js';

/**
 * Client-based tool filtering: hide a client's own tools
 * (no point asking yourself for a second opinion).
 */

const CLIENT_EXCLUSIONS: Record<string, NonNullable<UnifiedTool['category']>[]> = {
  'claude-code':            ['claude'],
  'codex-mcp-client':       ['codex'],
  'gemini-cli-mcp-client':  ['antigravity', 'gemini'],
  'antigravity-cli-mcp-client': ['antigravity', 'gemini'],
  'opencode':               ['opencode'],
};

export function getExcludedCategory(clientName: string | undefined): UnifiedTool['category'] | undefined {
  return getExcludedCategories(clientName)[0];
}

export function getExcludedCategories(clientName: string | undefined): NonNullable<UnifiedTool['category']>[] {
  if (!clientName) return [];
  return CLIENT_EXCLUSIONS[clientName] ?? [];
}

export function filterToolsForClient(tools: UnifiedTool[], clientName: string | undefined): UnifiedTool[] {
  const excluded = new Set(getExcludedCategories(clientName));
  if (excluded.size === 0) return tools;

  return tools.filter(t => !t.category || !excluded.has(t.category));
}

export function isToolBlockedForClient(tool: UnifiedTool | undefined, clientName: string | undefined): boolean {
  if (!tool) return false;
  const excluded = new Set(getExcludedCategories(clientName));
  return tool.category !== undefined && excluded.has(tool.category);
}
