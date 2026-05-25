import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/commandExecutor.js', () => ({
  executeCommand: vi.fn().mockResolvedValue('mock grok response'),
}));

import { executeGrokCLI } from '../../src/utils/grokExecutor.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';

describe('grokExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls grok with headless prompt flag', async () => {
    const result = await executeGrokCLI('explain this code');

    expect(executeCommand).toHaveBeenCalledWith(
      'grok',
      ['-p', 'explain this code'],
      undefined,
    );
    expect(result).toBe('mock grok response');
  });

  it('passes onProgress callback through', async () => {
    const onProgress = vi.fn();
    await executeGrokCLI('test prompt', { onProgress });

    expect(executeCommand).toHaveBeenCalledWith(
      'grok',
      ['-p', 'test prompt'],
      { onProgress },
    );
  });
});
