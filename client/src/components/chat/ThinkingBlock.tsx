import { useState } from 'react';

export default function ThinkingBlock({
  block,
  isLatestMessage,
}: {
  block: { thinking?: string | null };
  isLatestMessage?: boolean;
}) {
  const [forceExpanded, setForceExpanded] = useState<boolean | null>(null);
  const expanded = forceExpanded !== null ? forceExpanded : isLatestMessage;

  return (
    <div onClick={() => setForceExpanded((e) => !e)} className="text-xs text-faint overflow-hidden">
      <div className="px-3 py-2 font-medium">Thinking...</div>
      {expanded && (
        <div className="px-3 py-2 text-faint whitespace-pre-wrap max-h-64 overflow-auto">
          {block.thinking}
        </div>
      )}
    </div>
  );
}
