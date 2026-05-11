import { Tool, Prompt } from "@modelcontextprotocol/sdk/types.js"; // Each tool definition includes its metadata, schema, prompt, and execution logic in one place.

import { ToolArguments } from "../constants.js";
import { z, ZodError } from "zod";
import { ToolExecutionContext, ToolTimeoutClass } from "../execution.js";

export interface UnifiedTool {
  name: string;
  description: string;
  zodSchema: z.ZodType;
  
  prompt?: {
    description: string;
    arguments?: Array<{
      name: string;
      description: string;
      required: boolean;
    }>;
  };
  
  execute: (args: ToolArguments, context?: ToolExecutionContext) => Promise<string>;
  category?: 'gemini' | 'codex' | 'claude' | 'opencode' | 'utility';
  execution?: Tool['execution'];
  timeoutClass?: ToolTimeoutClass;
}

export const toolRegistry: UnifiedTool[] = [];
export function toolExists(toolName: string): boolean {
  return toolRegistry.some(t => t.name === toolName);
}
export function getTool(toolName: string): UnifiedTool | undefined {
  return toolRegistry.find(t => t.name === toolName);
}
export function getToolDefinitions(subset?: UnifiedTool[]): Tool[] { // get Tool definitions from registry
  return (subset ?? toolRegistry).map(tool => {
    const jsonSchema = z.toJSONSchema(tool.zodSchema) as any;
    const inputSchema: Tool['inputSchema'] = {
      type: "object",
      properties: jsonSchema.properties || {},
      required: jsonSchema.required || [],
    };

    // Derive MCP annotations from tool name
    let annotations: Tool['annotations'] | undefined;
    if (tool.name.startsWith('Ask-')) {
      annotations = { openWorldHint: true, readOnlyHint: false, destructiveHint: false };
    } else if (tool.name.startsWith('List-') || tool.name.endsWith('-Help') || tool.name === 'Fetch-Chunk' || tool.name === 'Get-Run' || tool.name === 'Claude-Gemini-Codex') {
      annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
      ...(tool.execution && { execution: tool.execution }),
      ...(annotations && { annotations }),
    };
  });
}

function extractPromptArguments(zodSchema: z.ZodType): Array<{name: string; description: string; required: boolean}> {
  const jsonSchema = z.toJSONSchema(zodSchema) as any;
  const properties = jsonSchema.properties || {};
  const required = jsonSchema.required || [];

  return Object.entries(properties).map(([name, prop]: [string, any]) => ({
    name,
    description: prop.description || `${name} parameter`,
    required: required.includes(name)
  }));
}

export function getPromptDefinitions(subset?: UnifiedTool[]): Prompt[] { // Helper to get MCP Prompt definitions from registry
  return (subset ?? toolRegistry)
    .filter(tool => tool.prompt)
    .map(tool => ({
      name: tool.name,
      description: tool.prompt!.description,
      arguments: tool.prompt!.arguments || extractPromptArguments(tool.zodSchema),
    }));
}

export function validateToolArguments(toolName: string, args: ToolArguments): ToolArguments {
  const tool = getTool(toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    return tool.zodSchema.parse(args) as ToolArguments;
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
      throw new Error(`Invalid arguments for ${toolName}: ${issues}`);
    }
    throw error;
  }
}

export async function executeValidatedTool(
  tool: UnifiedTool,
  args: ToolArguments,
  context?: ToolExecutionContext,
): Promise<string> {
  return tool.execute(args, context);
}

export async function executeTool(
  toolName: string,
  args: ToolArguments,
  context?: ToolExecutionContext,
): Promise<string> {
  const tool = getTool(toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const validatedArgs = validateToolArguments(toolName, args);
  return executeValidatedTool(tool, validatedArgs, context);
}

export function getPromptMessage(toolName: string, args: Record<string, any>): string {
  const tool = toolRegistry.find(t => t.name === toolName);
  if (!tool?.prompt) {
    throw new Error(`No prompt defined for tool: ${toolName}`);
  }
  const paramStrings: string[] = [];
  
  if (args.prompt) {
    paramStrings.push(args.prompt);
  }

  Object.entries(args).forEach(([key, value]) => {
    if (key !== 'prompt' && value !== undefined && value !== null && value !== false) {
      if (typeof value === 'boolean') {
        paramStrings.push(`[${key}]`);
      } else {
        paramStrings.push(`(${key}: ${value})`);
      }
    }
  });
  
  return `Use the ${toolName} tool${paramStrings.length > 0 ? ': ' + paramStrings.join(' ') : ''}`;
}
