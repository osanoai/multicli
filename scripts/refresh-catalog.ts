#!/usr/bin/env npx tsx
/**
 * refresh-catalog.ts
 *
 * Queries each CLI (claude, gemini, codex) to self-report available models,
 * then writes src/modelCatalog.generated.json.
 *
 * Usage:
 *   npx tsx scripts/refresh-catalog.ts
 *
 * Environment variables (optional — only needed if the CLI requires them):
 *   ANTHROPIC_API_KEY, GEMINI_API_KEY / GOOGLE_API_KEY, OPENAI_API_KEY
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_PATH = resolve(__dirname, '..', 'src', 'modelCatalog.generated.json');

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  displayName: string;
  tier: 'fast' | 'balanced' | 'powerful';
  description: string;
}

interface CLIResponse {
  models: ModelEntry[];
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

// ── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(provider: string): string {
  return `You are reporting which models are available through the ${provider} CLI.
Respond with ONLY valid JSON matching this exact schema — no markdown, no explanation, no code fences.

{
  "models": [
    {
      "id": "exact model ID string passed to --model or -m",
      "displayName": "human-readable name",
      "tier": "fast | balanced | powerful",
      "description": "1 sentence on when to use this model"
    }
  ]
}

Rules:
- ONLY include ${provider}'s own models — do NOT include models from other providers
- Only include models currently available in this CLI
- Classify: smallest/fastest models → "fast", mid-range → "balanced", largest/most capable → "powerful"
- The "id" must be the exact string a user passes to the --model or -m flag
- If unsure about a model, omit it`;
}

// ── CLI invocations ──────────────────────────────────────────────────────────

interface CLIConfig {
  name: string;
  expectedPrefix: string;
  buildCommand: (prompt: string) => string;
}

const CLI_CONFIGS: CLIConfig[] = [
  {
    name: 'claude',
    expectedPrefix: 'claude-',
    buildCommand: (prompt) =>
      `claude --print --output-format text --model claude-haiku-4-5-20251001 ${shellQuote(prompt)}`,
  },
  {
    name: 'gemini',
    expectedPrefix: 'gemini-',
    buildCommand: (prompt) =>
      `gemini -m gemini-2.5-flash -p ${shellQuote(prompt)}`,
  },
  {
    name: 'codex',
    expectedPrefix: 'gpt-',
    buildCommand: (prompt) =>
      `codex exec --full-auto --skip-git-repo-check --color never -m gpt-5.1-codex-mini ${shellQuote(prompt)}`,
  },
];

function shellQuote(s: string): string {
  // Single-quote the string, escaping any embedded single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_TIERS = new Set(['fast', 'balanced', 'powerful']);

function validateResponse(raw: string, cliName: string): ModelEntry[] | null {
  // Strip markdown code fences if the LLM wrapped the response
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: CLIResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(`  ✗ ${cliName}: response is not valid JSON`);
    return null;
  }

  if (!Array.isArray(parsed.models) || parsed.models.length === 0) {
    console.error(`  ✗ ${cliName}: response has no models array or it is empty`);
    return null;
  }

  const valid: ModelEntry[] = [];
  for (const m of parsed.models) {
    if (
      typeof m.id !== 'string' ||
      !m.id.trim() ||
      typeof m.displayName !== 'string' ||
      typeof m.tier !== 'string' ||
      !VALID_TIERS.has(m.tier) ||
      typeof m.description !== 'string'
    ) {
      console.warn(`  ⚠ ${cliName}: skipping invalid model entry: ${JSON.stringify(m)}`);
      continue;
    }
    valid.push({
      id: m.id.trim(),
      displayName: m.displayName.trim(),
      tier: m.tier as ModelEntry['tier'],
      description: m.description.trim(),
    });
  }

  if (valid.length === 0) {
    console.error(`  ✗ ${cliName}: no valid model entries after validation`);
    return null;
  }

  return valid;
}

// ── Query a single CLI ──────────────────────────────────────────────────────

function queryCLI(config: CLIConfig): ModelEntry[] | null {
  const prompt = buildPrompt(config.name);
  const command = config.buildCommand(prompt);

  console.log(`  ⟳ Querying ${config.name} CLI...`);

  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      timeout: 120_000, // 2 minute timeout
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const models = validateResponse(stdout, config.name);
    if (!models) return null;

    // Filter out models that don't match the expected provider prefix
    const filtered = models.filter((m) => m.id.startsWith(config.expectedPrefix));
    const dropped = models.length - filtered.length;
    if (dropped > 0) {
      console.warn(`  ⚠ ${config.name}: dropped ${dropped} model(s) not matching prefix "${config.expectedPrefix}"`);
    }
    return filtered.length > 0 ? filtered : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${config.name}: CLI invocation failed — ${message}`);
    return null;
  }
}

// ── Build catalog from model entries ────────────────────────────────────────

function buildCatalog(cliName: string, models: ModelEntry[]): GeneratedCatalog {
  const tierOrder: Array<'fast' | 'balanced' | 'powerful'> = ['fast', 'balanced', 'powerful'];
  const tiers: GeneratedTier[] = [];

  for (const tier of tierOrder) {
    const tierModels = models.filter((m) => m.tier === tier).map((m) => m.id);
    if (tierModels.length > 0) {
      tiers.push({ tier, models: tierModels });
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

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('Refreshing model catalog...\n');

  const existing = loadExisting();
  const catalogs: Record<string, GeneratedCatalog> = {};
  let successCount = 0;

  for (const config of CLI_CONFIGS) {
    const models = queryCLI(config);
    if (models) {
      catalogs[config.name] = buildCatalog(config.name, models);
      console.log(`  ✓ ${config.name}: ${models.length} models found\n`);
      successCount++;
    } else if (existing?.catalogs[config.name]) {
      console.log(`  ↩ ${config.name}: keeping existing catalog (fallback)\n`);
      catalogs[config.name] = existing.catalogs[config.name];
    } else {
      console.warn(`  ⚠ ${config.name}: no data available (no fallback)\n`);
    }
  }

  if (successCount === 0 && !existing) {
    console.error('\n✗ All CLIs failed and no existing catalog to fall back to.');
    process.exit(1);
  }

  const output: GeneratedFile = {
    generatedAt: new Date().toISOString(),
    catalogs,
  };

  writeFileSync(GENERATED_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`✓ Wrote ${GENERATED_PATH}`);
  console.log(`  ${successCount}/${CLI_CONFIGS.length} CLIs refreshed successfully.`);
}

main();
