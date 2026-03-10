import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/commandExecutor.js', () => ({
  executeCommand: vi.fn(),
}));

import { executeOpencodeCLI } from '../../src/utils/opencodeExecutor.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';

describe('opencodeExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls opencode run with prompt and model', async () => {
    vi.mocked(executeCommand).mockResolvedValue('response text');

    const result = await executeOpencodeCLI('explain this code', 'google-vertex/gemini-2.5-flash');

    expect(executeCommand).toHaveBeenCalledWith(
      'opencode',
      ['run', 'explain this code', '-m', 'google-vertex/gemini-2.5-flash'],
      undefined,
    );
    expect(result).toBe('response text');
  });

  it('passes onProgress callback through', async () => {
    vi.mocked(executeCommand).mockResolvedValue('done');
    const onProgress = vi.fn();

    await executeOpencodeCLI('test prompt', 'opencode/gpt-5-nano', onProgress);

    expect(executeCommand).toHaveBeenCalledWith(
      'opencode',
      ['run', 'test prompt', '-m', 'opencode/gpt-5-nano'],
      onProgress,
    );
  });

  it('propagates errors from executeCommand', async () => {
    vi.mocked(executeCommand).mockRejectedValue(new Error('Command failed with exit code 1: model not found'));

    await expect(
      executeOpencodeCLI('test', 'invalid/model'),
    ).rejects.toThrow('Command failed with exit code 1: model not found');
  });
});
