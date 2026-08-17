import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/commandExecutor.js', () => ({
  executeCommand: vi.fn(),
}));

import { getCodexCapabilities, resetCodexCapabilitiesCache } from '../../src/utils/codexCapabilities.js';
import { executeCommand } from '../../src/utils/commandExecutor.js';

const MODERN_HELP = `
Options:
  -s, --sandbox <SANDBOX_MODE>
      --approve-for-me
          Route approval requests through automatic review using the workspace-write sandbox
      --skip-git-repo-check
`;

const LEGACY_HELP = `
Options:
  -s, --sandbox <SANDBOX_MODE>
  -a, --ask-for-approval <APPROVAL_POLICY>
      --full-auto
      --skip-git-repo-check
`;

describe('codexCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCodexCapabilitiesCache();
  });

  it('reports --approve-for-me support and no -a flag for modern codex', async () => {
    vi.mocked(executeCommand).mockResolvedValue(MODERN_HELP);

    const caps = await getCodexCapabilities();

    expect(caps).toEqual({ approveForMe: true, askForApprovalFlag: false });
  });

  it('reports -a support and no --approve-for-me for legacy codex', async () => {
    vi.mocked(executeCommand).mockResolvedValue(LEGACY_HELP);

    const caps = await getCodexCapabilities();

    expect(caps).toEqual({ approveForMe: false, askForApprovalFlag: true });
  });

  it('probes `codex exec --help` without streaming progress to the caller', async () => {
    vi.mocked(executeCommand).mockResolvedValue(MODERN_HELP);
    const onProgress = vi.fn();

    await getCodexCapabilities({ onProgress });

    const [command, args, options] = vi.mocked(executeCommand).mock.calls[0];
    expect(command).toBe('codex');
    expect(args).toEqual(['exec', '--help']);
    expect(options?.onProgress).toBeUndefined();
  });

  it('probes the CLI only once per process', async () => {
    vi.mocked(executeCommand).mockResolvedValue(MODERN_HELP);

    await getCodexCapabilities();
    await getCodexCapabilities();

    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('falls back to legacy flags when the probe fails', async () => {
    vi.mocked(executeCommand).mockRejectedValue(new Error('codex not found'));

    const caps = await getCodexCapabilities();

    expect(caps).toEqual({ approveForMe: false, askForApprovalFlag: true });
  });

  it('retries the probe after a failure instead of caching the fallback', async () => {
    vi.mocked(executeCommand).mockRejectedValueOnce(new Error('spawn failed'));
    vi.mocked(executeCommand).mockResolvedValueOnce(MODERN_HELP);

    const first = await getCodexCapabilities();
    const second = await getCodexCapabilities();

    expect(first.approveForMe).toBe(false);
    expect(second.approveForMe).toBe(true);
  });
});
