import { useState } from 'react';
import { ChevronDown, ExternalLink, MonitorPlay } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import ToolbarButton from './ToolbarButton.jsx';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';

const PREVIEW_LABEL = 'Preview';

/** Preview toolbar control when the session exposes multiple preview services. */
export default function PreviewServicesDropdown({
  services,
  className = '',
  hideLabelBelowSm = false,
  onClick,
}) {
  const [open, setOpen] = useState(false);

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      className={`min-w-[12rem] max-w-xs overflow-hidden ${DROPDOWN_PANEL_CLASS}`}
      reference={({ ref, referenceProps }) => (
        <ToolbarButton
          ref={ref}
          icon={MonitorPlay}
          label={PREVIEW_LABEL}
          hideLabelBelowSm={hideLabelBelowSm}
          className={className}
          title={PREVIEW_LABEL}
          aria-expanded={open}
          aria-haspopup="menu"
          {...referenceProps}
          onClick={(e) => {
            onClick?.(e);
            referenceProps.onClick?.(e);
            setOpen((v) => !v);
          }}
        >
          <ChevronDown
            className={`w-3 h-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </ToolbarButton>
      )}
    >
      <div role="menu">
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
    </AnchoredMenu>
  );
}
