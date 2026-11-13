import { useCallback, useEffect, useMemo, useState } from 'react';
import { agentConfigsService } from '../feathers.js';
import { isMockAgentSdkEnabled } from '@baguette/shared/mock-agent-sdk.js';

/** @typedef {{ key: string, label: string, supportsModelParams?: boolean, usesAgentPricingTable?: boolean, appliesUserModelPrefs?: boolean, requiresModelParamsOnTurn?: boolean, credentialSchema?: object | null }} SdkMeta */

/** @type {SdkMeta[] | null} */
let cached = null;
/** @type {Promise<SdkMeta[]> | null} */
let inflight = null;

function loadSdkMetas() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = agentConfigsService
      .getSdkMetas()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        cached = list;
        return list;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * JSON-serializable SDK plugin metas from `agent-configs.getSdkMetas()`.
 * Mock is omitted from `pickerMetas` unless `isMockAgentSdkEnabled()`.
 */
export function useSdkMetas() {
  const [metas, setMetas] = useState(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadSdkMetas()
      .then((list) => {
        if (cancelled) return;
        setMetas(list);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setMetas([]);
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byKey = useMemo(() => Object.fromEntries(metas.map((m) => [m.key, m])), [metas]);
  const pickerMetas = useMemo(
    () => metas.filter((m) => m.key !== 'mock' || isMockAgentSdkEnabled()),
    [metas]
  );
  const getMeta = useCallback((key) => (key ? (byKey[key] ?? null) : null), [byKey]);

  return {
    metas,
    pickerMetas,
    loading,
    error,
    getMeta,
  };
}
