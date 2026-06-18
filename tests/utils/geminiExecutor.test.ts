import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/commandExecutor.js', () => ({
  executeCommand: vi.fn().mockResolvedValue('mock response'),
}));

vi.mock('../../src/utils/changeModeParser.js', () => ({
  parseChangeModeOutput: vi.fn().mockReturnValue([]),
  validateChangeModeEdits: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock('../../src/utils/changeModeTranslator.js', () => ({
  formatChangeModeResponse: vi.fn().mockReturnValue(''),
  summarizeChangeModeEdits: vi.fn().mockReturnValue(''),
}));

vi.mock('../../src/utils/changeModeChunker.js', () => ({
  chunkChangeModeEdits: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/utils/chunkCache.js', () => ({
  cacheChunks: vi.fn(),
  getChunks: vi.fn(),
}));

import { executeGeminiCLI } from '../../src/utils/geminiExecutor.js';
import { formatAgyPrintTimeout } from '../../src/utils/antigravityExecutor.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';

describe('geminiExecutor compatibility alias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds correct base args with model and prompt', async () => {
    await executeGeminiCLI('explain this code', 'gemini-3.1-pro-preview');

    expect(executeCommand).toHaveBeenCalledWith(
      'agy',
      ['--model', 'gemini-3.1-pro-preview', '--print-timeout', '900s', '--print', 'explain this code'],
      undefined
    );
  });

  it('passes multi-word prompts without executor-level quoting', async () => {
    await executeGeminiCLI('Respond with a brief greeting confirming connectivity', 'gemini-3.1-pro-preview');

    const args = vi.mocked(executeCommand).mock.calls[0][1];
    expect(args.at(-1)).toBe('Respond with a brief greeting confirming connectivity');
  });

  it('passes multiline and @ prompts without executor-level quoting', async () => {
    await executeGeminiCLI('@src/index.ts explain this file\nthen summarize it', 'gemini-3.1-pro-preview');

    const args = vi.mocked(executeCommand).mock.calls[0][1];
    expect(args.at(-1)).toBe('@src/index.ts explain this file\nthen summarize it');
    expect(args.at(-1)).not.toMatch(/^"/);
  });

  it('adds sandbox flag when enabled', async () => {
    await executeGeminiCLI('task', 'gemini-3.1-pro-preview', true);

    const args = vi.mocked(executeCommand).mock.calls[0][1];
    expect(args).toContain('--sandbox');
  });

  it('converts timeoutMs to agy print timeout seconds', async () => {
    await executeGeminiCLI('task', 'gemini-3.1-pro-preview', false, false, { timeoutMs: 65_001 });

    expect(vi.mocked(executeCommand).mock.calls[0][1]).toEqual([
      '--model',
      'gemini-3.1-pro-preview',
      '--print-timeout',
      '66s',
      '--print',
      'task',
    ]);
  });

  it('passes onProgress callback through', async () => {
    const onProgress = vi.fn();
    await executeGeminiCLI('task', 'gemini-3.1-pro-preview', false, false, { onProgress });

    expect(executeCommand).toHaveBeenCalledWith(
      'agy',
      expect.any(Array),
      { onProgress }
    );
  });

  it('formats agy timeout with default fallback', () => {
    expect(formatAgyPrintTimeout()).toBe('900s');
  });
});
