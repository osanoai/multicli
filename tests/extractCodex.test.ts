import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts', 'extract-codex.sh');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'multicli-codex-extract-'));
  tempDirs.push(dir);
  return dir;
}

function writeModelsRepo(modelPath: string, slugs: string[]): string {
  const repoDir = makeTempDir();
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoDir });

  const fullPath = join(repoDir, modelPath);
  mkdirSync(resolve(fullPath, '..'), { recursive: true });
  writeFileSync(
    fullPath,
    JSON.stringify({ models: slugs.map((slug) => ({ slug })) }, null, 2),
    'utf-8',
  );

  execFileSync('git', ['add', modelPath], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'add models'], { cwd: repoDir, stdio: 'pipe' });
  return repoDir;
}

function extract(repoDir: string): string[] {
  const stdout = execFileSync('bash', [scriptPath], {
    encoding: 'utf-8',
    env: { ...process.env, CODEX_REPO_URL: repoDir },
  });
  return JSON.parse(stdout) as string[];
}

describe('extract-codex.sh', () => {
  it('reads the current Codex models-manager catalog path', () => {
    const repoDir = writeModelsRepo('codex-rs/models-manager/models.json', [
      'gpt-5.5',
      'gpt-5.4-mini',
      'codex-auto-review',
      'gpt-oss-20b',
    ]);

    expect(extract(repoDir)).toEqual(['gpt-5.4-mini', 'gpt-5.5']);
  });

  it('falls back to the legacy core catalog path', () => {
    const repoDir = writeModelsRepo('codex-rs/core/models.json', [
      'gpt-5.4',
      'gpt-5.3-codex',
    ]);

    expect(extract(repoDir)).toEqual(['gpt-5.3-codex', 'gpt-5.4']);
  });
});
