import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '../../src/utils/commandExecutor.js';

vi.mock('../../src/utils/commandExecutor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/commandExecutor.js')>();
  return {
    ...actual,
    executeCommand: vi.fn(),
  };
});

import {
  classifyAntigravityModel,
  clearAntigravityModelCache,
  formatAntigravityCatalog,
  getAntigravityClassifiedCatalog,
  parseAntigravityModels,
} from '../../src/utils/antigravityCatalog.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';

describe('antigravityCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAntigravityModelCache();
  });

  it('parses model names from agy models output', () => {
    const raw = `
Available models:
  gemini-3.1-flash-lite-preview
  gemini-3.1-pro-preview
  google/gemini-3-balanced
  Gemini 3.5 Flash (Medium)
`;

    expect(parseAntigravityModels(raw)).toEqual([
      'Gemini 3.5 Flash (Medium)',
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-pro-preview',
      'google/gemini-3-balanced',
    ]);
  });

  it('classifies tiers heuristically', () => {
    expect(classifyAntigravityModel('gemini-3.1-flash-lite-preview')).toBe('fast');
    expect(classifyAntigravityModel('gemini-3.1-pro-preview')).toBe('powerful');
    expect(classifyAntigravityModel('Gemini 3.5 Flash (Medium)')).toBe('fast');
    expect(classifyAntigravityModel('google/gemini-3-balanced')).toBe('balanced');
  });

  it('formats catalog with exact model guidance', () => {
    const formatted = formatAntigravityCatalog('gemini-3.1-flash-lite-preview\ngemini-3.1-pro-preview');

    expect(formatted).toContain('ANTIGRAVITY — Available Models');
    expect(formatted).toContain('Pass the exact model name returned by `agy models`');
    expect(formatted).toContain('[FAST]');
    expect(formatted).toContain('[POWERFUL]');
  });

  it('runs agy models and caches successful output', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce('gemini-3.1-pro-preview');

    const result = await getAntigravityClassifiedCatalog();

    expect(executeCommand).toHaveBeenCalledWith('agy', ['models'], undefined);
    expect(result).toContain('gemini-3.1-pro-preview');
  });

  it('falls back to cached output when discovery fails later', async () => {
    vi.mocked(executeCommand)
      .mockResolvedValueOnce('gemini-3.1-pro-preview')
      .mockRejectedValueOnce(new Error('network down'));

    await getAntigravityClassifiedCatalog();
    const result = await getAntigravityClassifiedCatalog();

    expect(result).toContain('last successful `agy models` result');
    expect(result).toContain('gemini-3.1-pro-preview');
    expect(result).toContain('network down');
  });

  it('includes sign-in guidance when discovery fails without cache', async () => {
    vi.mocked(executeCommand).mockRejectedValueOnce(
      new CommandExecutionError('failed', 'Command failed with exit code 1: please sign in', {
        command: 'agy',
        args: ['models'],
        stderr: 'please sign in',
      }),
    );

    const result = await getAntigravityClassifiedCatalog();

    expect(result).toContain('requires Antigravity CLI to be installed and signed in');
    expect(result).toContain('Sign in to Antigravity');
  });

  it('adds deprecation banner for Gemini model alias', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce('gemini-3.1-pro-preview');

    const result = await getAntigravityClassifiedCatalog(undefined, true);

    expect(result).toContain('DEPRECATION: List-Gemini-Models is a compatibility alias');
    expect(result).toContain('gemini-3.1-pro-preview');
  });
});
