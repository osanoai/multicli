// Tool Registry Index - Registers tools based on CLI availability
import { toolRegistry } from './registry.js';
import { askGeminiTool } from './ask-gemini.tool.js';
import {
  geminiHelpTool, codexHelpTool, claudeHelpTool, opencodeHelpTool, grokHelpTool,
  geminiListModelsTool, codexListModelsTool, claudeListModelsTool, opencodeListModelsTool, grokListModelsTool,
} from './simple-tools.js';
import { fetchChunkTool } from './fetch-chunk.tool.js';
import { askCodexTool } from './ask-codex.tool.js';
import { askClaudeTool } from './ask-claude.tool.js';
import { askOpencodeTool } from './ask-opencode.tool.js';
import { askGrokTool } from './ask-grok.tool.js';
import { detectAvailableClis, CliAvailability } from '../utils/cliDetector.js';
import { MultiCliConfig } from '../config.js';
import type { Logger } from '../logger.js';

/**
 * Initialize the tool registry based on which CLIs are available.
 * Must be called (and awaited) before the server starts accepting requests.
 */
export async function initTools(
  config?: Pick<MultiCliConfig, 'cliDetectTimeoutMs'> & { logger?: Logger },
): Promise<CliAvailability> {
  toolRegistry.length = 0;
  const availability = await detectAvailableClis(
    config?.cliDetectTimeoutMs,
    config?.logger,
  );

  if (availability.gemini) {
    toolRegistry.push(
      geminiListModelsTool,   // List-Gemini-Models
      askGeminiTool,          // Ask-Gemini
      fetchChunkTool,         // Fetch-Chunk
      geminiHelpTool,         // Gemini-Help
    );
  }

  if (availability.codex) {
    toolRegistry.push(
      codexListModelsTool,    // List-Codex-Models
      askCodexTool,           // Ask-Codex
      codexHelpTool,          // Codex-Help
    );
  }

  if (availability.claude) {
    toolRegistry.push(
      claudeListModelsTool,   // List-Claude-Models
      askClaudeTool,          // Ask-Claude
      claudeHelpTool,         // Claude-Help
    );
  }

  if (availability.opencode) {
    toolRegistry.push(
      opencodeListModelsTool, // List-OpenCode-Models
      askOpencodeTool,        // Ask-OpenCode
      opencodeHelpTool,       // OpenCode-Help
    );
  }

  if (availability.grok) {
    toolRegistry.push(
      grokListModelsTool,    // List-Grok-Models
      askGrokTool,            // Ask-Grok
      grokHelpTool,           // Grok-Help
    );
  }

  config?.logger?.info('tool_registry_initialized', {
    availability,
    toolNames: toolRegistry.map((tool) => tool.name),
  });

  return availability;
}

export * from './registry.js';
