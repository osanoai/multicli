import { describe, it, expect, vi } from 'vitest';
import {
  heuristicTier,
  validateEnrichment,
  assignTiers,
  buildEnrichmentPrompt,
  pickEnrichmentModel,
  probeModels,
} from '../scripts/refresh-catalog.js';
import type { EnrichmentEntry } from '../scripts/refresh-catalog.js';

// ===========================================================================
// heuristicTier
// ===========================================================================

describe('heuristicTier', () => {
  describe('fast tier', () => {
    it('classifies haiku as fast', () => {
      expect(heuristicTier('claude-haiku-4-5-20251001', 'claude')).toBe('fast');
    });

    it('classifies mini as fast', () => {
      expect(heuristicTier('gpt-5.1-codex-mini', 'codex')).toBe('fast');
    });

    it('classifies lite as fast', () => {
      expect(heuristicTier('gemini-2.5-flash-lite', 'gemini')).toBe('fast');
    });

    it('classifies flash (without preview) as fast for gemini', () => {
      expect(heuristicTier('gemini-2.5-flash', 'gemini')).toBe('fast');
    });
  });

  describe('balanced tier', () => {
    it('classifies sonnet as balanced for claude', () => {
      expect(heuristicTier('claude-sonnet-4-6', 'claude')).toBe('balanced');
    });

    it('classifies flash-preview as balanced for gemini', () => {
      expect(heuristicTier('gemini-3-flash-preview', 'gemini')).toBe('balanced');
    });

    it('classifies codex (no mini/max suffix) as balanced', () => {
      expect(heuristicTier('gpt-5.2-codex', 'codex')).toBe('balanced');
    });

    it('defaults unknown models to balanced', () => {
      expect(heuristicTier('claude-mystery-9000', 'claude')).toBe('balanced');
    });
  });

  describe('powerful tier', () => {
    it('classifies opus as powerful', () => {
      expect(heuristicTier('claude-opus-4-6', 'claude')).toBe('powerful');
    });

    it('classifies pro as powerful', () => {
      expect(heuristicTier('gemini-2.5-pro', 'gemini')).toBe('powerful');
      expect(heuristicTier('gemini-3.1-pro-preview', 'gemini')).toBe('powerful');
    });

    it('classifies max as powerful', () => {
      expect(heuristicTier('gpt-5.1-codex-max', 'codex')).toBe('powerful');
    });

    it('classifies plain gpt (without codex suffix) as powerful', () => {
      expect(heuristicTier('gpt-5.2', 'codex')).toBe('powerful');
    });
  });
});

// ===========================================================================
// validateEnrichment
// ===========================================================================

describe('validateEnrichment', () => {
  const knownIds = ['model-a', 'model-b', 'model-c'];

  function makeResponse(models: object[]): string {
    return JSON.stringify({ models });
  }

  it('accepts valid enrichment with all known IDs', () => {
    const raw = makeResponse([
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'fast one' },
      { id: 'model-b', tier: 'balanced', displayName: 'B', description: 'mid one' },
      { id: 'model-c', tier: 'powerful', displayName: 'C', description: 'big one' },
    ]);
    const result = validateEnrichment(raw, 'test', knownIds);
    expect(result).toHaveLength(3);
    expect(result!.map((e) => e.id)).toEqual(['model-a', 'model-b', 'model-c']);
  });

  it('rejects invented model IDs while keeping valid ones', () => {
    const raw = makeResponse([
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'fast' },
      { id: 'model-FAKE', tier: 'balanced', displayName: 'Fake', description: 'made up' },
      { id: 'model-c', tier: 'powerful', displayName: 'C', description: 'big' },
    ]);
    const result = validateEnrichment(raw, 'test', knownIds);
    expect(result).toHaveLength(2);
    expect(result!.map((e) => e.id)).toEqual(['model-a', 'model-c']);
  });

  it('rejects when all models in same tier (3+ models)', () => {
    const raw = makeResponse([
      { id: 'model-a', tier: 'balanced', displayName: 'A', description: 'd' },
      { id: 'model-b', tier: 'balanced', displayName: 'B', description: 'd' },
      { id: 'model-c', tier: 'balanced', displayName: 'C', description: 'd' },
    ]);
    expect(validateEnrichment(raw, 'test', knownIds)).toBeNull();
  });

  it('allows same tier when fewer than 3 models', () => {
    const twoIds = ['model-a', 'model-b'];
    const raw = makeResponse([
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'd' },
      { id: 'model-b', tier: 'fast', displayName: 'B', description: 'd' },
    ]);
    const result = validateEnrichment(raw, 'test', twoIds);
    expect(result).toHaveLength(2);
  });

  it('rejects when coverage below 50%', () => {
    const fiveIds = ['m1', 'm2', 'm3', 'm4', 'm5'];
    const raw = makeResponse([
      { id: 'm1', tier: 'fast', displayName: 'M1', description: 'd' },
      { id: 'm2', tier: 'balanced', displayName: 'M2', description: 'd' },
    ]);
    expect(validateEnrichment(raw, 'test', fiveIds)).toBeNull();
  });

  it('strips markdown code fences', () => {
    const inner = makeResponse([
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'f' },
      { id: 'model-b', tier: 'powerful', displayName: 'B', description: 'p' },
    ]);
    const raw = '```json\n' + inner + '\n```';
    expect(validateEnrichment(raw, 'test', ['model-a', 'model-b'])).toHaveLength(2);
  });

  it('returns null for non-JSON', () => {
    expect(validateEnrichment('not json at all', 'test', knownIds)).toBeNull();
  });

  it('returns null for empty models array', () => {
    expect(validateEnrichment('{"models":[]}', 'test', knownIds)).toBeNull();
  });

  it('skips entries with invalid tier values', () => {
    const raw = makeResponse([
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'd' },
      { id: 'model-b', tier: 'INVALID', displayName: 'B', description: 'd' },
      { id: 'model-c', tier: 'powerful', displayName: 'C', description: 'd' },
    ]);
    const result = validateEnrichment(raw, 'test', knownIds);
    expect(result).toHaveLength(2);
  });

  it('skips entries with missing fields', () => {
    const raw = makeResponse([
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'd' },
      { id: 'model-b', tier: 'balanced' }, // missing displayName, description
      { id: 'model-c', tier: 'powerful', displayName: 'C', description: 'd' },
    ]);
    const result = validateEnrichment(raw, 'test', knownIds);
    expect(result).toHaveLength(2);
  });
});

// ===========================================================================
// assignTiers
// ===========================================================================

describe('assignTiers', () => {
  it('uses enrichment when available', () => {
    const ids = ['model-a', 'model-b'];
    const enrichment: EnrichmentEntry[] = [
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'f' },
      { id: 'model-b', tier: 'powerful', displayName: 'B', description: 'p' },
    ];
    const result = assignTiers(ids, enrichment, null, 'test');
    expect(result.cli).toBe('test');
    expect(result.tiers).toHaveLength(2);
    expect(result.tiers[0]).toEqual({ tier: 'fast', models: ['model-a'] });
    expect(result.tiers[1]).toEqual({ tier: 'powerful', models: ['model-b'] });
  });

  it('falls back to previous catalog for unenriched models', () => {
    const ids = ['model-a', 'model-b'];
    const enrichment: EnrichmentEntry[] = [
      { id: 'model-a', tier: 'fast', displayName: 'A', description: 'f' },
    ];
    const previous = {
      cli: 'test',
      tiers: [{ tier: 'powerful' as const, models: ['model-b'] }],
    };
    const result = assignTiers(ids, enrichment, previous, 'test');
    expect(result.tiers.find((t) => t.tier === 'fast')?.models).toContain('model-a');
    expect(result.tiers.find((t) => t.tier === 'powerful')?.models).toContain('model-b');
  });

  it('falls back to heuristic for completely new models', () => {
    const ids = ['claude-haiku-99'];
    const result = assignTiers(ids, null, null, 'claude');
    expect(result.tiers).toHaveLength(1);
    expect(result.tiers[0]).toEqual({ tier: 'fast', models: ['claude-haiku-99'] });
  });

  it('returns empty tiers for empty model list', () => {
    const result = assignTiers([], null, null, 'test');
    expect(result.tiers).toHaveLength(0);
  });

  it('preserves tier order (fast, balanced, powerful)', () => {
    const ids = ['claude-opus-1', 'claude-haiku-1', 'claude-sonnet-1'];
    const result = assignTiers(ids, null, null, 'claude');
    const tierNames = result.tiers.map((t) => t.tier);
    expect(tierNames).toEqual(['fast', 'balanced', 'powerful']);
  });

  it('omits empty tiers', () => {
    const ids = ['claude-haiku-1', 'claude-opus-1'];
    const result = assignTiers(ids, null, null, 'claude');
    expect(result.tiers).toHaveLength(2);
    expect(result.tiers.map((t) => t.tier)).toEqual(['fast', 'powerful']);
  });

  it('enrichment takes priority over previous catalog', () => {
    const ids = ['model-a'];
    const enrichment: EnrichmentEntry[] = [
      { id: 'model-a', tier: 'powerful', displayName: 'A', description: 'p' },
    ];
    const previous = {
      cli: 'test',
      tiers: [{ tier: 'fast' as const, models: ['model-a'] }],
    };
    const result = assignTiers(ids, enrichment, previous, 'test');
    expect(result.tiers[0]).toEqual({ tier: 'powerful', models: ['model-a'] });
  });
});

// ===========================================================================
// buildEnrichmentPrompt
// ===========================================================================

describe('buildEnrichmentPrompt', () => {
  it('includes the CLI name', () => {
    const prompt = buildEnrichmentPrompt('claude', ['claude-opus-4-6']);
    expect(prompt).toContain('claude');
  });

  it('includes all model IDs', () => {
    const ids = ['model-a', 'model-b', 'model-c'];
    const prompt = buildEnrichmentPrompt('test', ids);
    for (const id of ids) {
      expect(prompt).toContain(id);
    }
  });

  it('includes tier classification instructions', () => {
    const prompt = buildEnrichmentPrompt('test', ['m1']);
    expect(prompt).toContain('fast');
    expect(prompt).toContain('balanced');
    expect(prompt).toContain('powerful');
  });
});

// ===========================================================================
// pickEnrichmentModel
// ===========================================================================

describe('pickEnrichmentModel', () => {
  it('picks haiku for claude', () => {
    const ids = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
    expect(pickEnrichmentModel(ids, /haiku/i)).toBe('claude-haiku-4-5-20251001');
  });

  it('picks flash (non-preview) for gemini', () => {
    const ids = ['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    expect(pickEnrichmentModel(ids, /flash(?!.*preview)/i)).toBe('gemini-2.5-flash');
  });

  it('picks mini for codex', () => {
    const ids = ['gpt-5.2-codex', 'gpt-5.1-codex-mini', 'gpt-5.3-codex'];
    expect(pickEnrichmentModel(ids, /mini/i)).toBe('gpt-5.1-codex-mini');
  });

  it('falls back to first model if no pattern match', () => {
    const ids = ['unknown-model-a', 'unknown-model-b'];
    expect(pickEnrichmentModel(ids, /haiku/i)).toBe('unknown-model-a');
  });

  it('handles future model names gracefully', () => {
    const ids = ['claude-haiku-99-turbo', 'claude-opus-99'];
    expect(pickEnrichmentModel(ids, /haiku/i)).toBe('claude-haiku-99-turbo');
  });
});

// ===========================================================================
// probeModels
// ===========================================================================

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
    execFileSync: actual.execFileSync,
  };
});

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

describe('probeModels', () => {
  const fakeConfig = {
    name: 'test',
    expectedPrefix: 'model-',
    extractScript: 'scripts/extract-test.sh',
    fastModelPattern: /mini/i,
    buildEnrichmentCommand: (model: string, prompt: string) =>
      `test-cli -m ${model} '${prompt}'`,
  };

  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns all models when all probes succeed', () => {
    mockExecSync.mockReturnValue('OK');
    const result = probeModels(fakeConfig, ['model-a', 'model-b', 'model-c']);
    expect(result).toEqual(['model-a', 'model-b', 'model-c']);
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });

  it('filters out models that fail probing with non-transient errors', () => {
    mockExecSync
      .mockReturnValueOnce('OK')           // model-a: success
      .mockImplementationOnce(() => { throw new Error('model not found'); }) // model-b: fail (no retry)
      .mockReturnValueOnce('OK');           // model-c: success
    const result = probeModels(fakeConfig, ['model-a', 'model-b', 'model-c']);
    expect(result).toEqual(['model-a', 'model-c']);
    // model-b should only be attempted once (non-transient error)
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });

  it('retries on transient errors and succeeds', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('spawnSync /bin/sh ETIMEDOUT'); }) // attempt 1: timeout
      .mockImplementationOnce(() => { throw new Error('socket hang up'); })              // attempt 2: network
      .mockReturnValueOnce('OK');                                                         // attempt 3: success
    const result = probeModels(fakeConfig, ['model-a']);
    expect(result).toEqual(['model-a']);
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });

  it('gives up after max retries on persistent transient errors', () => {
    mockExecSync.mockImplementation(() => { throw new Error('spawnSync /bin/sh ETIMEDOUT'); });
    const result = probeModels(fakeConfig, ['model-a']);
    expect(result).toEqual([]);
    expect(mockExecSync).toHaveBeenCalledTimes(3); // 3 attempts then give up
  });

  it('returns empty array when all probes fail', () => {
    mockExecSync.mockImplementation(() => { throw new Error('fail'); });
    const result = probeModels(fakeConfig, ['model-a', 'model-b']);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const result = probeModels(fakeConfig, []);
    expect(result).toEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('calls buildEnrichmentCommand with trivial probe prompt', () => {
    mockExecSync.mockReturnValue('OK');
    probeModels(fakeConfig, ['model-a']);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('respond with OK'),
      expect.objectContaining({ timeout: 30_000 }),
    );
  });
});
