import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, MonitorPlay } from 'lucide-react';
import VsCodeIcon from './VsCodeIcon.jsx';

const TOOLS = {
  preview: { label: 'Preview', Icon: MonitorPlay },
  code: { label: 'Code', Icon: VsCodeIcon },
};

const BASE_CLASS =
  'inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors border-zinc-700/80 bg-zinc-800/50 text-zinc-300 hover:border-sky-500/35 hover:bg-sky-500/10 hover:text-sky-200 shrink-0';

function PreviewServicesDropdown({
  services,
  className = '',
  size = 'md',
  hideLabelBelowSm,
  onClick,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const { label, Icon } = TOOLS.preview;
  const sizeClass = size === 'sm' ? 'px-1.5 py-0.5 text-[11px] gap-1' : 'px-2 py-1';

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        title={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          onClick?.(e);
          setOpen((v) => !v);
        }}
        className={`${BASE_CLASS} ${sizeClass} ${className}`}
      >
        <Icon className="w-3 h-3 shrink-0 opacity-90" aria-hidden />
        <span className={hideLabelBelowSm ? 'hidden sm:inline' : undefined}>{label}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[12rem] max-w-xs overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        >
          <div className="border-b border-zinc-800 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Preview services
          </div>
          <div className="py-1">
            {services.map((svc) => {
              const href = svc.deep_link_url || svc.url;
              return (
                <a
                  key={svc.name}
                  role="menuitem"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-zinc-100">{svc.display_name}</span>
                    {svc.description && (
                      <span className="mt-0.5 block text-xs leading-snug text-zinc-500 line-clamp-2">
                        {svc.description}
                      </span>
                    )}
                  </span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * External link styled as a compact tool button (preview proxy, code-server, etc.).
 */
export default function SessionToolLink({
  kind,
  href,
  previewServices,
  className = '',
  onClick,
  size = 'md',
  hideLabelBelowSm = false,
}) {
  if (kind === 'preview' && previewServices?.length > 1) {
    return (
      <PreviewServicesDropdown
        services={previewServices}
        className={className}
        size={size}
        hideLabelBelowSm={hideLabelBelowSm}
        onClick={onClick}
      />
    );
  }

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
