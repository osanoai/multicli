import os from 'node:os';
import path from 'node:path';

import type { MultiCliConfig } from '../config.js';
import type { ServiceKind, ServicePaths } from './types.js';

export const SERVICE_LABEL = 'com.osanoai.multicli';
export const SYSTEMD_UNIT_NAME = 'multicli.service';
export const WINDOWS_TASK_NAME = 'MultiCLI';

export function getMulticliDir(): string {
  return path.join(os.homedir(), '.multicli');
}

export function getRunsDir(): string {
  return path.join(getMulticliDir(), 'runs');
}

export function getServiceKind(
  platform: NodeJS.Platform = process.platform,
): ServiceKind {
  switch (platform) {
    case 'darwin':
      return 'launchd';
    case 'win32':
      return 'windows-task';
    default:
      return 'systemd-user';
  }
}

export function getServicePaths(
  config: MultiCliConfig,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ServicePaths {
  const root = config.serviceRootDir;

  switch (platform) {
    case 'darwin':
      return {
        root,
        manifest: config.serviceManifestPath,
        envFile: config.serviceEnvPath,
        launcher: path.join(root, 'Multi-CLI.sh'),
        serviceDefinition: path.join(
          os.homedir(),
          'Library',
          'LaunchAgents',
          `${SERVICE_LABEL}.plist`,
        ),
        logFile: config.serviceLogPath,
        stderrLogFile: `${config.serviceLogPath}.stderr`,
      };
    case 'win32':
      return {
        root,
        manifest: config.serviceManifestPath,
        envFile: config.serviceEnvPath,
        launcher: path.join(root, 'launcher.ps1'),
        serviceDefinition: path.join(root, 'task.xml'),
        logFile: config.serviceLogPath,
        stderrLogFile: `${config.serviceLogPath}.stderr`,
      };
    default:
      return {
        root,
        manifest: config.serviceManifestPath,
        envFile: config.serviceEnvPath,
        launcher: path.join(root, 'launcher.sh'),
        serviceDefinition: path.join(
          env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
          'systemd',
          'user',
          SYSTEMD_UNIT_NAME,
        ),
        logFile: config.serviceLogPath,
        stderrLogFile: `${config.serviceLogPath}.stderr`,
      };
  }
}
