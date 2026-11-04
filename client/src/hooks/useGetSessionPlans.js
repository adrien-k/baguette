import { useCallback, useEffect, useState } from 'react';
import { sessionPlansService } from '../feathers.js';
import { findAllPages } from '../utils/feathersFindAll.js';
import { toastError } from '../utils/toastError.jsx';

export function useGetSessionPlans(sessionId, { enabled = true } = {}) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!enabled || sessionId == null) {
      setPlans([]);
      return;
    }
    setLoading(true);
    findAllPages(sessionPlansService, { session_id: sessionId, $sort: { ref: 1 } })
      .then((rows) => setPlans(rows))
      .catch((err) => {
        toastError('Failed to load plans', err);
        setPlans([]);
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

  return { plans, loading, reload };
}
