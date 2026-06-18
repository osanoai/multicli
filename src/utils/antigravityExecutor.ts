import { executeCommand } from './commandExecutor.js';
import { CLI } from '../constants.js';
import { ToolExecutionContext } from '../execution.js';

import { parseChangeModeOutput, validateChangeModeEdits } from './changeModeParser.js';
import { formatChangeModeResponse, summarizeChangeModeEdits } from './changeModeTranslator.js';
import { chunkChangeModeEdits } from './changeModeChunker.js';
import { cacheChunks, getChunks } from './chunkCache.js';

const DEFAULT_PRINT_TIMEOUT_MS = 15 * 60 * 1000;

export function formatAgyPrintTimeout(timeoutMs?: number): string {
  const effectiveMs = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_PRINT_TIMEOUT_MS;
  return `${Math.max(1, Math.ceil(effectiveMs / 1000))}s`;
}

export async function executeAntigravityCLI(
  prompt: string,
  model: string,
  sandbox?: boolean,
  changeMode?: boolean,
  context?: ToolExecutionContext,
): Promise<string> {
  let promptProcessed = prompt;

  if (changeMode) {
    promptProcessed = prompt.replace(/file:(\S+)/g, '@$1');

    const changeModeInstructions = `
[CHANGEMODE INSTRUCTIONS]
You are generating code modifications that will be processed by an automated system. The output format is critical because it enables programmatic application of changes without human intervention.

INSTRUCTIONS:
1. Analyze each provided file thoroughly
2. Identify locations requiring changes based on the user request
3. For each change, output in the exact format specified
4. The OLD section must be EXACTLY what appears in the file (copy-paste exact match)
5. Provide complete, directly replacing code blocks
6. Verify line numbers are accurate

CRITICAL REQUIREMENTS:
1. Output edits in the EXACT format specified below - no deviations
2. The OLD string MUST be findable with Ctrl+F - it must be a unique, exact match
3. Include enough surrounding lines to make the OLD string unique
4. If a string appears multiple times (like </div>), include enough context lines above and below to make it unique
5. Copy the OLD content EXACTLY as it appears - including all whitespace, indentation, line breaks
6. Never use partial lines - always include complete lines from start to finish

OUTPUT FORMAT (follow exactly):
**FILE: [filename]:[line_number]**
\\\`\\\`\\\`
OLD:
[exact code to be replaced - must match file content precisely]
NEW:
[new code to insert - complete and functional]
\\\`\\\`\\\`

EXAMPLE 1 - Simple unique match:
**FILE: src/utils/helper.js:100**
\\\`\\\`\\\`
OLD:
function getMessage() {
  return "Hello World";
}
NEW:
function getMessage() {
  return "Hello Universe!";
}
\\\`\\\`\\\`

EXAMPLE 2 - Common tag needing context:
**FILE: index.html:245**
\\\`\\\`\\\`
OLD:
        </div>
      </div>
    </section>
NEW:
        </div>
      </footer>
    </section>
\\\`\\\`\\\`

IMPORTANT: The OLD section must be an EXACT copy from the file that can be found with Ctrl+F!

USER REQUEST:
${promptProcessed}
`;
    promptProcessed = changeModeInstructions;
  }

  const args: string[] = [
    CLI.ANTIGRAVITY_FLAGS.MODEL,
    model,
    CLI.ANTIGRAVITY_FLAGS.PRINT_TIMEOUT,
    formatAgyPrintTimeout(context?.timeoutMs),
  ];

  if (sandbox) {
    args.push(CLI.ANTIGRAVITY_FLAGS.SANDBOX);
  }

  args.push(CLI.ANTIGRAVITY_FLAGS.PRINT, promptProcessed);

  return executeCommand(CLI.COMMANDS.ANTIGRAVITY, args, context);
}

export async function processChangeModeOutput(
  rawResult: string,
  chunkIndex?: number,
  chunkCacheKey?: string,
  prompt?: string,
): Promise<string> {
  if (chunkIndex && chunkCacheKey) {
    const cachedChunks = getChunks(chunkCacheKey);
    if (cachedChunks && chunkIndex > 0 && chunkIndex <= cachedChunks.length) {
      const chunk = cachedChunks[chunkIndex - 1];
      let result = formatChangeModeResponse(
        chunk.edits,
        { current: chunkIndex, total: cachedChunks.length, cacheKey: chunkCacheKey },
      );

      if (chunkIndex === 1 && chunk.edits.length > 5) {
        const allEdits = cachedChunks.flatMap(c => c.edits);
        result = summarizeChangeModeEdits(allEdits) + '\n\n' + result;
      }

      return result;
    }
  }

  const edits = parseChangeModeOutput(rawResult);

  if (edits.length === 0) {
    return `No edits found in Antigravity's response. Please ensure Antigravity uses the OLD/NEW format. \n\n+ ${rawResult}`;
  }

  const validation = validateChangeModeEdits(edits);
  if (!validation.valid) {
    return `Edit validation failed:\n${validation.errors.join('\n')}`;
  }

  const chunks = chunkChangeModeEdits(edits);

  let cacheKey: string | undefined;
  if (chunks.length > 1 && prompt) {
    cacheKey = cacheChunks(prompt, chunks);
  }

  const returnChunkIndex = (chunkIndex && chunkIndex > 0 && chunkIndex <= chunks.length) ? chunkIndex : 1;
  const returnChunk = chunks[returnChunkIndex - 1];

  let result = formatChangeModeResponse(
    returnChunk.edits,
    chunks.length > 1 ? { current: returnChunkIndex, total: chunks.length, cacheKey } : undefined,
  );

  if (returnChunkIndex === 1 && edits.length > 5) {
    result = summarizeChangeModeEdits(edits, chunks.length > 1) + '\n\n' + result;
  }

  return result;
}
