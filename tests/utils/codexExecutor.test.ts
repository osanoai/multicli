import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/commandExecutor.js', () => ({
  executeCommand: vi.fn().mockResolvedValue('mock response'),
}));

vi.mock('../../src/utils/codexCapabilities.js', () => ({
  getCodexCapabilities: vi.fn(),
}));

import { executeCodexCLI } from '../../src/utils/codexExecutor.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';
import { getCodexCapabilities } from '../../src/utils/codexCapabilities.js';

const MODERN = { approveForMe: true, askForApprovalFlag: false };
const LEGACY = { approveForMe: false, askForApprovalFlag: true };

function argsOfLastCall(): string[] {
  return vi.mocked(executeCommand).mock.calls[0][1];
}

describe('codexExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeCommand).mockResolvedValue('mock response');
  });

  describe('modern codex (--approve-for-me, no -a flag)', () => {
    beforeEach(() => {
      vi.mocked(getCodexCapabilities).mockResolvedValue(MODERN);
    });

    it('runs unattended with --approve-for-me when no sandbox is requested', async () => {
      await executeCodexCLI('fix this bug', 'gpt-5.4');

      expect(executeCommand).toHaveBeenCalledWith(
        'codex',
        [
          'exec', 'fix this bug',
          '--approve-for-me',
          '--skip-git-repo-check',
          '--color', 'never',
          '-m', 'gpt-5.4',
        ],
        undefined
      );
    });

    it('drops --approve-for-me when a sandbox is requested, since codex rejects both together', async () => {
      await executeCodexCLI('task', 'gpt-5.4', 'read-only');

      const args = argsOfLastCall();
      expect(args).not.toContain('--approve-for-me');
      expect(args).toContain('-s');
      expect(args).toContain('read-only');
    });

    it('keeps a sandboxed run unattended by setting approval_policy=never', async () => {
      await executeCodexCLI('task', 'gpt-5.4', 'workspace-write');

      const args = argsOfLastCall();
      expect(args).toContain('-c');
      expect(args).toContain('approval_policy=never');
    });

    it('passes an explicit approvalPolicy as a config override instead of the removed -a flag', async () => {
      await executeCodexCLI('task', 'gpt-5.4', undefined, 'on-request');

      const args = argsOfLastCall();
      expect(args).not.toContain('-a');
      expect(args).toContain('-c');
      expect(args).toContain('approval_policy=on-request');
    });

    it('honours an explicit approvalPolicy over the sandboxed default', async () => {
      await executeCodexCLI('task', 'gpt-5.4', 'read-only', 'on-request');

      const args = argsOfLastCall();
      expect(args).toContain('approval_policy=on-request');
      expect(args).not.toContain('approval_policy=never');
    });

    it('never emits --full-auto, which modern codex rejects', async () => {
      await executeCodexCLI('task', 'gpt-5.4', 'read-only', 'never');

      expect(argsOfLastCall()).not.toContain('--full-auto');
    });
  });

  describe('legacy codex (--full-auto, -a flag)', () => {
    beforeEach(() => {
      vi.mocked(getCodexCapabilities).mockResolvedValue(LEGACY);
    });

    it('builds correct base args', async () => {
      await executeCodexCLI('fix this bug', 'gpt-5.2-codex');

      expect(executeCommand).toHaveBeenCalledWith(
        'codex',
        [
          'exec', 'fix this bug',
          '--full-auto',
          '--skip-git-repo-check',
          '--color', 'never',
          '-m', 'gpt-5.2-codex',
        ],
        undefined
      );
    });

    it('adds -s sandbox when provided', async () => {
      await executeCodexCLI('task', 'gpt-5.2-codex', 'read-only');

      const args = argsOfLastCall();
      expect(args).toContain('-s');
      expect(args).toContain('read-only');
    });

    it('adds -a approvalPolicy when provided', async () => {
      await executeCodexCLI('task', 'gpt-5.2-codex', undefined, 'never');

      const args = argsOfLastCall();
      expect(args).toContain('-a');
      expect(args).toContain('never');
    });

    it('includes both sandbox and approvalPolicy when both provided', async () => {
      await executeCodexCLI('task', 'gpt-5.2-codex', 'workspace-write', 'on-failure');

      const args = argsOfLastCall();
      expect(args).toContain('-s');
      expect(args).toContain('workspace-write');
      expect(args).toContain('-a');
      expect(args).toContain('on-failure');
    });
  });

  it('passes onProgress callback through', async () => {
    vi.mocked(getCodexCapabilities).mockResolvedValue(MODERN);
    const onProgress = vi.fn();
    await executeCodexCLI('task', 'gpt-5.4', undefined, undefined, { onProgress });

    expect(executeCommand).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      { onProgress }
    );
  });
});
