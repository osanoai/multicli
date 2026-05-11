import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { executeCommand, sanitizeArgForCmd } from '../../src/utils/commandExecutor.js';
import { createLogger } from '../../src/logger.js';

function createMockProcess() {
  const proc = {
    pid: 123,
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

    await expect(promise).rejects.toThrow('Command failed with code 1: something went wrong');
    await expect(promise).rejects.toThrow('"error_type": "FAILED"');
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

    const promise = executeCommand('cmd', [], {
      onProgress: (newOutput) => {
      progressCalls.push(newOutput);
      },
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

  it('rejects with timeout error when timeoutMs elapses and kills the process tree', async () => {
    vi.useFakeTimers();
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('slow', [], {
        timeoutMs: 5000,
        killGraceMs: 250,
      });
      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow('Command timed out after 5000ms');
      expect(processKill).toHaveBeenCalledWith(-123, 'SIGTERM');

      vi.advanceTimersByTime(250);
      expect(processKill).toHaveBeenCalledWith(-123, 'SIGKILL');
    } finally {
      processKill.mockRestore();
      vi.useRealTimers();
    }
  });

  it('rejects with cancellation error when aborted and kills the process tree', async () => {
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const controller = new AbortController();
      const promise = executeCommand('slow', [], { signal: controller.signal });
      controller.abort();

      await expect(promise).rejects.toThrow('Command cancelled');
      expect(processKill).toHaveBeenCalledWith(-123, 'SIGTERM');
    } finally {
      processKill.mockRestore();
    }
  });

  it('rejects when exit 0 but stdout empty and stderr has content', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('opencode', ['run', 'hi', '-m', 'invalid/model']);
    mock.emitStderr('Model not found: invalid/model');
    mock.emitClose(0);

    await expect(promise).rejects.toThrow('Command produced no output');
    await expect(promise).rejects.toThrow('Model not found: invalid/model');
  });

  it('resolves with empty string when exit 0 and both stdout and stderr are empty', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('cmd', []);
    mock.emitClose(0);

    const result = await promise;
    expect(result).toBe('');
  });

  it('clears timeout when command completes before timeout', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockProcess();
      const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('fast', [], { timeoutMs: 30000 });
      mock.emitStdout('done');
      mock.emitClose(0);

      const result = await promise;
      expect(result).toBe('done');
      // Process should not have been killed
      expect(processKill).not.toHaveBeenCalled();
      processKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects immediately when stderr reports RESOURCE_EXHAUSTED', async () => {
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('gemini', ['prompt'], {});
      mock.emitStderr('RESOURCE_EXHAUSTED: quota exceeded');

      await expect(promise).rejects.toThrow('Quota exhausted: RESOURCE_EXHAUSTED: quota exceeded');
      await expect(promise).rejects.toThrow('"error_type": "RESOURCE_EXHAUSTED"');
      expect(processKill).toHaveBeenCalledWith(-123, 'SIGTERM');
    } finally {
      processKill.mockRestore();
    }
  });

  it('logs subprocess lifecycle events while redacting sensitive command data', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'multicli-command-'));
    try {
      const logPath = path.join(dir, 'multicli.log');
      const logger = createLogger({
        filePath: logPath,
        fileLevel: 'debug',
        stderrLevel: 'silent',
        bindings: { component: 'testCommand' },
      });
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('claude', [
        '--print',
        'FULL PROMPT BODY',
        '--header',
        'Authorization: Bearer SUPERSECRET',
      ], {
        logger,
      });
      mock.emitStdout('tool output\nAuthorization: Bearer LEAKED');
      mock.emitClose(0);

      await promise;

      const logContents = readFileSync(logPath, 'utf8');
      expect(logContents).toContain('command_spawn_requested');
      expect(logContents).toContain('command_stdout_chunk');
      expect(logContents).toContain('FULL PROMPT BODY');
      expect(logContents).toContain('Authorization: Bearer [Redacted]');
      expect(logContents).toContain('tool output');
      expect(logContents).not.toContain('SUPERSECRET');
      expect(logContents).not.toContain('LEAKED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes cwd and env overrides through to spawn', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('claude', ['--help'], {
      cwd: '/tmp/project-root',
      env: {
        PATH: '/custom/bin',
        MULTICLI_SERVICE: '1',
      },
    });
    mock.emitStdout('help output');
    mock.emitClose(0);

    await promise;

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['--help'],
      expect.objectContaining({
        cwd: '/tmp/project-root',
        env: {
          PATH: '/custom/bin',
          MULTICLI_SERVICE: '1',
        },
      }),
    );
  });
});

describe('sanitizeArgForCmd', () => {
  it('passes through single-word args unchanged', () => {
    expect(sanitizeArgForCmd('hello')).toBe('hello');
    expect(sanitizeArgForCmd('--full-auto')).toBe('--full-auto');
    expect(sanitizeArgForCmd('gpt-5.2-codex')).toBe('gpt-5.2-codex');
  });

  it('wraps multi-word args in double quotes to preserve argv boundaries', () => {
    expect(sanitizeArgForCmd('hello world')).toBe('"hello world"');
    expect(sanitizeArgForCmd('Respond with a brief greeting')).toBe('"Respond with a brief greeting"');
    expect(sanitizeArgForCmd('-m model-name')).toBe('"-m model-name"');
  });

  it('wraps args containing tabs in double quotes', () => {
    expect(sanitizeArgForCmd('a\tb')).toBe('"a\tb"');
  });

  it('wraps and escapes args with embedded double quotes', () => {
    expect(sanitizeArgForCmd('say "hello"')).toBe('"say ""hello"""');
    expect(sanitizeArgForCmd('say "hello world"')).toBe('"say ""hello world"""');
  });

  it('escapes percent signs in unquoted args', () => {
    expect(sanitizeArgForCmd('100%')).toBe('100%%');
    expect(sanitizeArgForCmd('%PATH%')).toBe('%%PATH%%');
  });

  it('escapes percent signs inside quoted args', () => {
    expect(sanitizeArgForCmd('improve by 100%')).toBe('"improve by 100%%"');
  });

  it('caret-escapes shell operators in unquoted args (no spaces)', () => {
    expect(sanitizeArgForCmd('a&b')).toBe('a^&b');
    expect(sanitizeArgForCmd('a|b')).toBe('a^|b');
    expect(sanitizeArgForCmd('a>b')).toBe('a^>b');
    expect(sanitizeArgForCmd('a<b')).toBe('a^<b');
    expect(sanitizeArgForCmd('a^b')).toBe('a^^b');
  });

  it('does NOT caret-escape shell operators inside quoted args (spaces present)', () => {
    expect(sanitizeArgForCmd('read & summarize')).toBe('"read & summarize"');
    expect(sanitizeArgForCmd('a | b')).toBe('"a | b"');
    expect(sanitizeArgForCmd('a > b')).toBe('"a > b"');
    expect(sanitizeArgForCmd('a < b')).toBe('"a < b"');
    expect(sanitizeArgForCmd('a ^ b')).toBe('"a ^ b"');
  });

  it('handles combined special chars with spaces (quoted path)', () => {
    expect(sanitizeArgForCmd('echo "hi" & del %TEMP%'))
      .toBe('"echo ""hi"" & del %%TEMP%%"');
  });

  it('handles @ file references with spaces', () => {
    expect(sanitizeArgForCmd('@src/index.ts explain this'))
      .toBe('"@src/index.ts explain this"');
  });

  it('doubles trailing backslashes in quoted args to prevent quote escaping', () => {
    // "C:\path\" would make CommandLineToArgvW interpret \" as escaped quote
    expect(sanitizeArgForCmd('C:\\My Folder\\')).toBe('"C:\\My Folder\\\\"');
    expect(sanitizeArgForCmd('path with trailing\\\\')).toBe('"path with trailing\\\\\\\\"');
  });

  it('leaves non-trailing backslashes unchanged in quoted args', () => {
    expect(sanitizeArgForCmd('C:\\My Folder\\file.txt')).toBe('"C:\\My Folder\\file.txt"');
  });

  it('returns "" for empty string', () => {
    expect(sanitizeArgForCmd('')).toBe('""');
  });

  it('replaces newlines with spaces to prevent cmd.exe command injection', () => {
    expect(sanitizeArgForCmd('line1\nline2')).toBe('"line1 line2"');
    expect(sanitizeArgForCmd('line1\r\nline2')).toBe('"line1 line2"');
    expect(sanitizeArgForCmd('a\n\n\nb')).toBe('"a b"');
  });

  it('strips newlines from single-word args that become multi-word', () => {
    // "hello\nworld" becomes "hello world" which needs quoting
    expect(sanitizeArgForCmd('hello\nworld')).toBe('"hello world"');
  });

  it('caret-escapes parentheses in unquoted args', () => {
    expect(sanitizeArgForCmd('(a)')).toBe('^(a^)');
    expect(sanitizeArgForCmd('foo(bar)')).toBe('foo^(bar^)');
  });
});
