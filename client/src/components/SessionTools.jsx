import { MonitorPlay, Upload } from 'lucide-react';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import PrStatusBadge from './PrStatusBadge.jsx';
import PreviewServicesDropdown from './PreviewServicesDropdown.jsx';
import ToolbarButton, { SESSION_TOOLS_CONTAINER_CLASS } from './ToolbarButton.jsx';
import VsCodeIcon from './svg/VsCodeIcon.jsx';

const ALL_TOOLS = ['pr', 'preview', 'code', 'push'];

function wrapClick(onToolClick) {
  if (!onToolClick) return undefined;
  return (e) => {
    onToolClick(e);
    e.stopPropagation();
  };
}

function canShowTool(tool, session, { readonly, onPush }) {
  if (!session) return false;
  switch (tool) {
    case 'pr':
      return !!(session.pr_url || session.pr_number != null);
    case 'preview':
      return !!session.preview_url;
    case 'code':
      return !!session.codeserver_url;
    case 'push':
      return (
        !!onPush &&
        !readonly &&
        !session.auto_push &&
        session.pr_status !== 'merged' &&
        !isGlobalSession(session)
      );
    default:
      return false;
  }
}

export function sessionToolsVisible(session, tools = ALL_TOOLS, options = {}) {
  return tools.some((t) => canShowTool(t, session, options));
}

/**
 * Session header / card tool row: PR, Preview, Code, Push.
 *
 * @param {object} props
 * @param {object} props.session
 * @param {Array<'pr'|'preview'|'code'|'push'>} [props.tools]
 * @param {'toolbar'|'compact'} [props.size] — preset container sizing via `.session-tool-btn` descendants
 * @param {string} [props.className] — extra classes on the flex container (layout, gaps, margins)
 * @param {boolean} [props.hideLabelBelowSm]
 * @param {boolean} [props.showPreviewPublicBadge]
 * @param {string} [props.prUrl] — override session PR link (e.g. header `prInfo`)
 * @param {number} [props.prNumber]
 * @param {string} [props.prStatus]
 */
export default function SessionTools({
  session,
  tools = ALL_TOOLS,
  size = 'toolbar',
  className = '',
  hideLabelBelowSm = false,
  readonly = false,
  onPush,
  pushing = false,
  commitsToPush = 0,
  prUrl,
  prNumber,
  prStatus,
  onToolClick,
  showPreviewPublicBadge = false,
}) {
  if (!session) return null;

  const options = { readonly, onPush };
  const visibleTools = tools.filter((t) => canShowTool(t, session, options));
  if (visibleTools.length === 0 && !showPreviewPublicBadge) return null;

  const onClick = wrapClick(onToolClick);
  const resolvedPrUrl = prUrl ?? session.pr_url;
  const resolvedPrNumber = prNumber ?? session.pr_number;
  const resolvedPrStatus = prStatus ?? session.pr_status;

  const containerClass = [
    'flex items-center gap-1.5 shrink-0',
    SESSION_TOOLS_CONTAINER_CLASS[size] ?? '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass}>
      {visibleTools.includes('pr') && (
        <PrStatusBadge
          status={resolvedPrStatus}
          prNumber={resolvedPrNumber}
          prUrl={resolvedPrUrl}
          hideLabelBelowSm={hideLabelBelowSm}
          onClick={onClick}
        />
      )}
      {visibleTools.includes('preview') && (
        <span className="shrink-0 flex items-center gap-1">
          {session.preview_services?.length > 1 ? (
            <PreviewServicesDropdown
              services={session.preview_services}
              hideLabelBelowSm={hideLabelBelowSm}
              onClick={onClick}
            />
          ) : (
            <ToolbarButton
              href={session.preview_url}
              icon={MonitorPlay}
              label="Preview"
              hideLabelBelowSm={hideLabelBelowSm}
              title="Preview"
              onClick={onClick}
            />
          )}
          {showPreviewPublicBadge && session.is_preview_public && (
            <span className="hidden sm:inline text-[10px] text-accent border border-brand/30 rounded px-1 py-0.5 leading-none">
              public
            </span>
          )}
        </span>
      )}
      {visibleTools.includes('code') && (
        <ToolbarButton
          href={session.codeserver_url}
          icon={VsCodeIcon}
          label="Code"
          hideLabelBelowSm={hideLabelBelowSm}
          title="Code"
          onClick={onClick}
        />
      )}
      {visibleTools.includes('push') && (
        <ToolbarButton
          icon={Upload}
          label="Push"
          hideLabelBelowSm={hideLabelBelowSm}
          onClick={onPush}
          disabled={pushing}
          title="Push commits"
          className="relative"
        >
          {commitsToPush > 0 && (
            <span className="flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-brand text-white text-[10px] font-bold leading-none">
              {commitsToPush}
            </span>
          )}
        </ToolbarButton>
      )}
    </div>
  );
}
