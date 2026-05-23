# AGENT INSTRUCTIONS

This file provides guidance to Claude Code, Google Gemini, OpenAI Codex, and other agentic development software when working with code in this repository.

## Project Overview

Multi-CLI — an MCP (Model Context Protocol) server that lets AI clients (Claude, Gemini, Codex) call each other as tools. Built with TypeScript and the `@modelcontextprotocol/sdk`. Runs over stdio transport. Published to npm as `@osanoai/multicli`.

## Session Start (Project Entrypoint)

세션 시작 시 **git / bd / memory** 셋을 목적에 따라 분리해서 읽는다. 셋의 역할이 중첩되면 stale 가 누적되고 진입이 느려진다.

1. **git** — 코드/브랜치 상태. `git status`, `git log --oneline -5`, 현재 브랜치 확인. PR 상태는 `gh pr list` / `gh pr view <N> --json state,mergeable,mergeStateStatus`.
2. **bd** (`.beads/`) — **actionable project state 의 1차 정본**. 진입점은 `bd ready` (차단 없는 다음 작업 큐). 추가 조회: `bd list`, `bd show <id>`, `bd dep tree <id>`. GitHub 이슈/PR 은 `--external-ref gh-NNN` 으로 양방향 연결. 작업 종류는 type 필드로 구분 (`bug|feature|task|epic|chore|decision`).
3. **memory** (Claude Code: `~/.claude/projects/.../memory/MEMORY.md` + entries / 다른 에이전트는 각자 상응 시스템) — durable operating principles + cross-session preferences. 근본 원인 분석, 명명/배포 컨벤션, 사용자 역할·응답 톤, 참조 경로. **live status 는 담지 않는다** (실증: 메모리에 PR 상태를 적은 항목이 4일 만에 stale 화됨).

**분할 축은 콘텐츠 유형**:
- WHY/HOW/WHERE/WHO (분석, 컨벤션, 참조, 사용자 선호) → memory
- WHAT/WHEN/STATUS (열린 작업, 상태 전이, 의존, 마감) → bd
- 같은 토픽도 두 곳에 나뉠 수 있다. memory → bd 는 ID 인용 (예: `bd 트래킹: multicli-ncj`) 허용. bd 의 status 를 memory 에 복제 금지.

다음 작업 선택은 항상 `bd ready` 결과 우선. memory 는 분석 참조용으로 호출한다.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: capture the lesson in `tasks/lessons.md` (create it if it doesn't exist)
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

### 7. Test Written Code
- After writing or modifying any source file, write or update corresponding tests
- Run `npm test` to verify all tests pass before marking work complete
- New features require tests; bug fixes require regression tests
- Never reduce coverage — check with `npm run test:coverage` when in doubt

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Record in `tasks/lessons.md` (create if needed)

### 8. Releases
- The release workflow (`release.yml`) uses a **bump PR pattern** triggered on every push to `main` and on `workflow_dispatch`.
- If the current `package.json` version is already published on npm, the workflow creates an automated `chore/version-bump` PR that increments the patch version and enables auto-merge.
- If the current version is **not** on npm (e.g. after the bump PR merges, or after a manual major/minor bump), the workflow runs security scan + tests, then builds, publishes to npm with OIDC provenance, pushes a git tag, and creates a GitHub Release.
- **Do not manually edit `package.json` version for patch releases** — the bump PR handles it automatically.
- For intentional **major** or **minor** version bumps, manually update `package.json` version in your PR. Once merged to `main`, the workflow publishes that version directly (no bump PR needed).

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

# Project Technical Details

## Build & Dev Commands

- `npm run build` — compile TypeScript and copy `src/modelCatalog.generated.json` into `dist/`
- `npm run dev` — build then run (`tsc && node dist/index.js`)
- `npm start` — run compiled server (`node dist/index.js`)
- `npm run lint` — type-check without emitting (`tsc --noEmit`)
- `npm run refresh-catalog` — run `scripts/refresh-catalog.ts` to regenerate the model catalog
- `npm run prepublishOnly` — safety reminder + build before publish
- `npm run prepare` — install Husky git hooks (`husky || true`)

## Model Catalog Maintenance

When OpenAI Codex (or any wrapped CLI) releases new model IDs (e.g. `gpt-5.5`), update `src/modelCatalog.generated.json` so Ask-Codex's whitelist validation accepts them. The catalog is the single source of truth for the schema-level allowlist that prevents LLM hallucination of model IDs.

Procedure (Codex case; analogous for claude/gemini):

1. **Capture authoritative IDs** — run both `codex --help` (CLI options + global flags) and `codex` (interactive TUI, then `/model`) and record the full model ID list.
2. **Regenerate catalog** — `npm run refresh-catalog`. The generator (`scripts/refresh-catalog.ts`) clones `openai/codex` and probes each ID via `codex exec -m <id>`. PROBE-rejected IDs (e.g. ChatGPT-account-incompatible models) will not be written into the catalog.
3. **Cross-check** — diff the codex section of `src/modelCatalog.generated.json` against step 1's ID list. Record any PROBE-rejected IDs and their reason (e.g. `invalid_request_error: model not supported when using Codex with a ChatGPT account`).
4. **Run catalog tests** — `npm test -- tests/refreshCatalog.test.ts tests/modelCatalog.test.ts`. The drift-detect snapshot in `tests/modelCatalog.test.ts` (`codex catalog drift detect (R1)`) must be updated alongside any genuine ID-pool change.
5. **Verify schema description sync** — `npm test -- tests/tools/ask-codex.tool.test.ts`. The Ask-Codex tool's zodSchema `model` description auto-syncs from the catalog; this test confirms allowlist propagation.
6. **PR body** — list the new model ID pool in the PR description for review traceability.

Reference incident (2026-05-21): LLM-generated `gpt-5.3` (an abbreviation of `gpt-5.3-codex`) was silently turning into `invalid_request_error` from codex because no schema-level allowlist existed. Plan-review rounds R1–R3 (archived under `tmp/archive/2026-05/`) introduced the catalog-backed validation pattern documented here.

## Testing

- `npm test` — run all tests (`vitest run`)
- `npm run test:watch` — run tests in watch mode (`vitest`)
- `npm run test:coverage` — run tests with coverage (`vitest run --coverage`)
- **Framework**: Vitest 4.x with globals enabled
- **Test files**: `tests/**/*.test.ts` (13 files, 194 tests)
- **CI**: `.github/workflows/tests.yml` runs lint, build, and tests on Node 20, 22, and 24
- **Mocking**: `vi.mock()` for fs/os/child_process and internal modules; pure-logic modules tested without mocks

## Framework

- **Runtime**: Node.js >=20.0.0, ESM (`"type": "module"`)
- **Language**: TypeScript 5.9.x (strict mode, target ES2022, module Node16)
- **Core dependencies**: `@modelcontextprotocol/sdk` ^1.27.1 (MCP server + stdio transport), `zod` ^4.3.6 (tool argument schemas), `dotenv` ^17.3.1 (environment loading)
- **Dev dependencies**: Vitest ^4.0.18 with V8 coverage, Husky ^9.1.7 for git hooks
- **Architecture**: Dynamic tool registry pattern — tool definitions live in `src/tools/`, `initTools()` registers only CLIs detected on the machine, and `src/index.ts` wires MCP tool/prompt handlers, client-specific tool filtering, and progress notifications over stdio.

# Authorship
All PRs and Commits to this repository must include a reference to "Claude, Codex, and Gemini" as the authors.

# Symlinks
CLAUDE.md and GEMINI.md and CODEX.md are symlinks to AGENTS.md - AGENTS.md is the only file that should ever be edited.
