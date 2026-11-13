import { useEffect } from 'react';
import { sessionPlansService } from '../feathers.js';
import { findAllPages } from '../utils/feathersFindAll.js';
import { toastError } from '../utils/toastError.jsx';
import { sameScopeId, scopeKeyOf } from '../utils/boundScope.js';
import { useScopedResource } from './useScopedResource.js';

const EMPTY_PLANS = [];

export function useGetSessionPlans(sessionId, { enabled = true } = {}) {
  const requestedKey = !enabled || sessionId == null ? '' : scopeKeyOf(sessionId);
  const {
    data: plans,
    loading,
    reload,
    isKeyCurrent,
  } = useScopedResource(requestedKey, {
    empty: EMPTY_PLANS,
    enabled,
    load: async () => {
      try {
        return await findAllPages(sessionPlansService, {
          session_id: sessionId,
          $sort: { ref: 1 },
        });
      } catch (err) {
        toastError('Failed to load plans', err);
        return EMPTY_PLANS;
      }
    },
  });

  useEffect(() => {
    if (!enabled || sessionId == null) return undefined;
    const key = requestedKey;
    const onChange = (row) => {
      if (sameScopeId(row.session_id, sessionId) && isKeyCurrent(key)) reload();
    };
    sessionPlansService.on('created', onChange);
    sessionPlansService.on('patched', onChange);
    sessionPlansService.on('removed', onChange);
    return () => {
      sessionPlansService.off('created', onChange);
      sessionPlansService.off('patched', onChange);
      sessionPlansService.off('removed', onChange);
    };
  }, [enabled, sessionId, reload, requestedKey, isKeyCurrent]);

  return { plans, loading, reload };
}
