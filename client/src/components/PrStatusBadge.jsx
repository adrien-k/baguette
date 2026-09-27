import { PR_STATUS_BADGE_CONFIG, PR_STATUS_BADGE_FALLBACK } from '../utils/prStatusStyles.js';

const BASE_CLASS =
  'session-tool-btn inline-flex items-center justify-center shrink-0 rounded-md border font-medium transition-colors h-8 gap-1.5 px-2 text-xs';

export default function PrStatusBadge({
  status,
  prNumber,
  prUrl,
  hideLabelBelowSm = false,
  onClick,
}) {
  if (!prUrl && prNumber == null) return null;

  const config = PR_STATUS_BADGE_CONFIG[status] ?? PR_STATUS_BADGE_FALLBACK;
  const { icon: Icon, className, title: titleBase } = config;
  const title = prNumber != null ? `${titleBase} #${prNumber}` : titleBase;
  const classNames = `${BASE_CLASS} ${className}`;

  const content = (
    <>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      {prNumber != null && (
        <span className={hideLabelBelowSm ? 'hidden sm:inline' : undefined}>#{prNumber}</span>
      )}
    </>
  );

  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={classNames}
        title={title}
        onClick={onClick ?? ((e) => e.stopPropagation())}
      >
        {content}
      </a>
    );
  }

  return (
    <span className={classNames} title={title}>
      {content}
    </span>
  );
}
