// Codex Markdown file preloader (issue #138 follow-up — codex 0.135.0-era workaround).
//
// On Windows, codex-cli 0.135.0's sandbox cannot spawn ANY subprocess
// (`windows sandbox: spawn setup refresh`, exited -1 in 0ms) — both PowerShell
// `Get-Content` and Node `node_repl` fail at sandbox setup. So codex cannot read
// pre-existing files at all (writes survive only via the internal apply_patch).
// This was empirically isolated: env (CODEX_MANAGED_PACKAGE_ROOT) and the
// WindowsApps pwsh were both ruled out by direct reproduction.
//
// multicli runs as a normal Node process (no sandbox), so it CAN read files.
// This module detects Markdown references in the prompt before Ask-Codex is
// invoked, reads them itself, and inlines their contents so codex reviews the
// inline text instead of reading from disk.
//
// NOTE: This is a workaround for the codex 0.135.0-era vendor bug. When codex
// fixes its Windows sandbox spawn, this can be disabled (MULTICLI_WINDOWS_CODEX_NO_PRELOAD=1)
// or removed — inlining stays harmless in the meantime.

import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  realpathSync as nodeRealpathSync,
  statSync as nodeStatSync,
} from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRELOAD_HEADER_TAG = '<multicli-preloaded-files';

const PER_FILE_LIMIT = 200 * 1024;
const TOTAL_LIMIT = 500 * 1024;
const INLINE_EXTENSIONS = new Set(['.md', '.markdown']);
// Korean + English read/review verbs used by the intent classifier (F-03).
const READ_VERB_RE = /(읽|열|리뷰|요약|감사|검토|분석|\bread\b|\bopen\b|\breview\b|summari|audit)/i;

export class FilePreloadError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly reason: string,
  ) {
    super(`Failed to preload ${filePath}: ${reason}`);
    this.name = 'FilePreloadError';
  }
}

export interface PreloadContext {
  cwd?: string;
  projectRoots?: ReadonlyArray<{ uri?: string; name?: string }>;
}

export interface PreloadDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string) => string;
  statSync?: (p: string) => { size: number };
  realpathSync?: (p: string) => string;
}

interface Candidate {
  token: string; // original (post-normalize) token used as display path
  normalized: string;
  hasSignal: boolean;
}

function hasInlineExtension(t: string): boolean {
  const lower = t.toLowerCase();
  for (const ext of INLINE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function normalizeToken(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^["'`]+/, '').replace(/["'`]+$/, ''); // unwrap quotes/backticks
  t = t.replace(/^@+/, ''); // strip leading @
  t = t.replace(/[.,;:)\]}!?]+$/, ''); // trim trailing punctuation
  return t.trim();
}

function hasVerbNearby(prompt: string, idx: number, len: number): boolean {
  const start = Math.max(0, idx - 30);
  const end = Math.min(prompt.length, idx + len + 30);
  return READ_VERB_RE.test(prompt.slice(start, end));
}

function detectCandidates(prompt: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const add = (token: string, normalized: string, hasSignal: boolean): void => {
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ token, normalized, hasSignal });
  };

  // 1) Quoted / backtick tokens — quoting is itself a reference signal, and
  //    these may contain spaces (F-02: "D:\My Docs\plan.md").
  const quotedRe = /(["'`])([^"'`]+?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = quotedRe.exec(prompt)) !== null) {
    const inner = m[2].trim();
    const norm = normalizeToken(inner);
    if (norm && hasInlineExtension(norm) && !norm.includes('://')) {
      add(norm, norm, true);
    }
  }

  // 2) Bare path-like tokens (no spaces). Lookbehind/ahead keep us off URLs
  //    and word fragments.
  const re =
    /(?<![A-Za-z0-9._/\\-])@?((?:\.{1,2}[\\/]|[A-Za-z]:[\\/])?(?:[\w.\-]+[\\/])*[\w.\-]+\.(?:md|markdown))(?![\w])/gi;
  while ((m = re.exec(prompt)) !== null) {
    const full = m[0];
    const norm = normalizeToken(full);
    if (!norm || !hasInlineExtension(norm) || norm.includes('://')) continue;
    const hasSep = /[\\/]/.test(norm);
    const hadAt = full.trimStart().startsWith('@');
    const verbAdjacent = hasVerbNearby(prompt, m.index, full.length);
    add(norm, norm, hasSep || hadAt || verbAdjacent);
  }

  return out;
}

function buildRoots(context: PreloadContext | undefined): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (p?: string): void => {
    if (!p) return;
    const norm = path.resolve(p);
    if (seen.has(norm)) return;
    seen.add(norm);
    roots.push(norm);
  };
  push(context?.cwd);
  for (const r of context?.projectRoots ?? []) {
    try {
      if (typeof r?.uri === 'string' && r.uri.startsWith('file://')) {
        push(fileURLToPath(r.uri));
      }
    } catch {
      /* skip malformed uri */
    }
  }
  return roots;
}

function escapesRoot(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel !== '' && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
}

function resolveSafe(
  token: string,
  roots: string[],
  deps: PreloadDeps,
): { abs: string; real: string } | null {
  const existsSync = deps.existsSync ?? nodeExistsSync;
  const realpathSync = deps.realpathSync ?? nodeRealpathSync;

  for (const root of roots) {
    const abs = path.isAbsolute(token) ? path.resolve(token) : path.resolve(root, token);
    if (escapesRoot(root, abs)) continue; // traversal / different drive
    if (!existsSync(abs)) continue; // not a real file under this root → ignore elsewhere

    // Symlink escape: re-check containment against realpaths.
    let real: string;
    let realRoot: string;
    try {
      real = realpathSync(abs);
      realRoot = realpathSync(root);
    } catch {
      continue;
    }
    if (escapesRoot(realRoot, real)) continue; // symlink points outside → ignore
    return { abs, real };
  }
  return null;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function fenceFor(index: number, content: string): string {
  let id = `MULTICLI_FILE_${index}`;
  let k = 0;
  while (content.includes(`<<<BEGIN ${id}>>>`) || content.includes(`<<<END ${id}>>>`)) {
    k += 1;
    id = `MULTICLI_FILE_${index}_${k}`;
  }
  return id;
}

function buildWrapper(files: { token: string; content: string }[], prompt: string): string {
  const note =
    "multicli preloaded these files because this Windows environment's codex sandbox cannot read files from disk. " +
    'Use the inline content for THESE files instead of reading them from disk.';
  const blocks = files.map((f, i) => {
    const id = fenceFor(i + 1, f.content);
    return `<file path="${f.token}" fence="${id}">\n<<<BEGIN ${id}>>>\n${f.content}\n<<<END ${id}>>>\n</file>`;
  });
  return [
    `${PRELOAD_HEADER_TAG} note="${note}">`,
    ...blocks,
    '</multicli-preloaded-files>',
    '',
    '<original-prompt>',
    prompt,
    '</original-prompt>',
  ].join('\n');
}

/**
 * Detect Markdown references in `prompt`, read them from disk (multicli-side,
 * no sandbox), and inline their contents so codex reviews text instead of
 * reading files. Windows-only; returns the prompt unchanged elsewhere.
 *
 * Throws {@link FilePreloadError} (codex NOT invoked) when a referenced file
 * exists but cannot be read or exceeds size limits. A matched token that does
 * not resolve to a real file under a root is silently ignored (topical mention).
 */
export function preloadFileReferencesForCodex(
  prompt: string,
  context?: PreloadContext,
  deps: PreloadDeps = {},
): string {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;

  if (platform !== 'win32') return prompt;
  if (env.MULTICLI_WINDOWS_CODEX_NO_PRELOAD === '1') return prompt;
  if (prompt.includes(PRELOAD_HEADER_TAG)) return prompt; // idempotency

  const roots = buildRoots(context);
  if (roots.length === 0) return prompt;

  const candidates = detectCandidates(prompt);
  if (candidates.length === 0) return prompt;

  const statSync = deps.statSync ?? nodeStatSync;
  const readFileSync = deps.readFileSync ?? ((p: string) => nodeReadFileSync(p, 'utf8'));

  const inlined: { token: string; content: string }[] = [];
  const seenReal = new Set<string>();
  let total = 0;

  for (const cand of candidates) {
    if (!cand.hasSignal) continue;
    const resolved = resolveSafe(cand.normalized, roots, deps);
    if (!resolved) continue; // missing / escape → ignore
    if (seenReal.has(resolved.real)) continue; // dedup by realpath

    let size: number;
    try {
      size = statSync(resolved.abs).size;
    } catch (e) {
      throw new FilePreloadError(cand.token, `stat failed: ${(e as Error).message}`);
    }
    if (size > PER_FILE_LIMIT) {
      throw new FilePreloadError(cand.token, `exceeds per-file limit (${size} > ${PER_FILE_LIMIT} bytes)`);
    }
    if (total + size > TOTAL_LIMIT) {
      throw new FilePreloadError(cand.token, `total preload budget exceeded (> ${TOTAL_LIMIT} bytes)`);
    }

    let content: string;
    try {
      content = readFileSync(resolved.abs);
    } catch (e) {
      throw new FilePreloadError(cand.token, `read failed: ${(e as Error).message}`);
    }

    total += size;
    seenReal.add(resolved.real);
    inlined.push({ token: cand.token, content: stripBom(content) });
  }

  if (inlined.length === 0) return prompt;
  return buildWrapper(inlined, prompt);
}
