import { describe, it, expect } from 'vitest';
import {
  formatChangeModeResponse,
  summarizeChangeModeEdits,
} from '../../src/utils/changeModeTranslator.js';
import { type ChangeModeEdit } from '../../src/utils/changeModeParser.js';

// ---------------------------------------------------------------------------
// Helper to build ChangeModeEdit objects with sensible defaults
// ---------------------------------------------------------------------------

function makeEdit(filename: string, oldCode: string, newCode: string): ChangeModeEdit {
  return {
    filename,
    oldStartLine: 1,
    oldEndLine: 1,
    oldCode,
    newStartLine: 1,
    newEndLine: 1,
    newCode,
  };
}

// ===========================================================================
// formatChangeModeResponse
// ===========================================================================

describe('formatChangeModeResponse', () => {
  it('should include CHANGEMODE OUTPUT header, filename, old code, and new code for a single edit without chunks', () => {
    const edits = [makeEdit('src/app.ts', 'const x = 1;', 'const x = 2;')];
    const result = formatChangeModeResponse(edits);

    expect(result).toContain('CHANGEMODE OUTPUT');
    expect(result).toContain('Antigravity has analyzed');
    expect(result).not.toContain('Gemini has analyzed');
    expect(result).toContain('src/app.ts');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const x = 2;');
  });

  it('should use chunk header when chunkInfo is provided with total > 1', () => {
    const edits = [makeEdit('src/a.ts', 'old', 'new')];
    const result = formatChangeModeResponse(edits, { current: 2, total: 5 });

    expect(result).toContain('Chunk 2 of 5');
    expect(result).toContain('Antigravity has analyzed your codebase');
    expect(result).toContain('across 5 chunks');
  });

  it('should include fetch-chunk instructions for non-final chunks with a cacheKey', () => {
    const edits = [makeEdit('src/a.ts', 'old', 'new')];
    const chunkInfo = { current: 1, total: 3, cacheKey: 'abc-123' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).toContain('fetch-chunk');
    expect(result).toContain('cacheKey="abc-123"');
    expect(result).toContain('chunkIndex=2');
    expect(result).toContain('Next Step');
    expect(result).toContain('2 of 3');
  });

  it('should not include fetch-chunk instructions for the final chunk', () => {
    const edits = [makeEdit('src/a.ts', 'old', 'new')];
    const chunkInfo = { current: 3, total: 3, cacheKey: 'abc-123' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).not.toContain('fetch-chunk');
    expect(result).not.toContain('Next Step');
  });

  it('should use singular "edit" for 1 edit and plural "edits" for 2 edits in chunk header', () => {
    const singleEdit = [makeEdit('src/a.ts', 'old', 'new')];
    const singleResult = formatChangeModeResponse(singleEdit, { current: 1, total: 2 });
    expect(singleResult).toContain('1 complete edit that');
    expect(singleResult).not.toContain('1 complete edits');

    const twoEdits = [
      makeEdit('src/a.ts', 'old1', 'new1'),
      makeEdit('src/b.ts', 'old2', 'new2'),
    ];
    const pluralResult = formatChangeModeResponse(twoEdits, { current: 1, total: 2 });
    expect(pluralResult).toContain('2 complete edits that');
  });

  it('should use singular "modification" for 1 edit and plural for 2 edits in non-chunk header', () => {
    const singleEdit = [makeEdit('src/a.ts', 'old', 'new')];
    const singleResult = formatChangeModeResponse(singleEdit);
    expect(singleResult).toContain('1 modification for');
    expect(singleResult).not.toContain('1 modifications');

    const twoEdits = [
      makeEdit('src/a.ts', 'old1', 'new1'),
      makeEdit('src/b.ts', 'old2', 'new2'),
    ];
    const pluralResult = formatChangeModeResponse(twoEdits);
    expect(pluralResult).toContain('2 modifications for');
  });
});

// ===========================================================================
// summarizeChangeModeEdits
// ===========================================================================

describe('summarizeChangeModeEdits', () => {
  it('should group edits by filename with correct counts', () => {
    const edits = [
      makeEdit('src/a.ts', 'old1', 'new1'),
      makeEdit('src/a.ts', 'old2', 'new2'),
      makeEdit('src/b.ts', 'old3', 'new3'),
    ];
    const result = summarizeChangeModeEdits(edits);

    expect(result).toContain('Total edits: 3');
    expect(result).toContain('Files affected: 2');
    expect(result).toContain('- src/a.ts: 2 edits');
    expect(result).toContain('- src/b.ts: 1 edit');
  });

  it('should change title when isPartialView is true', () => {
    const edits = [makeEdit('src/a.ts', 'old', 'new')];

    const defaultResult = summarizeChangeModeEdits(edits);
    expect(defaultResult).toContain('ChangeMode Summary:');
    expect(defaultResult).not.toContain('Complete analysis across all chunks');

    const partialResult = summarizeChangeModeEdits(edits, true);
    expect(partialResult).toContain('ChangeMode Summary (Complete analysis across all chunks):');
    expect(partialResult).toContain('(across all chunks)');
  });

  it('should use singular "edit" for a file with 1 edit', () => {
    const edits = [makeEdit('src/only.ts', 'old', 'new')];
    const result = summarizeChangeModeEdits(edits);

    expect(result).toContain('- src/only.ts: 1 edit');
    expect(result).not.toContain('- src/only.ts: 1 edits');
  });
});
