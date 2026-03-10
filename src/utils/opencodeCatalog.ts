import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { executeCommand } from './commandExecutor.js';
import { CLI } from '../constants.js';
import { TIER_CONFIG, CLI_NOTES } from '../tierConfig.js';
import type { TierName } from '../tierConfig.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpencodeClassification {
  fast: string[];
  balanced: string[];
  powerful: string[];
}

export interface OpencodeCacheFile {
  hash: string;
  classifications: OpencodeClassification;
}

// ── Cache location ───────────────────────────────────────────────────────────

export function getCacheDir(): string {
  if (process.env.MULTICLI_CACHE_DIR) {
    return process.env.MULTICLI_CACHE_DIR;
  }

  const os = platform();
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'osanoai');
  }
  if (os === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'osanoai');
  }
  // Linux / other: XDG_CACHE_HOME or ~/.cache
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'osanoai');
}

export function getCachePath(): string {
  return join(getCacheDir(), 'multicli-opencode.json');
}

// ── Model discovery ──────────────────────────────────────────────────────────

/** Patterns that indicate a model is not suitable for text generation */
const EMBEDDING_PATTERNS = /embedding|embed[-_]|rerank/i;

export async function listOpencodeModels(): Promise<string[]> {
  const raw = await executeCommand(
    CLI.COMMANDS.OPENCODE,
    [CLI.OPENCODE_SUBCOMMANDS.MODELS],
  );

  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.includes('/'))
    .filter(line => !EMBEDDING_PATTERNS.test(line));
}

// ── Hashing ──────────────────────────────────────────────────────────────────

export function hashModelList(models: string[]): string {
  const sorted = [...models].sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex');
}

// ── Cache read/write ─────────────────────────────────────────────────────────

export async function readCache(): Promise<OpencodeCacheFile | null> {
  try {
    const raw = await readFile(getCachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as OpencodeCacheFile;
    if (parsed.hash && parsed.classifications) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeCache(cache: OpencodeCacheFile): Promise<void> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getCachePath(), JSON.stringify(cache, null, 2), 'utf-8');
}

// ── Heuristic-based classification ──────────────────────────────────────────

/**
 * Name patterns → tier mapping. Checked in order; first match wins.
 * Patterns are tested against the full model identifier (provider/name).
 */
const FAST_PATTERNS = [
  /\bflash-lite\b/i,
  /\bnano\b/i,
  /\bmini\b/i,
  /\bsmall\b/i,
  /\b8b\b/i,
  /\b3b\b/i,
  /\bhaiku\b/i,
  /\blite\b/i,
  /\bMiMo\b/,
];

const POWERFUL_PATTERNS = [
  /\bopus\b/i,
  /\b405b\b/i,
  /\bgpt-5\.4\b/i,
  /\bo3\b/i,
  /\bo1\b/i,
  /\bDeepSeek-R1\b/,
  /\bpro\b/i,
  /\b235b\b/i,
  /\b120b\b/i,
  /\b480b\b/i,
  /\b397b\b/i,
  /\bCoder-Next\b/,
];

/**
 * Classify a single model into a tier using name-based heuristics.
 * Returns 'fast', 'powerful', or 'balanced' (default).
 */
export function classifyModelByName(model: string): TierName {
  for (const pattern of FAST_PATTERNS) {
    if (pattern.test(model)) return 'fast';
  }
  for (const pattern of POWERFUL_PATTERNS) {
    if (pattern.test(model)) return 'powerful';
  }
  return 'balanced';
}

/**
 * Classify all models using heuristics. Instant and requires no API calls.
 */
export function classifyModelsViaHeuristics(models: string[]): OpencodeClassification {
  const fast: string[] = [];
  const balanced: string[] = [];
  const powerful: string[] = [];

  for (const model of models) {
    const tier = classifyModelByName(model);
    if (tier === 'fast') fast.push(model);
    else if (tier === 'powerful') powerful.push(model);
    else balanced.push(model);
  }

  return { fast, balanced, powerful };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Get the classified OpenCode model catalog.
 * Runs `opencode models` to discover available models, then classifies via heuristics.
 * Caches results so repeated calls with the same model set are instant.
 */
export async function getOpencodeClassifiedCatalog(): Promise<string> {
  const models = await listOpencodeModels();

  if (models.length === 0) {
    return 'No models available. Ensure providers are configured via `opencode auth login`.';
  }

  const hash = hashModelList(models);
  const cache = await readCache();

  let classifications: OpencodeClassification;

  if (cache && cache.hash === hash) {
    classifications = cache.classifications;
  } else {
    classifications = classifyModelsViaHeuristics(models);

    // Write cache (fire-and-forget, don't block response)
    writeCache({ hash, classifications }).catch(() => {});
  }

  return formatOpencodeCatalog(classifications);
}

// ── Formatting ───────────────────────────────────────────────────────────────

const SELECTION_RULE =
  `MODEL SELECTION RULE: Default to the "balanced" tier for most tasks. ` +
  `Use "powerful" for complex reasoning, architecture, nuanced analysis, or when quality matters most. ` +
  `Reserve "fast" only for trivial lookups, simple math, or quick one-line answers. ` +
  `Models are in provider/model format — use the full string (e.g., "google-vertex/gemini-2.5-flash") when calling Ask-OpenCode.\n`;

export function formatOpencodeCatalog(classifications: OpencodeClassification): string {
  const lines: string[] = [
    `OPENCODE — Available Models\n`,
    SELECTION_RULE,
  ];

  for (const tierName of ['fast', 'balanced', 'powerful'] as TierName[]) {
    const models = classifications[tierName];
    if (!models || models.length === 0) continue;

    const config = TIER_CONFIG.opencode[tierName];
    lines.push(`[${tierName.toUpperCase()}] ${config.label}`);
    lines.push(`  Use when: ${config.useWhen}`);
    lines.push(`  Model IDs: ${models.join(', ')}`);
    lines.push('');
  }

  lines.push(`> ${CLI_NOTES.opencode}`);
  return lines.join('\n');
}
