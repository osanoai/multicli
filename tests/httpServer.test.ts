import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  ListRootsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

vi.mock('../src/utils/cliDetector.js', () => ({
  detectAvailableClis: vi.fn(),
}));

vi.mock('../src/utils/commandExecutor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/commandExecutor.js')>();
  return {
    ...actual,
    executeCommand: vi.fn(),
  };
});

import { detectAvailableClis } from '../src/utils/cliDetector.js';
import { executeCommand } from '../src/utils/commandExecutor.js';
import { startHttpServer } from '../src/httpServer.js';
import type { MultiCliHttpServer } from '../src/httpServer.js';
import type { MultiCliConfig } from '../src/config.js';

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve ephemeral port'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

const canBindLoopback = await new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once('error', () => resolve(false));
  server.listen(0, '127.0.0.1', () => {
    server.close(() => resolve(true));
  });
});

async function createHttpConfig(): Promise<MultiCliConfig> {
  const port = await findAvailablePort();
  const serviceRootDir = path.join(os.tmpdir(), `multicli-http-${process.pid}-${port}`);

  return {
    transport: 'http',
    askTimeoutMs: 1000,
    helpTimeoutMs: 500,
    cliDetectTimeoutMs: 100,
    killGraceMs: 50,
    taskTtlMs: 60_000,
    taskPollIntervalMs: 5,
    progressIdleHeartbeatMs: 25,
    progressThrottleMs: 1,
    httpHost: '127.0.0.1',
    httpPort: port,
    httpPath: '/mcp',
    httpAuthToken: 'test-token',
    httpSessionIdleMs: 60_000,
    logPath: path.join(serviceRootDir, 'multicli.log'),
    logLevel: 'debug',
    stderrLogLevel: 'silent',
    serviceRootDir,
    serviceLogPath: path.join(serviceRootDir, 'logs', 'service.log'),
    serviceEnvPath: path.join(serviceRootDir, 'env'),
    serviceManifestPath: path.join(serviceRootDir, 'manifest.json'),
  };
}

describe.skipIf(!canBindLoopback)('httpServer', () => {
  let server: MultiCliHttpServer | undefined;
  let client: Client | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectAvailableClis).mockResolvedValue({
      antigravity: false,
      gemini: false,
      codex: false,
      claude: true,
      opencode: false,
    });
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
  });

  it('rejects unauthenticated MCP requests', async () => {
    const config = await createHttpConfig();
    server = await startHttpServer(config);

    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it('serves tool calls over HTTP and resolves the session working directory from roots', async () => {
    const config = await createHttpConfig();
    server = await startHttpServer(config);
    vi.mocked(executeCommand).mockResolvedValue('http response');

    client = new Client(
      { name: 'http-test-client', version: '1.0.0' },
      {
        capabilities: {
          roots: {},
          tasks: {
            list: {},
            cancel: {},
          },
        },
      },
    );

    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: 'file:///tmp/http-root' }],
    }));

    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: {
          Authorization: 'Bearer test-token',
        },
      },
    });

    await client.connect(transport);

    const result = await client.callTool(
      {
        name: 'Ask-Claude',
        arguments: {
          prompt: 'hello',
          model: 'claude-sonnet-4-6',
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Claude response:\nhttp response');
    expect(executeCommand).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        cwd: '/tmp/http-root',
      }),
    );
  });
});
