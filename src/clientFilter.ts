import { UnifiedTool } from './tools/registry.js';

/**
 * Client-based tool filtering: hide a client's own tools
 * (no point asking yourself for a second opinion).
 */

const CLIENT_EXCLUSIONS: Record<string, UnifiedTool['category']> = {
  'claude-code':            'claude',
  'codex-mcp-client':       'codex',
  'gemini-cli-mcp-client':  'gemini',
  'opencode':               'opencode',
};

export function getExcludedCategory(clientName: string | undefined): UnifiedTool['category'] | undefined {
  if (!clientName) return undefined;
  return CLIENT_EXCLUSIONS[clientName];
}

export function filterToolsForClient(tools: UnifiedTool[], clientName: string | undefined): UnifiedTool[] {
  const excluded = getExcludedCategory(clientName);
  if (!excluded) return tools;

  return tools.filter(t => t.category !== excluded);
}

export function isToolBlockedForClient(tool: UnifiedTool | undefined, clientName: string | undefined): boolean {
  if (!tool) return false;
  const excluded = getExcludedCategory(clientName);
  return excluded !== undefined && tool.category === excluded;
}
