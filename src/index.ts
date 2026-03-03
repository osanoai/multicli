#!/usr/bin/env node
import 'dotenv/config';

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CallToolRequest,
  ListToolsRequest,
  ListPromptsRequest,
  GetPromptRequest,
  Tool,
  Prompt,
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { PROTOCOL, ToolArguments } from "./constants.js";

import {
  getToolDefinitions,
  getPromptDefinitions,
  executeTool,
  toolExists,
  getPromptMessage,
  toolRegistry,
  initTools,
} from "./tools/index.js";
import { importantReadNowTool } from './tools/important-read-now.tool.js';
import { filterToolsForClient, isToolBlockedForClient } from './clientFilter.js';

const server = new Server(
  {
    name: "Multi-CLI",
    version: "1.5.0",
  },{
    capabilities: {
      tools: {},
      prompts: {},
    },
  },
);

let connectedClientName: string | undefined;

server.oninitialized = () => {
  const clientInfo = server.getClientVersion();
  connectedClientName = clientInfo?.name;
};

let isProcessing = false; let currentOperationName = ""; let latestOutput = "";

async function sendNotification(method: string, params: any) {
  try {
    await server.notification({ method, params });
  } catch {
    // notification errors are non-critical
  }
}

/**
 * @param progressToken The progress token provided by the client
 * @param progress The current progress value
 * @param total Optional total value
 * @param message Optional status message
 */
async function sendProgressNotification(
  progressToken: string | number | undefined,
  progress: number,
  total?: number,
  message?: string
) {
  if (!progressToken) return; // Only send if client requested progress
  
  try {
    const params: any = {
      progressToken,
      progress
    };
    
    if (total !== undefined) params.total = total; // future cache progress
    if (message) params.message = message;
    
    await server.notification({
      method: PROTOCOL.NOTIFICATIONS.PROGRESS,
      params
    });
  } catch {
    // progress notification errors are non-critical
  }
}

function startProgressUpdates(
  operationName: string,
  progressToken?: string | number
) {
  isProcessing = true;
  currentOperationName = operationName;
  latestOutput = ""; // Reset latest output
  
  const progressMessages = [
    `🧠 ${operationName} - Analyzing your request...`,
    `📊 ${operationName} - Processing and generating insights...`,
    `✨ ${operationName} - Creating structured response for your review...`,
    `⏱️ ${operationName} - Large analysis in progress (this is normal for big requests)...`,
    `🔍 ${operationName} - Still working on your request...`,
  ];
  
  let messageIndex = 0;
  let progress = 0;
  
  // Send immediate acknowledgment if progress requested
  if (progressToken) {
    sendProgressNotification(
      progressToken,
      0,
      undefined, // No total - indeterminate progress
      `🔍 Starting ${operationName}`
    );
  }
  
  // Keep client alive with periodic updates
  const progressInterval = setInterval(async () => {
    if (isProcessing && progressToken) {
      // Simply increment progress value
      progress += 1;
      
      // Include latest output if available
      const baseMessage = progressMessages[messageIndex % progressMessages.length];
      const outputPreview = latestOutput.slice(-150).trim(); // Last 150 chars
      const message = outputPreview 
        ? `${baseMessage}\n📝 Output: ...${outputPreview}`
        : baseMessage;
      
      await sendProgressNotification(
        progressToken,
        progress,
        undefined, // No total - indeterminate progress
        message
      );
      messageIndex++;
    } else if (!isProcessing) {
      clearInterval(progressInterval);
    }
  }, PROTOCOL.KEEPALIVE_INTERVAL); // Every 25 seconds
  
  return { interval: progressInterval, progressToken };
}

function stopProgressUpdates(
  progressData: { interval: NodeJS.Timeout; progressToken?: string | number },
  success: boolean = true
) {
  const operationName = currentOperationName; // Store before clearing
  isProcessing = false;
  currentOperationName = "";
  clearInterval(progressData.interval);
  
  // Send final progress notification if client requested progress
  if (progressData.progressToken) {
    sendProgressNotification(
      progressData.progressToken,
      100,
      100,
      success ? `✅ ${operationName} completed successfully` : `❌ ${operationName} failed`
    );
  }
}

// tools/list
server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest): Promise<{ tools: Tool[] }> => {
  const visible = filterToolsForClient(toolRegistry, connectedClientName);
  if (visible.length === 0) {
    return { tools: getToolDefinitions([importantReadNowTool]) as unknown as Tool[] };
  }
  return { tools: getToolDefinitions(visible) as unknown as Tool[] };
});

// tools/get
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<CallToolResult> => {
  const toolName: string = request.params.name;

  // Handle fallback tool (dynamically injected, not in registry)
  if (toolName === importantReadNowTool.name) {
    const result = await importantReadNowTool.execute({});
    return {
      content: [{ type: "text", text: result }],
      isError: false,
    };
  }

  const toolEntry = toolRegistry.find(t => t.name === toolName);
  if (isToolBlockedForClient(toolEntry, connectedClientName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  if (toolExists(toolName)) {
    // Check if client requested progress updates
    const progressToken = (request.params as any)._meta?.progressToken;
    
    // Start progress updates if client requested them
    const progressData = startProgressUpdates(toolName, progressToken);
    
    try {
      // Get prompt and other parameters from arguments with proper typing
      const args: ToolArguments = (request.params.arguments as ToolArguments) || {};

      // Execute the tool using the unified registry with progress callback
      const result = await executeTool(toolName, args, (newOutput) => {
        latestOutput = newOutput;
      });

      // Stop progress updates
      stopProgressUpdates(progressData, true);

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
        isError: false,
      };
    } catch (error) {
      // Stop progress updates on error
      stopProgressUpdates(progressData, false);
      
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        content: [
          {
            type: "text",
            text: `Error executing ${toolName}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  } else {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// prompts/list
server.setRequestHandler(ListPromptsRequestSchema, async (request: ListPromptsRequest): Promise<{ prompts: Prompt[] }> => {
  const visible = filterToolsForClient(toolRegistry, connectedClientName);
  return { prompts: getPromptDefinitions(visible) as unknown as Prompt[] };
});

// prompts/get
server.setRequestHandler(GetPromptRequestSchema, async (request: GetPromptRequest): Promise<GetPromptResult> => {
  const promptName = request.params.name;
  const promptEntry = toolRegistry.find(t => t.name === promptName);
  if (isToolBlockedForClient(promptEntry, connectedClientName)) {
    throw new Error(`Unknown prompt: ${promptName}`);
  }

  const args = request.params.arguments || {};
  const promptMessage = getPromptMessage(promptName, args);
  
  if (!promptMessage) {
    throw new Error(`Unknown prompt: ${promptName}`);
  }
  
  return { 
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: promptMessage
      }
    }]
  };
});

// Start the server
async function main() {
  await initTools();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} main().catch(() => { process.exit(1); });
