# TESTS.md — Multi-CLI Verification Suite

## Purpose

These tests verify that the **Multi-CLI** MCP server behaves correctly: tools are registered, requests succeed, errors are graceful, and client-based filtering works. Tests target **application behavior**, not the quality of AI-generated responses.

### Conventions

- **PASS**: Expected result matches actual result.
- **FAIL**: Expected result does not match, or an unexpected error occurs.
- **SKIP**: A prerequisite is not met (e.g., a CLI is not installed). Document the reason.

### Who Runs These Tests

Any AI agent connected to Multi-CLI via MCP. The bootstrap section below lets the agent discover which backends are visible and set up variables used by every test.

---

## Bootstrap: Discovering Your Tools

Before running any test suite, execute these steps to establish your testing context. All subsequent tests reference the variables defined here — no backend names are hardcoded.

### Step 1 — Enumerate visible tools

Call `tools/list` via MCP. Record every tool name returned.

### Step 2 — Identify backends by prefix

Group tools by their name prefix. The three possible prefixes are:

| Prefix | Backend |
|--------|---------|
| `gemini-` | Gemini CLI |
| `codex-` | Codex CLI |
| `claude-` | Claude CLI |

You should see tools from exactly **two** of these three prefixes. The missing prefix is your own backend (Multi-CLI hides your own tools from you).

### Step 3 — Assign variables

| Variable | Value |
|----------|-------|
| **Backend A** | First visible prefix (alphabetical) |
| **Backend B** | Second visible prefix (alphabetical) |
| **Hidden Backend** | The prefix that is absent — this is you |

For each visible backend, you should see three tools following this naming convention:

| Tool pattern | Purpose |
|--------------|---------|
| `{prefix}ask` | Send a prompt to that backend |
| `{prefix}list-models` | List available models |
| `{prefix}help` | Show CLI help text |

Gemini also exposes `Fetch-Chunk` (4 tools total). Record which tools you see.

### Step 4 — Pick models

For each visible backend, call `{prefix}list-models` (no arguments). Parse the response to find the recommended model for that backend. Store as:

| Variable | Value |
|----------|-------|
| **Model A** | Recommended model for Backend A |
| **Model B** | Recommended model for Backend B |

### Step 5 — Confirm readiness

You should now have: Backend A, Backend B, Hidden Backend, Model A, Model B, and a full tool list. Proceed to the test suites.

---

## Suite 1: Tool Discovery

> **Requires CLI**: No
> **Priority**: Run first — validates the foundation everything else depends on.

### Test 1.1 — Tool count per backend

**Steps**: Count tools grouped by each visible prefix.

**Expected**: Each visible backend has at least 3 tools (`ask`, `list-models`, `help`). If Gemini is visible, it has 4 (adds `Fetch-Chunk`).

**Pass if**: Counts match. **Fail if**: Any visible backend has fewer tools than expected.

### Test 1.2 — No hidden tools visible

**Steps**: Search the full tool list for any tool whose prefix matches Hidden Backend.

**Expected**: Zero tools found with the Hidden Backend prefix.

**Pass if**: No hidden tools appear. **Fail if**: Any tool with the Hidden Backend prefix is listed.

### Test 1.3 — Tool schemas present

**Steps**: For each visible tool, inspect the `inputSchema` property returned by `tools/list`.

**Expected**: Every tool has a non-empty `inputSchema` of type `object` with a `properties` field.

**Pass if**: All tools have valid schemas. **Fail if**: Any tool has a missing or malformed schema.

### Test 1.4 — Ask tools require prompt and model

**Steps**: For both `{Backend A}ask` and `{Backend B}ask`, inspect the `inputSchema.required` array.

**Expected**: Both `prompt` and `model` appear in the `required` array.

**Pass if**: Both fields are required. **Fail if**: Either field is missing from `required`.

---

## Suite 2: List-Models

> **Requires CLI**: No
> **Priority**: Run early — provides model names needed by later suites.

### Test 2.1 — Backend A list-models returns content

**Steps**: Call `{Backend A}list-models` with no arguments (`{}`).

**Expected**: Response contains text content listing model families and specific model IDs.

**Pass if**: Response is non-empty and contains at least one model identifier. **Fail if**: Empty response or error.

### Test 2.2 — Backend B list-models returns content

**Steps**: Call `{Backend B}list-models` with no arguments (`{}`).

**Expected**: Same as 2.1 but for Backend B.

**Pass if**: Response is non-empty and contains at least one model identifier. **Fail if**: Empty response or error.

### Test 2.3 — List-models accepts no arguments

**Steps**: Call `{Backend A}list-models` with an empty object `{}`.

**Expected**: Succeeds without validation error.

**Pass if**: No error about invalid arguments. **Fail if**: Validation error returned.

---

## Suite 3: Help Tools

> **Requires CLI**: Yes — executes the actual CLI `--help` command.
> **Skip if**: The CLI for the target backend is not installed.

### Test 3.1 — Backend A help returns CLI output

**Steps**: Call `{Backend A}help` with no arguments (`{}`).

**Expected**: Response contains usage information, flags, or command descriptions from the CLI.

**Pass if**: Response is non-empty and resembles CLI help text. **Fail if**: Error or empty response.

### Test 3.2 — Backend B help returns CLI output

**Steps**: Call `{Backend B}help` with no arguments (`{}`).

**Expected**: Same as 3.1 but for Backend B.

**Pass if**: Response is non-empty and resembles CLI help text. **Fail if**: Error or empty response.

---

## Suite 4: Ask — Validation

> **Requires CLI**: No — these tests verify input validation before any CLI is invoked.
> **Priority**: Run early to confirm schema enforcement.

### Test 4.1 — Missing prompt (Backend A)

**Steps**: Call `{Backend A}ask` with `{ "model": "{Model A}" }` (no `prompt` field).

**Expected**: Validation error mentioning that `prompt` is required.

**Pass if**: Error message includes "prompt" and indicates a required/missing field. **Fail if**: Request succeeds or error is unrelated.

### Test 4.2 — Missing model (Backend A)

**Steps**: Call `{Backend A}ask` with `{ "prompt": "hello" }` (no `model` field).

**Expected**: Validation error mentioning that `model` is required.

**Pass if**: Error message includes "model" and indicates a required/missing field. **Fail if**: Request succeeds or error is unrelated.

### Test 4.3 — Empty prompt string (Backend A)

**Steps**: Call `{Backend A}ask` with `{ "prompt": "", "model": "{Model A}" }`.

**Expected**: Validation error. The prompt field has a minimum length of 1 character.

**Pass if**: Error references prompt validation (too short / min length). **Fail if**: Request proceeds to CLI execution.

### Test 4.4 — Empty model string (Backend A)

**Steps**: Call `{Backend A}ask` with `{ "prompt": "hello", "model": "" }`.

**Expected**: Validation error. The model field has a minimum length of 1 character.

**Pass if**: Error references model validation. **Fail if**: Request proceeds to CLI execution.

### Test 4.5 — Missing prompt (Backend B)

**Steps**: Same as 4.1 but targeting `{Backend B}ask` with `{ "model": "{Model B}" }`.

**Expected**: Validation error about missing prompt.

**Pass if**: Error message includes "prompt". **Fail if**: Succeeds or irrelevant error.

### Test 4.6 — Missing model (Backend B)

**Steps**: Same as 4.2 but targeting `{Backend B}ask` with `{ "prompt": "hello" }`.

**Expected**: Validation error about missing model.

**Pass if**: Error message includes "model". **Fail if**: Succeeds or irrelevant error.

### Test 4.7 — Both fields missing (Backend A)

**Steps**: Call `{Backend A}ask` with `{}`.

**Expected**: Validation error mentioning both `prompt` and `model`.

**Pass if**: Error references both fields. **Fail if**: Only one field mentioned or request succeeds.

### Test 4.8 — Extra unknown fields are tolerated

**Steps**: Call `{Backend A}ask` with `{ "prompt": "hello", "model": "{Model A}", "unknownField": "value" }`.

**Expected**: The request either succeeds (extra fields stripped) or fails only on the unknown field — it should NOT cause a crash or unrelated error.

**Pass if**: Graceful behavior (success or clean validation error). **Fail if**: Unhandled exception or crash.

### Test 4.9 — Wrong type for prompt

**Steps**: Call `{Backend A}ask` with `{ "prompt": 42, "model": "{Model A}" }`.

**Expected**: Validation error indicating `prompt` must be a string.

**Pass if**: Error references type mismatch. **Fail if**: Request proceeds or crashes.

---

## Suite 5: Ask — Execution

> **Requires CLI**: Yes — sends real prompts to backend CLIs.
> **Skip if**: The CLI for the target backend is not installed.

### Test 5.1 — Simple prompt (Backend A)

**Steps**: Call `{Backend A}ask` with `{ "prompt": "Reply with exactly: MULTICLI_TEST_OK", "model": "{Model A}" }`.

**Expected**: Response contains text content. The response prefix should match the backend's status message pattern (e.g., "Gemini response:", "Codex response:", or "Claude response:").

**Pass if**: Non-empty response with recognizable backend prefix. **Fail if**: Error or empty response.

### Test 5.2 — Simple prompt (Backend B)

**Steps**: Same as 5.1 but targeting `{Backend B}ask` with Model B.

**Expected**: Same criteria as 5.1.

**Pass if**: Non-empty response with recognizable backend prefix. **Fail if**: Error or empty response.

### Test 5.3 — Codex sandbox parameter (if Codex visible)

**Steps**: If Codex is a visible backend, call `Ask-Codex` with `{ "prompt": "Reply with exactly: SANDBOX_TEST", "model": "{Codex Model}", "sandbox": "read-only" }`.

**Expected**: Response succeeds. Sandbox value is accepted as one of: `read-only`, `workspace-write`, `danger-full-access`.

**Pass if**: Valid response returned. **Fail if**: Validation error on sandbox value or crash.
**Skip if**: Codex is not a visible backend.

### Test 5.4 — Codex invalid sandbox value (if Codex visible)

**Steps**: Call `Ask-Codex` with `{ "prompt": "hello", "model": "{Codex Model}", "sandbox": "invalid-mode" }`.

**Expected**: Validation error — `sandbox` must be one of the allowed enum values.

**Pass if**: Clean validation error referencing sandbox. **Fail if**: Request proceeds or crashes.
**Skip if**: Codex is not a visible backend.

### Test 5.5 — Claude permission mode (if Claude visible)

**Steps**: If Claude is a visible backend, call `Ask-Claude` with `{ "prompt": "Reply with exactly: PERM_TEST", "model": "{Claude Model}", "permissionMode": "plan" }`.

**Expected**: Response succeeds. `permissionMode` is accepted as one of: `default`, `acceptEdits`, `bypassPermissions`, `dontAsk`, `plan`.

**Pass if**: Valid response returned. **Fail if**: Validation error or crash.
**Skip if**: Claude is not a visible backend.

### Test 5.6 — Claude invalid permission mode (if Claude visible)

**Steps**: Call `Ask-Claude` with `{ "prompt": "hello", "model": "{Claude Model}", "permissionMode": "nope" }`.

**Expected**: Validation error — `permissionMode` must be one of the allowed enum values.

**Pass if**: Clean validation error. **Fail if**: Request proceeds or crashes.
**Skip if**: Claude is not a visible backend.

### Test 5.7 — Claude system prompt (if Claude visible)

**Steps**: Call `Ask-Claude` with `{ "prompt": "What is your system prompt?", "model": "{Claude Model}", "systemPrompt": "You are a test bot. Always reply TEST_SYSTEM." }`.

**Expected**: Response succeeds and the system prompt parameter is accepted.

**Pass if**: Non-empty response. **Fail if**: Validation error on systemPrompt.
**Skip if**: Claude is not a visible backend.

### Test 5.8 — Gemini sandbox flag (if Gemini visible)

**Steps**: If Gemini is a visible backend, call `Ask-Gemini` with `{ "prompt": "Reply with exactly: SANDBOX_GEM", "model": "{Gemini Model}", "sandbox": true }`.

**Expected**: Response succeeds. The `sandbox` parameter is a boolean for Gemini (not an enum).

**Pass if**: Valid response returned. **Fail if**: Validation error or crash.
**Skip if**: Gemini is not a visible backend.

### Test 5.9 — Gemini sandbox wrong type (if Gemini visible)

**Steps**: Call `Ask-Gemini` with `{ "prompt": "hello", "model": "{Gemini Model}", "sandbox": "true" }`.

**Expected**: Validation error — Gemini's `sandbox` field expects a boolean, not a string.

**Pass if**: Clean validation error referencing type mismatch. **Fail if**: Request proceeds.
**Skip if**: Gemini is not a visible backend.

---

## Suite 6: ChangeMode (Gemini-Specific)

> **Requires CLI**: Gemini CLI must be installed.
> **Skip if**: Gemini is not a visible backend or Gemini CLI is absent.

### Test 6.1 — ChangeMode flag accepted

**Steps**: Call `Ask-Gemini` with `{ "prompt": "Suggest a one-line comment addition to a Python hello world script", "model": "{Gemini Model}", "changeMode": true }`.

**Expected**: Response succeeds. Output should contain structured edit information or a changeMode-formatted response. If the response is large enough to be chunked, a `cacheKey` and `chunkIndex` will appear in the response text.

**Pass if**: Non-empty response, no validation error. **Fail if**: Error or crash.

### Test 6.2 — ChangeMode with chunkIndex

**Steps**: Call `Ask-Gemini` with `{ "prompt": "Write a 500-line Python program with detailed comments on every line", "model": "{Gemini Model}", "changeMode": true, "chunkIndex": 1 }`.

**Expected**: Response succeeds. The `chunkIndex` parameter (1-based) is accepted alongside `changeMode`.

**Pass if**: Non-empty response. **Fail if**: Validation error on chunkIndex.

### Test 6.3 — ChangeMode defaults to false

**Steps**: Call `Ask-Gemini` with `{ "prompt": "Say hello", "model": "{Gemini Model}" }` (no `changeMode` field).

**Expected**: Response is a standard text response, not changeMode-formatted.

**Pass if**: Response does not contain chunked edit formatting. **Fail if**: Unexpected changeMode output.

---

## Suite 7: Fetch-Chunk (Gemini-Specific)

> **Requires**: Suite 6 must produce a cached chunk (a `cacheKey`). If Suite 6 did not produce a cacheKey, skip this suite.
> **Skip if**: Gemini is not a visible backend.

### Test 7.1 — Fetch valid chunk

**Steps**: Using the `cacheKey` from Suite 6, call `Fetch-Chunk` with `{ "cacheKey": "{cacheKey}", "chunkIndex": 1 }`.

**Expected**: Response contains chunk content from the cached response.

**Pass if**: Non-empty chunk content returned. **Fail if**: Error or empty response.

### Test 7.2 — Fetch chunk index out of range

**Steps**: Call `Fetch-Chunk` with `{ "cacheKey": "{cacheKey}", "chunkIndex": 9999 }`.

**Expected**: Error or informational message indicating the chunk index is out of range.

**Pass if**: Graceful error with range information. **Fail if**: Crash or unrelated error.

### Test 7.3 — Fetch chunk with zero index

**Steps**: Call `Fetch-Chunk` with `{ "cacheKey": "{cacheKey}", "chunkIndex": 0 }`.

**Expected**: Validation error — `chunkIndex` has a minimum value of 1 (1-based indexing).

**Pass if**: Error referencing minimum value. **Fail if**: Returns content for index 0.

### Test 7.4 — Invalid cache key

**Steps**: Call `Fetch-Chunk` with `{ "cacheKey": "nonexistent_key_abc123", "chunkIndex": 1 }`.

**Expected**: Error message explaining the cache key is invalid, possibly mentioning expiry, wrong key, or MCP restart. The response includes TTL information (10-minute cache).

**Pass if**: Clear error about invalid/expired cache. **Fail if**: Crash or unrelated error.

### Test 7.5 — Missing cacheKey field

**Steps**: Call `Fetch-Chunk` with `{ "chunkIndex": 1 }`.

**Expected**: Validation error — `cacheKey` is a required field.

**Pass if**: Error references missing cacheKey. **Fail if**: Succeeds or crashes.

### Test 7.6 — Missing chunkIndex field

**Steps**: Call `Fetch-Chunk` with `{ "cacheKey": "anything" }`.

**Expected**: Validation error — `chunkIndex` is a required field.

**Pass if**: Error references missing chunkIndex. **Fail if**: Succeeds or crashes.

### Test 7.7 — Negative chunkIndex

**Steps**: Call `Fetch-Chunk` with `{ "cacheKey": "anything", "chunkIndex": -1 }`.

**Expected**: Validation error — `chunkIndex` must be >= 1.

**Pass if**: Error referencing minimum value. **Fail if**: Succeeds or crashes.

---

## Suite 8: CLI Missing

> **Requires**: Intentionally absent CLI — only run this suite when you know a specific CLI is **not** installed on the system.
> **Skip if**: You cannot confirm a CLI is absent, or if your environment has all CLIs installed.

### Test 8.1 — Ask with missing CLI

**Steps**: Call `{prefix}ask` for a backend whose CLI is known to be absent, with valid prompt and model arguments.

**Expected**: Error message indicating the CLI could not be found or executed. The error should not be a validation error — validation passes, but execution fails.

**Pass if**: Clear error about CLI execution failure (not a validation error). **Fail if**: Succeeds, crashes, or returns a validation error.

### Test 8.2 — Help with missing CLI

**Steps**: Call `{prefix}help` for a backend whose CLI is known to be absent.

**Expected**: Error message about CLI execution failure.

**Pass if**: Clear CLI-not-found error. **Fail if**: Succeeds or crashes.

---

## Suite 9: Hidden Tools (Access Control)

> **Requires CLI**: No
> **Priority**: Run early — validates the core security/filtering mechanism.

### Test 9.1 — Cannot call hidden tool

**Steps**: Attempt to call `{Hidden Backend}ask` with `{ "prompt": "hello", "model": "any-model" }`.

**Expected**: Error: `"Unknown tool: {Hidden Backend}ask"`. The server treats the hidden tool as if it does not exist.

**Pass if**: Error message matches `"Unknown tool: {toolName}"`. **Fail if**: Tool executes successfully or returns a different error.

### Test 9.2 — Cannot call hidden list-models

**Steps**: Attempt to call `{Hidden Backend}list-models`.

**Expected**: Error: `"Unknown tool: {Hidden Backend}list-models"`.

**Pass if**: Error message matches the pattern. **Fail if**: Tool executes or different error.

---

## Suite 10: Prompts

> **Requires CLI**: No
> **Priority**: Run after Suite 1.

### Test 10.1 — List prompts returns entries

**Steps**: Call `prompts/list` via MCP.

**Expected**: Response contains prompt entries. Each prompt has a `name` and `description`.

**Pass if**: At least one prompt returned with valid structure. **Fail if**: Empty list or malformed entries.

### Test 10.2 — Prompts are filtered by client

**Steps**: Check that no prompt in the `prompts/list` response has a name matching the Hidden Backend prefix.

**Expected**: Zero prompts with the Hidden Backend prefix.

**Pass if**: No hidden prompts visible. **Fail if**: Any hidden prompt appears.

### Test 10.3 — Get a visible prompt

**Steps**: Pick any prompt from the `prompts/list` response. Call `prompts/get` with that prompt's name.

**Expected**: Response includes the prompt's `messages` array with at least one message containing `role` and `content`.

**Pass if**: Valid prompt message returned. **Fail if**: Error or empty messages.

### Test 10.4 — Get a hidden prompt

**Steps**: Attempt `prompts/get` with a prompt name using the Hidden Backend prefix (e.g., `{Hidden Backend}ask`).

**Expected**: Error: `"Unknown prompt: {promptName}"`.

**Pass if**: Error matches the pattern. **Fail if**: Prompt returned or different error.

---

## Suite 11: Resilience

> **Requires CLI**: Partial — some tests need a working CLI, others do not.

### Test 11.1 — Nonexistent tool name

**Steps**: Attempt to call a tool named `nonexistent-tool-xyz` via MCP.

**Expected**: Error indicating the tool is not found (e.g., contains "not found in registry" or "Unknown tool").

**Pass if**: Clean error about unknown tool. **Fail if**: Crash or no error.

### Test 11.2 — Very long prompt

**Steps**: Call `{Backend A}ask` with a prompt consisting of 5,000 characters of repeated text and a valid model.

**Expected**: The request either succeeds (CLI handles it) or fails with a CLI-level error — not a server crash or unhandled exception.

**Pass if**: Graceful success or graceful error. **Fail if**: Timeout with no response, crash, or unhandled exception.

### Test 11.3 — Special characters in prompt

**Steps**: Call `{Backend A}ask` with `{ "prompt": "Test with special chars: <>&\"'\\n\\t$(echo inject)", "model": "{Model A}" }`.

**Expected**: No command injection occurs. The prompt is passed safely to the CLI. Response is either a normal reply or a graceful error.

**Pass if**: No evidence of command injection; response is normal. **Fail if**: Shell command injection observed or server crash.

### Test 11.4 — Concurrent requests

**Steps**: Simultaneously call `{Backend A}ask` and `{Backend B}ask` with simple prompts and their respective models.

**Expected**: Both requests complete independently. Neither blocks or corrupts the other.

**Pass if**: Both return valid, independent responses. **Fail if**: One or both fail due to concurrency, or responses are mixed.

---

## Execution Order

Run suites in this order to maximize coverage while respecting dependencies:

### Phase 1 — Offline (no CLI required)

1. **Bootstrap** — establish variables
2. **Suite 1: Tool Discovery** — validate tool registration
3. **Suite 2: List-Models** — get model names for later tests
4. **Suite 4: Ask — Validation** — confirm schema enforcement
5. **Suite 9: Hidden Tools** — verify access control
6. **Suite 10: Prompts** — check prompt filtering

### Phase 2 — Live (CLI required)

7. **Suite 3: Help Tools** — basic CLI connectivity check
8. **Suite 5: Ask — Execution** — end-to-end prompt execution
9. **Suite 6: ChangeMode** — Gemini-specific (skip if Gemini not visible)
10. **Suite 7: Fetch-Chunk** — depends on Suite 6 producing a cacheKey

### Phase 3 — Edge Cases

11. **Suite 11: Resilience** — stress and safety tests
12. **Suite 8: CLI Missing** — only if a CLI is intentionally absent

---

## Summary Checklist

After running all applicable suites, record results here:

| Suite | Tests | Passed | Failed | Skipped |
|-------|-------|--------|--------|---------|
| 1. Tool Discovery | 4 | | | |
| 2. List-Models | 3 | | | |
| 3. Help Tools | 2 | | | |
| 4. Ask — Validation | 9 | | | |
| 5. Ask — Execution | 9 | | | |
| 6. ChangeMode | 3 | | | |
| 7. Fetch-Chunk | 7 | | | |
| 8. CLI Missing | 2 | | | |
| 9. Hidden Tools | 2 | | | |
| 10. Prompts | 4 | | | |
| 11. Resilience | 4 | | | |
| **Total** | **49** | | | |

Record any notes on failures or skips below the table.
