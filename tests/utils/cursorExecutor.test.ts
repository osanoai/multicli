import { describe, it, expect, vi } from 'vitest';
import { executeCursorCLI } from '../../src/utils/cursorExecutor.js';
import { cursorListModelsTool } from '../../src/tools/simple-tools.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';
import { CLI } from '../../src/constants.js';

vi.mock('../../src/utils/commandExecutor.js', () => ({
  executeCommand: vi.fn(),
}));

describe('executeCursorCLI', () => {
  it('calls executeCommand with basic cursor arguments', async () => {
    vi.mocked(executeCommand).mockResolvedValue('success');

    const result = await executeCursorCLI('write a function', 'claude-3.5-sonnet');

    expect(executeCommand).toHaveBeenCalledWith(
      CLI.COMMANDS.CURSOR,
      [
        CLI.CURSOR_FLAGS.PRINT,
        CLI.CURSOR_FLAGS.OUTPUT_FORMAT, 'text',
        CLI.CURSOR_FLAGS.MODEL, 'claude-3.5-sonnet',
        'write a function',
      ],
      undefined
    );
    expect(result).toBe('success');
  });

  it('includes optional flags when provided', async () => {
    vi.mocked(executeCommand).mockResolvedValue('success');

    await executeCursorCLI(
      'write a function',
      'claude-3.5-sonnet',
      true,
      true,
      '/path/to/workspace'
    );

    expect(executeCommand).toHaveBeenCalledWith(
      CLI.COMMANDS.CURSOR,
      [
        CLI.CURSOR_FLAGS.PRINT,
        CLI.CURSOR_FLAGS.OUTPUT_FORMAT, 'text',
        CLI.CURSOR_FLAGS.MODEL, 'claude-3.5-sonnet',
        CLI.CURSOR_FLAGS.FORCE,
        CLI.CURSOR_FLAGS.TRUST,
        CLI.CURSOR_FLAGS.WORKSPACE, '/path/to/workspace',
        'write a function',
      ],
      undefined
    );
  });
});

describe('cursorListModelsTool', () => {
  it('calls executeCommand with cursor-agent --list-models', async () => {
    vi.mocked(executeCommand).mockResolvedValue('Available models\n\nauto - Auto');

    const ctx = { timeoutMs: 30_000 };
    const result = await cursorListModelsTool.execute!({}, ctx);

    expect(executeCommand).toHaveBeenCalledWith(
      CLI.COMMANDS.CURSOR,
      [CLI.CURSOR_FLAGS.LIST_MODELS],
      ctx,
    );
    expect(result).toBe('Available models\n\nauto - Auto');
  });
});
