// Tool Registry Index - Registers tools based on CLI availability
import { toolRegistry } from './registry.js';
import { askGeminiTool } from './ask-gemini.tool.js';
import {
  geminiHelpTool, codexHelpTool, claudeHelpTool, opencodeHelpTool,
  geminiListModelsTool, codexListModelsTool, claudeListModelsTool, opencodeListModelsTool,
} from './simple-tools.js';
import { fetchChunkTool } from './fetch-chunk.tool.js';
import { askCodexTool } from './ask-codex.tool.js';
import { askClaudeTool } from './ask-claude.tool.js';
import { askOpencodeTool } from './ask-opencode.tool.js';
import { detectAvailableClis, CliAvailability } from '../utils/cliDetector.js';

/**
 * Initialize the tool registry based on which CLIs are available.
 * Must be called (and awaited) before the server starts accepting requests.
 */
export async function initTools(): Promise<CliAvailability> {
  const availability = await detectAvailableClis();

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

  return availability;
}

export * from './registry.js';
