import { CLI } from '../constants.js';
import { executeCommand } from './commandExecutor.js';
import { ToolExecutionContext } from '../execution.js';

export type AntigravityTier = 'fast' | 'balanced' | 'powerful';

export interface AntigravityTierGroup {
  tier: AntigravityTier;
  label: string;
  models: string[];
  useWhen: string;
}

let cachedModelsOutput: string | undefined;

const TIER_LABELS: Record<AntigravityTier, { label: string; useWhen: string }> = {
  fast: {
    label: 'Fast',
    useWhen: 'Only for trivial lookups, simple math, quick one-line answers, or latency-sensitive checks.',
  },
  balanced: {
    label: 'Balanced (DEFAULT)',
    useWhen: 'Most coding, analysis, debugging, and multi-step work. Use this by default.',
  },
  powerful: {
    label: 'Powerful',
    useWhen: 'Complex reasoning, architecture, large codebase analysis, or when quality matters most.',
  },
};

export function clearAntigravityModelCache(): void {
  cachedModelsOutput = undefined;
}

export function parseAntigravityModels(raw: string): string[] {
  const found = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*•]\s*/, '');
    if (!trimmed) continue;
    if (/^(id|name|model|models|available|recommended|tier|provider)(\s|:|$)/i.test(trimmed)) continue;
    if (/\s/.test(trimmed) && /\b(gemini|claude|gpt|oss)\b/i.test(trimmed)) {
      found.add(trimmed);
      continue;
    }

    const candidates = trimmed.match(/[A-Za-z0-9][A-Za-z0-9._/-]*(?:gemini|claude|gpt|models\/)[A-Za-z0-9._/-]*/gi)
      ?? trimmed.match(/[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]/g)
      ?? [];
    let acceptedLineCandidate = false;

    for (const candidate of candidates) {
      const cleaned = candidate
        .replace(/^models\//, '')
        .replace(/[,:;)\]}]+$/, '');

      if (
        cleaned.length > 2 &&
        !/^(id|name|model|models|available|recommended|tier|provider)$/i.test(cleaned) &&
        /[-/.]/.test(cleaned)
      ) {
        found.add(cleaned);
        acceptedLineCandidate = true;
      }
    }

    if (!acceptedLineCandidate) {
      found.add(trimmed);
    }
  }

  return [...found].sort();
}

export function classifyAntigravityModel(modelId: string): AntigravityTier {
  const lower = modelId.toLowerCase();
  const segments = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));

  if (['lite', 'flash', 'small', 'mini', 'nano'].some((part) => segments.has(part))) {
    return 'fast';
  }

  if (['pro', 'opus', 'max', 'ultra'].some((part) => segments.has(part))) {
    return 'powerful';
  }

  return 'balanced';
}

export function formatAntigravityCatalog(raw: string, deprecatedAlias = false): string {
  const models = parseAntigravityModels(raw);
  const buckets: Record<AntigravityTier, string[]> = {
    fast: [],
    balanced: [],
    powerful: [],
  };

  for (const model of models) {
    buckets[classifyAntigravityModel(model)].push(model);
  }

  const lines: string[] = [];
  if (deprecatedAlias) {
    lines.push('DEPRECATION: List-Gemini-Models is a compatibility alias. Antigravity via `agy` is the Google backend. Use List-Antigravity-Models and Ask-Antigravity for new workflows.\n');
  }

  lines.push('ANTIGRAVITY — Available Models\n');
  lines.push('MODEL SELECTION RULE: Pass the exact model name returned by `agy models`. Default to the balanced tier for most tasks; use powerful for complex reasoning; reserve fast for trivial or latency-sensitive work.\n');

  if (models.length === 0) {
    lines.push('No parseable model IDs were found in `agy models` output. Raw output follows:');
    lines.push(raw.trim() || '(empty output)');
  } else {
    for (const tier of ['fast', 'balanced', 'powerful'] as const) {
      if (buckets[tier].length === 0) continue;
      lines.push(`[${tier.toUpperCase()}] ${TIER_LABELS[tier].label}`);
      lines.push(`  Use when: ${TIER_LABELS[tier].useWhen}`);
      lines.push(`  Model IDs: ${buckets[tier].join(', ')}`);
      lines.push('');
    }
  }

  lines.push('> Antigravity models are discovered at runtime because `agy models` depends on local authentication and account access.');
  return lines.join('\n');
}

function formatModelDiscoveryFailure(error: unknown, cachedOutput?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const signInHint = /sign.?in|login|auth|credential|unauthorized|forbidden/i.test(message)
    ? '\n\nSign in to Antigravity, then rerun List-Antigravity-Models.'
    : '';

  if (cachedOutput) {
    return [
      'Antigravity model discovery failed, so the last successful `agy models` result is shown below.',
      signInHint.trim(),
      '',
      formatAntigravityCatalog(cachedOutput),
      '',
      `Latest discovery error: ${message}`,
    ].filter(Boolean).join('\n');
  }

  return [
    'Antigravity model discovery failed. `agy models` requires Antigravity CLI to be installed and signed in.',
    signInHint.trim(),
    '',
    `Error: ${message}`,
  ].filter(Boolean).join('\n');
}

export async function getAntigravityClassifiedCatalog(
  context?: ToolExecutionContext,
  deprecatedAlias = false,
): Promise<string> {
  try {
    const raw = await executeCommand(
      CLI.COMMANDS.ANTIGRAVITY,
      [CLI.ANTIGRAVITY_SUBCOMMANDS.MODELS],
      context,
    );
    cachedModelsOutput = raw;
    return formatAntigravityCatalog(raw, deprecatedAlias);
  } catch (error) {
    const failure = formatModelDiscoveryFailure(error, cachedModelsOutput);
    if (deprecatedAlias) {
      return `DEPRECATION: List-Gemini-Models is a compatibility alias. Antigravity via \`agy\` is the Google backend. Use List-Antigravity-Models and Ask-Antigravity for new workflows.\n\n${failure}`;
    }
    return failure;
  }
}
