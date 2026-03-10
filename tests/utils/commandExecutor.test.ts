import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { executeCommand, sanitizeArgForCmd } from '../../src/utils/commandExecutor.js';

function createMockProcess() {
  const proc = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: vi.fn(),
  };
  // Wire up event handlers
  const handlers: Record<string, Function> = {};
  proc.on.mockImplementation((event: string, handler: Function) => {
    handlers[event] = handler;
    return proc;
  });

  return {
    proc,
    emitStdout(data: string) {
      proc.stdout.emit('data', Buffer.from(data));
    },
    emitStderr(data: string) {
      proc.stderr.emit('data', Buffer.from(data));
    },
    emitClose(code: number) {
      handlers['close']?.(code);
    },
    emitError(err: Error) {
      handlers['error']?.(err);
    },
  };
}

describe('commandExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves with trimmed stdout on exit code 0', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('echo', ['hello']);
    mock.emitStdout('  hello world  \n');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toBe('hello world');
  });

  it('rejects with stderr message on non-zero exit code', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('bad', ['cmd']);
    mock.emitStderr('something went wrong');
    mock.emitClose(1);

    await expect(promise).rejects.toThrow('exit code 1: something went wrong');
  });

  it('rejects with "Unknown error" when stderr is empty on failure', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('bad', []);
    mock.emitClose(1);

    await expect(promise).rejects.toThrow('Unknown error');
  });

  it('rejects on spawn error', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('nonexistent', []);
    mock.emitError(new Error('ENOENT'));

    await expect(promise).rejects.toThrow('Failed to spawn command: ENOENT');
  });

  it('calls onProgress with incremental stdout data', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);
    const progressCalls: string[] = [];

    const promise = executeCommand('cmd', [], (newOutput) => {
      progressCalls.push(newOutput);
    });

    mock.emitStdout('chunk1');
    mock.emitStdout('chunk2');
    mock.emitStdout('chunk3');
    mock.emitClose(0);

    await promise;
    expect(progressCalls).toEqual(['chunk1', 'chunk2', 'chunk3']);
  });

  it('settles only once when error fires before close', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('cmd', []);
    mock.emitError(new Error('spawn failed'));
    // Close after error should not cause double rejection
    mock.emitClose(1);

    await expect(promise).rejects.toThrow('Failed to spawn command');
  });

  it('rejects with timeout error when timeoutMs elapses', async () => {
    vi.useFakeTimers();
    const mock = createMockProcess();
    // Add kill mock to the process
    (mock.proc as any).kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('slow', [], undefined, 5000);
    vi.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow('Command timed out after 5000ms');
    expect((mock.proc as any).kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('clears timeout when command completes before timeout', async () => {
    vi.useFakeTimers();
    const mock = createMockProcess();
    (mock.proc as any).kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('fast', [], undefined, 30000);
    mock.emitStdout('done');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toBe('done');
    // Process should not have been killed
    expect((mock.proc as any).kill).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('sanitizeArgForCmd', () => {
  it('passes through safe strings unchanged', () => {
    expect(sanitizeArgForCmd('hello world')).toBe('hello world');
    expect(sanitizeArgForCmd('-m model-name')).toBe('-m model-name');
  });

  it('escapes double quotes with cmd.exe convention ("")', () => {
    expect(sanitizeArgForCmd('say "hello"')).toBe('say ""hello""');
  });

  it('escapes percent signs to prevent %VAR% expansion', () => {
    expect(sanitizeArgForCmd('improve by 100%')).toBe('improve by 100%%');
    expect(sanitizeArgForCmd('%PATH%')).toBe('%%PATH%%');
  });

  it('caret-escapes cmd.exe shell operators', () => {
    expect(sanitizeArgForCmd('read & summarize')).toBe('read ^& summarize');
    expect(sanitizeArgForCmd('a | b')).toBe('a ^| b');
    expect(sanitizeArgForCmd('a > b')).toBe('a ^> b');
    expect(sanitizeArgForCmd('a < b')).toBe('a ^< b');
    expect(sanitizeArgForCmd('a ^ b')).toBe('a ^^ b');
  });

  it('handles combined metacharacters', () => {
    expect(sanitizeArgForCmd('echo "hi" & del %TEMP%'))
      .toBe('echo ""hi"" ^& del %%TEMP%%');
  });

  it('handles empty string', () => {
    expect(sanitizeArgForCmd('')).toBe('');
  });
});
