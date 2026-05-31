import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/commandExecutor.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/commandExecutor.js')>(
    '../../src/utils/commandExecutor.js'
  );
  return {
    ...actual,
    executeCommand: vi.fn().mockResolvedValue('codex stdout response'),
  };
});

vi.mock('../../src/utils/codexLauncher.js', () => ({
  resolveCodexNativeBinary: vi.fn().mockReturnValue(null),
  buildCodexLauncherEnv: vi.fn(),
}));

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  askCodexTool,
  MODEL_DESCRIPTION_THRESHOLD,
  buildCodexModelDescription,
} from '../../src/tools/ask-codex.tool.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';
import { getCatalog } from '../../src/modelCatalog.js';

/**
 * R2-a — Ask-Codex model 인자 화이트리스트 validation
 * (plan-review R1-R3 합의, 2026-05-21)
 *
 * 계약:
 *   - 카탈로그 ID 만 통과
 *   - 카탈로그 외 ID 거부 + ValidationError 메시지에 유효 ID 전체 노출
 *   - zodSchema description 에 allowlist auto-sync (LLM 학습 신호)
 *   - description 가드: 정렬/중복/임계치/fail-fast
 */
describe('askCodexTool — model 화이트리스트 validation (R2-a)', () => {
  const codexCatalog = getCatalog('codex');
  const knownIds = codexCatalog.tiers.flatMap((t) => t.models);

  const validBaseArgs = (model: string) => ({
    prompt: 'sample task',
    model,
  });

  describe('수용 케이스', () => {
    it.each(knownIds)('카탈로그 ID "%s" 는 통과한다', (id) => {
      const result = askCodexTool.zodSchema.safeParse(validBaseArgs(id));
      expect(result.success).toBe(true);
    });
  });

  describe('거부 케이스 (hallucination 가드)', () => {
    it('약칭 hallucination "gpt-5.3" 은 거부된다 (실측 사례)', () => {
      const result = askCodexTool.zodSchema.safeParse(validBaseArgs('gpt-5.3'));
      expect(result.success).toBe(false);
    });

    it('완전 가상 ID "gpt-5.5-medium" 은 거부된다 (PoC #0 케이스)', () => {
      const result = askCodexTool.zodSchema.safeParse(
        validBaseArgs('gpt-5.5-medium'),
      );
      expect(result.success).toBe(false);
    });

    it('빈 ID 와는 다른 거부 사유 (min(1) vs 화이트리스트)', () => {
      const empty = askCodexTool.zodSchema.safeParse(validBaseArgs(''));
      const unknown = askCodexTool.zodSchema.safeParse(
        validBaseArgs('gpt-5.3'),
      );
      expect(empty.success).toBe(false);
      expect(unknown.success).toBe(false);
    });

    it('거부 시 에러 메시지에 유효 ID 전체 목록이 노출된다', () => {
      const result = askCodexTool.zodSchema.safeParse(
        validBaseArgs('gpt-5.3'),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = result.error.issues
          .map((i) => i.message)
          .join(' | ');
        for (const id of knownIds) {
          expect(message).toContain(id);
        }
      }
    });
  });

  describe('description allowlist auto-sync (F-03 수용)', () => {
    it('schema description 에 카탈로그 모든 ID 가 포함된다 (임계치 이하)', () => {
      // 현재 카탈로그 4종 < MODEL_DESCRIPTION_THRESHOLD(10)
      expect(knownIds.length).toBeLessThanOrEqual(MODEL_DESCRIPTION_THRESHOLD);
      const modelField = askCodexTool.zodSchema.shape.model;
      const description = modelField.description ?? '';
      for (const id of knownIds) {
        expect(description).toContain(id);
      }
    });
  });

  describe('description 가드 (F-06 수용)', () => {
    it('buildCodexModelDescription — 임계치 이하: 전체 ID 노출', () => {
      const ids = ['gpt-5.4-mini', 'gpt-5.2', 'gpt-5.3-codex', 'gpt-5.4'];
      const desc = buildCodexModelDescription(ids);
      for (const id of ids) {
        expect(desc).toContain(id);
      }
    });

    it('buildCodexModelDescription — 임계치 초과: 요약형 + List-Codex-Models 안내', () => {
      const ids = Array.from(
        { length: MODEL_DESCRIPTION_THRESHOLD + 5 },
        (_, i) => `gpt-fake-${i}`,
      );
      const desc = buildCodexModelDescription(ids);
      expect(desc).toContain('List-Codex-Models');
      // 요약형은 전체 ID 가 아니라 일부만 노출
      expect(desc.length).toBeLessThan(ids.join(', ').length + 200);
    });

    it('buildCodexModelDescription — ID 정렬 + 중복 제거 (결정적 순서)', () => {
      const ids = ['gpt-5.4', 'gpt-5.2', 'gpt-5.4', 'gpt-5.3-codex'];
      const desc = buildCodexModelDescription(ids);
      const sorted = [...new Set(ids)].sort();
      // 정렬 순서대로 등장하는지 확인
      let lastIndex = -1;
      for (const id of sorted) {
        const idx = desc.indexOf(id);
        expect(idx).toBeGreaterThan(lastIndex);
        lastIndex = idx;
      }
    });

    it('buildCodexModelDescription — 빈 카탈로그 시 fail-fast (throw)', () => {
      expect(() => buildCodexModelDescription([])).toThrow();
    });
  });

  describe('상수화 (F-06 + 구현 주의 1)', () => {
    it('MODEL_DESCRIPTION_THRESHOLD 는 상수로 노출된다 (drift 방지)', () => {
      expect(typeof MODEL_DESCRIPTION_THRESHOLD).toBe('number');
      expect(MODEL_DESCRIPTION_THRESHOLD).toBeGreaterThan(0);
    });
  });
});

/**
 * R3 — Ask-Codex 통합 E2E (plan-review R1-R3 합의, 2026-05-21)
 *
 * 시나리오: 잘못된 model ID 가 codex CLI 까지 도달하지 않고 차단되는 핵심 경로.
 * R2-a (schema validation) 와 R2-b (executor ERROR detection) 가 결합된 검증.
 */
describe('Ask-Codex 통합 E2E — model validation 차단 (R3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('카탈로그 외 model ID 호출 시 zodSchema 가 거부하므로 executeCommand 는 호출되지 않는다', () => {
    const result = askCodexTool.zodSchema.safeParse({
      prompt: 'task',
      model: 'gpt-5.3', // 약칭 hallucination — 카탈로그 외
    });

    expect(result.success).toBe(false);
    expect(vi.mocked(executeCommand)).not.toHaveBeenCalled();
  });

  it('카탈로그 ID 는 schema 통과 + execute 진입 후 codex CLI 가 호출된다', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce('codex done normally');

    const parseResult = askCodexTool.zodSchema.safeParse({
      prompt: 'task',
      model: 'gpt-5.4',
    });
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const response = await askCodexTool.execute(parseResult.data, undefined as never);
      expect(response).toContain('codex done normally');
      expect(vi.mocked(executeCommand)).toHaveBeenCalledTimes(1);
    }
  });

  it('카탈로그 ID 호출 중 codex 가 ERROR JSON 반환하면 execute 가 CodexInvocationError throw (R2-b 연동)', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce(
      'ERROR: {"type":"error","error":{"type":"invalid_request_error","message":"some failure"}}',
    );

    const parseResult = askCodexTool.zodSchema.safeParse({
      prompt: 'task',
      model: 'gpt-5.4',
    });
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const { CodexInvocationError } = await import('../../src/utils/codexExecutor.js');
      await expect(
        askCodexTool.execute(parseResult.data, undefined as never),
      ).rejects.toBeInstanceOf(CodexInvocationError);
    }
  });
});

/**
 * Markdown preload wiring — multicli reads .md references itself and inlines
 * them so codex never has to read from disk (codex 0.135.0 Windows sandbox bug).
 */
describe('Ask-Codex — Markdown preload wiring (Windows)', () => {
  const ORIGINAL_PLATFORM = process.platform;
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '');
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_PRELOAD', '');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    root = mkdtempSync(path.join(os.tmpdir(), 'multicli-tool-preload-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
    rmSync(root, { recursive: true, force: true });
  });

  it('inlines a referenced .md file into the prompt sent to codex', async () => {
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'foo.md'), 'PRELOADED-BODY', 'utf8');
    vi.mocked(executeCommand).mockResolvedValueOnce('ok');

    await askCodexTool.execute(
      { prompt: 'review docs/foo.md', model: 'gpt-5.4' },
      { cwd: root } as never,
    );

    expect(executeCommand).toHaveBeenCalledTimes(1);
    const codexArgs = vi.mocked(executeCommand).mock.calls[0][1] as string[];
    const promptArg = codexArgs[1];
    expect(promptArg).toContain('PRELOADED-BODY');
    expect(promptArg).toContain('multicli-preloaded-files');
  });

  it('does not call codex when preload hard-fails (oversize file)', async () => {
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'big.md'), 'x'.repeat(200 * 1024 + 1), 'utf8');
    vi.mocked(executeCommand).mockResolvedValue('should-not-run');

    const { FilePreloadError } = await import('../../src/utils/codexFilePreloader.js');
    await expect(
      askCodexTool.execute({ prompt: 'review docs/big.md', model: 'gpt-5.4' }, { cwd: root } as never),
    ).rejects.toBeInstanceOf(FilePreloadError);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
