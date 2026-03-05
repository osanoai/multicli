import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/cliDetector.js', () => ({
  detectAvailableClis: vi.fn(),
}));

import { initTools } from '../../src/tools/index.js';
import { toolRegistry } from '../../src/tools/registry.js';
import { detectAvailableClis } from '../../src/utils/cliDetector.js';

describe('initTools', () => {
  let savedRegistry: typeof toolRegistry extends (infer T)[] ? T[] : never;

  beforeEach(() => {
    vi.clearAllMocks();
    savedRegistry = [...toolRegistry];
    toolRegistry.length = 0;
  });

  afterEach(() => {
    toolRegistry.length = 0;
    toolRegistry.push(...savedRegistry);
  });

  it('registers gemini tools when gemini available', async () => {
    vi.mocked(detectAvailableClis).mockResolvedValue({
      gemini: true, codex: false, claude: false,
    });

    await initTools();

    const names = toolRegistry.map(t => t.name);
    expect(names).toContain('List-Gemini-Models');
    expect(names).toContain('Ask-Gemini');
    expect(names).toContain('Fetch-Chunk');
    expect(names).toContain('Gemini-Help');
    // Should NOT have codex or claude tools
    expect(names).not.toContain('Ask-Codex');
    expect(names).not.toContain('Ask-Claude');
  });

  it('registers codex tools when codex available', async () => {
    vi.mocked(detectAvailableClis).mockResolvedValue({
      gemini: false, codex: true, claude: false,
    });

    await initTools();

    const names = toolRegistry.map(t => t.name);
    expect(names).toContain('List-Codex-Models');
    expect(names).toContain('Ask-Codex');
    expect(names).toContain('Codex-Help');
    expect(names).not.toContain('Ask-Gemini');
    expect(names).not.toContain('Ask-Claude');
  });

  it('registers claude tools when claude available', async () => {
    vi.mocked(detectAvailableClis).mockResolvedValue({
      gemini: false, codex: false, claude: true,
    });

    await initTools();

    const names = toolRegistry.map(t => t.name);
    expect(names).toContain('List-Claude-Models');
    expect(names).toContain('Ask-Claude');
    expect(names).toContain('Claude-Help');
    expect(names).not.toContain('Ask-Gemini');
    expect(names).not.toContain('Ask-Codex');
  });

  it('registers tools for multiple available CLIs', async () => {
    vi.mocked(detectAvailableClis).mockResolvedValue({
      gemini: true, codex: true, claude: false,
    });

    await initTools();

    const names = toolRegistry.map(t => t.name);
    expect(names).toContain('Ask-Gemini');
    expect(names).toContain('Ask-Codex');
    expect(names).not.toContain('Ask-Claude');
  });

  it('registers no tools when no CLIs available', async () => {
    vi.mocked(detectAvailableClis).mockResolvedValue({
      gemini: false, codex: false, claude: false,
    });

    await initTools();
    expect(toolRegistry).toHaveLength(0);
  });

  it('returns availability object', async () => {
    const expected = { gemini: true, codex: false, claude: true };
    vi.mocked(detectAvailableClis).mockResolvedValue(expected);

    const result = await initTools();
    expect(result).toEqual(expected);
  });
});
