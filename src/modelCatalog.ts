import { createRequire } from 'node:module';
import { TIER_CONFIG, CLI_NOTES } from './tierConfig.js';
import type { CLIName, TierName } from './tierConfig.js';

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

// ── Generated catalog (loaded at module init) ────────────────────────────────

interface GeneratedTier {
  tier: string;
  models: string[];
}

interface GeneratedCatalogEntry {
  cli: string;
  tiers: GeneratedTier[];
}

interface GeneratedFile {
  generatedAt: string;
  catalogs: Record<string, GeneratedCatalogEntry>;
}

let generatedData: GeneratedFile | null = null;
try {
  const require = createRequire(import.meta.url);
  generatedData = require('./modelCatalog.generated.json') as GeneratedFile;
} catch {
  // Generated file doesn't exist yet — will use hardcoded fallback
}

// ── Hardcoded fallback catalogs ──────────────────────────────────────────────

const FALLBACK_CATALOGS: Record<string, CLICatalog> = {
  gemini: {
    cli: 'gemini',
    tiers: [
      {
        tier: 'fast',
        label: 'Flash',
        models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
        useWhen: 'Only for: trivial lookups, simple math, quick one-line answers.',
      },
      {
        tier: 'balanced',
        label: 'Flash Preview (DEFAULT)',
        models: ['gemini-3-flash-preview'],
        useWhen:
          'Most tasks: coding, analysis, multi-step work, debugging, code review. USE THIS BY DEFAULT.',
      },
      {
        tier: 'powerful',
        label: 'Pro',
        models: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
        useWhen:
          'Complex analysis, deep reasoning, large codebase understanding, nuanced opinions, architectural decisions.',
      },
    ],
    note: 'Run Gemini-Help for the latest CLI options. Model IDs may change as Google releases new versions.',
  },
  codex: {
    cli: 'codex',
    tiers: [
      {
        tier: 'fast',
        label: 'Codex Mini',
        models: ['gpt-5.1-codex-mini'],
        useWhen: 'Only for: trivial lookups, simple math, quick one-line answers.',
      },
      {
        tier: 'balanced',
        label: 'Codex (DEFAULT)',
        models: ['gpt-5.2-codex'],
        useWhen:
          'Most tasks: coding, analysis, multi-file changes, debugging, code review. USE THIS BY DEFAULT.',
      },
      {
        tier: 'powerful',
        label: 'Codex Max / GPT',
        models: ['gpt-5.3-codex', 'gpt-5.1-codex-max', 'gpt-5.2'],
        useWhen:
          'Complex architecture, large refactors, deep reasoning, nuanced analysis, multi-step planning.',
      },
    ],
    note: 'Run Codex-Help for the latest CLI options. Model IDs may change as OpenAI releases new versions.',
  },
  claude: {
    cli: 'claude',
    tiers: [
      {
        tier: 'fast',
        label: 'Haiku',
        models: ['claude-haiku-4-5-20251001'],
        useWhen: 'Only for: trivial lookups, simple math, quick one-line answers.',
      },
      {
        tier: 'balanced',
        label: 'Sonnet (DEFAULT)',
        models: ['claude-sonnet-4-6'],
        useWhen:
          'Most tasks: coding, analysis, multi-step work, debugging, code review. USE THIS BY DEFAULT.',
      },
      {
        tier: 'powerful',
        label: 'Opus',
        models: ['claude-opus-4-6'],
        useWhen:
          'Complex reasoning, nuanced analysis, architectural decisions, large refactors, or when you need the highest quality.',
      },
    ],
    note: 'Run Claude-Help for the latest CLI options.',
  },
};

// ── Build catalog from generated data ────────────────────────────────────────

function buildFromGenerated(cliName: CLIName): CLICatalog | null {
  const entry = generatedData?.catalogs[cliName];
  if (!entry?.tiers?.length) return null;

  const tiers: ModelTier[] = [];
  for (const genTier of entry.tiers) {
    const tierName = genTier.tier as TierName;
    const config = TIER_CONFIG[cliName]?.[tierName];
    if (!config || !Array.isArray(genTier.models) || !genTier.models.length) continue;

    tiers.push({
      tier: tierName,
      label: config.label,
      models: genTier.models,
      useWhen: config.useWhen,
    });
  }

  if (tiers.length === 0) return null;

  return {
    cli: cliName,
    tiers,
    note: CLI_NOTES[cliName],
  };
}

// ── Resolved catalogs ────────────────────────────────────────────────────────

const CATALOGS: Record<string, CLICatalog> = {};
for (const cli of ['gemini', 'codex', 'claude'] as const) {
  CATALOGS[cli] = buildFromGenerated(cli) ?? FALLBACK_CATALOGS[cli];
}

// ── Public API (unchanged signatures) ────────────────────────────────────────

export function getCatalog(cli: 'gemini' | 'codex' | 'claude'): CLICatalog {
  return CATALOGS[cli];
}

const SELECTION_RULE =
  `MODEL SELECTION RULE: Default to the "balanced" tier for most tasks. ` +
  `Use "powerful" for complex reasoning, architecture, nuanced analysis, or when quality matters most. ` +
  `Reserve "fast" only for trivial lookups, simple math, or quick one-line answers. ` +
  `When multiple model IDs are listed for a tier, prefer the one with the highest version number (newest and most capable).\n`;

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
