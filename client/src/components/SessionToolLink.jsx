import { Code2, MonitorPlay } from 'lucide-react';

const TOOLS = {
  preview: { label: 'Preview', Icon: MonitorPlay },
  code: { label: 'Code', Icon: Code2 },
};

const BASE_CLASS =
  'inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors border-zinc-700/80 bg-zinc-800/50 text-zinc-300 hover:border-sky-500/35 hover:bg-sky-500/10 hover:text-sky-200 shrink-0';

/**
 * External link styled as a compact tool button (preview proxy, code-server, etc.).
 */
export default function SessionToolLink({
  kind,
  href,
  className = '',
  onClick,
  size = 'md',
  hideLabelBelowSm = false,
}) {
  const { label, Icon } = TOOLS[kind];
  const sizeClass = size === 'sm' ? 'px-1.5 py-0.5 text-[11px] gap-1' : 'px-2 py-1';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      title={label}
      className={`${BASE_CLASS} ${sizeClass} ${className}`}
    >
      <Icon className="w-3 h-3 shrink-0 opacity-90" aria-hidden />
      <span className={hideLabelBelowSm ? 'hidden sm:inline' : undefined}>{label}</span>
    </a>
  );
}
