import { HelpCircle } from 'lucide-react';
import Tooltip from '../../components/Tooltip.jsx';
import MarkdownContent from '../../components/MarkdownContent.jsx';

/**
 * SDK-defined credential help from `credentialSchema.credentialHelpBanner` (markdown).
 * @param {{ credentialHelpBanner?: { markdown?: string } | null }} schema
 */
export default function AgentConfigCredentialHelpTooltip({ schema }) {
  const markdown = schema?.credentialHelpBanner?.markdown?.trim();
  if (!markdown) return null;

  return (
    <Tooltip
      placement="right"
      wrap
      wide
      interactive
      content={
        <MarkdownContent className="text-inherit text-xs [&_p]:my-1.5 [&_p]:first:mt-0 [&_p]:last:mb-0 [&_pre]:my-1.5 [&_pre]:text-[11px] [&_a]:text-info">
          {markdown}
        </MarkdownContent>
      }
    >
      <button
        type="button"
        className="inline-flex text-faint hover:text-fg-muted transition-colors"
        aria-label="API key and auth token help"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}
