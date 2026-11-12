import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import MarkdownContent from '../components/MarkdownContent.jsx';
import { useSessionDescription } from '../hooks/useSessionDescription.js';
import {
  findSessionImagePlaceholders,
  hasSessionImagePlaceholders,
  interpolateSessionImagePlaceholders,
  publicSessionImageUrl,
} from '@baguette/shared/session-images.js';
import { PAGE_BG, TEXT_HEADING, TEXT_PRIMARY } from '../utils/ui.js';
import { SESSION_CONTENT_MAX_WIDTH_CLASS } from '../components/ChatMessagesViewport.jsx';
import { localizeSessionImageUrls } from './session/sessionDescription.js';

function SessionDescriptionBody({ description }) {
  const rawPrDescription = description.pr_description?.trim() ?? '';

  const descriptionMarkdown = useMemo(() => {
    // Legacy descriptions embed absolute `/api/images/…` URLs — load them
    // same-origin so they render even when their host is not reachable.
    const raw = localizeSessionImageUrls(rawPrDescription);
    if (!hasSessionImagePlaceholders(raw)) return raw;
    const bySlug = new Set(findSessionImagePlaceholders(raw));
    const rowsById = new Map();
    for (const row of description.images ?? []) {
      if (bySlug.has(row.image_slug)) rowsById.set(row.image_slug, row);
    }
    return interpolateSessionImagePlaceholders(raw, (imageSlug) => {
      const row = rowsById.get(imageSlug);
      if (!row) return null;
      return {
        // GitHub-hosted asset URL when the image was attached to the PR,
        // otherwise the public image URL the instance serves unauthenticated —
        // both render for any viewer of this page.
        url: row.github_url || publicSessionImageUrl(row, window.location.origin),
        alt_text: row.alt_text,
      };
    });
  }, [rawPrDescription, description.images]);

  const title =
    description.label?.trim() || description.repo_full_name || `Session #${description.id}`;
  return (
    <div className={`flex-1 min-h-0 overflow-auto ${PAGE_BG}`}>
      <div className={`${SESSION_CONTENT_MAX_WIDTH_CLASS} px-4 py-6 space-y-5`}>
        <div>
          <Link
            to={description.session_accessible ? `/sessions/${description.id}` : '/'}
            className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-fg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
            {description.session_accessible ? 'Back to session' : 'Back to dashboard'}
          </Link>
          <h1 className={`mt-3 text-xl font-semibold ${TEXT_HEADING} break-words`}>{title}</h1>
        </div>
        {descriptionMarkdown ? (
          <div className={`text-sm ${TEXT_PRIMARY} min-w-0`}>
            <MarkdownContent>{descriptionMarkdown}</MarkdownContent>
          </div>
        ) : (
          <p className="text-sm text-faint">No description yet.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Full-page view of a session's PR description (e.g. opened from a GitHub PR
 * link). Loads through the limited `sessions.getDescription` projection, so
 * any signed-in user can view it — the session does not have to be shared.
 */
export default function SessionDescription() {
  const { id } = useParams();
  const { loading, error, description } = useSessionDescription(id);

  if (loading) {
    return (
      <div className={`flex-1 min-h-0 ${PAGE_BG} flex items-center justify-center`}>
        <span className="text-fg-muted">Loading…</span>
      </div>
    );
  }
  if (!description) {
    return (
      <div className={`flex-1 min-h-0 overflow-auto ${PAGE_BG}`}>
        <div className={`${SESSION_CONTENT_MAX_WIDTH_CLASS} px-4 py-6 space-y-4`}>
          <h1 className={`text-xl font-semibold ${TEXT_HEADING}`}>Session not found</h1>
          <p className={`text-sm ${TEXT_PRIMARY}`}>
            {error?.message || 'This session does not exist or you do not have access to it.'}
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-info hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  return <SessionDescriptionBody description={description} />;
}
