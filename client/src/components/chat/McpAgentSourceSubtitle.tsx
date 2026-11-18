import { Link } from 'react-router-dom';
import type { McpMessageSender } from '@baguette/shared/message-types.ts';
import { sessionHref } from '@baguette/shared/session-scope.js';
import { isMcpMessageSender } from '@baguette/shared/mcp-message-sender.js';

function settingsHref(sender: { settings_tab?: string }) {
  const tab = sender.settings_tab ?? 'integrations';
  return `/settings?tab=${tab}`;
}

function SessionSourceLink({ sender }: { sender: Extract<McpMessageSender, { kind: 'session' }> }) {
  const sessionPath = sessionHref({
    id: sender.session_id,
    is_global: sender.is_global,
    repo_id: sender.repo_id,
  });
  const agentHref =
    sender.agent_id != null ? `${sessionPath}?agent=${sender.agent_id}&view=chat` : null;

  return (
    <>
      <Link to={sessionPath} className="text-secondary hover:underline truncate max-w-[14rem]">
        {sender.session_label}
      </Link>
      {sender.agent_name && agentHref ? (
        <>
          <span aria-hidden> · </span>
          <Link to={agentHref} className="text-secondary hover:underline truncate max-w-[10rem]">
            {sender.agent_name}
          </Link>
        </>
      ) : null}
    </>
  );
}

export default function McpAgentSourceSubtitle({ sender }: { sender?: McpMessageSender | null }) {
  if (!isMcpMessageSender(sender)) return null;

  return (
    <div className="text-[11px] text-faint font-normal flex flex-wrap items-center gap-x-1 gap-y-0.5 pl-5 sm:pl-0 sm:ml-[1.375rem] -mt-0.5 mb-1">
      <span className="shrink-0">From</span>
      {sender.kind === 'external' ? (
        <Link to={settingsHref(sender)} className="text-secondary hover:underline">
          {sender.label}
        </Link>
      ) : (
        <SessionSourceLink sender={sender} />
      )}
    </div>
  );
}
