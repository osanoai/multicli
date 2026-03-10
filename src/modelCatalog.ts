import { createRequire } from 'node:module';
import { TIER_CONFIG, CLI_NOTES } from './tierConfig.js';
import type { StaticCLIName, TierName } from './tierConfig.js';

export interface ModelTier {
  tier: 'fast' | 'balanced' | 'powerful';
  label: string;
  models: string[];
  useWhen: string;
}

export interface CLICatalog {
  cli: StaticCLIName;
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

let generatedData: GeneratedFile;
try {
  const require = createRequire(import.meta.url);
  const raw = require('./modelCatalog.generated.json') as unknown;
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('catalogs' in raw) ||
    typeof (raw as Record<string, unknown>).catalogs !== 'object'
  ) {
    throw new Error('invalid shape');
  }
  generatedData = raw as GeneratedFile;
} catch {
  throw new Error(
    'Failed to load modelCatalog.generated.json. ' +
      "If developing locally, run 'npm run refresh-catalog'. " +
      'If using the published package, try reinstalling or upgrading.',
  );
}

// ── Build catalog from generated data (no static fallback — generated file
//    is checked into git and always ships with the package) ──────────────────

function buildFromGenerated(cliName: StaticCLIName): CLICatalog | null {
  const entry = generatedData.catalogs[cliName];
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
  const built = buildFromGenerated(cli);
  if (!built) {
    throw new Error(
      `No catalog entry for "${cli}" in generated data. ` +
        "If developing locally, run 'npm run refresh-catalog'. " +
        'If using the published package, try reinstalling or upgrading.',
    );
  }
  CATALOGS[cli] = built;
}

// ── Public API (unchanged signatures) ────────────────────────────────────────

export function getCatalog(cli: StaticCLIName): CLICatalog {
  return CATALOGS[cli];
}

const SELECTION_RULE =
  `MODEL SELECTION RULE: Default to the "balanced" tier for most tasks. ` +
  `Use "powerful" for complex reasoning, architecture, nuanced analysis, or when quality matters most. ` +
  `Reserve "fast" only for trivial lookups, simple math, or quick one-line answers. ` +
  `When multiple model IDs are listed for a tier, prefer the one with the highest version number (newest and most capable).\n`;

export function formatCatalog(cli: StaticCLIName): string {
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
