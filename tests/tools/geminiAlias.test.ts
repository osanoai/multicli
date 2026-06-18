import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/geminiExecutor.js', () => ({
  executeGeminiCLI: vi.fn().mockResolvedValue('alias response'),
  processChangeModeOutput: vi.fn(),
}));

import { askGeminiTool } from '../../src/tools/ask-gemini.tool.js';
import { executeGeminiCLI } from '../../src/utils/geminiExecutor.js';

describe('Ask-Gemini alias tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeGeminiCLI).mockResolvedValue('alias response');
  });

  it('executes through Antigravity and returns a deprecation banner', async () => {
    const result = await askGeminiTool.execute({
      prompt: 'hello',
      model: 'gemini-3.1-pro-preview',
      sandbox: true,
    });

    expect(executeGeminiCLI).toHaveBeenCalledWith(
      'hello',
      'gemini-3.1-pro-preview',
      true,
      false,
      undefined,
    );
    expect(result).toContain('DEPRECATION: Ask-Gemini is a compatibility alias');
    expect(result).toContain('Antigravity response:');
    expect(result).toContain('alias response');
  });
});
