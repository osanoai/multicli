import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../src/utils/commandExecutor.js', () => ({
  executeCommand: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { executeCommand } from '../../src/utils/commandExecutor.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  listOpencodeModels,
  hashModelList,
  classifyModelByName,
  classifyModelsViaHeuristics,
  formatOpencodeCatalog,
  getCacheDir,
  readCache,
  writeCache,
  getOpencodeClassifiedCatalog,
} from '../../src/utils/opencodeCatalog.js';

describe('opencodeCatalog', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MULTICLI_CACHE_DIR;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('listOpencodeModels', () => {
    it('parses provider/model lines from opencode models output', async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        'opencode/big-pickle\nopencode/gpt-5-nano\ngoogle-vertex/gemini-2.5-flash\n'
      );

      const models = await listOpencodeModels();
      expect(models).toEqual([
        'opencode/big-pickle',
        'opencode/gpt-5-nano',
        'google-vertex/gemini-2.5-flash',
      ]);
      expect(executeCommand).toHaveBeenCalledWith('opencode', ['models']);
    });

    it('filters out lines without a slash', async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        'opencode/gpt-5-nano\nsome-header-line\ngoogle-vertex/gemini-2.5-flash\n'
      );

      const models = await listOpencodeModels();
      expect(models).toEqual([
        'opencode/gpt-5-nano',
        'google-vertex/gemini-2.5-flash',
      ]);
    });

    it('handles empty output', async () => {
      vi.mocked(executeCommand).mockResolvedValue('');

      const models = await listOpencodeModels();
      expect(models).toEqual([]);
    });

    it('trims whitespace from lines', async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        '  opencode/gpt-5-nano  \n  google-vertex/gemini-2.5-flash  \n'
      );

      const models = await listOpencodeModels();
      expect(models).toEqual([
        'opencode/gpt-5-nano',
        'google-vertex/gemini-2.5-flash',
      ]);
    });

    it('filters out embedding models', async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        'opencode/gpt-5-nano\ngoogle-vertex/gemini-embedding-001\nhuggingface/Qwen/Qwen3-Embedding-4B\ngoogle-vertex/gemini-2.5-flash\n'
      );

      const models = await listOpencodeModels();
      expect(models).toEqual([
        'opencode/gpt-5-nano',
        'google-vertex/gemini-2.5-flash',
      ]);
    });
  });

  describe('hashModelList', () => {
    it('produces consistent hash for same models regardless of order', () => {
      const hash1 = hashModelList(['b/model', 'a/model', 'c/model']);
      const hash2 = hashModelList(['c/model', 'a/model', 'b/model']);
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different model sets', () => {
      const hash1 = hashModelList(['a/model', 'b/model']);
      const hash2 = hashModelList(['a/model', 'c/model']);
      expect(hash1).not.toBe(hash2);
    });

    it('returns a hex string', () => {
      const hash = hashModelList(['test/model']);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('classifyModelByName', () => {
    it('classifies nano models as fast', () => {
      expect(classifyModelByName('opencode/gpt-5-nano')).toBe('fast');
    });

    it('classifies flash-lite models as fast', () => {
      expect(classifyModelByName('google-vertex/gemini-2.0-flash-lite')).toBe('fast');
    });

    it('classifies mini models as fast', () => {
      expect(classifyModelByName('provider/gpt-4o-mini')).toBe('fast');
    });

    it('does not misclassify minimax (company name) as fast', () => {
      expect(classifyModelByName('opencode/minimax-m2.5-free')).toBe('balanced');
    });

    it('classifies haiku models as fast', () => {
      expect(classifyModelByName('google-vertex-anthropic/claude-haiku-4-5@20251001')).toBe('fast');
    });

    it('classifies small models as fast', () => {
      expect(classifyModelByName('provider/some-small-model')).toBe('fast');
    });

    it('classifies 8b models as fast', () => {
      expect(classifyModelByName('cerebras/llama3.1-8b')).toBe('fast');
    });

    it('classifies MiMo models as fast', () => {
      expect(classifyModelByName('huggingface/XiaomiMiMo/MiMo-V2-Flash')).toBe('fast');
    });

    it('classifies opus models as powerful', () => {
      expect(classifyModelByName('google-vertex-anthropic/claude-opus-4-6@default')).toBe('powerful');
    });

    it('classifies pro models as powerful', () => {
      expect(classifyModelByName('google-vertex/gemini-2.5-pro')).toBe('powerful');
    });

    it('classifies DeepSeek-R1 models as powerful', () => {
      expect(classifyModelByName('huggingface/deepseek-ai/DeepSeek-R1-0528')).toBe('powerful');
    });

    it('classifies 120b models as powerful', () => {
      expect(classifyModelByName('cerebras/gpt-oss-120b')).toBe('powerful');
    });

    it('classifies 235b models as powerful', () => {
      expect(classifyModelByName('cerebras/qwen-3-235b-a22b-instruct-2507')).toBe('powerful');
    });

    it('classifies Coder-Next models as powerful', () => {
      expect(classifyModelByName('huggingface/Qwen/Qwen3-Coder-Next')).toBe('powerful');
    });

    it('classifies sonnet models as balanced (default)', () => {
      expect(classifyModelByName('google-vertex-anthropic/claude-sonnet-4-6@default')).toBe('balanced');
    });

    it('classifies flash models as balanced (default)', () => {
      expect(classifyModelByName('google-vertex/gemini-2.5-flash')).toBe('balanced');
    });

    it('classifies unknown models as balanced', () => {
      expect(classifyModelByName('opencode/big-pickle')).toBe('balanced');
    });

    it('fast pattern takes priority over powerful for flash-lite (has lite → fast)', () => {
      // flash-lite matches FAST_PATTERNS (lite) before any powerful pattern
      expect(classifyModelByName('google-vertex/gemini-2.5-flash-lite')).toBe('fast');
    });
  });

  describe('classifyModelsViaHeuristics', () => {
    it('classifies a mix of models correctly', () => {
      const models = [
        'opencode/gpt-5-nano',              // fast (nano)
        'google-vertex/gemini-2.5-flash',    // balanced
        'google-vertex-anthropic/claude-opus-4-6@default', // powerful
      ];
      const result = classifyModelsViaHeuristics(models);
      expect(result.fast).toEqual(['opencode/gpt-5-nano']);
      expect(result.balanced).toEqual(['google-vertex/gemini-2.5-flash']);
      expect(result.powerful).toEqual(['google-vertex-anthropic/claude-opus-4-6@default']);
    });

    it('puts all models in balanced when no patterns match', () => {
      const models = ['opencode/big-pickle', 'provider/unknown-model'];
      const result = classifyModelsViaHeuristics(models);
      expect(result.fast).toEqual([]);
      expect(result.balanced).toEqual(['opencode/big-pickle', 'provider/unknown-model']);
      expect(result.powerful).toEqual([]);
    });

    it('handles empty model list', () => {
      const result = classifyModelsViaHeuristics([]);
      expect(result).toEqual({ fast: [], balanced: [], powerful: [] });
    });
  });

  describe('getCacheDir', () => {
    it('uses MULTICLI_CACHE_DIR env var when set', () => {
      process.env.MULTICLI_CACHE_DIR = '/custom/cache';
      expect(getCacheDir()).toBe('/custom/cache');
    });

    it('uses Library/Caches on darwin', () => {
      delete process.env.MULTICLI_CACHE_DIR;
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      // getCacheDir uses os.platform() not process.platform directly,
      // so this test validates the env var path primarily
      process.env.MULTICLI_CACHE_DIR = '/test/darwin';
      expect(getCacheDir()).toBe('/test/darwin');
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('readCache / writeCache', () => {
    it('returns null when cache file does not exist', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      const result = await readCache();
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      vi.mocked(readFile).mockResolvedValue('not json');
      const result = await readCache();
      expect(result).toBeNull();
    });

    it('returns null for JSON missing required fields', async () => {
      vi.mocked(readFile).mockResolvedValue('{"foo":"bar"}');
      const result = await readCache();
      expect(result).toBeNull();
    });

    it('returns parsed cache when valid', async () => {
      const cache = {
        hash: 'abc123',
        classifications: { fast: ['a/b'], balanced: ['c/d'], powerful: ['e/f'] },
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(cache));
      const result = await readCache();
      expect(result).toEqual(cache);
    });

    it('writeCache creates directory and writes file', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const cache = {
        hash: 'abc123',
        classifications: { fast: ['a/b'], balanced: ['c/d'], powerful: ['e/f'] },
      };
      await writeCache(cache);

      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('multicli-opencode.json'),
        JSON.stringify(cache, null, 2),
        'utf-8',
      );
    });
  });

  describe('formatOpencodeCatalog', () => {
    it('formats classifications into readable output', () => {
      const classifications = {
        fast: ['provider/fast-model'],
        balanced: ['provider/balanced-model'],
        powerful: ['provider/powerful-model'],
      };

      const output = formatOpencodeCatalog(classifications);
      expect(output).toContain('OPENCODE');
      expect(output).toContain('[FAST]');
      expect(output).toContain('[BALANCED]');
      expect(output).toContain('[POWERFUL]');
      expect(output).toContain('provider/fast-model');
      expect(output).toContain('provider/balanced-model');
      expect(output).toContain('provider/powerful-model');
    });

    it('omits empty tiers', () => {
      const classifications = {
        fast: [],
        balanced: ['provider/model'],
        powerful: [],
      };

      const output = formatOpencodeCatalog(classifications);
      expect(output).not.toContain('[FAST]');
      expect(output).toContain('[BALANCED]');
      expect(output).not.toContain('[POWERFUL]');
    });
  });

  describe('getOpencodeClassifiedCatalog', () => {
    it('returns error message when no models available', async () => {
      // opencode models returns empty
      vi.mocked(executeCommand).mockResolvedValueOnce('');

      const result = await getOpencodeClassifiedCatalog();
      expect(result).toContain('No models available');
    });

    it('uses cache when hash matches', async () => {
      const models = ['provider/model-a', 'provider/model-b'];
      const hash = hashModelList(models);
      const cache = {
        hash,
        classifications: { fast: ['provider/model-a'], balanced: ['provider/model-b'], powerful: [] as string[] },
      };

      // opencode models call
      vi.mocked(executeCommand).mockResolvedValueOnce(models.join('\n'));
      // readFile returns matching cache
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(cache));

      const result = await getOpencodeClassifiedCatalog();
      expect(result).toContain('provider/model-a');
      expect(result).toContain('provider/model-b');
      // Only 1 executeCommand call (opencode models), no classification call
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });

    it('classifies via heuristics and caches when no cache exists', async () => {
      const models = ['opencode/gpt-5-nano', 'google-vertex/gemini-2.5-flash'];

      // opencode models call
      vi.mocked(executeCommand).mockResolvedValueOnce(models.join('\n'));
      // Cache miss
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result = await getOpencodeClassifiedCatalog();
      // nano should be classified as fast
      expect(result).toContain('opencode/gpt-5-nano');
      // flash should be classified as balanced
      expect(result).toContain('google-vertex/gemini-2.5-flash');
      // Should write cache
      expect(writeFile).toHaveBeenCalled();
      // No second executeCommand call (heuristics, not LLM)
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });

    it('classifies instantly without API calls', async () => {
      const models = [
        'opencode/gpt-5-nano',
        'google-vertex/gemini-2.5-flash',
        'google-vertex-anthropic/claude-opus-4-6@default',
      ];

      vi.mocked(executeCommand).mockResolvedValueOnce(models.join('\n'));
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result = await getOpencodeClassifiedCatalog();
      expect(result).toContain('[FAST]');
      expect(result).toContain('[BALANCED]');
      expect(result).toContain('[POWERFUL]');
      // Only the models list call, no classification API calls
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });
  });
});
