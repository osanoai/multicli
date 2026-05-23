import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeCodexCLI } from '../utils/codexExecutor.js';
import { ERROR_MESSAGES, STATUS_MESSAGES } from '../constants.js';
import { getCatalog } from '../modelCatalog.js';

/**
 * R2-a — Ask-Codex model 화이트리스트 validation (plan-review R1-R3 합의, 2026-05-21)
 *
 * F-03 (description allowlist auto-sync) + F-06 (description 가드: 정렬/중복/임계치/fail-fast)
 * 결정 근거: codex CLI 의 model_not_supported ERROR 가 LLM hallucination (예: `gpt-5.3`)
 * 으로 silent 종결되던 결함 차단. 카탈로그 ID 외 입력은 schema 단계에서 거부.
 */
export const MODEL_DESCRIPTION_THRESHOLD = 10;

export function buildCodexModelDescription(ids: string[]): string {
  if (ids.length === 0) {
    throw new Error(
      'Codex catalog produced empty model ID list. Ask-Codex 도구 등록 불가 — '
        + '`npm run refresh-catalog` 실행 또는 src/modelCatalog.generated.json 정합성 확인.',
    );
  }

  const sorted = [...new Set(ids)].sort();
  const base = 'REQUIRED — you MUST first call List-Codex-Models, review the available '
    + 'model families and their strengths, then select the best model for your task. It\'s the law.';

  if (sorted.length > MODEL_DESCRIPTION_THRESHOLD) {
    const sample = sorted.slice(0, 3).join(', ');
    return `${base} Allowed IDs (auto-synced, ${sorted.length}종): ${sample}, ... — `
      + 'see List-Codex-Models for full list. Empty strings or IDs outside the catalog will be rejected.';
  }

  return `${base} Allowed IDs (auto-synced from catalog): ${sorted.join(', ')}. `
    + 'Empty strings or IDs outside this list will be rejected.';
}

const codexCatalog = getCatalog('codex');
const codexAllowedModels = [
  ...new Set(codexCatalog.tiers.flatMap((t) => t.models)),
].sort();
const codexModelSet = new Set(codexAllowedModels);
const codexModelDescription = buildCodexModelDescription(codexAllowedModels);

const askCodexArgsSchema = z.object({
  prompt: z.string().min(1).describe(
    'The question or task for Codex. REQUIRED — MUST be a non-empty string. Codex has FULL '
      + 'access to the filesystem and can read files itself. Do NOT pre-read or inline file '
      + 'contents — just describe the task and let Codex explore the codebase.',
  ),
  model: z.string().min(1)
    .refine((id) => codexModelSet.has(id), {
      message:
        `model 은 Codex 카탈로그 ID 중 하나여야 합니다. 사용 가능한 IDs: `
        + `${codexAllowedModels.join(', ')}. `
        + `LLM hallucination 약칭(예: "gpt-5.3" → "gpt-5.3-codex")을 자주 발생시키므로 정확한 ID 사용 필요. `
        + `최신 목록은 List-Codex-Models 호출.`,
    })
    .describe(codexModelDescription),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional().describe(
    "Optional. Do NOT set unless explicitly needed. Sandbox mode: 'read-only' (safe), "
      + "'workspace-write' (default), or 'danger-full-access' (unrestricted).",
  ),
  approvalPolicy: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).optional().describe(
    "Optional. Do NOT set unless explicitly needed. Approval policy: 'never', 'on-request' (default), "
      + "'on-failure', or 'untrusted'.",
  ),
});

export const askCodexTool: UnifiedTool = {
  name: "Ask-Codex",
  description: "Ask OpenAI Codex a question or give it a task. Codex has full filesystem access and will read files itself — do NOT pre-gather context or inline file contents into the prompt. Just describe what you need. You MUST call List-Codex-Models first to select an appropriate model. Do NOT set optional parameters unless you have a specific reason. This tool is long-running (1-15 min); delegate this call to a sub-agent or background task.",
  zodSchema: askCodexArgsSchema,
  prompt: {
    description: "Execute 'codex exec <prompt> --full-auto' to get Codex's response.",
  },
  category: 'codex',
  execution: { taskSupport: 'optional' },
  timeoutClass: 'ask',
  execute: async (args, context) => {
    const { prompt, model, sandbox, approvalPolicy } = args;

    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeCodexCLI(
      prompt as string,
      model as string,
      sandbox as string | undefined,
      approvalPolicy as string | undefined,
      context
    );

    return `${STATUS_MESSAGES.CODEX_RESPONSE}\n${result}`;
  }
};
