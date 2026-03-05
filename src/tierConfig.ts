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
export type CLIName = 'claude' | 'gemini' | 'codex';

export const TIER_CONFIG: Record<CLIName, Record<TierName, TierDisplayConfig>> = {
  claude: {
    fast: {
      label: 'Haiku (DEFAULT)',
      useWhen:
        'Simple questions, math, lookups, summaries, short code, trivial tasks. USE THIS BY DEFAULT.',
    },
    balanced: {
      label: 'Sonnet',
      useWhen: 'Moderate coding, analysis, multi-step tasks, following detailed instructions.',
    },
    powerful: {
      label: 'Opus',
      useWhen:
        'ONLY for: complex reasoning, nuanced analysis, difficult multi-step tasks, architectural decisions.',
    },
  },
  gemini: {
    fast: {
      label: 'Flash (DEFAULT)',
      useWhen:
        'Simple questions, math, lookups, summaries, short code, trivial tasks. USE THIS BY DEFAULT.',
    },
    balanced: {
      label: 'Flash Preview',
      useWhen:
        'Moderate tasks needing newer capabilities but still fast. Multi-step but not deeply complex.',
    },
    powerful: {
      label: 'Pro',
      useWhen:
        'ONLY for: complex analysis, deep reasoning, large codebase understanding, nuanced opinions, architectural decisions.',
    },
  },
  codex: {
    fast: {
      label: 'Codex Mini (DEFAULT)',
      useWhen:
        'Simple questions, math, lookups, short code snippets, trivial tasks. USE THIS BY DEFAULT.',
    },
    balanced: {
      label: 'Codex',
      useWhen: 'Moderate coding tasks, multi-file changes, debugging, code review.',
    },
    powerful: {
      label: 'Codex Max / GPT',
      useWhen:
        'ONLY for: complex architecture, large refactors, deep reasoning, nuanced analysis, multi-step planning.',
    },
  },
};

export const CLI_NOTES: Record<CLIName, string> = {
  claude: 'Run Claude-Help for the latest CLI options.',
  gemini:
    'Run Gemini-Help for the latest CLI options. Model IDs may change as Google releases new versions.',
  codex: 'Run Codex-Help for the latest CLI options. Model IDs may change as OpenAI releases new versions.',
};
