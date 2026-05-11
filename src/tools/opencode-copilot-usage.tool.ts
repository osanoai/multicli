import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeGhApi, GhCliError } from '../utils/githubCli.js';

const currentDate = new Date();

const opencodeCopilotUsageArgsSchema = z.object({
  username: z.string().min(1).optional().describe('Optional GitHub username to inspect. Defaults to the authenticated `gh` user.'),
  year: z.coerce.number().int().min(1970).optional().describe(`Optional year for the usage window. Defaults to ${currentDate.getFullYear()}.`),
  month: z.coerce.number().int().min(1).max(12).optional().describe(`Optional month for the usage window. Defaults to ${currentDate.getMonth() + 1}.`),
  day: z.coerce.number().int().min(1).max(31).optional().describe('Optional day for a more specific usage window.'),
  product: z.string().min(1).optional().describe('Optional product filter for the usage query.'),
  model: z.string().min(1).optional().describe('Optional model filter for the usage query.'),
});

type UsageResponse = Record<string, unknown>;

async function getAuthenticatedUsername(context?: Parameters<typeof executeGhApi>[1]): Promise<string> {
  const username = await executeGhApi(['user', '--jq', '.login'], context);
  if (!username.trim()) {
    throw new Error('GitHub CLI returned an empty username. Run `gh auth status` and try again.');
  }

  return username.trim();
}

function buildQueryArgs(args: {
  year: number;
  month: number;
  day?: number;
  product?: string;
  model?: string;
}): string[] {
  const queryArgs = ['--method', 'GET', '-f', `year=${args.year}`, '-f', `month=${args.month}`];

  if (args.day !== undefined) {
    queryArgs.push('-f', `day=${args.day}`);
  }

  if (args.product) {
    queryArgs.push('-f', `product=${args.product}`);
  }

  if (args.model) {
    queryArgs.push('-f', `model=${args.model}`);
  }

  return queryArgs;
}

function formatSummary(username: string, year: number, month: number, day?: number): string {
  const period = day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : `${year}-${String(month).padStart(2, '0')}`;
  return `GitHub Copilot premium request usage for ${username} (${period})`;
}

export const opencodeCopilotUsageTool: UnifiedTool = {
  name: 'OpenCode-Copilot-Usage',
  description: 'Check GitHub Copilot premium request usage for the authenticated OpenCode provider account or a specified GitHub username.',
  zodSchema: opencodeCopilotUsageArgsSchema,
  prompt: {
    description: 'Read GitHub Copilot premium request usage for OpenCode via gh api.',
  },
  category: 'opencode',
  execute: async (args, context) => {
    const a = opencodeCopilotUsageArgsSchema.parse(args);
    let resolvedUsername = a.username?.trim() || '';
    let year = a.year ?? new Date().getFullYear();
    let month = a.month ?? new Date().getMonth() + 1;

    try {
      resolvedUsername = resolvedUsername || await getAuthenticatedUsername(context);
      const queryArgs = buildQueryArgs({
        year,
        month,
        day: a.day,
        product: a.product,
        model: a.model,
      });

      const raw = await executeGhApi([
        `/users/${encodeURIComponent(resolvedUsername)}/settings/billing/premium_request/usage`,
        '-H', 'Accept: application/vnd.github+json',
        '-H', 'X-GitHub-Api-Version: 2026-03-10',
        ...queryArgs,
      ], context);

      const parsed = raw ? JSON.parse(raw) as UsageResponse : {};
      return `${formatSummary(resolvedUsername, year, month, a.day)}\n\nRaw JSON:\n${JSON.stringify({
        request: {
          username: resolvedUsername,
          year,
          month,
          day: a.day,
          product: a.product,
          model: a.model,
        },
        response: parsed,
      }, null, 2)}`;
    } catch (error) {
      if (error instanceof GhCliError) {
        return `${formatSummary(resolvedUsername, year, month, a.day)}\n\n${error.message}\n\nDebug:\n${JSON.stringify(error.details, null, 2)}`;
      }

      throw error;
    }
  },
};
