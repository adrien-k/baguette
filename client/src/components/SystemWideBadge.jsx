import { Server } from 'lucide-react';
import Tooltip from './Tooltip.jsx';

/** Scope label for instance-wide settings (integrations, secrets, Docker, repos, etc.). */
export default function SystemWideBadge() {
  return (
    <Tooltip content="Available to all users of this Baguette instance." wrap placement="left">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium tracking-wide text-fg-muted px-2 py-0.5 rounded-full border border-strong bg-control/80 cursor-default">
        <Server className="w-3 h-3 shrink-0" aria-hidden />
        system-wide
      </span>
    </Tooltip>
  );
}
