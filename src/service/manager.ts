import {
  closeSync,
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { MultiCliConfig } from '../config.js';
import { detectAvailableClis } from '../utils/cliDetector.js';
import { executeCommand } from '../utils/commandExecutor.js';
import type { Logger } from '../logger.js';
import { createServiceManifest, buildServiceEnvFileContents, generateServiceToken } from './runtime.js';
import {
  renderLaunchAgent,
  renderPosixLauncher,
  renderSystemdUnit,
  renderWindowsLauncher,
  renderWindowsTaskXml,
} from './renderers.js';
import {
  SERVICE_LABEL,
  SYSTEMD_UNIT_NAME,
  WINDOWS_TASK_NAME,
} from './paths.js';
import type { ServiceManifest } from './types.js';

interface ServiceInstallOptions {
  configureClaude?: boolean;
  preserveToken?: boolean;
}

interface ClaudeConfigInspection {
  present: boolean;
  matchesManagedService: boolean;
}

function ensureParentDir(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath: string, contents: string, mode?: number) {
  ensureParentDir(filePath);
  writeFileSync(filePath, contents, { encoding: 'utf8', mode: mode ?? 0o666 });
  if (mode !== undefined && process.platform !== 'win32') {
    chmodSync(filePath, mode);
  }
}

export function ensureServiceFilesystem(manifest: ServiceManifest) {
  mkdirSync(manifest.paths.root, { recursive: true });
  ensureParentDir(manifest.paths.envFile);
  ensureParentDir(manifest.paths.launcher);
  ensureParentDir(manifest.paths.serviceDefinition);
  ensureParentDir(manifest.paths.manifest);
  ensureParentDir(manifest.paths.logFile);
  ensureParentDir(manifest.paths.stderrLogFile);
}

function loadManifest(config: MultiCliConfig): ServiceManifest {
  const manifestPath = config.serviceManifestPath;
  if (!existsSync(manifestPath)) {
    throw new Error(`Multi-CLI service is not installed. Missing manifest at ${manifestPath}`);
  }

  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ServiceManifest;
}

async function runBestEffort(command: string, args: string[], logger: Logger) {
  try {
    await executeCommand(command, args, { logger });
  } catch (error) {
    logger.debug('service_command_ignored_failure', {
      command,
      args,
      error,
    });
  }
}

async function waitForHealth(manifest: ServiceManifest, logger: Logger) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(manifest.transport.healthUrl);
      if (response.ok) {
        logger.info('service_health_check_passed', {
          healthUrl: manifest.transport.healthUrl,
        });
        return;
      }
    } catch (error) {
      logger.debug('service_health_check_retrying', { error });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for service health at ${manifest.transport.healthUrl}`);
}

async function configureClaude(manifest: ServiceManifest, logger: Logger) {
  await runBestEffort(
    'claude',
    ['mcp', 'remove', '--scope', 'user', 'Multi-CLI'],
    logger,
  );

  await executeCommand(
    'claude',
    [
      'mcp',
      'add',
      '--scope',
      'user',
      '--transport',
      'http',
      'Multi-CLI',
      manifest.transport.url,
      '--header',
      `Authorization: Bearer ${manifest.transport.token}`,
    ],
    { logger },
  );
}

export function isMatchingClaudeConfigOutput(
  output: string,
  manifest: ServiceManifest,
): boolean {
  return output.includes('Type: http')
    && output.includes(`URL: ${manifest.transport.url}`)
    && output.includes(`Authorization: Bearer ${manifest.transport.token}`);
}

async function inspectClaudeConfig(
  manifest: ServiceManifest,
  logger: Logger,
): Promise<ClaudeConfigInspection> {
  try {
    const output = await executeCommand(
      'claude',
      ['mcp', 'get', 'Multi-CLI'],
      { logger },
    );

    return {
      present: true,
      matchesManagedService: isMatchingClaudeConfigOutput(output, manifest),
    };
  } catch (error) {
    logger.debug('claude_config_inspection_failed', { error });
    return {
      present: false,
      matchesManagedService: false,
    };
  }
}

async function registerService(manifest: ServiceManifest, logger: Logger) {
  switch (manifest.serviceKind) {
    case 'launchd': {
      const domain = `gui/${process.getuid?.() ?? 0}`;
      await runBestEffort(
        'launchctl',
        ['bootout', domain, manifest.paths.serviceDefinition],
        logger,
      );
      await executeCommand(
        'launchctl',
        ['bootstrap', domain, manifest.paths.serviceDefinition],
        { logger },
      );
      await executeCommand(
        'launchctl',
        ['kickstart', '-k', `${domain}/${SERVICE_LABEL}`],
        { logger },
      );
      return;
    }
    case 'systemd-user':
      await executeCommand('systemctl', ['--user', 'daemon-reload'], { logger });
      await executeCommand('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME], { logger });
      return;
    case 'windows-task':
      await executeCommand(
        'schtasks',
        ['/Create', '/TN', WINDOWS_TASK_NAME, '/XML', manifest.paths.serviceDefinition, '/F'],
        { logger },
      );
      await runBestEffort('schtasks', ['/Run', '/TN', WINDOWS_TASK_NAME], logger);
      return;
  }
}

async function unregisterService(manifest: ServiceManifest, logger: Logger) {
  switch (manifest.serviceKind) {
    case 'launchd': {
      const domain = `gui/${process.getuid?.() ?? 0}`;
      await runBestEffort(
        'launchctl',
        ['bootout', domain, manifest.paths.serviceDefinition],
        logger,
      );
      return;
    }
    case 'systemd-user':
      await runBestEffort('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT_NAME], logger);
      await runBestEffort('systemctl', ['--user', 'daemon-reload'], logger);
      return;
    case 'windows-task':
      await runBestEffort('schtasks', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'], logger);
      return;
  }
}

async function getServiceStatus(manifest: ServiceManifest, logger: Logger): Promise<string> {
  try {
    switch (manifest.serviceKind) {
      case 'launchd':
        return await executeCommand(
          'launchctl',
          ['print', `gui/${process.getuid?.() ?? 0}/${SERVICE_LABEL}`],
          { logger },
        );
      case 'systemd-user':
        return await executeCommand('systemctl', ['--user', 'status', SYSTEMD_UNIT_NAME], { logger });
      case 'windows-task':
        return await executeCommand('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME, '/V', '/FO', 'LIST'], { logger });
    }
  } catch (error) {
    return `inactive: ${String(error)}`;
  }
}

function renderLauncher(manifest: ServiceManifest): string {
  return manifest.platform === 'win32'
    ? renderWindowsLauncher(manifest)
    : renderPosixLauncher(manifest);
}

function renderServiceDefinition(manifest: ServiceManifest): string {
  switch (manifest.serviceKind) {
    case 'launchd':
      return renderLaunchAgent(manifest);
    case 'systemd-user':
      return renderSystemdUnit(manifest);
    case 'windows-task':
      return renderWindowsTaskXml(manifest);
  }
}

async function installService(
  config: MultiCliConfig,
  logger: Logger,
  options: ServiceInstallOptions,
): Promise<ServiceManifest> {
  const existingToken = options.preserveToken && existsSync(config.serviceManifestPath)
    ? loadManifest(config).transport.token
    : undefined;
  const token = config.httpAuthToken ?? existingToken ?? generateServiceToken();
  const manifest = createServiceManifest(
    {
      ...config,
      transport: 'http',
      httpHost: '127.0.0.1',
      httpAuthToken: token,
    },
    token,
  );

  ensureServiceFilesystem(manifest);
  writeTextFile(
    manifest.paths.envFile,
    buildServiceEnvFileContents(manifest),
    0o600,
  );
  writeTextFile(
    manifest.paths.launcher,
    renderLauncher(manifest),
    manifest.platform === 'win32' ? undefined : 0o700,
  );
  writeTextFile(manifest.paths.serviceDefinition, renderServiceDefinition(manifest), 0o600);
  writeTextFile(manifest.paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);

  await registerService(manifest, logger);
  await waitForHealth(manifest, logger);

  if (options.configureClaude) {
    await configureClaude(manifest, logger);
  }

  return manifest;
}

function tailFile(filePath: string, lineCount = 200): string {
  if (!existsSync(filePath)) {
    return `Log file not found: ${filePath}`;
  }

  const fileDescriptor = openSync(filePath, 'r');

  try {
    const { size } = statSync(filePath);
    if (size === 0) {
      return '';
    }

    const chunkSize = 4096;
    let position = size;
    let contents = '';
    let newlineCount = 0;

    while (position > 0 && newlineCount <= lineCount) {
      const bytesToRead = Math.min(chunkSize, position);
      position -= bytesToRead;
      const chunkBuffer = Buffer.alloc(bytesToRead);
      readSync(fileDescriptor, chunkBuffer, 0, bytesToRead, position);
      contents = chunkBuffer.toString('utf8') + contents;
      newlineCount = contents.split('\n').length - 1;
    }

    return contents.split('\n').slice(-lineCount).join('\n');
  } finally {
    closeSync(fileDescriptor);
  }
}

export async function handleServiceCommand(
  args: string[],
  config: MultiCliConfig,
  logger: Logger,
): Promise<void> {
  const [subcommand = 'status', ...rest] = args;
  const configureClaudeFlag = rest.includes('--configure-claude');
  const serviceLogger = logger.child({ component: 'service' });

  switch (subcommand) {
    case 'install': {
      const availability = await detectAvailableClis(
        config.cliDetectTimeoutMs,
        serviceLogger.child({ component: 'cliDetector' }),
      );
      if (!Object.values(availability).some(Boolean)) {
        throw new Error('Cannot install the Multi-CLI service because no supported backend CLIs were detected on PATH.');
      }

      const manifest = await installService(config, serviceLogger, {
        configureClaude: configureClaudeFlag,
      });
      process.stdout.write(
        [
          `Installed Multi-CLI service (${manifest.serviceKind}).`,
          `Service URL: ${manifest.transport.url}`,
          `Health URL: ${manifest.transport.healthUrl}`,
          `Launcher: ${manifest.paths.launcher}`,
          configureClaudeFlag
            ? 'Claude Code configuration updated.'
            : 'Run `multicli service refresh --configure-claude` or configure Claude manually if needed.',
        ].join('\n') + '\n',
      );
      return;
    }
    case 'refresh': {
      const manifest = await installService(config, serviceLogger, {
        configureClaude: configureClaudeFlag,
        preserveToken: true,
      });
      process.stdout.write(`Refreshed Multi-CLI service at ${manifest.transport.url}\n`);
      return;
    }
    case 'uninstall': {
      const manifest = loadManifest(config);
      const claudeConfig = await inspectClaudeConfig(manifest, serviceLogger);
      await unregisterService(manifest, serviceLogger);
      if (claudeConfig.matchesManagedService) {
        await runBestEffort('claude', ['mcp', 'remove', '--scope', 'user', 'Multi-CLI'], serviceLogger);
      }
      try {
        unlinkSync(manifest.paths.serviceDefinition);
      } catch {}
      rmSync(manifest.paths.root, { recursive: true, force: true });
      process.stdout.write('Uninstalled Multi-CLI service.\n');
      return;
    }
    case 'start': {
      const manifest = loadManifest(config);
      await registerService(manifest, serviceLogger);
      await waitForHealth(manifest, serviceLogger);
      process.stdout.write(`Started Multi-CLI service at ${manifest.transport.url}\n`);
      return;
    }
    case 'stop': {
      const manifest = loadManifest(config);
      await unregisterService(manifest, serviceLogger);
      process.stdout.write('Stopped Multi-CLI service.\n');
      return;
    }
    case 'restart': {
      const manifest = loadManifest(config);
      await unregisterService(manifest, serviceLogger);
      await registerService(manifest, serviceLogger);
      await waitForHealth(manifest, serviceLogger);
      process.stdout.write(`Restarted Multi-CLI service at ${manifest.transport.url}\n`);
      return;
    }
    case 'status': {
      const manifest = loadManifest(config);
      const status = await getServiceStatus(manifest, serviceLogger);
      process.stdout.write(`${status}\n`);
      return;
    }
    case 'doctor': {
      const manifest = loadManifest(config);
      const status = await getServiceStatus(manifest, serviceLogger);
      const claudeConfig = await inspectClaudeConfig(manifest, serviceLogger);
      let health: string;
      try {
        const response = await fetch(manifest.transport.healthUrl);
        health = response.ok ? 'ok' : `http ${response.status}`;
      } catch (error) {
        health = `error: ${String(error)}`;
      }

      const availability = await detectAvailableClis(
        config.cliDetectTimeoutMs,
        serviceLogger.child({ component: 'cliDetector' }),
      );

      process.stdout.write(
        [
          'Multi-CLI Doctor',
          `service kind: ${manifest.serviceKind}`,
          `service url: ${manifest.transport.url}`,
          `health: ${health}`,
          `status: ${status.split('\n')[0] ?? status}`,
          `launcher: ${manifest.paths.launcher}`,
          `manifest: ${manifest.paths.manifest}`,
          `claude config present: ${claudeConfig.present ? 'yes' : 'no'}`,
          `claude config matches managed service: ${claudeConfig.matchesManagedService ? 'yes' : 'no'}`,
          `backend clis: ${JSON.stringify(availability)}`,
        ].join('\n') + '\n',
      );
      return;
    }
    case 'logs': {
      const manifest = loadManifest(config);
      process.stdout.write(`${tailFile(manifest.paths.logFile)}\n`);
      return;
    }
    default:
      throw new Error(`Unknown service subcommand: ${subcommand}`);
  }
}
