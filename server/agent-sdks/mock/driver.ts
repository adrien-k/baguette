import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import { isMockAgentSdkEnabled, mockUserPromptText } from '../../../shared/mock-agent-sdk.js';
import type { MessageOp } from '../../../shared/message-types.ts';
import type { AgentApp } from '../../services/feathers/agent-service-types.ts';
import { issueAgentMetadataFromTurn } from '../../services/session-issues.js';
import type {
  AgentDriver,
  DriverContext,
  DriverNewSessionParams,
  DriverPromptResult,
  DriverRecordUsageOpts,
  DriverSessionResult,
} from '../driver.ts';
import { runMockAgentTurn, runMockReviewerTurn } from './mock-agent-turn.js';
import { recordMockTurnUsage } from './record-turn-usage.js';

function opsToAcpNotifications(
  sessionId: string,
  ops: MessageOp[],
  onTurnResult: (status: 'ok' | 'error', errorMessage: string | null) => void
): SessionNotification[] {
  const out: SessionNotification[] = [];
  for (const op of ops) {
    if (op.op === 'assistant_text') {
      out.push({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: op.text },
        },
      });
    } else if (op.op === 'assistant_thinking') {
      out.push({
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: op.text },
        },
      });
    } else if (op.op === 'tool_start') {
      out.push({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: op.call_id,
          title: op.name,
          name: op.name,
          status: 'in_progress',
          rawInput: op.input,
        },
      });
    } else if (op.op === 'tool_result') {
      const isError = Boolean(op.is_error || op.status === 'error');
      out.push({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: op.call_id,
          ...(op.name ? { name: op.name } : {}),
          ...(op.input ? { rawInput: op.input } : {}),
          rawOutput: op.raw,
          status: isError ? 'failed' : 'completed',
        },
      });
    } else if (op.op === 'plan') {
      out.push({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'mock-plan',
          title: 'Plan',
          name: 'exit_plan_mode',
          status: 'completed',
          rawInput: { plan: op.markdown },
        },
      });
    } else if (op.op === 'turn_result') {
      onTurnResult(
        op.payload.status === 'error' ? 'error' : 'ok',
        op.payload.error_message ?? null
      );
    }
  }
  return out;
}

export class MockDriver implements AgentDriver {
  private readonly app: AgentApp;
  private readonly listeners = new Set<(notification: SessionNotification) => void>();
  private ctx: DriverContext | null = null;

  constructor(app: AgentApp) {
    this.app = app;
  }

  onUpdate(listener: (notification: SessionNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(notification: SessionNotification): void {
    for (const listener of this.listeners) {
      listener(notification);
    }
  }

  async start(ctx: DriverContext): Promise<void> {
    if (!isMockAgentSdkEnabled()) {
      throw new Error('Mock agent SDK is not enabled');
    }
    this.ctx = ctx;
  }

  async newSession(_params: DriverNewSessionParams): Promise<DriverSessionResult> {
    return { sessionId: 'mock-session', storedSessionId: null };
  }

  async resume(
    _storedSessionId: string,
    _params: DriverNewSessionParams
  ): Promise<DriverSessionResult> {
    return { sessionId: 'mock-session', storedSessionId: null };
  }

  async prompt(
    sessionId: string,
    content: string,
    opts?: { signal?: AbortSignal }
  ): Promise<DriverPromptResult> {
    if (!this.ctx) throw new Error('MockDriver not started');
    const ctx = this.ctx;
    const abortSignal = opts?.signal ?? new AbortController().signal;

    let turnError: string | null = null;
    let turnCostUsd = 0;
    const virtualWriter = {
      appendThinking: async (text: string) => {
        if (!text) return;
        this.emit({
          sessionId,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text },
          },
        });
      },
      appendAssistantText: async (text: string) => {
        if (!text) return;
        this.emit({
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text },
          },
        });
      },
      flushAssistant: async () => {},
      startTool: async (callId: string, name: string, args: Record<string, unknown>) => {
        this.emit({
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: callId,
            title: name,
            name,
            status: 'in_progress',
            rawInput: args,
          },
        });
        return 0;
      },
      completeTool: async (
        callId: string,
        opts: {
          name?: string;
          args?: Record<string, unknown>;
          rawResult?: unknown;
          isError?: boolean;
          toolCallStatus?: string;
        } = {}
      ) => {
        const isError = Boolean(opts.isError || opts.toolCallStatus === 'error');
        this.emit({
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: callId,
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.args ? { rawInput: opts.args } : {}),
            rawOutput: opts.rawResult,
            status: isError ? 'failed' : 'completed',
          },
        });
      },
      persistTurnResult: async (payload: {
        status?: string;
        error_message?: string | null;
        total_cost_usd?: number | null;
      }) => {
        if (typeof payload?.total_cost_usd === 'number') {
          turnCostUsd = payload.total_cost_usd;
        }
        if (payload?.status === 'error') {
          turnError = payload.error_message ?? 'Mock turn failed';
        }
      },
      apply: async (ops: MessageOp[]) => {
        const notifications = opsToAcpNotifications(sessionId, ops, (status, errMsg) => {
          if (status === 'error') turnError = errMsg ?? 'Mock turn failed';
        });
        for (const n of notifications) {
          this.emit(n);
        }
      },
      finish: async () => {},
      log: async (ev: unknown) => {
        await ctx.appendRawEvent?.(ev);
      },
    };

    if (ctx.channel === 'review') {
      const turnMeta = issueAgentMetadataFromTurn({
        agent_sdk: 'mock',
        model: ctx.turnModel.model ?? ctx.agent.model,
        model_params: ctx.turnModel.modelParams,
      });
      await runMockReviewerTurn({
        writer: virtualWriter,
        abortSignal,
        createIssue: (spec: { severity: string; title: string; description: string }) =>
          this.app.service('session-issues').create(
            {
              session_id: ctx.session.id,
              status: 'opened',
              severity: spec.severity,
              title: spec.title,
              description: spec.description,
              ...turnMeta,
            },
            { user: { id: ctx.userId } }
          ),
      });
      if (abortSignal.aborted) return { stopReason: 'aborted' };
      return { stopReason: turnError ? 'error' : 'end_turn', errorMessage: turnError };
    }

    const userPrompt = ctx.row?.message_json
      ? mockUserPromptText(JSON.parse(ctx.row.message_json))
      : content;

    const turnMeta = await runMockAgentTurn({
      session: ctx.session,
      writer: virtualWriter,
      abortSignal,
      userPrompt: userPrompt || content,
      app: this.app,
      userId: ctx.userId,
      turnId: ctx.turnId,
      agent: ctx.agent,
    });

    if (abortSignal.aborted) return { stopReason: 'aborted' };
    if (turnError) {
      return {
        stopReason: 'error',
        errorMessage: turnError,
        awaitingUser: Boolean(turnMeta?.awaitingUser),
      };
    }
    return {
      stopReason: 'end_turn',
      awaitingUser: Boolean(turnMeta?.awaitingUser),
      usage: turnCostUsd > 0 ? { cost_usd: turnCostUsd } : null,
    };
  }

  async cancel(_sessionId: string): Promise<void> {}

  async close(): Promise<void> {}

  async recordTurnUsage(opts: DriverRecordUsageOpts): Promise<void> {
    await recordMockTurnUsage(this.app, opts.session, {
      turnModel: opts.turnModel,
      patchSessionCost: opts.patchSessionCost,
      agentConfigId: opts.agentConfigId,
      agentId: opts.agentId,
    });
  }

  async completeText(): Promise<string> {
    return '';
  }
}
