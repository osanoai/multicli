/**
 * Human-curated tier display labels and usage guidance.
 * These change rarely — only when we want to rename a tier or update guidance text.
 * The model IDs within each tier are managed by the generated catalog.
 */

export interface TierDisplayConfig {
  label: string;
  useWhen: string;
}

export type TierName = 'fast' | 'balanced' | 'powerful';
export type CLIName = 'claude' | 'antigravity' | 'gemini' | 'codex' | 'opencode';
/** CLIs that use the static generated model catalog (not dynamic discovery). */
export type StaticCLIName = 'claude' | 'codex';

export const TIER_CONFIG: Record<CLIName, Record<TierName, TierDisplayConfig>> = {
  claude: {
    fast: {
      label: 'Haiku',
      useWhen: 'Only for: trivial lookups, simple math, quick one-line answers.',
    },
    balanced: {
      label: 'Sonnet (DEFAULT)',
      useWhen:
        'Most tasks: coding, analysis, multi-step work, debugging, code review. USE THIS BY DEFAULT.',
    },
    powerful: {
      label: 'Opus',
      useWhen:
        'Complex reasoning, nuanced analysis, architectural decisions, large refactors, or when you need the highest quality.',
    },
  },
  antigravity: {
    fast: {
      label: 'Fast',
      useWhen: 'Only for: trivial lookups, simple math, quick one-line answers.',
    },
    balanced: {
      label: 'Balanced (DEFAULT)',
      useWhen:
        'Most tasks: coding, analysis, multi-step work, debugging, code review. USE THIS BY DEFAULT.',
    },
    powerful: {
      label: 'Powerful',
      useWhen:
        'Complex analysis, deep reasoning, large codebase understanding, nuanced opinions, architectural decisions.',
    },
  },
  gemini: {
    fast: {
      label: 'Deprecated Alias',
      useWhen: 'Use List-Antigravity-Models instead. Gemini names route to Antigravity via agy.',
    },
    balanced: {
      label: 'Deprecated Alias (DEFAULT)',
      useWhen: 'Use Ask-Antigravity for new workflows; Ask-Gemini remains a compatibility alias.',
    },
    powerful: {
      label: 'Deprecated Alias',
      useWhen: 'Use exact Antigravity model names returned by agy models.',
    },
  },
  codex: {
    fast: {
      label: 'Codex Mini',
      useWhen: 'Only for: trivial lookups, simple math, quick one-line answers.',
    },
    balanced: {
      label: 'Codex (DEFAULT)',
      useWhen:
        'Most tasks: coding, analysis, multi-file changes, debugging, code review. USE THIS BY DEFAULT.',
    },
    powerful: {
      label: 'Codex Max / GPT',
      useWhen:
        'Complex architecture, large refactors, deep reasoning, nuanced analysis, multi-step planning.',
    },
  },
  opencode: {
    fast: {
      label: 'Fast',
      useWhen: 'Only for: trivial lookups, simple math, quick one-line answers.',
    },
    balanced: {
      label: 'Balanced (DEFAULT)',
      useWhen:
        'Most tasks: coding, analysis, multi-step work, debugging, code review. USE THIS BY DEFAULT.',
    },
    powerful: {
      label: 'Powerful',
      useWhen:
        'Complex reasoning, nuanced analysis, architectural decisions, large refactors, or when you need the highest quality.',
    },
  },
};

export const CLI_NOTES: Record<CLIName, string> = {
  claude: 'Run Claude-Help for the latest CLI options.',
  antigravity:
    'Antigravity models are dynamically discovered at runtime through agy models because discovery depends on local sign-in.',
  gemini:
    'Deprecated alias for Antigravity. Use Antigravity-Help and List-Antigravity-Models for new workflows.',
  codex: 'Run Codex-Help for the latest CLI options. Model IDs may change as OpenAI releases new versions.',
  opencode: 'OpenCode models are dynamically discovered from your configured providers. Models are classified into tiers automatically. Run OpenCode-Help for CLI options.',
};
