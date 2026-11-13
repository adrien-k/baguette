import { useState, useEffect, useCallback } from 'react';
import { loopsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

/**
 * Loops for the current picker scope (`query` from Dashboard/Session sidebar).
 * Subscribes to loops SSE so schedule fields stay fresh.
 */
export function useGetLoops(query) {
  const [loops, setLoops] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!query) {
      setLoops([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    loopsService
      .find({ query: { ...query, $limit: 100 } })
      .then((d) => {
        setLoops(d.data ?? d);
        setLoaded(true);
      })
      .catch((err) => toastError('Failed to load loops', err));
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refresh = () => load();
    loopsService.on('created', refresh);
    loopsService.on('patched', refresh);
    loopsService.on('removed', refresh);
    return () => {
      loopsService.off('created', refresh);
      loopsService.off('patched', refresh);
      loopsService.off('removed', refresh);
    };
  }, [load]);

  return { loops, loaded, reload: load };
}
