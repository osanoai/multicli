import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync),
  };
});

import * as fs from 'node:fs';
import {
  executeCommand,
  resolveWindowsExecutable,
} from '../../src/utils/commandExecutor.js';

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
      handlers['close']?.(code);
    },
  };
}

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('executeCommand — issue #138 Windows Codex spawn handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockImplementation(() => false);
    vi.mocked(fs.statSync).mockImplementation(() => ({ isFile: () => true }) as any);
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  // Test A — default Windows behavior preserved when flag is OFF
  it('preserves default Windows spawn options (shell:true, detached:false) when windowsCodexNoShell is not set', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec', 'foo']);
    mock.emitStdout('ok');
    mock.emitClose(0);
    await promise;

    expect(spawn).toHaveBeenCalledTimes(1);
    const [, , options] = vi.mocked(spawn).mock.calls[0];
    expect(options).toMatchObject({
      shell: true,
      detached: false,
    });
    // windowsHide is not set in default path
    expect((options as any).windowsHide).toBeUndefined();
  });

  // Test B — no-shell .exe activation
  it('activates no-shell path with shell:false + detached:true + windowsHide:true when .exe is resolved', async () => {
    setPlatform('win32');
    const resolvedPath = 'C:\\fake\\codex.exe';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === resolvedPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.COM;.EXE;.CMD';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec', 'hi'], {
      windowsCodexNoShell: true,
    });
    mock.emitStdout('ok');
    mock.emitClose(0);
    await promise;

    const [cmd, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(cmd).toBe(resolvedPath);
    expect(args).toEqual(['exec', 'hi']); // raw args, NOT sanitized
    expect(options).toMatchObject({
      shell: false,
      detached: true,
      windowsHide: true,
    });
    // windowsVerbatimArguments must NOT be set
    expect((options as any).windowsVerbatimArguments).toBeUndefined();
  });

  // Test C — .cmd resolution falls back to shell:true
  it('falls back to shell:true path when resolved executable is a .cmd shim', async () => {
    setPlatform('win32');
    const cmdPath = 'C:\\fake\\codex.cmd';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === cmdPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.CMD;.EXE';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec', 'foo bar'], {
      windowsCodexNoShell: true,
    });
    mock.emitStdout('ok');
    mock.emitClose(0);
    await promise;

    const [cmd, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(cmd).toBe('codex'); // NOT resolved path
    expect(args).toEqual(['exec', '"foo bar"']); // sanitized
    expect(options).toMatchObject({
      shell: true,
      detached: false,
    });
  });

  // Test D — resolution failure falls back to shell:true
  it('falls back to shell:true path when executable cannot be resolved', async () => {
    setPlatform('win32');
    vi.mocked(fs.existsSync).mockImplementation(() => false);
    process.env.PATH = 'C:\\nowhere';
    process.env.PATHEXT = '.EXE';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec'], {
      windowsCodexNoShell: true,
    });
    mock.emitStdout('ok');
    mock.emitClose(0);
    await promise;

    const [cmd, , options] = vi.mocked(spawn).mock.calls[0];
    expect(cmd).toBe('codex');
    expect(options).toMatchObject({ shell: true, detached: false });
  });

  // Test E — metachar preservation in no-shell path
  it('preserves spaces, ampersand, pipe, and double-quote args verbatim in no-shell path', async () => {
    setPlatform('win32');
    const resolvedPath = 'C:\\fake\\codex.exe';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === resolvedPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.EXE';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const tricky = [
      'foo bar baz',     // spaces
      'foo & bar',       // ampersand
      'foo | bar',       // pipe
      'say "hello"',     // double quotes
    ];
    const promise = executeCommand('codex', tricky, {
      windowsCodexNoShell: true,
    });
    mock.emitStdout('ok');
    mock.emitClose(0);
    await promise;

    const [, args] = vi.mocked(spawn).mock.calls[0];
    expect(args).toEqual(tricky); // exact verbatim, no sanitization
  });

  // Test E2 — .exe takes priority over .cmd in same directory when PATHEXT lists .EXE first
  it('selects .exe over .cmd in the same directory per PATHEXT order', async () => {
    setPlatform('win32');
    const exePath = 'C:\\fake\\codex.exe';
    const cmdPath = 'C:\\fake\\codex.cmd';
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p).toLowerCase();
      return s === exePath.toLowerCase() || s === cmdPath.toLowerCase();
    });
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';

    const result = resolveWindowsExecutable('codex');
    expect(result).toEqual({ path: exePath, isCmd: false });
  });

  // Test F — Tier 3 hint on stderr (flag OFF)
  it('appends issue #138 hint with "try setting" when CreateProcessAsUserW failed: 5 appears on stderr and flag is OFF', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStderr('something\nCreateProcessAsUserW failed: 5\n');
    mock.emitClose(1);

    await expect(promise).rejects.toThrow(/MULTICLI_WINDOWS_CODEX_NO_SHELL=1/);
    await expect(promise).rejects.toThrow(/try setting/);
  });

  // Test G — Tier 3 hint on stdout (flag OFF)
  it('appends issue #138 hint when CreateProcessAsUserW failed: 5 appears on stdout (not stderr) and flag is OFF', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStdout('garbage CreateProcessAsUserW failed: 5 more garbage');
    mock.emitStderr('exit reason');
    mock.emitClose(1);

    await expect(promise).rejects.toThrow(/issues\/138/);
    await expect(promise).rejects.toThrow(/try setting/);
  });

  // Test H — Tier 3 hint when flag is ALREADY ON
  it('appends "workaround was already attempted" hint when flag is ON and failure still occurs', async () => {
    setPlatform('win32');
    const resolvedPath = 'C:\\fake\\codex.exe';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === resolvedPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.EXE';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec'], {
      windowsCodexNoShell: true,
    });
    mock.emitStderr('CreateProcessAsUserW failed: 5');
    mock.emitClose(1);

    await expect(promise).rejects.toThrow(/workaround was already attempted/);
    await expect(promise).rejects.toThrow(/upstream Codex fix/);
  });

  // Test I — Codex flag does NOT propagate globally
  it('does not activate no-shell path when caller does not pass windowsCodexNoShell (Gemini/Claude/OpenCode path)', async () => {
    setPlatform('win32');
    const exePath = 'C:\\fake\\gemini.exe';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === exePath);
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.EXE';
    process.env.MULTICLI_WINDOWS_CODEX_NO_SHELL = '1'; // even if env is set globally

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    // Gemini executor does NOT pass windowsCodexNoShell
    const promise = executeCommand('gemini', ['prompt', 'hi']);
    mock.emitStdout('ok');
    mock.emitClose(0);
    await promise;

    const [cmd, , options] = vi.mocked(spawn).mock.calls[0];
    expect(cmd).toBe('gemini');
    expect(options).toMatchObject({ shell: true, detached: false });
    expect((options as any).windowsHide).toBeUndefined();

    delete process.env.MULTICLI_WINDOWS_CODEX_NO_SHELL;
  });
});

describe('executeCommand — R3 exit-0 issue #138 note injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockImplementation(() => false);
    vi.mocked(fs.statSync).mockImplementation(() => ({ isFile: () => true }) as any);
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  // Test J — exit 0 + stderr marker, flag OFF → separated note appended
  it('J: appends separated [multicli] note when exit 0 + stderr contains marker (flag OFF)', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStdout('some result\n');
    mock.emitStderr('CreateProcessAsUserW failed: 5\n');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toContain('some result');
    expect(result).toContain('---\n[multicli] note:');
    expect(result).toContain('MULTICLI_WINDOWS_CODEX_NO_SHELL=1');
    expect(result).toContain('codex.exe is on PATH');
    expect(result).toContain('Codex exited 0');
  });

  // Test K — exit 0 + stdout marker, flag OFF → same shape
  it('K: appends separated [multicli] note when exit 0 + stdout contains marker (flag OFF)', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStdout('preface\nCreateProcessAsUserW failed: 5\ntrailing\n');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toContain('---\n[multicli] note:');
    expect(result).toContain('issues/138');
  });

  // Test L — exit 0 + no marker → output unchanged (false-positive guard)
  it('L: leaves output unchanged when exit 0 has no marker (false-positive guard)', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStdout('normal output\n');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toBe('normal output');
    expect(result).not.toContain('[multicli] note');
  });

  // Test M — exit 0 + marker + flag ON → hint says workaround already attempted
  it('M: appends "workaround already active" note when exit 0 + marker + flag ON', async () => {
    setPlatform('win32');
    const resolvedPath = 'C:\\fake\\codex.exe';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === resolvedPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.EXE';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec'], { windowsCodexNoShell: true });
    mock.emitStdout('result\n');
    mock.emitStderr('CreateProcessAsUserW failed: 5\n');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toContain('already active');
    expect(result).toContain('upstream Codex fix');
  });

  // Test N — exit 0 + marker + linux → output unchanged (Windows-only)
  it('N: leaves output unchanged on non-Windows platform even when marker is present', async () => {
    setPlatform('linux');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStdout('linux output\n');
    mock.emitStderr('CreateProcessAsUserW failed: 5\n');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toBe('linux output');
    expect(result).not.toContain('[multicli] note');
  });

  // Test O — exit 0 + marker on BOTH streams → single note only (regression M2)
  it('O: attaches single note even when marker is on both stdout and stderr', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStdout('a\nCreateProcessAsUserW failed: 5\nb\n');
    mock.emitStderr('CreateProcessAsUserW failed: 5\n');
    mock.emitClose(0);

    const result = await promise;
    const noteOccurrences = (result.match(/\[multicli\] note:/g) || []).length;
    expect(noteOccurrences).toBe(1);
  });

  // Test Q — wording bug: flag ON + .cmd shim (silent fallback) + exit 0 + marker
  // → hint must say "bypass could not activate" (not "already active")
  it('Q: hint says "bypass could not activate" when flag ON but resolution lands on .cmd (success path)', async () => {
    setPlatform('win32');
    const cmdPath = 'C:\\fake\\codex.cmd';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === cmdPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.CMD';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec'], { windowsCodexNoShell: true });
    mock.emitStdout('result\n');
    mock.emitStderr('CreateProcessAsUserW failed: 5\n');
    mock.emitClose(0);

    const result = await promise;
    expect(result).toContain('bypass could not activate');
    expect(result).toContain('codex.exe is not on PATH');
    expect(result).not.toContain('already active');
  });

  // Test R — wording bug: flag ON + .cmd shim + non-zero exit + marker
  // → error hint must say "bypass could not activate" (not "already attempted")
  it('R: error hint says "bypass could not activate" when flag ON but resolution lands on .cmd (failure path)', async () => {
    setPlatform('win32');
    const cmdPath = 'C:\\fake\\codex.cmd';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === cmdPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.CMD';

    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec'], { windowsCodexNoShell: true });
    mock.emitStderr('CreateProcessAsUserW failed: 5');
    mock.emitClose(1);

    await expect(promise).rejects.toThrow(/bypass could not activate/);
    await expect(promise).rejects.toThrow(/codex\.exe is not on PATH/);
    await expect(promise).rejects.toThrow(/(?!.*already attempted)/);
  });

  // Test P — exit 0 + empty stdout + stderr marker → note-only, no leading newline (M1 final fix)
  it('P: returns note-only with no leading newline when stdout is empty and stderr has marker', async () => {
    setPlatform('win32');
    const mock = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mock.proc as any);

    const promise = executeCommand('codex', ['exec']);
    mock.emitStderr('CreateProcessAsUserW failed: 5\n');
    mock.emitClose(0);

    const result = await promise;
    expect(result.startsWith('---\n[multicli] note:')).toBe(true);
    expect(result.startsWith('\n')).toBe(false);
  });
});

describe('resolveWindowsExecutable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockImplementation(() => false);
    vi.mocked(fs.statSync).mockImplementation(() => ({ isFile: () => true }) as any);
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  it('returns null on non-Windows platforms', () => {
    setPlatform('linux');
    expect(resolveWindowsExecutable('codex')).toBeNull();
  });

  it('returns null when nothing matches on PATH', () => {
    setPlatform('win32');
    vi.mocked(fs.existsSync).mockImplementation(() => false);
    process.env.PATH = 'C:\\nowhere';
    process.env.PATHEXT = '.EXE';
    expect(resolveWindowsExecutable('codex')).toBeNull();
  });

  it('marks .bat as isCmd:true', () => {
    setPlatform('win32');
    const batPath = 'C:\\fake\\foo.bat';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).toLowerCase() === batPath.toLowerCase());
    process.env.PATH = 'C:\\fake';
    process.env.PATHEXT = '.BAT';
    expect(resolveWindowsExecutable('foo')).toEqual({ path: batPath, isCmd: true });
  });
});
