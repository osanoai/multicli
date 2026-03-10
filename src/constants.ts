

// Error messages
export const ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "Quota exceeded for Gemini model requests",
  QUOTA_EXCEEDED_SHORT: "⚠️ Gemini daily quota exceeded. Please try again later.",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
} as const;

// Status messages
export const STATUS_MESSAGES = {
  SANDBOX_EXECUTING: "🔒 Executing CLI command in sandbox mode...",
  GEMINI_RESPONSE: "Gemini response:",
  CODEX_RESPONSE: "Codex response:",
  CLAUDE_RESPONSE: "Claude response:",
  OPENCODE_RESPONSE: "OpenCode response:",
  // Timeout prevention messages
  PROCESSING_START: "🔍 Starting analysis (may take 5-15 minutes for large codebases)",
  PROCESSING_CONTINUE: "⏳ Still processing...",
  PROCESSING_COMPLETE: "✅ Analysis completed successfully",
} as const;

// MCP Protocol Constants
export const PROTOCOL = {
  // Message roles
  ROLES: {
    USER: "user",
    ASSISTANT: "assistant",
  },
  // Content types
  CONTENT_TYPES: {
    TEXT: "text",
  },
  // Status codes
  STATUS: {
    SUCCESS: "success",
    ERROR: "error",
    FAILED: "failed",
    REPORT: "report",
  },
  // Notification methods
  NOTIFICATIONS: {
    PROGRESS: "notifications/progress",
  },
  // Timeout prevention
  KEEPALIVE_INTERVAL: 10000, // 10 seconds
} as const;


// CLI Constants
export const CLI = {
  // Command names
  COMMANDS: {
    GEMINI: "gemini",
    CODEX: "codex",
    CLAUDE: "claude",
    OPENCODE: "opencode",
    ECHO: "echo",
  },
  // Gemini command flags
  FLAGS: {
    MODEL: "-m",
    SANDBOX: "-s",
    PROMPT: "-p",
    HELP: "-help",
  },
  // Codex subcommands
  SUBCOMMANDS: {
    EXEC: "exec",
  },
  // Codex-specific flags
  CODEX_FLAGS: {
    MODEL: "-m",
    SANDBOX: "-s",
    APPROVAL: "-a",
    COLOR: "--color",
    FULL_AUTO: "--full-auto",
    SKIP_GIT_CHECK: "--skip-git-repo-check",
  },
  // Claude Code flags
  CLAUDE_FLAGS: {
    PRINT: "--print",
    MODEL: "--model",
    OUTPUT_FORMAT: "--output-format",
    PERMISSION_MODE: "--permission-mode",
    MAX_BUDGET: "--max-budget-usd",
    SYSTEM_PROMPT: "--system-prompt",
    TOOLS: "--tools",
    HELP: "--help",
  },
  // OpenCode flags
  OPENCODE_FLAGS: {
    MODEL: "-m",
    CONTINUE: "-c",
    SESSION: "-s",
    HELP: "--help",
  },
  // OpenCode subcommands
  OPENCODE_SUBCOMMANDS: {
    RUN: "run",
    MODELS: "models",
  },
  // Default values
  DEFAULTS: {
    BOOLEAN_TRUE: "true",
    BOOLEAN_FALSE: "false",
  },
} as const;


// (merged PromptArguments and ToolArguments)
export interface ToolArguments {
  prompt?: string;
  model?: string;
  sandbox?: boolean | string;
  changeMode?: boolean | string;
  chunkIndex?: number | string; // Which chunk to return (1-based)
  chunkCacheKey?: string; // Optional cache key for continuation
  message?: string; // For Ping tool -- Un-used.

  approvalPolicy?: string; // Codex approval policy
  permissionMode?: string; // Claude permission mode
  maxBudgetUsd?: number; // Claude max spend
  systemPrompt?: string; // Claude system prompt override

  [key: string]: string | boolean | number | undefined; // Allow additional properties
}
