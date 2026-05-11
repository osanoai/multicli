import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import { executeGhApi, GhCliError } from '../../src/utils/githubCli.js';

function createMockProcess() {
  const proc = {
    pid: 123,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: vi.fn(),
  };

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
      handlers.close?.(code);
    },
    emitError(err: Error & { code?: string }) {
      handlers.error?.(err);
    },
  };
}

describe('githubCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes gh api commands', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeGhApi(['/users/octo/settings/billing/premium_request/usage']);
    mock.emitStdout('{"ok":true}');
    mock.emitClose(0);

    await expect(promise).resolves.toBe('{"ok":true}');
    expect(spawn).toHaveBeenCalledWith('gh', ['api', '/users/octo/settings/billing/premium_request/usage'], expect.objectContaining({ shell: false }));
  });

  it('maps missing gh to a helpful error', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeGhApi(['/users/octo/settings/billing/premium_request/usage']);
    mock.emitError(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));

    await expect(promise).rejects.toBeInstanceOf(GhCliError);
    await expect(promise).rejects.toThrow('GitHub CLI `gh` is not installed');
  });

  it('maps 403 scope errors to actionable guidance', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeGhApi(['/users/octo/settings/billing/premium_request/usage']);
    mock.emitStderr('HTTP 403 Forbidden: missing required scope');
    mock.emitClose(1);

    await expect(promise).rejects.toThrow('missing the scope needed for Copilot premium request usage');
  });

  it('maps 404 errors to an actionable message', async () => {
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeGhApi(['/users/octo/settings/billing/premium_request/usage']);
    mock.emitStderr('HTTP 404 Not Found');
    mock.emitClose(1);

    await expect(promise).rejects.toThrow('GitHub returned 404 for this Copilot usage request');
  });

  it('kills the gh child process on timeout', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockProcess();
      const kill = vi.fn();
      vi.mocked(spawn).mockReturnValue({ ...mock.proc, kill } as any);

      const promise = executeGhApi(['/users/octo/settings/billing/premium_request/usage'], {
        timeoutMs: 1000,
      });
      vi.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('timed out');
      expect(kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });
});
