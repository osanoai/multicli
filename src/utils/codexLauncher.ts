// Codex launcher mimicking for Windows sandbox compatibility (issue #138).
//
// Reproduces npm @openai/codex/bin/codex.js launcher's binary resolution and
// env setup so multicli can spawn the native codex executable directly with
// the same shape codex's internal sandbox setup expects (shell:false,
// detached:false, env with codex-path on PATH + CODEX_MANAGED_BY_NPM=1 +
// CODEX_MANAGED_PACKAGE_ROOT). Empirically isolated as the only spawn shape
// that lets codex's child PowerShell launch succeed on Windows
// (tmp/R-20260523-085500-tier2-launcher-audit.md).

import { existsSync as nodeExistsSync, realpathSync as nodeRealpathSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

export type CodexNativeResolution = {
  binaryPath: string;
  pathDir: string;
  /**
   * Root of the top-level @openai/codex package, not the platform package.
   * codex.js sets CODEX_MANAGED_PACKAGE_ROOT to this directory.
   */
  packageRoot: string;
};

export interface ResolveDeps {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  existsSync?: (p: string) => boolean;
  realpathSync?: (p: string) => string;
  packageJsonResolver?: (id: string) => string;
  localVendorRoot?: string;
}

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

export function targetTripleFor(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | null {
  switch (platform) {
    case 'linux':
    case 'android':
      if (arch === 'x64') return 'x86_64-unknown-linux-musl';
      if (arch === 'arm64') return 'aarch64-unknown-linux-musl';
      return null;
    case 'darwin':
      if (arch === 'x64') return 'x86_64-apple-darwin';
      if (arch === 'arm64') return 'aarch64-apple-darwin';
      return null;
    case 'win32':
      if (arch === 'x64') return 'x86_64-pc-windows-msvc';
      if (arch === 'arm64') return 'aarch64-pc-windows-msvc';
      return null;
    default:
      return null;
  }
}

/**
 * Build candidate `paths` for `require.resolve` so the platform package
 * (@openai/codex-win32-x64) can be located when it lives in npm-global
 * rather than multicli's own node_modules. Discovered via:
 *   1. `npm_config_prefix` env (npm standard)
 *   2. PATH scan for codex shim binaries → parent dir's node_modules
 *
 * Returned paths target the directories that contain the `@openai/...`
 * vendor packages — both the top-level node_modules and the nested
 * @openai/codex/node_modules where npm-global typically places the
 * platform-specific binary package.
 */
export function getNpmGlobalCandidatePaths(
  deps: { platform?: NodeJS.Platform; existsSync?: (p: string) => boolean } = {},
): string[] {
  const platform = deps.platform ?? process.platform;
  const existsSync = deps.existsSync ?? nodeExistsSync;
  const candidates: string[] = [];

  const pushPair = (dir: string) => {
    candidates.push(path.join(dir, 'node_modules'));
    candidates.push(path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules'));
  };

  const prefix = process.env.npm_config_prefix ?? process.env.NPM_CONFIG_PREFIX;
  if (prefix) pushPair(prefix);

  const pathSep = platform === 'win32' ? ';' : ':';
  const shimNames =
    platform === 'win32'
      ? ['codex.cmd', 'codex.exe', 'codex.ps1', 'codex']
      : ['codex'];
  const pathDirs = (process.env.PATH ?? '').split(pathSep).filter(Boolean);
  for (const dir of pathDirs) {
    for (const shim of shimNames) {
      try {
        if (existsSync(path.join(dir, shim))) {
          pushPair(dir);
          break;
        }
      } catch {
        /* ignore stat errors on inaccessible dirs */
      }
    }
  }

  return Array.from(new Set(candidates));
}

export function resolveCodexNativeBinary(
  deps: ResolveDeps = {},
): CodexNativeResolution | null {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;

  const triple = targetTripleFor(platform, arch);
  if (!triple) return null;

  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple];
  if (!platformPackage) return null;

  const existsSync = deps.existsSync ?? nodeExistsSync;
  const realpathSync = deps.realpathSync ?? nodeRealpathSync;
  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex';

  // L7 escape hatch (issue #138 follow-up audit High finding 대응):
  // MULTICLI_WINDOWS_CODEX_BINARY 가 설정되면 그 path 를 신뢰하고 vendor
  // 구조 (`<pkgRoot>/vendor/<triple>/bin/<binary>`) 로부터 pathDir /
  // packageRoot 를 자동 추정. yarn Berry PnP / pnpm hoist 등 npm-global
  // 휴리스틱이 못 찾는 환경의 사용자 escape hatch.
  const binaryOverride = process.env.MULTICLI_WINDOWS_CODEX_BINARY;
  if (binaryOverride && existsSync(binaryOverride)) {
    const binDir = path.dirname(binaryOverride);          // .../vendor/<triple>/bin
    const tripleDir = path.dirname(binDir);                // .../vendor/<triple>
    const vendorDir = path.dirname(tripleDir);             // .../vendor
    const pkgRoot = path.dirname(vendorDir);               // pkg root
    return {
      binaryPath: binaryOverride,
      pathDir: path.join(tripleDir, 'codex-path'),
      packageRoot: realpathSync(pkgRoot),
    };
  }

  const resolver =
    deps.packageJsonResolver ??
    ((id: string) => {
      const req = createRequire(import.meta.url);
      // 1. multicli's own node_modules (works for bundled deps + tests)
      try {
        return req.resolve(id);
      } catch {
        /* fall through to npm-global discovery */
      }
      // 2. npm-global discovery — codex is usually installed globally,
      // not as a multicli dependency.
      const extraPaths = getNpmGlobalCandidatePaths({ platform, existsSync });
      if (extraPaths.length > 0) {
        try {
          return req.resolve(id, { paths: extraPaths });
        } catch {
          /* fall through */
        }
      }
      throw new Error(`Cannot resolve ${id}`);
    });

  const vendorRoots: { vendorRoot: string; managedPackageRoot: string }[] = [];
  try {
    const pkgJsonPath = resolver(`${platformPackage}/package.json`);
    const platformPackageRoot = path.dirname(pkgJsonPath);
    const nestedCodexRoot = path.resolve(platformPackageRoot, '..', '..', '..');
    let managedPackageRoot = platformPackageRoot;
    try {
      const codexPackageJsonPath = resolver('@openai/codex/package.json');
      managedPackageRoot = path.dirname(codexPackageJsonPath);
    } catch {
      if (
        path.basename(path.dirname(nestedCodexRoot)) === '@openai'
        && path.basename(nestedCodexRoot) === 'codex'
      ) {
        managedPackageRoot = nestedCodexRoot;
      }
    }
    vendorRoots.push({
      vendorRoot: path.join(platformPackageRoot, 'vendor'),
      managedPackageRoot,
    });
  } catch {
    // platform package not installed via npm — fall through to localVendorRoot
  }

  if (deps.localVendorRoot) {
    vendorRoots.push({
      vendorRoot: deps.localVendorRoot,
      managedPackageRoot: path.resolve(deps.localVendorRoot, '..'),
    });
  }

  for (const { vendorRoot, managedPackageRoot } of vendorRoots) {
    const packageRoot = path.join(vendorRoot, triple);

    const modernBin = path.join(packageRoot, 'bin', binaryName);
    if (existsSync(modernBin)) {
      return {
        binaryPath: modernBin,
        pathDir: path.join(packageRoot, 'codex-path'),
        packageRoot: realpathSync(managedPackageRoot),
      };
    }

    const legacyBin = path.join(packageRoot, 'codex', binaryName);
    if (existsSync(legacyBin)) {
      return {
        binaryPath: legacyBin,
        pathDir: path.join(packageRoot, 'path'),
        packageRoot: realpathSync(managedPackageRoot),
      };
    }
  }

  return null;
}

export interface BuildEnvOptions {
  pathSep?: string;
}

export function buildCodexLauncherEnv(
  baseEnv: NodeJS.ProcessEnv,
  native: CodexNativeResolution,
  options: BuildEnvOptions = {},
): NodeJS.ProcessEnv {
  const sep = options.pathSep ?? (process.platform === 'win32' ? ';' : ':');
  const existingParts = (baseEnv.PATH ?? '').split(sep).filter(Boolean);
  const updatedPath = [native.pathDir, ...existingParts].join(sep);
  return {
    ...baseEnv,
    PATH: updatedPath,
    CODEX_MANAGED_BY_NPM: '1',
    CODEX_MANAGED_PACKAGE_ROOT: native.packageRoot,
  };
}
