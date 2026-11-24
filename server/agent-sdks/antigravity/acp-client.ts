import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AuthenticateResponse,
  type ClientConnection,
  type InitializeResponse,
  type McpServer as AcpMcpServer,
  type NewSessionResponse,
  type PermissionOption,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionResponse,
  type ResumeSessionResponse,
  type SendRequestOptions,
  type SessionNotification,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk/unstable';

const DEFAULT_ACP_ARGS = ['acp', '--dangerously-skip-permissions', '--disable-telemetry'];
const STDERR_TAIL_LIMIT = 4096;

export type AcpModelInfo = {
  modelId: string;
  name?: string;
  description?: string | null;
};

export type AcpSessionWithModels = (NewSessionResponse | ResumeSessionResponse) & {
  sessionId?: string;
  models?: {
    availableModels?: AcpModelInfo[];
    currentModelId?: string;
  };
};

export type AcpSpawnOptions = {
  binary: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  spawnImpl?: typeof spawn;
};

export interface AcpClientLike {
  readonly stderrTail: string;
  onSessionUpdate(listener: (notification: SessionNotification) => void): () => void;
  initialize(): Promise<InitializeResponse>;
  authenticate(methodId: string): Promise<AuthenticateResponse | void>;
  newSession(params: {
    cwd: string;
    mcpServers?: AcpMcpServer[];
    systemPromptAppend?: string | null;
  }): Promise<AcpSessionWithModels>;
  resumeSession(params: {
    sessionId: string;
    cwd: string;
    mcpServers?: AcpMcpServer[];
    systemPromptAppend?: string | null;
  }): Promise<AcpSessionWithModels>;
  setModel(sessionId: string, modelId: string): Promise<unknown>;
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string
  ): Promise<SetSessionConfigOptionResponse>;
  prompt(
    params: Pick<PromptRequest, 'sessionId' | 'prompt'>,
    options?: SendRequestOptions
  ): Promise<PromptResponse>;
  cancel(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

function selectPermissionOption(options: PermissionOption[]): PermissionOption | null {
  if (!options.length) return null;
  return (
    options.find((o) => o.kind === 'allow_always') ??
    options.find((o) => o.kind === 'allow_once') ??
    options[0] ??
    null
  );
}

function buildSystemPromptMeta(
  systemPromptAppend?: string | null
): Record<string, unknown> | undefined {
  const trimmed = typeof systemPromptAppend === 'string' ? systemPromptAppend.trim() : '';
  if (!trimmed) return undefined;
  return {
    antigravity: {
      systemPrompt: {
        append: trimmed,
      },
    },
  };
}

/**
 * Stdio ACP client wrapping a spawned `agy acp` subprocess via `@agentclientprotocol/sdk`.
 */
export class AcpProcessClient implements AcpClientLike {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly connection: ClientConnection;
  private readonly sessionUpdateListeners = new Set<(notification: SessionNotification) => void>();
  private stderrBuffer = '';
  private exited = false;
  private spawnError: Error | null = null;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.stderrBuffer = (this.stderrBuffer + text).slice(-STDERR_TAIL_LIMIT);
    });

    child.once('error', (err: Error) => {
      this.spawnError = err;
      this.exited = true;
      this.connection.close(err);
    });

    child.once('exit', (code, signal) => {
      this.exited = true;
      if (!this.closed && code !== 0) {
        const detail = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
        const tail = this.stderrTail.trim();
        const suffix = tail ? `: ${tail}` : '';
        this.connection.close(new Error(`Antigravity ACP process exited (${detail})${suffix}`));
      }
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    );

    const app = client({ name: 'baguette' })
      .onNotification(methods.client.session.update, ({ params }) => {
        for (const listener of this.sessionUpdateListeners) {
          listener(params);
        }
      })
      .onRequest(
        methods.client.session.requestPermission,
        ({ params, signal }): RequestPermissionResponse => {
          if (this.closed || signal.aborted) {
            return { outcome: { outcome: 'cancelled' } };
          }
          const option = selectPermissionOption(params.options ?? []);
          if (!option) {
            return { outcome: { outcome: 'cancelled' } };
          }
          return {
            outcome: {
              outcome: 'selected',
              optionId: option.optionId,
            },
          };
        }
      );

    this.connection = app.connect(stream);
  }

  static spawn(options: AcpSpawnOptions): AcpProcessClient {
    const spawnFn = options.spawnImpl ?? spawn;
    const args = options.args ?? DEFAULT_ACP_ARGS;
    const child = spawnFn(options.binary, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    return new AcpProcessClient(child);
  }

  get stderrTail(): string {
    return this.stderrBuffer;
  }

  onSessionUpdate(listener: (notification: SessionNotification) => void): () => void {
    this.sessionUpdateListeners.add(listener);
    return () => {
      this.sessionUpdateListeners.delete(listener);
    };
  }

  private enrichError(err: unknown): Error {
    if (this.spawnError) return this.spawnError;
    if (err instanceof Error) {
      const tail = this.stderrTail.trim();
      if (tail && !err.message.includes(tail)) {
        const enriched = new Error(`${err.message} (${tail})`) as Error & {
          code?: unknown;
          data?: unknown;
        };
        const withCode = err as Error & { code?: unknown; data?: unknown };
        if (withCode.code !== undefined) enriched.code = withCode.code;
        if (withCode.data !== undefined) enriched.data = withCode.data;
        enriched.name = err.name;
        return enriched;
      }
      return err;
    }
    return new Error(String(err));
  }

  private async requestWithContext<T>(fn: () => Promise<T>): Promise<T> {
    if (this.spawnError) throw this.spawnError;
    try {
      return await fn();
    } catch (err) {
      throw this.enrichError(err);
    }
  }

  async initialize(): Promise<InitializeResponse> {
    return this.requestWithContext(() =>
      this.connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'baguette', version: '1.0.0' },
        clientCapabilities: {},
      })
    );
  }

  async authenticate(methodId: string): Promise<AuthenticateResponse | void> {
    return this.requestWithContext(() =>
      this.connection.agent.request(methods.agent.authenticate, { methodId })
    );
  }

  async newSession({
    cwd,
    mcpServers = [],
    systemPromptAppend,
  }: {
    cwd: string;
    mcpServers?: AcpMcpServer[];
    systemPromptAppend?: string | null;
  }): Promise<AcpSessionWithModels> {
    const _meta = buildSystemPromptMeta(systemPromptAppend);
    return this.requestWithContext(() =>
      this.connection.agent.request(methods.agent.session.new, {
        cwd,
        mcpServers,
        ...(_meta ? { _meta } : {}),
      })
    ) as Promise<AcpSessionWithModels>;
  }

  async resumeSession({
    sessionId,
    cwd,
    mcpServers = [],
    systemPromptAppend,
  }: {
    sessionId: string;
    cwd: string;
    mcpServers?: AcpMcpServer[];
    systemPromptAppend?: string | null;
  }): Promise<AcpSessionWithModels> {
    const _meta = buildSystemPromptMeta(systemPromptAppend);
    return this.requestWithContext(() =>
      this.connection.agent.request(methods.agent.session.resume, {
        sessionId,
        cwd,
        mcpServers,
        ...(_meta ? { _meta } : {}),
      })
    ) as Promise<AcpSessionWithModels>;
  }

  async setModel(sessionId: string, modelId: string): Promise<unknown> {
    return this.requestWithContext(() =>
      this.connection.agent.request('session/set_model', { sessionId, modelId })
    );
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string
  ): Promise<SetSessionConfigOptionResponse> {
    return this.requestWithContext(() =>
      this.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId,
        value,
      })
    );
  }

  async prompt(
    params: Pick<PromptRequest, 'sessionId' | 'prompt'>,
    options?: SendRequestOptions
  ): Promise<PromptResponse> {
    return this.requestWithContext(() =>
      this.connection.agent.request(
        methods.agent.session.prompt,
        {
          sessionId: params.sessionId,
          prompt: params.prompt,
        },
        options
      )
    );
  }

  async cancel(sessionId: string): Promise<void> {
    if (this.closed || this.exited) return;
    try {
      await this.connection.agent.notify(methods.agent.session.cancel, { sessionId });
    } catch {
      // Best-effort cancellation on shutdown.
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    if (this.closed || this.exited) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.connection.agent.request(methods.agent.session.close, { sessionId }),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1500);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } catch {
      // Best-effort close.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      try {
        this.connection.close();
      } catch {
        // Ignore stream close errors.
      }
      try {
        this.child.stdin.end();
      } catch {
        // Ignore stdin close errors.
      }
      if (!this.exited && !this.child.killed) {
        try {
          this.child.kill('SIGTERM');
        } catch {
          // Ignore kill errors.
        }
        const killTimer = setTimeout(() => {
          if (!this.exited) {
            try {
              this.child.kill('SIGKILL');
            } catch {
              // Ignore SIGKILL errors.
            }
          }
        }, 2000);
        if (typeof killTimer.unref === 'function') killTimer.unref();

        await new Promise<void>((resolve) => {
          if (this.exited) {
            clearTimeout(killTimer);
            resolve();
            return;
          }
          const doneTimer = setTimeout(() => {
            this.child.off('exit', onExit);
            resolve();
          }, 500);
          if (typeof doneTimer.unref === 'function') doneTimer.unref();
          const onExit = () => {
            clearTimeout(doneTimer);
            clearTimeout(killTimer);
            resolve();
          };
          this.child.once('exit', onExit);
        });
      }
    })();
    return this.closePromise;
  }
}
