import { ChevronDown, Loader2 } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import AgentTypeIcon from '../AgentTypeIcon.jsx';
import { agentDisplayTitle } from '../../utils/sessionAgents.js';
import {
  resolveSubagentForMcpToolCall,
  resolveSubagentTargetFromMcpTool,
  subagentLastAssistantPreview,
  subagentToolHasStableIdentity,
} from '../../utils/subagentMcpTool.js';
import ToolRunElapsed from './ToolRunElapsed.tsx';
import { formatToolInput, hasToolInput } from './QuietToolBlock.tsx';
import MarkdownContent from '../MarkdownContent.jsx';

type SessionAgent = {
  id: number;
  ref?: number;
  name?: string;
  agent_type?: string;
  status?: string;
};

type McpResultData = Record<string, unknown> | null;

function subagentBadgeLabel(
  agent: SessionAgent | null,
  target: ReturnType<typeof resolveSubagentTargetFromMcpTool>
) {
  if (agent) return agentDisplayTitle(agent);
  if (target.name) return target.name;
  if (target.agentId != null) return `agent ${target.agentId}`;
  return 'Subagent';
}

function badgeRef(
  agent: SessionAgent | null,
  target: ReturnType<typeof resolveSubagentTargetFromMcpTool>
) {
  const ref = agent?.ref ?? target.agentRef;
  return ref != null ? ref : null;
}

export default function SubagentMcpToolBlock({
  toolName,
  args = {},
  result,
  parsedResult,
  isError = false,
  startedAt,
  agents,
  onSelectAgent,
}: {
  toolName: 'StartSubagent' | 'AwaitSubagent';
  args?: Record<string, unknown>;
  result?: unknown;
  parsedResult?: McpResultData;
  isError?: boolean;
  startedAt?: string | null;
  agents?: SessionAgent[];
  onSelectAgent?: (agent: SessionAgent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mcpFailed = parsedResult?.ok === false;
  const showFailed = isError || mcpFailed;
  const mcpErrorMessage =
    mcpFailed && typeof parsedResult?.error === 'string' ? parsedResult.error : null;
  const isRunning = result == null && !showFailed;

  const target = useMemo(
    () => resolveSubagentTargetFromMcpTool(toolName, args, parsedResult ?? null),
    [toolName, args, parsedResult]
  );
  const resolved = useMemo(
    () => resolveSubagentForMcpToolCall(agents, toolName, args, parsedResult ?? null),
    [agents, toolName, args, parsedResult]
  );

  const badgeAgent: SessionAgent | null = resolved.agent
    ? (resolved.agent as SessionAgent)
    : resolved.agentId != null
      ? {
          id: resolved.agentId,
          ref: resolved.agentRef ?? undefined,
          name: resolved.name ?? undefined,
          agent_type: 'subagent',
          status: resolved.status ?? undefined,
        }
      : null;

  const displayAgent: SessionAgent | null =
    badgeAgent ??
    (target.name || target.agentRef != null
      ? {
          id: 0,
          ref: target.agentRef ?? undefined,
          name: target.name ?? undefined,
          agent_type: 'subagent',
        }
      : null);

  const refLabel = badgeRef(badgeAgent, target);

  const showBadge =
    displayAgent != null ||
    target.agentRef != null ||
    (toolName === 'StartSubagent' && Boolean(target.name));

  const stableIdentity = subagentToolHasStableIdentity(target);
  const canOpen = Boolean(
    onSelectAgent &&
    stableIdentity &&
    badgeAgent?.id &&
    badgeAgent.id > 0 &&
    (target.agentId != null || resolved.agent != null)
  );

  const badgeLabel = subagentBadgeLabel(displayAgent, target);

  const detail =
    toolName === 'StartSubagent'
      ? ((typeof args.name === 'string' ? args.name : null) ?? resolved.name)
      : null;

  const lastAssistantPreview = useMemo(
    () => subagentLastAssistantPreview(parsedResult ?? null),
    [parsedResult]
  );

  const hasResultBody =
    showFailed ||
    lastAssistantPreview != null ||
    (parsedResult != null && result != null && !isRunning);

  const showExpandedBody = expanded && (hasToolInput(args) || hasResultBody);

  const handleOpen = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canOpen || !badgeAgent) return;
    onSelectAgent(badgeAgent);
  };

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${showFailed ? 'border-danger/60' : 'border-line'}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 min-w-0">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
        >
          <span className="text-accent text-xs font-mono shrink-0">{toolName}</span>
          {detail ? (
            <span className="text-fg text-xs font-semibold truncate min-w-0">{detail}</span>
          ) : null}
          {showFailed && (
            <span className="shrink-0 text-danger text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
              error
            </span>
          )}
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-faint" aria-hidden />
          ) : (
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {isRunning && startedAt ? <ToolRunElapsed startedAt={startedAt} /> : null}
          {showBadge ? (
            <button
              type="button"
              onClick={handleOpen}
              disabled={!canOpen}
              title={canOpen ? `Open ${badgeLabel}` : badgeLabel}
              className={`inline-flex max-w-[12rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                canOpen
                  ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 cursor-pointer'
                  : 'border-line/80 bg-control/40 text-fg-muted cursor-default'
              }`}
            >
              <AgentTypeIcon agentType="subagent" subagent className="h-3 w-3" />
              {refLabel != null ? (
                <span className="font-mono text-[10px] opacity-80">#{refLabel}</span>
              ) : null}
              <span className="truncate">{badgeLabel}</span>
            </button>
          ) : null}
        </div>
      </div>
      {showExpandedBody && (
        <div className="border-t border-line px-3 sm:px-4 py-3 text-xs space-y-2">
          {hasToolInput(args) && (
            <div>
              <div className="text-faint font-medium mb-0.5">Input</div>
              <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
                {formatToolInput(args)}
              </pre>
            </div>
          )}
          {mcpErrorMessage && (
            <div>
              {hasToolInput(args) && <div className="text-faint font-medium mb-0.5">Error</div>}
              <pre className="whitespace-pre-wrap overflow-auto max-h-40 rounded p-2 text-danger bg-red-950/30">
                {mcpErrorMessage}
              </pre>
            </div>
          )}
          {showFailed && !mcpErrorMessage && result != null && (
            <pre className="whitespace-pre-wrap overflow-auto max-h-40 rounded p-2 text-danger bg-red-950/30">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
          {lastAssistantPreview && (
            <div>
              <div className="text-faint font-medium mb-0.5">Subagent reply</div>
              <div className="text-fg-muted rounded-md border border-line/60 bg-page/40 p-2 max-h-48 overflow-auto">
                <MarkdownContent>{lastAssistantPreview}</MarkdownContent>
              </div>
            </div>
          )}
          {!showFailed && parsedResult != null && result != null && !lastAssistantPreview && (
            <div>
              {(hasToolInput(args) || lastAssistantPreview) && (
                <div className="text-faint font-medium mb-0.5">Result</div>
              )}
              <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
                {JSON.stringify(parsedResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
