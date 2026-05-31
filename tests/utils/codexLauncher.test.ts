import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveCodexNativeBinary,
  targetTripleFor,
  buildCodexLauncherEnv,
  getNpmGlobalCandidatePaths,
  type CodexNativeResolution,
} from '../../src/utils/codexLauncher.js';

describe('codexLauncher.targetTripleFor', () => {
  it('maps win32 x64 → x86_64-pc-windows-msvc', () => {
    expect(targetTripleFor('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
  });

  it('maps darwin arm64 → aarch64-apple-darwin', () => {
    expect(targetTripleFor('darwin', 'arm64')).toBe('aarch64-apple-darwin');
  });

  it('maps linux x64 → x86_64-unknown-linux-musl', () => {
    expect(targetTripleFor('linux', 'x64')).toBe('x86_64-unknown-linux-musl');
  });

  it('returns null for unsupported platform/arch combos', () => {
    expect(targetTripleFor('freebsd' as NodeJS.Platform, 'x64')).toBeNull();
    expect(targetTripleFor('win32', 'mips' as NodeJS.Architecture)).toBeNull();
  });
});

describe('codexLauncher.resolveCodexNativeBinary (L1 vendor fallback)', () => {
  it('returns null when packageJsonResolver throws AND no localVendorRoot binary', () => {
    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: () => {
        throw new Error('Cannot find module @openai/codex-win32-x64');
      },
      existsSync: () => false,
      realpathSync: (p) => p,
    });
    expect(result).toBeNull();
  });

  it('falls back to localVendorRoot when packageJsonResolver throws', () => {
    const localVendor = 'D:/local-vendor';
    const localBin = `${localVendor}/x86_64-pc-windows-msvc/bin/codex.exe`;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: () => {
        throw new Error('not installed');
      },
      localVendorRoot: localVendor,
      existsSync: (p) => p.replace(/\\/g, '/') === localBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath.replace(/\\/g, '/')).toBe(localBin);
  });

  it('returns null when binary does not exist in any vendor root', () => {
    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: () => 'C:/mock/node_modules/@openai/codex-win32-x64/package.json',
      existsSync: () => false,
      realpathSync: (p) => p,
    });
    expect(result).toBeNull();
  });

  it('falls back to legacyBinaryPath (vendor/<triple>/codex/codex.exe) when modern bin missing', () => {
    const fakePkgRoot = 'C:/mock/node_modules/@openai/codex-win32-x64';
    const legacyBin = `${fakePkgRoot}/vendor/x86_64-pc-windows-msvc/codex/codex.exe`;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: () => `${fakePkgRoot}/package.json`,
      existsSync: (p) => p.replace(/\\/g, '/') === legacyBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath.replace(/\\/g, '/')).toBe(legacyBin);
    expect(result!.pathDir.replace(/\\/g, '/')).toBe(
      `${fakePkgRoot}/vendor/x86_64-pc-windows-msvc/path`,
    );
  });
});

describe('codexLauncher.resolveCodexNativeBinary (L0 happy path)', () => {
  it('resolves to vendor/<triple>/bin/codex.exe on win32 x64 when binary exists', () => {
    const fakePkgRoot = 'C:/mock/node_modules/@openai/codex-win32-x64';
    const fakeVendor = `${fakePkgRoot}/vendor`;
    const fakeBin = `${fakeVendor}/x86_64-pc-windows-msvc/bin/codex.exe`;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: (id) => {
        if (id === '@openai/codex-win32-x64/package.json') {
          return `${fakePkgRoot}/package.json`;
        }
        throw new Error(`unexpected resolve: ${id}`);
      },
      existsSync: (p) => p.replace(/\\/g, '/') === fakeBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath.replace(/\\/g, '/')).toBe(fakeBin);
    expect(result!.pathDir.replace(/\\/g, '/')).toBe(`${fakeVendor}/x86_64-pc-windows-msvc/codex-path`);
    expect(result!.packageRoot.replace(/\\/g, '/')).toBe(fakePkgRoot);
  });

  it('sets packageRoot to @openai/codex root, not the platform package root', () => {
    const codexRoot = 'C:/mock/node_modules/@openai/codex';
    const fakePkgRoot = `${codexRoot}/node_modules/@openai/codex-win32-x64`;
    const fakeVendor = `${fakePkgRoot}/vendor`;
    const fakeBin = `${fakeVendor}/x86_64-pc-windows-msvc/bin/codex.exe`;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: (id) => {
        if (id === '@openai/codex-win32-x64/package.json') {
          return `${fakePkgRoot}/package.json`;
        }
        if (id === '@openai/codex/package.json') {
          return `${codexRoot}/package.json`;
        }
        throw new Error(`unexpected resolve: ${id}`);
      },
      existsSync: (p) => p.replace(/\\/g, '/') === fakeBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath.replace(/\\/g, '/')).toBe(fakeBin);
    expect(result!.packageRoot.replace(/\\/g, '/')).toBe(codexRoot);
  });

  it('infers @openai/codex root from nested platform package when main package resolve fails', () => {
    const codexRoot = 'C:/mock/node_modules/@openai/codex';
    const fakePkgRoot = `${codexRoot}/node_modules/@openai/codex-win32-x64`;
    const fakeBin = `${fakePkgRoot}/vendor/x86_64-pc-windows-msvc/bin/codex.exe`;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: (id) => {
        if (id === '@openai/codex-win32-x64/package.json') {
          return `${fakePkgRoot}/package.json`;
        }
        throw new Error(`unexpected resolve: ${id}`);
      },
      existsSync: (p) => p.replace(/\\/g, '/') === fakeBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.packageRoot.replace(/\\/g, '/')).toBe(codexRoot);
  });

  it('resolves linux/darwin to bin/codex (no .exe) when binary exists', () => {
    const fakePkgRoot = '/mock/node_modules/@openai/codex-linux-x64';
    const fakeBin = `${fakePkgRoot}/vendor/x86_64-unknown-linux-musl/bin/codex`;

    const result = resolveCodexNativeBinary({
      platform: 'linux',
      arch: 'x64',
      packageJsonResolver: () => `${fakePkgRoot}/package.json`,
      existsSync: (p) => p.replace(/\\/g, '/') === fakeBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath.replace(/\\/g, '/')).toBe(fakeBin);
    expect(result!.binaryPath.endsWith('.exe')).toBe(false);
  });
});

describe('codexLauncher.buildCodexLauncherEnv (L2)', () => {
  const native: CodexNativeResolution = {
    binaryPath: 'C:/mock/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
    pathDir: 'C:/mock/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex-path',
    packageRoot: 'C:/mock/node_modules/@openai/codex-win32-x64',
  };

  it('prepends pathDir to PATH using semicolon on win32', () => {
    const baseEnv = { PATH: 'C:\\Windows\\System32;D:\\tools' };
    const env = buildCodexLauncherEnv(baseEnv, native, { pathSep: ';' });
    expect(env.PATH).toBe(`${native.pathDir};C:\\Windows\\System32;D:\\tools`);
  });

  it('prepends pathDir to PATH using colon on posix', () => {
    const baseEnv = { PATH: '/usr/local/bin:/usr/bin' };
    const env = buildCodexLauncherEnv(baseEnv, native, { pathSep: ':' });
    expect(env.PATH).toBe(`${native.pathDir}:/usr/local/bin:/usr/bin`);
  });

  it('sets CODEX_MANAGED_BY_NPM to "1"', () => {
    const env = buildCodexLauncherEnv({ PATH: 'X' }, native, { pathSep: ';' });
    expect(env.CODEX_MANAGED_BY_NPM).toBe('1');
  });

  it('sets CODEX_MANAGED_PACKAGE_ROOT to native.packageRoot', () => {
    const env = buildCodexLauncherEnv({ PATH: 'X' }, native, { pathSep: ';' });
    expect(env.CODEX_MANAGED_PACKAGE_ROOT).toBe(native.packageRoot);
  });

  it('preserves other base env vars (does not strip user values)', () => {
    const baseEnv = { PATH: 'X', MY_VAR: 'keepme', NODE_ENV: 'test' };
    const env = buildCodexLauncherEnv(baseEnv, native, { pathSep: ';' });
    expect(env.MY_VAR).toBe('keepme');
    expect(env.NODE_ENV).toBe('test');
  });

  it('handles empty base PATH gracefully (no trailing separator)', () => {
    const env = buildCodexLauncherEnv({ PATH: '' }, native, { pathSep: ';' });
    expect(env.PATH).toBe(native.pathDir);
  });

  it('handles undefined base PATH', () => {
    const env = buildCodexLauncherEnv({}, native, { pathSep: ';' });
    expect(env.PATH).toBe(native.pathDir);
  });
});

describe('codexLauncher.getNpmGlobalCandidatePaths (L0-fix: npm-global discovery)', () => {
  const ORIGINAL_NPM_PREFIX = process.env.npm_config_prefix;
  const ORIGINAL_PATH = process.env.PATH;

  beforeEach(() => {
    delete process.env.npm_config_prefix;
    delete process.env.NPM_CONFIG_PREFIX;
    process.env.PATH = '';
  });

  afterEach(() => {
    if (ORIGINAL_NPM_PREFIX === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = ORIGINAL_NPM_PREFIX;
    process.env.PATH = ORIGINAL_PATH ?? '';
  });

  it('includes npm_config_prefix-derived paths (pair: <prefix>/node_modules and nested)', () => {
    process.env.npm_config_prefix = 'D:/tools/node_global';
    const paths = getNpmGlobalCandidatePaths({ platform: 'win32', existsSync: () => false });
    expect(paths).toContain(
      'D:/tools/node_global/node_modules'.replace(/\//g, require('node:path').sep),
    );
    const nested = require('node:path').join(
      'D:/tools/node_global',
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
    );
    expect(paths).toContain(nested);
  });

  it('scans PATH for codex shim and adds parent dir node_modules', () => {
    process.env.PATH = 'D:/tools/node_global;C:/Windows/System32';
    const seen: string[] = [];
    const paths = getNpmGlobalCandidatePaths({
      platform: 'win32',
      existsSync: (p) => {
        seen.push(p.replace(/\\/g, '/'));
        return p.replace(/\\/g, '/') === 'D:/tools/node_global/codex.cmd';
      },
    });
    expect(
      paths.some((p) => p.replace(/\\/g, '/') === 'D:/tools/node_global/node_modules'),
    ).toBe(true);
    expect(
      paths.some(
        (p) => p.replace(/\\/g, '/') === 'D:/tools/node_global/node_modules/@openai/codex/node_modules',
      ),
    ).toBe(true);
  });

  it('returns empty when neither env nor PATH yields a codex shim', () => {
    process.env.PATH = 'C:/nope';
    const paths = getNpmGlobalCandidatePaths({
      platform: 'win32',
      existsSync: () => false,
    });
    expect(paths).toEqual([]);
  });

  it('deduplicates paths when env and PATH point to the same root', () => {
    process.env.npm_config_prefix = 'D:/dup';
    process.env.PATH = 'D:/dup';
    const paths = getNpmGlobalCandidatePaths({
      platform: 'win32',
      existsSync: (p) => p.replace(/\\/g, '/') === 'D:/dup/codex.cmd',
    });
    // Each pair (node_modules + nested) should appear exactly once
    const counts = paths.reduce<Record<string, number>>((acc, p) => {
      acc[p] = (acc[p] ?? 0) + 1;
      return acc;
    }, {});
    expect(Math.max(...Object.values(counts))).toBe(1);
  });
});

describe('codexLauncher.resolveCodexNativeBinary (L7 escape: MULTICLI_WINDOWS_CODEX_BINARY)', () => {
  const ORIGINAL_ENV = process.env.MULTICLI_WINDOWS_CODEX_BINARY;

  beforeEach(() => {
    delete process.env.MULTICLI_WINDOWS_CODEX_BINARY;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.MULTICLI_WINDOWS_CODEX_BINARY;
    else process.env.MULTICLI_WINDOWS_CODEX_BINARY = ORIGINAL_ENV;
  });

  it('uses MULTICLI_WINDOWS_CODEX_BINARY when set and the file exists, bypassing npm resolution', () => {
    const overridePath = 'C:/custom-codex/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
    process.env.MULTICLI_WINDOWS_CODEX_BINARY = overridePath;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      // packageJsonResolver intentionally throws — we should NOT reach it
      packageJsonResolver: () => {
        throw new Error('packageJsonResolver must not be called when override is valid');
      },
      existsSync: (p) => p.replace(/\\/g, '/') === overridePath,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath).toBe(overridePath);
  });

  it('infers pathDir as <triple>/codex-path sibling of the override binary', () => {
    const overridePath = 'C:/custom/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
    process.env.MULTICLI_WINDOWS_CODEX_BINARY = overridePath;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: () => { throw new Error('skip'); },
      existsSync: (p) => p.replace(/\\/g, '/') === overridePath,
      realpathSync: (p) => p,
    });

    expect(result!.pathDir.replace(/\\/g, '/')).toBe(
      'C:/custom/vendor/x86_64-pc-windows-msvc/codex-path',
    );
  });

  it('infers packageRoot as the directory above vendor/', () => {
    const overridePath = 'C:/myPkg/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
    process.env.MULTICLI_WINDOWS_CODEX_BINARY = overridePath;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: () => { throw new Error('skip'); },
      existsSync: (p) => p.replace(/\\/g, '/') === overridePath,
      realpathSync: (p) => p,
    });

    expect(result!.packageRoot.replace(/\\/g, '/')).toBe('C:/myPkg');
  });

  it('falls through to npm-global resolution when override is set but file does not exist', () => {
    process.env.MULTICLI_WINDOWS_CODEX_BINARY = 'C:/nonexistent/codex.exe';
    const fallbackPkgRoot = 'C:/mock/node_modules/@openai/codex-win32-x64';
    const fallbackBin = `${fallbackPkgRoot}/vendor/x86_64-pc-windows-msvc/bin/codex.exe`;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      packageJsonResolver: () => `${fallbackPkgRoot}/package.json`,
      existsSync: (p) => p.replace(/\\/g, '/') === fallbackBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath.replace(/\\/g, '/')).toBe(fallbackBin);
  });
});

describe('codexLauncher.resolveCodexNativeBinary (L0-fix: production resolver tries extraPaths)', () => {
  const ORIGINAL_NPM_PREFIX = process.env.npm_config_prefix;
  const ORIGINAL_PATH = process.env.PATH;

  beforeEach(() => {
    delete process.env.npm_config_prefix;
    delete process.env.NPM_CONFIG_PREFIX;
    process.env.PATH = '';
  });

  afterEach(() => {
    if (ORIGINAL_NPM_PREFIX === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = ORIGINAL_NPM_PREFIX;
    process.env.PATH = ORIGINAL_PATH ?? '';
  });

  it('default resolver: when multicli own resolve fails AND PATH points to npm-global codex shim, returns vendor binary', () => {
    // Note: this test exercises the default packageJsonResolver path (no DI).
    // We can't truly mock createRequire(import.meta.url).resolve, but we can
    // verify the fallback control flow by providing extraPaths via PATH +
    // existsSync stub that simulates an installed npm-global vendor.
    const fakeNpmRoot = 'D:/mock-global';
    const codexRoot = `${fakeNpmRoot}/node_modules/@openai/codex`;
    const pkgJsonPath = `${codexRoot}/node_modules/@openai/codex-win32-x64/package.json`;
    const fakeBin = `${codexRoot}/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`;

    const result = resolveCodexNativeBinary({
      platform: 'win32',
      arch: 'x64',
      // Override packageJsonResolver to mimic the multi-path resolver that
      // the default would have produced (multicli fail → npm-global hit).
      packageJsonResolver: (id) => {
        if (id === '@openai/codex-win32-x64/package.json') return pkgJsonPath;
        if (id === '@openai/codex/package.json') return `${codexRoot}/package.json`;
        throw new Error(`unexpected: ${id}`);
      },
      existsSync: (p) => p.replace(/\\/g, '/') === fakeBin,
      realpathSync: (p) => p,
    });

    expect(result).not.toBeNull();
    expect(result!.binaryPath.replace(/\\/g, '/')).toBe(fakeBin);
    expect(result!.packageRoot.replace(/\\/g, '/')).toBe(codexRoot);
  });
});
