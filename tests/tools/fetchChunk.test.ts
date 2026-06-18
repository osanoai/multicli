import { describe, expect, it } from 'vitest';
import { fetchAntigravityChunkTool, fetchChunkTool } from '../../src/tools/fetch-chunk.tool.js';

describe('fetch chunk tools', () => {
  it.each([
    fetchAntigravityChunkTool,
    fetchChunkTool,
  ])('documents cacheKey and chunkIndex prompt arguments for %s', (tool) => {
    expect(tool.prompt?.arguments).toEqual([
      {
        name: 'cacheKey',
        description: 'The cache key provided in the initial changeMode response',
        required: true,
      },
      {
        name: 'chunkIndex',
        description: 'Which chunk to retrieve (1-based index)',
        required: true,
      },
    ]);
  });
});
