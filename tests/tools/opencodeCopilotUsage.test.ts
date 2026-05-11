import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/githubCli.js', () => ({
  executeGhApi: vi.fn(),
  GhCliError: class GhCliError extends Error {
    constructor(public kind: string, message: string, public details: any) {
      super(message);
      this.name = 'GhCliError';
    }
  },
}));

import { opencodeCopilotUsageTool } from '../../src/tools/opencode-copilot-usage.tool.js';
import { executeGhApi, GhCliError } from '../../src/utils/githubCli.js';

describe('opencodeCopilotUsageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults username from gh api user and returns usage JSON', async () => {
    vi.mocked(executeGhApi)
      .mockResolvedValueOnce('octocat')
      .mockResolvedValueOnce('{"total":12,"used":7}');

    const result = await opencodeCopilotUsageTool.execute({}, undefined);

    expect(executeGhApi).toHaveBeenNthCalledWith(1, ['user', '--jq', '.login'], undefined);
    expect(executeGhApi).toHaveBeenNthCalledWith(2, expect.arrayContaining([
      '--method', 'GET',
      '/users/octocat/settings/billing/premium_request/usage',
      '-H', 'Accept: application/vnd.github+json',
      '-H', 'X-GitHub-Api-Version: 2026-03-10',
      '-f', expect.stringMatching(/^year=/),
      '-f', expect.stringMatching(/^month=/),
    ]), undefined);
    expect(result).toContain('GitHub Copilot premium request usage for octocat');
    expect(result).toContain('"used": 7');
  });

  it('includes the gh error message in output for handled failures', async () => {
    vi.mocked(executeGhApi)
      .mockResolvedValueOnce('octocat')
      .mockRejectedValueOnce(new GhCliError('forbidden', 'GitHub returned 403 for this Copilot usage request. Check `gh auth status`, ensure the authenticated account can read Copilot premium request usage, and if needed run `gh auth refresh -h github.com -s user`.', {
        command: 'gh',
        args: ['api'],
        exitCode: 1,
        stderr: 'HTTP 403 Forbidden',
      }));

    const result = await opencodeCopilotUsageTool.execute({}, undefined);

    expect(result).toContain('GitHub returned 403 for this Copilot usage request');
    expect(result).toContain('"command": "gh"');
  });
});
