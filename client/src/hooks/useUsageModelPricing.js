import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usageModelPricingService } from '../feathers.js';
import { usageModelPricingKeys } from '../queries/keys.js';
import { feathersFind } from '../queries/feathersFinders.js';

/**
 * Custom & catalog model pricing rows from `usageModelPricingService`.
 * Background read: degrades gracefully if the request fails so model pickers
 * and usage labels still work with the static pricing table.
 */
export function useUsageModelPricing({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: usageModelPricingKeys.list(),
    queryFn: () => feathersFind(usageModelPricingService, {}),
    enabled,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const customPricingByModel = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (row?.source === 'custom' && row.model_id) {
        map.set(row.model_id, {
          input: row.price_input,
          cacheWrite: row.price_cache_write ?? null,
          cacheRead: row.price_cache_read ?? null,
          output: row.price_output,
        });
      }
    }
    return map;
  }, [rows]);

  return {
    rows,
    customPricingByModel,
    loading: query.isPending,
  };
}
