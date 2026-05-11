import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { getRunsDir } from '../service/paths.js';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

const getRunArgsSchema = z.object({
  runId: z.string().optional().describe("Specific run ID to retrieve. If omitted, and 'latest' is true, retrieves the most recent run."),
  latest: z.boolean().optional().describe("If true, retrieves the most recent run summary. Defaults to true if runId is omitted."),
});

export const getRunTool: UnifiedTool = {
  name: "Get-Run",
  description: "Retrieve summary of a prior command execution (run ledger). Useful for diagnosing failures, reviewing logs, or checking retryability.",
  zodSchema: getRunArgsSchema,
  category: 'utility',
  execution: { taskSupport: 'forbidden' },
  timeoutClass: 'none',
  execute: async (args) => {
    const { runId, latest = !args.runId } = args;
    const runsDir = getRunsDir();

    try {
      if (runId) {
        const filePath = path.join(runsDir, `${runId}.json`);
        const content = await readFile(filePath, 'utf-8');
        return content;
      }

      if (latest) {
        const files = await readdir(runsDir);
        if (files.length === 0) {
          return "No runs found in ledger.";
        }

        const stats = await Promise.all(
          files.filter(f => f.endsWith('.json')).map(async (f) => {
            const p = path.join(runsDir, f);
            const s = await stat(p);
            return { name: f, mtime: s.mtimeMs };
          })
        );

        if (stats.length === 0) {
          return "No runs found in ledger.";
        }

        stats.sort((a, b) => b.mtime - a.mtime);
        const latestFile = stats[0].name;
        const content = await readFile(path.join(runsDir, latestFile), 'utf-8');
        return content;
      }

      return "Please provide either runId or set latest: true.";
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        if (!runId) {
          return "No runs found in ledger.";
        }
        return `Run not found: ${runId}`;
      }
      throw error;
    }
  }
};
