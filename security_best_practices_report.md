# Security Best Practices Report — Multi-CLI

Date: 2026-03-03

## Executive Summary
Multi-CLI is an MCP server that executes external AI CLIs (Gemini/Codex/Claude) based on tool calls. The primary risks are (1) unauthenticated tool execution leading to filesystem access and external command execution, (2) Windows command injection via shell execution with untrusted arguments, and (3) cache key handling that can enable cross-client data exposure and path traversal to read/delete JSON files. No hardcoded secrets were found, but error handling can leak sensitive CLI output, and dependency management relies on caret ranges without automated vulnerability checks.

---

## High Severity

### H-1 — Windows command injection via `shell: true` and untrusted arguments
- **Location:** `src/utils/commandExecutor.ts:12-16`, `src/utils/codexExecutor.ts:11-27`, `src/utils/claudeExecutor.ts:12-31`, `src/utils/geminiExecutor.ts:84-95`
- **Description:** On Windows, `executeCommand` runs with `shell: true` and passes user-controlled arguments (prompt/model/systemPrompt/etc.) directly to the shell. An attacker can craft prompt/model strings with shell metacharacters that are interpreted by `cmd.exe`, leading to command injection when the server is running on Windows.
- **Recommended Fix:** Avoid `shell: true` for user-supplied arguments. Resolve CLI executable paths and use `spawn`/`execFile` with `shell: false`. If Windows `.cmd` execution is required, route through a safe wrapper that properly escapes arguments (or use `cross-spawn` with `shell: false`) and validate/sanitize prompt/model values to disallow shell metacharacters when a shell is unavoidable.

### H-2 — No authentication/authorization for tool execution
- **Location:** `src/index.ts:172-246`
- **Description:** The MCP server accepts any incoming tool call and executes it without authenticating the client. Any process that can connect via stdio can invoke tools to run external CLIs with filesystem access. Client filtering only hides a client’s own tools; it does not enforce allowlists or auth.
- **Recommended Fix:** Implement explicit authentication/authorization for tool calls (e.g., shared secret in request metadata, allowlisted client IDs, or a per-client policy). Reject unauthenticated/unauthorized callers before `executeTool`.

### H-3 — Server allows bypass of CLI safeguards (sandbox/permission modes)
- **Location:** `src/tools/ask-codex.tool.ts:6-10`, `src/tools/ask-claude.tool.ts:6-11`
- **Description:** Tool schemas permit `danger-full-access` and `bypassPermissions` modes without any server-side guard. Untrusted clients can disable safety checks or allow unrestricted filesystem access.
- **Recommended Fix:** Enforce a server-side policy (e.g., env allowlist) that restricts unsafe modes by default. Only permit elevated modes when explicitly enabled by the operator.

---

## Medium Severity

### M-1 — Cache key path traversal allowing arbitrary `.json` file read/delete
- **Location:** `src/tools/fetch-chunk.tool.ts:6-9, 30-35`, `src/utils/chunkCache.ts:59-78`
- **Description:** `cacheKey` is an unvalidated string and is concatenated into a file path via `path.join`. An attacker can supply `../` segments to read or delete JSON files outside the cache directory (e.g., `../../some/secret` → `/tmp/.../../../some/secret.json`).
- **Recommended Fix:** Validate `cacheKey` strictly (e.g., `/^[a-f0-9]{8}$/`) and reject anything else. Also verify that `path.resolve(CACHE_DIR, filename)` stays within `CACHE_DIR` before file access.

### M-2 — Cross-client cache disclosure via guessable cache keys
- **Location:** `src/utils/chunkCache.ts:33-36`, `src/utils/geminiExecutor.ts:104-122`, `src/tools/ask-gemini.tool.ts:14-35`, `src/tools/fetch-chunk.tool.ts:30-35`
- **Description:** Cache keys are deterministic (first 8 hex chars of prompt hash) and any client can request chunks by cache key without proving knowledge of the original prompt. In multi-client or shared-host scenarios, this allows unauthorized access to other users’ change-mode outputs.
- **Recommended Fix:** Use random, per-request nonces (cryptographically strong) and bind them to a client/session identifier. Validate ownership before returning cached chunks.

### M-3 — Unbounded prompt/output size can cause memory exhaustion (DoS)
- **Location:** `src/utils/commandExecutor.ts:19-32, 37-58`, `src/tools/ask-claude.tool.ts:6-11`, `src/tools/ask-codex.tool.ts:6-11`, `src/tools/ask-gemini.tool.ts:9-16`
- **Description:** Prompts have no max length and CLI outputs are accumulated entirely in memory. A large prompt or long-running CLI output can cause high memory usage and crash the server.
- **Recommended Fix:** Enforce input size limits at the schema level, cap buffered output size, and truncate or stream outputs with backpressure.

---

## Low Severity

### L-1 — Error responses may leak sensitive CLI output
- **Location:** `src/utils/commandExecutor.ts:56-58`, `src/index.ts:231-238`
- **Description:** On failure, stderr content is returned to the caller. CLI errors can include filesystem paths, configuration, or credential-related information that should not be exposed to untrusted clients.
- **Recommended Fix:** Sanitize/trim error output before returning it to callers. Log full errors locally with redaction, and return a generic error message with a correlation ID.

### L-2 — Implicit `.env` loading from current working directory
- **Location:** `src/index.ts:2`
- **Description:** `dotenv/config` loads environment variables from the current working directory. If the server is launched from an untrusted directory, a malicious `.env` could alter runtime behavior.
- **Recommended Fix:** In production, disable implicit `.env` loading or require an explicit `DOTENV_CONFIG_PATH` and restrict permissions on the directory that contains it.

---

## Informational

### I-1 — Dependency version ranges and missing automated vulnerability checks
- **Location:** `package.json:46-57`
- **Description:** Dependencies use caret ranges (`^`), which allow automatic minor/patch updates without explicit review. There is no configured audit step in scripts/CI.
- **Recommended Fix:** Run `npm audit` (or `pnpm audit`) in CI, and consider using lockfile-enforced installs (`npm ci`) with periodic, reviewed dependency updates.

---

## Non-Findings (Evidence-Backed)
- **No hardcoded secrets found:** Searched for common secret/key patterns; none present in `src/`. `.env` exists but only contains `QA_NO_CLIS=false`.
- **No unauthenticated network endpoints:** Server uses stdio transport only; no HTTP endpoints observed.

