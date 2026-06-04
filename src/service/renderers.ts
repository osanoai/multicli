import path from 'node:path';

import type { ServiceManifest } from './types.js';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function escapeSystemdPath(value: string): string {
  return Array.from(Buffer.from(value, 'utf8'))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      if (char === '%') {
        return '%%';
      }
      return /[A-Za-z0-9/_.:-]/.test(char)
        ? char
        : `\\x${byte.toString(16).padStart(2, '0')}`;
    })
    .join('');
}

export function renderPosixLauncher(manifest: ServiceManifest): string {
  return `#!/bin/sh
set -eu

exec ${quotePosix(manifest.runtime.nodePath)} ${quotePosix(manifest.runtime.bootstrapPath)} ${quotePosix(manifest.paths.envFile)} ${quotePosix(manifest.runtime.entrypointPath)} serve-http
`;
}

export function renderWindowsLauncher(manifest: ServiceManifest): string {
  return `$ErrorActionPreference = 'Stop'

& ${quotePowerShell(manifest.runtime.nodePath)} ${quotePowerShell(manifest.runtime.bootstrapPath)} ${quotePowerShell(manifest.paths.envFile)} ${quotePowerShell(manifest.runtime.entrypointPath)} 'serve-http'
exit $LASTEXITCODE
`;
}

export function renderLaunchAgent(manifest: ServiceManifest): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(manifest.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(manifest.paths.launcher)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${escapeXml(manifest.paths.root)}</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(manifest.paths.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(manifest.paths.stderrLogFile)}</string>
</dict>
</plist>
`;
}

export function renderSystemdUnit(manifest: ServiceManifest): string {
  return `[Unit]
Description=Multi-CLI local HTTP service
After=network.target

[Service]
Type=simple
WorkingDirectory=${escapeSystemdPath(manifest.paths.root)}
ExecStart=${escapeSystemdPath(manifest.paths.launcher)}
Restart=on-failure
RestartSec=1
StandardOutput=append:${escapeSystemdPath(manifest.paths.logFile)}
StandardError=append:${escapeSystemdPath(manifest.paths.stderrLogFile)}

[Install]
WantedBy=default.target
`;
}

export function renderWindowsTaskXml(manifest: ServiceManifest): string {
  const command = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const argumentsText = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ${quotePowerShell(manifest.paths.launcher)}`;

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(command)}</Command>
      <Arguments>${escapeXml(argumentsText)}</Arguments>
      <WorkingDirectory>${escapeXml(manifest.paths.root)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}
