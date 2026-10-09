import { useCallback, useEffect, useState } from 'react';
import { sessionsService, sessionPlansService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

export function useGetSessionPlan(sessionId, { enabled = true } = {}) {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!enabled || sessionId == null) {
      setMarkdown('');
      return;
    }
    setLoading(true);
    sessionsService
      .getPlan({ id: sessionId })
      .then((res) => setMarkdown(res.markdown ?? ''))
      .catch((err) => {
        toastError('Failed to load plan', err);
        setMarkdown('');
      })
      .finally(() => setLoading(false));
  }, [enabled, sessionId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled || sessionId == null) return undefined;
    const onChange = (row) => {
      if (row.session_id === sessionId) reload();
    };
    sessionPlansService.on('created', onChange);
    sessionPlansService.on('patched', onChange);
    sessionPlansService.on('removed', onChange);
    return () => {
      sessionPlansService.off('created', onChange);
      sessionPlansService.off('patched', onChange);
      sessionPlansService.off('removed', onChange);
    };
  }, [enabled, sessionId, reload]);

  return { markdown, loading, reload };
}
