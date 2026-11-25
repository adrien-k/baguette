/**
 * Generic `AgentDriver` backed by an external ACP subprocess (`AcpProcessClient`)
 * and an optional loopback HTTP MCP bridge (`startAcpMcpBridge`).
 */

import type {
  McpServer as AcpMcpServer,
  SessionNotification,
} from '@agentclientprotocol/sdk/unstable';
import {
  baguetteMcpShortName,
  isBaguetteMcpToolName,
} from '../../../shared/baguette-mcp-tool-names.js';
import type {
  AgentDriver,
  DriverCompleteTextParams,
  DriverContext,
  DriverMcpServersMap,
  DriverNewSessionParams,
  DriverPromptResult,
  DriverPromptUsage,
  DriverSessionResult,
} from '../driver.ts';
import {
  AcpProcessClient,
  type AcpClientLike,
  type AcpSessionWithModels,
  type AcpSpawnOptions,
} from './acp-client.ts';
import { startAcpMcpBridge, type AcpMcpBridge, type AcpMcpToolDescriptor } from './mcp-bridge.ts';

type UserMcpEntry = {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export function toAcpMcpServers(
  userMcpMap: DriverMcpServersMap | Record<string, UserMcpEntry> | null | undefined
): AcpMcpServer[] {
  if (!userMcpMap || typeof userMcpMap !== 'object') return [];
  const servers: AcpMcpServer[] = [];
  for (const [name, rawEntry] of Object.entries(userMcpMap)) {
    const entry = rawEntry as UserMcpEntry | null | undefined;
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'sse' && typeof entry.url === 'string' && entry.url) {
      servers.push({
        type: 'sse',
        name,
        url: entry.url,
        headers: entry.headers
          ? Object.entries(entry.headers).map(([hName, hVal]) => ({
              name: hName,
              value: String(hVal),
            }))
          : [],
      });
      continue;
    }
    if ((entry.type === 'http' || !entry.type) && typeof entry.url === 'string' && entry.url) {
      servers.push({
        type: 'http',
        name,
        url: entry.url,
        headers: entry.headers
          ? Object.entries(entry.headers).map(([hName, hVal]) => ({
              name: hName,
              value: String(hVal),
            }))
          : [],
      });
      continue;
    }
    if (typeof entry.command === 'string' && entry.command) {
      servers.push({
        name,
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args.map(String) : [],
        env: entry.env
          ? Object.entries(entry.env).map(([eName, eVal]) => ({
              name: eName,
              value: String(eVal),
            }))
          : [],
      });
    }
  }
  return servers;
}

export function isAuthRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === -32000) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /auth(entication)?\s*required/i.test(message);
}

export type AcpProcessDriverConfig = {
  binary: string | ((config: Record<string, unknown> | null) => string);
  args?: string[];
  env?:
    | Record<string, string | undefined>
    | ((config: Record<string, unknown> | null) => Record<string, string | undefined>);
  authMethod?: string | null;
  apiKey?: string | null | ((config: Record<string, unknown> | null) => string | null);
  modelSelection?: 'setModel' | 'configOption';
  systemPromptMetaKey?: string;
  applyModel?: (opts: {
    client: AcpClientLike;
    sessionId: string;
    sessionResult: AcpSessionWithModels;
    model: string;
    modelParams?: unknown;
  }) => Promise<void>;
  recordTurnUsage?: AgentDriver['recordTurnUsage'];
  spawnClient?: (opts: AcpSpawnOptions) => AcpClientLike;
  startMcpBridge?: typeof startAcpMcpBridge;
};

export class AcpProcessDriver implements AgentDriver {
  private readonly cfg: AcpProcessDriverConfig;
  private readonly config: Record<string, unknown> | null;
  private readonly listeners = new Set<(notification: SessionNotification) => void>();
  private acpClient: AcpClientLike | null = null;
  private mcpBridge: AcpMcpBridge | null = null;
  private userMcpServers: AcpMcpServer[] = [];
  private unsubClientUpdate: (() => void) | null = null;
  private readonly toolNameById = new Map<string, string>();
  private apiKey: string | null = null;

  constructor(cfg: AcpProcessDriverConfig, config: Record<string, unknown> | null = null) {
    this.cfg = cfg;
    this.config = config;
    this.recordTurnUsage = cfg.recordTurnUsage;
  }

  recordTurnUsage?: AgentDriver['recordTurnUsage'];

  private resolveBinary(): string {
    return typeof this.cfg.binary === 'function' ? this.cfg.binary(this.config) : this.cfg.binary;
  }

  private resolveEnv(): Record<string, string | undefined> {
    if (typeof this.cfg.env === 'function') return this.cfg.env(this.config);
    return this.cfg.env ?? process.env;
  }

  private resolveApiKey(): string | null {
    if (typeof this.cfg.apiKey === 'function') return this.cfg.apiKey(this.config);
    if (this.cfg.apiKey !== undefined) return this.cfg.apiKey;
    const raw = this.config?.api_key;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  private spawnClient(cwd: string): AcpClientLike {
    const spawnFn = this.cfg.spawnClient ?? AcpProcessClient.spawn;
    return spawnFn({
      binary: this.resolveBinary(),
      args: this.cfg.args,
      cwd,
      env: this.resolveEnv(),
      systemPromptMetaKey: this.cfg.systemPromptMetaKey,
    });
  }

  private handleIncomingNotification(notification: SessionNotification): void {
    const update = notification?.update;
    let effective = notification;
    if (update && typeof update === 'object') {
      const toolCallId = (update as { toolCallId?: unknown }).toolCallId;
      if (update.sessionUpdate === 'tool_call' && typeof toolCallId === 'string') {
        const name = (update as { name?: string }).name;
        if (name) this.toolNameById.set(toolCallId, name);
      } else if (update.sessionUpdate === 'tool_call_update' && typeof toolCallId === 'string') {
        const name = (update as { name?: string }).name ?? this.toolNameById.get(toolCallId) ?? '';
        const normalizedName = name.startsWith('mcp_baguette_')
          ? `mcp__baguette__${name.slice('mcp_baguette_'.length)}`
          : name;
        if (
          this.mcpBridge &&
          isBaguetteMcpToolName(normalizedName) &&
          (update as { rawOutput?: unknown }).rawOutput == null
        ) {
          const captured = this.mcpBridge.consumeToolResult(baguetteMcpShortName(normalizedName));
          if (captured) {
            effective = {
              ...notification,
              update: {
                ...update,
                rawOutput: captured.raw,
                ...(captured.isError ? { status: 'failed' } : {}),
              },
            };
          }
        }
      }
    }
    for (const listener of this.listeners) {
      listener(effective);
    }
  }

  async start(ctx: DriverContext): Promise<void> {
    this.apiKey = this.resolveApiKey();
    this.userMcpServers = toAcpMcpServers(ctx.userMcpServers);

    if (ctx.baguetteTools.length > 0) {
      const startBridge = this.cfg.startMcpBridge ?? startAcpMcpBridge;
      this.mcpBridge = await startBridge(ctx.baguetteTools as AcpMcpToolDescriptor[], {
        serverName: 'baguette',
      });
    }

    this.acpClient = this.spawnClient(ctx.cwd);
    this.unsubClientUpdate = this.acpClient.onSessionUpdate((n) =>
      this.handleIncomingNotification(n)
    );
    await this.acpClient.initialize();
  }

  private async authenticateAndRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isAuthRequiredError(err) && this.cfg.authMethod && this.apiKey && this.acpClient) {
        await this.acpClient.authenticate(this.cfg.authMethod);
        return fn();
      }
      throw err;
    }
  }

  private buildMcpServers(extra?: AcpMcpServer[]): AcpMcpServer[] {
    const base = extra ?? this.userMcpServers;
    return this.mcpBridge ? [...base, this.mcpBridge.acpServerConfig] : [...base];
  }

  private async applySessionModel(
    sessionId: string,
    sessionResult: AcpSessionWithModels,
    model: string | null | undefined,
    modelParams?: unknown
  ): Promise<void> {
    if (!model || !this.acpClient) return;
    if (this.cfg.applyModel) {
      await this.cfg.applyModel({
        client: this.acpClient,
        sessionId,
        sessionResult,
        model,
        modelParams,
      });
      return;
    }
    if (this.cfg.modelSelection === 'configOption') {
      await this.acpClient.setConfigOption(sessionId, 'model', model);
    } else {
      await this.acpClient.setModel(sessionId, model);
    }
  }

  async newSession(params: DriverNewSessionParams): Promise<DriverSessionResult> {
    if (!this.acpClient) throw new Error('AcpProcessDriver not started');
    const mcpServers = this.buildMcpServers(params.mcpServers);
    const created = await this.authenticateAndRetry(() =>
      this.acpClient!.newSession({
        cwd: params.cwd,
        mcpServers,
        systemPromptAppend: params.systemPromptAppend,
      })
    );
    if (!created.sessionId) {
      throw new Error('ACP session/new returned no sessionId');
    }
    await this.applySessionModel(created.sessionId, created, params.model, params.modelParams);
    return {
      sessionId: created.sessionId,
      storedSessionId: created.sessionId,
      availableModels: created.models?.availableModels,
      currentModelId: created.models?.currentModelId,
    };
  }

  async resume(
    storedSessionId: string,
    params: DriverNewSessionParams
  ): Promise<DriverSessionResult> {
    if (!this.acpClient) throw new Error('AcpProcessDriver not started');
    const mcpServers = this.buildMcpServers(params.mcpServers);
    try {
      const resumed = await this.authenticateAndRetry(() =>
        this.acpClient!.resumeSession({
          sessionId: storedSessionId,
          cwd: params.cwd,
          mcpServers,
          systemPromptAppend: params.systemPromptAppend,
        })
      );
      const sessionId = resumed.sessionId || storedSessionId;
      await this.applySessionModel(sessionId, resumed, params.model, params.modelParams);
      return {
        sessionId,
        storedSessionId: sessionId,
        availableModels: resumed.models?.availableModels,
        currentModelId: resumed.models?.currentModelId,
      };
    } catch (err) {
      if (isAuthRequiredError(err)) throw err;
      return this.newSession(params);
    }
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.acpClient?.setModel(sessionId, modelId);
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    await this.acpClient?.setConfigOption(sessionId, configId, value);
  }

  async prompt(
    sessionId: string,
    content: string,
    opts?: { signal?: AbortSignal }
  ): Promise<DriverPromptResult> {
    if (!this.acpClient) throw new Error('AcpProcessDriver not started');
    const response = await this.acpClient.prompt(
      {
        sessionId,
        prompt: [{ type: 'text', text: content }],
      },
      {
        cancellationSignal: opts?.signal,
        stopWaitingOnCancel: true,
      }
    );

    const u = response?.usage;
    const usage: DriverPromptUsage | null = u
      ? {
          input_tokens: Number(u.inputTokens) || 0,
          output_tokens: Number(u.outputTokens) || 0,
          cache_read_tokens: Number(u.cachedReadTokens) || 0,
          cache_write_tokens: Number(u.cachedWriteTokens) || 0,
          reasoning_tokens: Number(u.thoughtTokens) || 0,
          total_tokens:
            Number(u.totalTokens) ||
            (Number(u.inputTokens) || 0) +
              (Number(u.outputTokens) || 0) +
              (Number(u.cachedReadTokens) || 0) +
              (Number(u.cachedWriteTokens) || 0),
        }
      : null;

    return {
      stopReason: response?.stopReason ?? 'end_turn',
      usage,
    };
  }

  onUpdate(listener: (notification: SessionNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async cancel(sessionId: string): Promise<void> {
    await this.acpClient?.cancel(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.acpClient?.closeSession(sessionId);
  }

  async close(): Promise<void> {
    this.unsubClientUpdate?.();
    this.unsubClientUpdate = null;
    if (this.acpClient) {
      await this.acpClient.close().catch(() => {});
      this.acpClient = null;
    }
    if (this.mcpBridge) {
      await this.mcpBridge.close().catch(() => {});
      this.mcpBridge = null;
    }
  }

  async completeText(params: DriverCompleteTextParams): Promise<string> {
    const client = this.spawnClient(params.cwd);
    let acpSessionId: string | null = null;
    const chunks: string[] = [];
    const unsub = client.onSessionUpdate((n) => {
      if (n?.update?.sessionUpdate === 'agent_message_chunk' && n.update.content?.type === 'text') {
        chunks.push(n.update.content.text);
      }
    });
    const onAbort = () => {
      if (acpSessionId) void client.cancel(acpSessionId);
      void client.close();
    };
    params.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await client.initialize();
      const created = await client.newSession({ cwd: params.cwd, mcpServers: [] });
      acpSessionId = created.sessionId ?? null;
      if (!acpSessionId) return '';
      if (params.model) {
        await client.setModel(acpSessionId, params.model).catch(() => {});
      }
      await client.prompt(
        { sessionId: acpSessionId, prompt: [{ type: 'text', text: params.prompt }] },
        { cancellationSignal: params.signal, stopWaitingOnCancel: true }
      );
      return chunks.join('').trim();
    } finally {
      params.signal.removeEventListener('abort', onAbort);
      unsub();
      if (acpSessionId) await client.closeSession(acpSessionId).catch(() => {});
      await client.close().catch(() => {});
    }
  }
}
