import GithubIcon from './svg/GithubIcon.jsx';
import ToolbarButton from './ToolbarButton.jsx';

const STATUS_ICON_CLASS = {
  open: 'text-emerald-400',
  draft: 'text-zinc-400',
  merged: 'text-indigo-400',
  closed: 'text-red-400',
};

const STATUS_TITLE = {
  open: 'Open pull request',
  draft: 'Draft pull request',
  merged: 'Merged pull request',
  closed: 'Closed pull request',
};

export default function PrStatusBadge({
  status,
  prNumber,
  prUrl,
  hideLabelBelowSm = false,
  onClick,
}) {
  if (!prUrl && prNumber == null) return null;

  const statusKey = STATUS_TITLE[status] ? status : null;
  const titleBase = statusKey ? STATUS_TITLE[statusKey] : 'Pull request on GitHub';
  const title = prNumber != null ? `${titleBase} #${prNumber}` : titleBase;

  return (
    <ToolbarButton
      href={prUrl || undefined}
      icon={GithubIcon}
      iconClassName={statusKey ? STATUS_ICON_CLASS[statusKey] : ''}
      label={prNumber != null ? `#${prNumber}` : undefined}
      hideLabelBelowSm={hideLabelBelowSm}
      title={title}
      onClick={onClick ?? ((e) => e.stopPropagation())}
    />
  );
}
