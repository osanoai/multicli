import { describe, it, expect } from 'vitest';
import { getCatalog, formatCatalog } from '../src/modelCatalog.js';
import { TIER_CONFIG, CLI_NOTES } from '../src/tierConfig.js';

// ===========================================================================
// getCatalog
// ===========================================================================

describe('getCatalog', () => {
  const clis = ['gemini', 'codex', 'claude'] as const;

  it.each(clis)('should return a catalog with cli, tiers, and note for "%s"', (cli) => {
    const catalog = getCatalog(cli);

    expect(catalog).toBeDefined();
    expect(catalog.cli).toBe(cli);
    expect(catalog).toHaveProperty('tiers');
    expect(catalog).toHaveProperty('note');
    expect(typeof catalog.note).toBe('string');
  });

  it.each(clis)('should have exactly 3 tiers for "%s"', (cli) => {
    const catalog = getCatalog(cli);
    expect(catalog.tiers).toHaveLength(3);
  });

  it.each(clis)('should have tiers in order fast, balanced, powerful for "%s"', (cli) => {
    const catalog = getCatalog(cli);
    const tierNames = catalog.tiers.map(t => t.tier);
    expect(tierNames).toEqual(['fast', 'balanced', 'powerful']);
  });

  it.each(clis)('should have at least one model ID in every tier for "%s"', (cli) => {
    const catalog = getCatalog(cli);
    for (const tier of catalog.tiers) {
      expect(tier.models.length).toBeGreaterThanOrEqual(1);
      for (const model of tier.models) {
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
      }
    }
  });

  it.each(clis)('should have non-empty useWhen for every tier in "%s"', (cli) => {
    const catalog = getCatalog(cli);
    for (const tier of catalog.tiers) {
      expect(tier.useWhen).toBeTruthy();
      expect(tier.useWhen.length).toBeGreaterThan(0);
    }
  });

  it.each(clis)('should include "DEFAULT" in the balanced tier label for "%s"', (cli) => {
    const catalog = getCatalog(cli);
    const balancedTier = catalog.tiers.find(t => t.tier === 'balanced');
    expect(balancedTier).toBeDefined();
    expect(balancedTier!.label).toContain('DEFAULT');
  });
});

// ===========================================================================
// formatCatalog
// ===========================================================================

describe('formatCatalog', () => {
  const clis = ['gemini', 'codex', 'claude'] as const;

  it.each(clis)('should include all model IDs from the catalog for "%s"', (cli) => {
    const catalog = getCatalog(cli);
    const formatted = formatCatalog(cli);

    for (const tier of catalog.tiers) {
      for (const modelId of tier.models) {
        expect(formatted).toContain(modelId);
      }
    }
  });

  it.each(clis)('should include "MODEL SELECTION RULE" text for "%s"', (cli) => {
    const formatted = formatCatalog(cli);
    expect(formatted).toContain('MODEL SELECTION RULE');
  });

  it.each(clis)('should include tier labels [FAST], [BALANCED], [POWERFUL] for "%s"', (cli) => {
    const formatted = formatCatalog(cli);
    expect(formatted).toContain('[FAST]');
    expect(formatted).toContain('[BALANCED]');
    expect(formatted).toContain('[POWERFUL]');
  });

  it.each(clis)('should include version-based selection guidance for "%s"', (cli) => {
    const formatted = formatCatalog(cli);
    expect(formatted).toContain('highest version number');
  });
});

// ===========================================================================
// tierConfig
// ===========================================================================

// ===========================================================================
// codex catalog drift detect (R1 — plan-review 합의 2026-05-21)
//
// 본 snapshot 은 generator (npm run refresh-catalog) 출력의 stable baseline.
// codex CLI 가 신규 모델을 노출하면 generator 가 새 ID 를 추가하여 이 assert
// 가 fail 한다. fail 시 절차:
//   1. AGENTS.md "Model Catalog Maintenance" 절 6단계 체크리스트 수행
//   2. PR 본문에 신규 모델 ID 풀 명시 + 본 snapshot 갱신
//
// 누락 케이스(예: gpt-5.5 가 openai/codex models.json 에 있는데
// `npm run refresh-catalog` PROBE 단계에서 ChatGPT 계정 비호환으로 reject)도
// 본 snapshot 으로 발견 가능 — 신규 ID 가 들어오면 fail.
// ===========================================================================

describe('codex catalog drift detect (R1)', () => {
  it('codex 모델 풀이 4종 stable baseline 과 일치한다', () => {
    const catalog = getCatalog('codex');
    const allModels = catalog.tiers.flatMap(t => t.models).sort();
    expect(allModels).toEqual([
      'gpt-5.2',
      'gpt-5.3-codex',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
  });

  it('codex tier 분배가 stable baseline 과 일치한다', () => {
    const catalog = getCatalog('codex');
    const tierMap = Object.fromEntries(
      catalog.tiers.map(t => [t.tier, [...t.models].sort()])
    );
    expect(tierMap).toEqual({
      fast: ['gpt-5.4-mini'],
      balanced: ['gpt-5.2', 'gpt-5.3-codex'],
      powerful: ['gpt-5.4'],
    });
  });
});

describe('tierConfig', () => {
  const clis = ['claude', 'gemini', 'codex'] as const;
  const tiers = ['fast', 'balanced', 'powerful'] as const;

  it.each(clis)('should have config for all three tiers for "%s"', (cli) => {
    for (const tier of tiers) {
      const config = TIER_CONFIG[cli][tier];
      expect(config).toBeDefined();
      expect(config.label).toBeTruthy();
      expect(config.useWhen).toBeTruthy();
    }
  });

  it.each(clis)('should have a note for "%s"', (cli) => {
    expect(CLI_NOTES[cli]).toBeTruthy();
    expect(typeof CLI_NOTES[cli]).toBe('string');
  });

  it.each(clis)('should have "DEFAULT" in the balanced tier label for "%s"', (cli) => {
    expect(TIER_CONFIG[cli].balanced.label).toContain('DEFAULT');
  });

  it('tierConfig labels should match catalog labels', () => {
    for (const cli of clis) {
      const catalog = getCatalog(cli);
      for (const tier of catalog.tiers) {
        const tierName = tier.tier as typeof tiers[number];
        expect(tier.label).toBe(TIER_CONFIG[cli][tierName].label);
        expect(tier.useWhen).toBe(TIER_CONFIG[cli][tierName].useWhen);
      }
    }
  });
});
