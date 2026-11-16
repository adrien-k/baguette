import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toastFeathersError } from '../utils/toastError.jsx';
import { sortIssuesBySeverity } from '@baguette/shared/session-issues.js';
import { sessionIssuesService } from '../feathers.js';
import { sessionIssueKeys } from '../queries/keys.js';
import { feathersFind } from '../queries/feathersFinders.js';

/**
 * Opened review issues for one session, severity-sorted. Realtime issue
 * events (created/patched/removed, incl. closed patches dropping rows) are
 * applied by the central `sseCacheBridge`.
 */
export function useGetSessionIssues(sessionId, { enabled = true } = {}) {
  const active = enabled && sessionId != null;

  const query = useQuery({
    queryKey: sessionIssueKeys.session(sessionId),
    queryFn: () =>
      feathersFind(sessionIssuesService, { session_id: sessionId, $sort: { id: 1 }, $limit: 100 }),
    enabled: active,
  });

  useEffect(() => {
    if (query.error) toastFeathersError('Failed to load review issues', query.error);
  }, [query.error]);

  return {
    issues: active ? sortIssuesBySeverity(query.data ?? []) : [],
    loading: active && query.isPending,
  };
}
