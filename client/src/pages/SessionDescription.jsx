import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useGetSession } from '../hooks/useGetSession.js';
import MarkdownContent from '../components/MarkdownContent.jsx';
import {
  findSessionImagePlaceholders,
  hasSessionImagePlaceholders,
  interpolateSessionImagePlaceholders,
  localSessionImageUrl,
} from '@baguette/shared/session-images.js';
import { sessionImagesService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { PAGE_BG, TEXT_HEADING, TEXT_PRIMARY } from '../utils/ui.js';
import { SESSION_CONTENT_MAX_WIDTH_CLASS } from '../components/ChatMessagesViewport.jsx';
import { localizeSessionImageUrls } from './session/sessionDescription.js';

function SessionDescriptionBody({ session }) {
  const rawPrDescription = session?.pr_description?.trim() ?? '';
  const [imageRows, setImageRows] = useState(null);

  // `{{image:<id>}}` placeholders resolve against the session's stored image
  // rows, mirroring the Details tab: a cached GitHub asset URL when the image
  // was attached to the PR, the local session-scoped URL otherwise.
  useEffect(() => {
    if (!session?.id || !hasSessionImagePlaceholders(rawPrDescription)) {
      setImageRows(null);
      return undefined;
    }
    let cancelled = false;
    sessionImagesService
      .find({ query: { session_id: session.id, $limit: 200 } })
      .then((data) => {
        if (!cancelled) setImageRows(Array.isArray(data) ? data : (data?.data ?? []));
      })
      .catch((err) => {
        if (!cancelled) {
          setImageRows(null);
          toastError('Failed to load session images', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.id, rawPrDescription]);

  const description = useMemo(() => {
    // Legacy descriptions embed absolute `/api/images/…` URLs — load them
    // same-origin so they render even when their host is not reachable.
    const raw = localizeSessionImageUrls(rawPrDescription);
    if (!hasSessionImagePlaceholders(raw)) return raw;
    const bySlug = new Set(findSessionImagePlaceholders(raw));
    const rowsById = new Map();
    for (const row of imageRows ?? []) {
      if (bySlug.has(row.image_slug)) rowsById.set(row.image_slug, row);
    }
    return interpolateSessionImagePlaceholders(raw, (imageSlug) => {
      const row = rowsById.get(imageSlug);
      if (!row) return null;
      return {
        url: row.github_url || localSessionImageUrl(row, window.location.origin),
        alt_text: row.alt_text,
      };
    });
  }, [rawPrDescription, imageRows]);

  const title =
    session?.label?.trim() || session?.repo_full_name || `Session #${session?.id ?? ''}`;
  return (
    <div className={`flex-1 min-h-0 overflow-auto ${PAGE_BG}`}>
      <div className={`${SESSION_CONTENT_MAX_WIDTH_CLASS} px-4 py-6 space-y-5`}>
        <div>
          <Link
            to={`/sessions/${session.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-fg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
            Back to session
          </Link>
          <h1 className={`mt-3 text-xl font-semibold ${TEXT_HEADING} break-words`}>{title}</h1>
        </div>
        {description ? (
          <div className={`text-sm ${TEXT_PRIMARY} min-w-0`}>
            <MarkdownContent>{description}</MarkdownContent>
          </div>
        ) : (
          <p className="text-sm text-faint">No description yet.</p>
        )}
      </div>
    </div>
  );
}

/** Full-page view of a session's PR description (e.g. opened from a GitHub PR link). */
export default function SessionDescription() {
  const { id } = useParams();
  const { session, loading, error } = useGetSession(id);

  if (loading) {
    return (
      <div className={`flex-1 min-h-0 ${PAGE_BG} flex items-center justify-center`}>
        <span className="text-fg-muted">Loading…</span>
      </div>
    );
  }
  if (!session) {
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
  return <SessionDescriptionBody session={session} />;
}
