export interface ModelTier {
  tier: 'fast' | 'balanced' | 'powerful';
  label: string;
  models: string[];
  useWhen: string;
}

export interface CLICatalog {
  cli: 'gemini' | 'codex' | 'claude';
  tiers: ModelTier[];
  note: string;
}

const GEMINI_CATALOG: CLICatalog = {
  cli: 'gemini',
  tiers: [
    {
      tier: 'fast',
      label: 'Flash (DEFAULT)',
      models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      useWhen: 'Simple questions, math, lookups, summaries, short code, trivial tasks. USE THIS BY DEFAULT.',
    },
    {
      tier: 'balanced',
      label: 'Flash Preview',
      models: ['gemini-3-flash-preview'],
      useWhen: 'Moderate tasks needing newer capabilities but still fast. Multi-step but not deeply complex.',
    },
    {
      tier: 'powerful',
      label: 'Pro',
      models: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
      useWhen: 'ONLY for: complex analysis, deep reasoning, large codebase understanding, nuanced opinions, architectural decisions.',
    },
  ],
  note: 'Run Gemini Help for the latest CLI options. Model IDs may change as Google releases new versions.',
};

const CODEX_CATALOG: CLICatalog = {
  cli: 'codex',
  tiers: [
    {
      tier: 'fast',
      label: 'Codex Mini (DEFAULT)',
      models: ['gpt-5.1-codex-mini'],
      useWhen: 'Simple questions, math, lookups, short code snippets, trivial tasks. USE THIS BY DEFAULT.',
    },
    {
      tier: 'balanced',
      label: 'Codex',
      models: ['gpt-5.2-codex'],
      useWhen: 'Moderate coding tasks, multi-file changes, debugging, code review.',
    },
    {
      tier: 'powerful',
      label: 'Codex Max / GPT',
      models: ['gpt-5.3-codex', 'gpt-5.1-codex-max', 'gpt-5.2'],
      useWhen: 'ONLY for: complex architecture, large refactors, deep reasoning, nuanced analysis, multi-step planning.',
    },
  ],
  note: 'Run Codex Help for the latest CLI options. Model IDs may change as OpenAI releases new versions.',
};

const CLAUDE_CATALOG: CLICatalog = {
  cli: 'claude',
  tiers: [
    {
      tier: 'fast',
      label: 'Haiku (DEFAULT)',
      models: ['claude-haiku-4-5-20251001'],
      useWhen: 'Simple questions, math, lookups, summaries, short code, trivial tasks. USE THIS BY DEFAULT.',
    },
    {
      tier: 'balanced',
      label: 'Sonnet',
      models: ['claude-sonnet-4-6'],
      useWhen: 'Moderate coding, analysis, multi-step tasks, following detailed instructions.',
    },
    {
      tier: 'powerful',
      label: 'Opus',
      models: ['claude-opus-4-6'],
      useWhen: 'ONLY for: complex reasoning, nuanced analysis, difficult multi-step tasks, architectural decisions.',
    },
  ],
  note: 'Run Claude Help for the latest CLI options.',
};

const CATALOGS: Record<string, CLICatalog> = {
  gemini: GEMINI_CATALOG,
  codex: CODEX_CATALOG,
  claude: CLAUDE_CATALOG,
};

export function getCatalog(cli: 'gemini' | 'codex' | 'claude'): CLICatalog {
  return CATALOGS[cli];
}

const SELECTION_RULE =
  `MODEL SELECTION RULE: Always use the fastest (smallest) model that can handle the task. ` +
  `Default to the "fast" tier. Only escalate when the task clearly requires more capability. ` +
  `Simple questions, math, lookups, and trivial code do NOT need powerful models.\n`;

export function formatCatalog(cli: 'gemini' | 'codex' | 'claude'): string {
  const catalog = CATALOGS[cli];
  const lines: string[] = [
    `${catalog.cli.toUpperCase()} — Available Models\n`,
    SELECTION_RULE,
  ];

  for (const tier of catalog.tiers) {
    lines.push(`[${tier.tier.toUpperCase()}] ${tier.label}`);
    lines.push(`  Use when: ${tier.useWhen}`);
    lines.push(`  Model IDs: ${tier.models.join(', ')}`);
    lines.push('');
  }

  lines.push(`> ${catalog.note}`);
  return lines.join('\n');
}
