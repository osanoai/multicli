# AGENT INSTRUCTIONS

This file provides guidance to Claude Code, Google Gemini, OpenAI Codex, and other agentic development software when working with code in this repository.

## Project Overview

Multi-CLI — an MCP (Model Context Protocol) server that lets AI clients (Claude, Gemini, Codex) call each other as tools. Built with TypeScript and the `@modelcontextprotocol/sdk`. Runs over stdio transport. Published to npm as `multicli

## Workflow Orchestration

### 1. Plan Node Default
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
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
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
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

# Project Technical Details

## Build & Dev Commands

- `npm run build` — compile TypeScript (`tsc`) to `dist/`
- `npm run dev` — build then run (`tsc && node dist/index.js`)
- `npm start` — run compiled server (`node dist/index.js`)
- `npm run lint` — type-check without emitting (`tsc --noEmit`)
- `npm run docs:dev` — local VitePress docs server
- `npm run docs:build` — build static docs site

## Testing

No test framework is configured yet. `npm test` is a no-op placeholder. When adding tests, pick a runner (e.g., vitest) and wire it into the `test` script.

## Framework

- **Runtime**: Node.js >=18, ESM (`"type": "module"`)
- **Language**: TypeScript 5.x (strict mode, target ES2022, module Node16)
- **Core dependency**: `@modelcontextprotocol/sdk` — MCP server + stdio transport
- **Validation**: `zod` for tool argument schemas
- **Docs**: VitePress with Mermaid plugin
- **Architecture**: Tool registry pattern — each tool in `src/tools/` exports a definition + executor. `src/index.ts` wires the MCP server, request handlers, and progress notifications.
