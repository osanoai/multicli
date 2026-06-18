import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { getChunks } from '../utils/chunkCache.js';
import { formatChangeModeResponse, summarizeChangeModeEdits } from '../utils/changeModeTranslator.js';

const inputSchema = z.object({
  cacheKey: z.string().describe("The cache key provided in the initial changeMode response"),
  chunkIndex: z.number().min(1).describe("Which chunk to retrieve (1-based index)")
});

function createFetchChunkTool(name: string, category: 'antigravity' | 'gemini', deprecated = false): UnifiedTool {
  return {
  name,
  description: deprecated
    ? 'Deprecated compatibility alias for Fetch-Antigravity-Chunk. Retrieves cached chunks from an Antigravity changeMode response.'
    : 'Retrieves cached chunks from an Antigravity changeMode response. Use this to get subsequent chunks after receiving a partial changeMode response.',

  zodSchema: inputSchema,

  prompt: {
    description: deprecated ? 'Deprecated alias: fetch the next Antigravity response chunk' : 'Fetch the next chunk of an Antigravity response',
    arguments: [
      {
        name: 'prompt',
        description: 'fetch-chunk cacheKey=<key> chunkIndex=<number>',
        required: true
      }
    ]
  },

  category,

  execute: async (args: any): Promise<string> => {
    const { cacheKey, chunkIndex } = args;
    
    // Retrieve cached chunks
    const chunks = getChunks(cacheKey);
    
    if (!chunks) {
      return `❌ Cache miss: No chunks found for cache key "${cacheKey}". 

  Possible reasons:
  1. The cache key is incorrect. Have you run Ask-Antigravity or Ask-Gemini with changeMode enabled?
  2. The cache has expired (10 minute TTL)
  3. The MCP server was restarted and the file-based cache was cleared

Please re-run the original changeMode request to regenerate the chunks.`;
    }
    
    // Validate chunk index
    if (chunkIndex < 1 || chunkIndex > chunks.length) {
      return `❌ Invalid chunk index: ${chunkIndex}

Available chunks: 1 to ${chunks.length}
You requested: ${chunkIndex}

Please use a valid chunk index.`;
    }
    
    // Get the requested chunk
    const chunk = chunks[chunkIndex - 1];
    
    // Format the response
    let result = formatChangeModeResponse(
      chunk.edits,
      { current: chunkIndex, total: chunks.length, cacheKey }
    );
    
    // Add summary for first chunk
    if (chunkIndex === 1 && chunks.length > 1) {
      const allEdits = chunks.flatMap(c => c.edits);
      result = summarizeChangeModeEdits(allEdits, true) + '\n\n' + result;
    }
    
    return result;
  },
};
}

export const fetchAntigravityChunkTool: UnifiedTool = createFetchChunkTool('Fetch-Antigravity-Chunk', 'antigravity');
export const fetchChunkTool: UnifiedTool = createFetchChunkTool('Fetch-Chunk', 'gemini', true);
