import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { executeCommand } from '../../src/utils/commandExecutor.js';

function createMockProcess() {
  const proc = {
    pid: 4242,
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
    settle(code: number) {
      setTimeout(() => handlers['close']?.(code), 0);
    },
  };
}

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('executeCommand — codexLauncherMimick spawn shape (issue #138 fix)', () => {
  const mimickContext = {
    codexLauncherMimick: {
      binaryPath: 'C:/pkg/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
      pathDir: 'C:/pkg/vendor/x86_64-pc-windows-msvc/codex-path',
      env: {
        PATH: 'C:/pkg/vendor/x86_64-pc-windows-msvc/codex-path;C:/Windows/System32',
        CODEX_MANAGED_BY_NPM: '1',
        CODEX_MANAGED_PACKAGE_ROOT: 'C:/pkg',
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('win32');
    const m = createMockProcess();
    vi.mocked(spawn).mockReturnValue(m.proc as any);
    // settle promptly to close the promise loop
    setTimeout(() => {
      const handlers: Record<string, Function> = {};
      // re-bind handlers from the mock
      vi.mocked(m.proc.on).mock.calls.forEach(([event, handler]) => {
        handlers[event as string] = handler as Function;
      });
      handlers['close']?.(0);
    }, 0);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
  });

  it('spawns the mimick binaryPath with shell:false', async () => {
    await executeCommand('codex', ['exec', 'task'], mimickContext);

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe(mimickContext.codexLauncherMimick.binaryPath);
    const spawnOpts = call[2] as any;
    expect(spawnOpts.shell).toBe(false);
  });

  it('spawns with detached:false (NOT detached:true like PR #139 noShell branch)', async () => {
    await executeCommand('codex', ['exec', 'task'], mimickContext);
    const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    expect(spawnOpts.detached).toBe(false);
  });

  it('does NOT apply windowsHide (matches docs/codex.js launcher exactly)', async () => {
    await executeCommand('codex', ['exec', 'task'], mimickContext);
    const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    expect(spawnOpts.windowsHide).toBeUndefined();
  });

  it('uses stdio pipe so multicli can capture codex output', async () => {
    await executeCommand('codex', ['exec', 'task'], mimickContext);
    const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    expect(spawnOpts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('forwards raw args (no sanitizeArgForCmd applied — shell:false makes it unnecessary)', async () => {
    const rawArgs = ['exec', 'prompt with "quotes" & symbols', '--full-auto'];
    await executeCommand('codex', rawArgs, mimickContext);
    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[1]).toEqual(rawArgs);
  });

  it('passes the mimick env (with codex-path prepended + CODEX_MANAGED_*) to spawn', async () => {
    await executeCommand('codex', ['exec', 'task'], mimickContext);
    const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    expect(spawnOpts.env).toBe(mimickContext.codexLauncherMimick.env);
  });

  it('mimick wins over windowsCodexNoShell when both are set (NO_SHELL becomes no-op)', async () => {
    await executeCommand('codex', ['exec', 'task'], {
      ...mimickContext,
      windowsCodexNoShell: true,
    });
    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe(mimickContext.codexLauncherMimick.binaryPath);
    const spawnOpts = call[2] as any;
    expect(spawnOpts.shell).toBe(false);
    expect(spawnOpts.detached).toBe(false);
    expect(spawnOpts.windowsHide).toBeUndefined();
  });

  it('without mimick context, legacy windowsCodexNoShell branch still works (regression)', async () => {
    // existsSync 미스로 noShellActive=false → fall back to default shell:true path
    await executeCommand('codex', ['exec', 'task'], { windowsCodexNoShell: true });
    const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    // resolveWindowsExecutable will not find codex.exe in test env's PATH most likely,
    // so spawnShell stays true and detached stays false (Windows default branch).
    expect(spawnOpts.shell).toBe(true);
  });
});
