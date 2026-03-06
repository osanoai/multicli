#!/usr/bin/env npx tsx
/**
 * refresh-catalog.ts
 *
 * 5-phase model catalog refresh:
 *   1. DISCOVER  — run bash extract scripts to get authoritative model IDs
 *   2. ENRICH    — ask each CLI's fast model to classify its own models into tiers
 *   3. VALIDATE  — reject hallucinated IDs, check coverage & tier distribution
 *   4. FALLBACK  — per-model: enrichment → previous catalog → name heuristic → balanced
 *   5. WRITE     — serialize to src/modelCatalog.generated.json
 *
 * Usage:
 *   npx tsx scripts/refresh-catalog.ts
 *
 * Environment variables (optional — only needed if the CLI requires them):
 *   ANTHROPIC_API_KEY, GEMINI_API_KEY / GOOGLE_API_KEY, OPENAI_API_KEY
 */

import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_PATH = resolve(__dirname, '..', 'src', 'modelCatalog.generated.json');

// ── Types ────────────────────────────────────────────────────────────────────

export interface EnrichmentEntry {
  id: string;
  tier: 'fast' | 'balanced' | 'powerful';
  displayName: string;
  description: string;
}

interface EnrichmentResponse {
  models: EnrichmentEntry[];
}

interface GeneratedTier {
  tier: 'fast' | 'balanced' | 'powerful';
  models: string[];
}

interface GeneratedCatalog {
  cli: string;
  tiers: GeneratedTier[];
}

interface GeneratedFile {
  generatedAt: string;
  catalogs: Record<string, GeneratedCatalog>;
}

// ── CLI configuration ────────────────────────────────────────────────────────

interface CLIConfig {
  name: string;
  expectedPrefix: string;
  extractScript: string;
  /** Pattern to find the cheapest/fastest model from discovered IDs for enrichment */
  fastModelPattern: RegExp;
  buildEnrichmentCommand: (model: string, prompt: string) => string;
}

const CLI_CONFIGS: CLIConfig[] = [
  {
    name: 'claude',
    expectedPrefix: 'claude-',
    extractScript: 'scripts/extract-claude.sh',
    fastModelPattern: /haiku/i,
    buildEnrichmentCommand: (model, prompt) =>
      `claude --print --output-format text --model ${model} ${shellQuote(prompt)}`,
  },
  {
    name: 'gemini',
    expectedPrefix: 'gemini-',
    extractScript: 'scripts/extract-gemini.sh',
    fastModelPattern: /flash(?!.*preview)/i,
    buildEnrichmentCommand: (model, prompt) =>
      `gemini -m ${model} -p ${shellQuote(prompt)}`,
  },
  {
    name: 'codex',
    expectedPrefix: 'gpt-',
    extractScript: 'scripts/extract-codex.sh',
    fastModelPattern: /mini/i,
    buildEnrichmentCommand: (model, prompt) =>
      `codex exec --full-auto --skip-git-repo-check --color never -m ${model} ${shellQuote(prompt)}`,
  },
];

/**
 * Pick the cheapest model from discovered IDs to use for enrichment.
 * Falls back to the first model in the list if no pattern match.
 */
export function pickEnrichmentModel(modelIds: string[], pattern: RegExp): string {
  const match = modelIds.find((id) => pattern.test(id));
  return match ?? modelIds[0];
}

// ── Utilities ────────────────────────────────────────────────────────────────

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

const VALID_TIERS = new Set(['fast', 'balanced', 'powerful']);

// ── Phase 1: DISCOVER ────────────────────────────────────────────────────────

function discoverModels(config: CLIConfig): string[] | null {
  const scriptPath = resolve(__dirname, '..', config.extractScript);

  console.log(`  [discover] Running ${config.extractScript}...`);

  try {
    const stdout = execFileSync('bash', [scriptPath], {
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const parsed: unknown = JSON.parse(stdout.trim());

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.error(`  [discover] ${config.name}: script returned empty or non-array`);
      return null;
    }

    const valid = parsed.filter(
      (id: unknown): id is string =>
        typeof id === 'string' && id.startsWith(config.expectedPrefix),
    );

    if (valid.length === 0) {
      console.error(
        `  [discover] ${config.name}: no IDs matching prefix "${config.expectedPrefix}"`,
      );
      return null;
    }

    console.log(`  [discover] ${config.name}: found ${valid.length} model IDs`);
    return valid;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [discover] ${config.name}: extraction failed — ${message}`);
    return null;
  }
}

// ── Phase 2: ENRICH ──────────────────────────────────────────────────────────

export function buildEnrichmentPrompt(cliName: string, modelIds: string[]): string {
  return `You are classifying ${cliName} models into performance tiers.

Here are the exact model IDs available in the ${cliName} CLI:
${JSON.stringify(modelIds)}

Classify EACH model into exactly one tier and respond with ONLY valid JSON (no markdown, no code fences, no explanation):

{
  "models": [
    {
      "id": "exact model ID from the list above",
      "tier": "fast | balanced | powerful",
      "displayName": "human-friendly name (e.g. 'Haiku', 'Sonnet 4', 'GPT-5.2 Codex')",
      "description": "1 sentence on strengths/when to use"
    }
  ]
}

Rules:
- You MUST classify EVERY model ID listed above. Do not skip any.
- You MUST NOT invent model IDs. Only use IDs from the list.
- Classify by relative capability: smallest/fastest -> "fast", mid-range -> "balanced", largest/most capable -> "powerful"
- Each tier should have at least one model (if 3+ models are provided)
- The "id" field must EXACTLY match one of the IDs provided above`;
}

function enrichModels(config: CLIConfig, modelIds: string[]): EnrichmentEntry[] | null {
  const enrichmentModel = pickEnrichmentModel(modelIds, config.fastModelPattern);
  const prompt = buildEnrichmentPrompt(config.name, modelIds);
  const command = config.buildEnrichmentCommand(enrichmentModel, prompt);

  console.log(`  [enrich] Querying ${config.name} CLI (model: ${enrichmentModel})...`);

  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return validateEnrichment(stdout, config.name, modelIds);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [enrich] ${config.name}: CLI invocation failed — ${message}`);
    return null;
  }
}

// ── Phase 3: VALIDATE ────────────────────────────────────────────────────────

export function validateEnrichment(
  raw: string,
  cliName: string,
  knownIds: string[],
): EnrichmentEntry[] | null {
  // Strip markdown code fences if the LLM wrapped the response
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: EnrichmentResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(`  [validate] ${cliName}: response is not valid JSON`);
    return null;
  }

  if (!Array.isArray(parsed.models) || parsed.models.length === 0) {
    console.error(`  [validate] ${cliName}: no models array or it is empty`);
    return null;
  }

  const knownSet = new Set(knownIds);
  const valid: EnrichmentEntry[] = [];

  for (const m of parsed.models) {
    if (
      typeof m.id !== 'string' ||
      typeof m.tier !== 'string' ||
      !VALID_TIERS.has(m.tier) ||
      typeof m.displayName !== 'string' ||
      typeof m.description !== 'string'
    ) {
      console.warn(`  [validate] ${cliName}: skipping malformed entry: ${JSON.stringify(m)}`);
      continue;
    }

    // Reject invented model IDs
    if (!knownSet.has(m.id)) {
      console.warn(`  [validate] ${cliName}: rejecting invented model ID: "${m.id}"`);
      continue;
    }

    valid.push({
      id: m.id.trim(),
      tier: m.tier as EnrichmentEntry['tier'],
      displayName: m.displayName.trim(),
      description: m.description.trim(),
    });
  }

  if (valid.length === 0) {
    console.error(`  [validate] ${cliName}: no valid entries after validation`);
    return null;
  }

  // Coverage check — enrichment must cover at least 50% of known IDs
  const coveredIds = new Set(valid.map((e) => e.id));
  const coverageRatio = coveredIds.size / knownIds.length;
  if (coverageRatio < 0.5) {
    console.warn(
      `  [validate] ${cliName}: low coverage (${coveredIds.size}/${knownIds.length}), rejecting enrichment`,
    );
    return null;
  }

  // Tier distribution — reject if all models land in the same tier (when 3+)
  if (valid.length >= 3) {
    const uniqueTiers = new Set(valid.map((e) => e.tier));
    if (uniqueTiers.size === 1) {
      console.warn(
        `  [validate] ${cliName}: all ${valid.length} models in same tier "${[...uniqueTiers][0]}", rejecting`,
      );
      return null;
    }
  }

  console.log(`  [validate] ${cliName}: ${valid.length}/${knownIds.length} models classified`);
  return valid;
}

// ── Phase 4: FALLBACK ────────────────────────────────────────────────────────

export function heuristicTier(
  modelId: string,
  cliName: string,
): 'fast' | 'balanced' | 'powerful' {
  // Use dash-delimited segments to avoid substring false positives
  // (e.g. "gemini" contains "mini", "preview" does NOT contain "pro")
  const lower = modelId.toLowerCase();
  const segments = new Set(lower.split('-'));

  // Fast indicators
  if (['mini', 'lite', 'haiku', 'small', 'nano'].some((p) => segments.has(p))) return 'fast';

  // Powerful indicators
  if (['opus', 'pro', 'max', 'ultra'].some((p) => segments.has(p))) return 'powerful';

  // CLI-specific patterns
  if (cliName === 'gemini') {
    if (segments.has('flash') && !segments.has('preview')) return 'fast';
    if (segments.has('flash') && segments.has('preview')) return 'balanced';
  }

  if (cliName === 'claude') {
    if (segments.has('sonnet')) return 'balanced';
  }

  if (cliName === 'codex') {
    if (segments.has('codex') && !segments.has('mini') && !segments.has('max'))
      return 'balanced';
    if (lower.startsWith('gpt-') && !segments.has('codex')) return 'powerful';
  }

  // Default
  return 'balanced';
}

export function assignTiers(
  modelIds: string[],
  enrichment: EnrichmentEntry[] | null,
  previousCatalog: GeneratedCatalog | null,
  cliName: string,
): GeneratedCatalog {
  // Build lookup maps
  const enrichmentMap = new Map<string, EnrichmentEntry>();
  if (enrichment) {
    for (const e of enrichment) enrichmentMap.set(e.id, e);
  }

  const previousTierMap = new Map<string, 'fast' | 'balanced' | 'powerful'>();
  if (previousCatalog) {
    for (const t of previousCatalog.tiers) {
      for (const id of t.models) {
        previousTierMap.set(id, t.tier);
      }
    }
  }

  // Assign each model to a tier via the fallback chain
  const tierBuckets: Record<string, string[]> = { fast: [], balanced: [], powerful: [] };

  for (const id of modelIds) {
    let tier: 'fast' | 'balanced' | 'powerful';
    let source: string;

    const enriched = enrichmentMap.get(id);
    if (enriched) {
      tier = enriched.tier;
      source = 'enrichment';
    } else if (previousTierMap.has(id)) {
      tier = previousTierMap.get(id)!;
      source = 'previous-catalog';
    } else {
      tier = heuristicTier(id, cliName);
      source = 'heuristic';
    }

    tierBuckets[tier].push(id);
    console.log(`    ${id} -> ${tier} (${source})`);
  }

  // Build GeneratedCatalog preserving tier order and omitting empty tiers
  const tierOrder: Array<'fast' | 'balanced' | 'powerful'> = ['fast', 'balanced', 'powerful'];
  const tiers: GeneratedTier[] = [];

  for (const tier of tierOrder) {
    if (tierBuckets[tier].length > 0) {
      tiers.push({ tier, models: tierBuckets[tier] });
    }
  }

  return { cli: cliName, tiers };
}

// ── Load existing catalog for fallback ──────────────────────────────────────

function loadExisting(): GeneratedFile | null {
  if (!existsSync(GENERATED_PATH)) return null;
  try {
    return JSON.parse(readFileSync(GENERATED_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Phase 5: WRITE (main orchestrator) ───────────────────────────────────────

function main(): void {
  console.log('Refreshing model catalog...\n');

  const existing = loadExisting();
  const catalogs: Record<string, GeneratedCatalog> = {};
  let anyDiscoverySuccess = false;

  for (const config of CLI_CONFIGS) {
    console.log(`\n--- ${config.name.toUpperCase()} ---`);

    // Phase 1: DISCOVER
    const modelIds = discoverModels(config);

    if (!modelIds) {
      // Discovery failed — fall back to entire previous catalog for this CLI
      if (existing?.catalogs[config.name]) {
        console.log(`  [fallback] keeping entire previous catalog for ${config.name}`);
        catalogs[config.name] = existing.catalogs[config.name];
      } else {
        console.warn(`  [fallback] no previous catalog for ${config.name}, skipping`);
      }
      continue;
    }

    anyDiscoverySuccess = true;

    // Phase 2: ENRICH
    const enrichment = enrichModels(config, modelIds);

    // Phase 3: VALIDATE (inside enrichModels → validateEnrichment)

    // Phase 4: FALLBACK + ASSIGN
    const previousCatalog = existing?.catalogs[config.name] ?? null;
    catalogs[config.name] = assignTiers(modelIds, enrichment, previousCatalog, config.name);

    const totalModels = catalogs[config.name].tiers.reduce((sum, t) => sum + t.models.length, 0);
    console.log(
      `  [result] ${config.name}: ${totalModels} models across ${catalogs[config.name].tiers.length} tiers`,
    );
  }

  if (!anyDiscoverySuccess && !existing) {
    console.error('\nAll CLIs failed discovery and no existing catalog. Aborting.');
    process.exit(1);
  }

  const output: GeneratedFile = {
    generatedAt: new Date().toISOString(),
    catalogs,
  };

  writeFileSync(GENERATED_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`\n✓ Wrote ${GENERATED_PATH}`);

  const cliCount = Object.keys(catalogs).length;
  console.log(`  ${cliCount}/${CLI_CONFIGS.length} CLIs in catalog.`);
}

// Only run main() when executed directly (not when imported by tests)
const isDirectExecution =
  process.argv[1]?.endsWith('refresh-catalog.ts') ||
  process.argv[1]?.endsWith('refresh-catalog.js');

if (isDirectExecution) {
  main();
}
