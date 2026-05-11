import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { mkdir, writeFile, readdir, readFile, stat } from 'fs/promises';
import { executeCommand, CommandExecutionError } from '../src/utils/commandExecutor.js';
import { getRunTool } from '../src/tools/get-run.tool.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual as any,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    stat: vi.fn().mockResolvedValue({ mtimeMs: 0 }),
  };
});

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
    emitStdout(data: string) { proc.stdout.emit('data', Buffer.from(data)); },
    emitStderr(data: string) { proc.stderr.emit('data', Buffer.from(data)); },
    emitClose(code: number) { handlers['close']?.(code); },
    emitError(err: Error) { handlers['error']?.(err); },
  };
}

describe('Reliability Improvements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Structured Errors & Classification', () => {
    it('includes a JSON block in the error message', async () => {
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('bad-cli', ['arg']);
      mock.emitStderr('RESOURCE_EXHAUSTED: too many requests');
      mock.emitClose(1);

      try {
        await promise;
      } catch (error: any) {
        expect(error).toBeInstanceOf(CommandExecutionError);
        expect(error.message).toContain('```json');
        expect(error.message).toContain('"error_type": "RESOURCE_EXHAUSTED"');
        expect(error.message).toContain('"retryable": true');
      }
    });

    it('classifies auth errors as non-retryable', async () => {
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('bad-cli', ['arg']);
      mock.emitStderr('Unauthorized: Invalid API Key');
      mock.emitClose(1);

      try {
        await promise;
      } catch (error: any) {
        expect(error.message).toContain('"error_type": "AUTH_ERROR"');
        expect(error.message).toContain('"retryable": false');
      }
    });

    it('adds a note for MODEL_NOT_FOUND errors', async () => {
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('bad-cli', ['arg']);
      mock.emitStderr('404 Model Not Found');
      mock.emitClose(1);

      try {
        await promise;
      } catch (error: any) {
        expect(error.message).toContain('model IDs are tool-specific');
        expect(error.message).toContain('"error_type": "MODEL_NOT_FOUND"');
      }
    });

    it('includes run_id and tails in structured output on timeout', async () => {
      vi.useFakeTimers();
      const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        const mock = createMockProcess();
        vi.mocked(spawn).mockReturnValue(mock.proc as any);

        const promise = executeCommand('slow', [], { timeoutMs: 1000 });
        mock.emitStdout('partial out');
        mock.emitStderr('partial err');
        vi.advanceTimersByTime(1000);

        try {
          await promise;
        } catch (error: any) {
          expect(error).toBeInstanceOf(CommandExecutionError);
          expect(error.message).toContain('"error_type": "TIMEOUT"');
          expect(error.details.runId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );
          expect(error.message).toContain('"stdout_tail"');
          expect(error.message).toContain('"stderr_tail"');
        }
      } finally {
        processKill.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  describe('Run Ledger', () => {
    it('records a run to the filesystem', async () => {
      const mock = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mock.proc as any);

      const promise = executeCommand('echo', ['hello']);
      mock.emitStdout('hello world');
      mock.emitClose(0);

      await promise;

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.stringContaining('"status": "success"')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.stringContaining('"stdout_tail": "hello world"')
      );
    });
  });

  describe('Get-Run Tool', () => {
    it('retrieves the latest run', async () => {
      vi.mocked(readdir).mockResolvedValue(['run1.json', 'run2.json'] as any);
      vi.mocked(stat).mockImplementation(async (p: any) => {
        if (p.includes('run1.json')) return { mtimeMs: 100 } as any;
        return { mtimeMs: 200 } as any;
      });
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ run_id: 'run2', status: 'success' }));

      const result = await getRunTool.execute({ latest: true }, {} as any);
      const parsed = JSON.parse(result as string);
      expect(parsed.run_id).toBe('run2');
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('run2.json'), 'utf-8');
    });

    it('reports no runs when latest is requested before the ledger directory exists', async () => {
      vi.mocked(readdir).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      const result = await getRunTool.execute({ latest: true }, {} as any);

      expect(result).toBe('No runs found in ledger.');
    });

    it('retrieves a specific run by ID', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ run_id: 'specific-id', status: 'failed' }));

      const result = await getRunTool.execute({ runId: 'specific-id' }, {} as any);
      const parsed = JSON.parse(result as string);
      expect(parsed.run_id).toBe('specific-id');
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('specific-id.json'), 'utf-8');
    });
  });
});
