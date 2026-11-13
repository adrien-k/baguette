import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '../components/Alert.jsx';
import { usageModelPricingService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { FIX_MODEL_PRICING_PROMPT } from '@baguette/shared/agent-model-pricing.js';

function formatRate(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n}`;
}

function sourceLabel(source) {
  if (source === 'missing') return 'Missing';
  if (source === 'custom') return 'Custom';
  return 'Built-in';
}

export default function ModelPricing() {
  const [rows, setRows] = useState(null);

  const load = useCallback(() => {
    setRows(null);
    usageModelPricingService
      .find()
      .then((res) => setRows(res.data ?? []))
      .catch((err) => {
        setRows([]);
        toastError('Failed to load model pricing', err);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => {
    const list = rows ?? [];
    return [...list].sort((a, b) => {
      const aMissing = a.source === 'missing' ? 0 : 1;
      const bMissing = b.source === 'missing' ? 0 : 1;
      if (aMissing !== bMissing) return aMissing - bMissing;
      return String(a.model_id).localeCompare(String(b.model_id));
    });
  }, [rows]);

  const missingCount = sorted.filter((r) => r.source === 'missing').length;
  const loading = rows === null;
  const globalHref = `/global?prompt=${encodeURIComponent(FIX_MODEL_PRICING_PROMPT)}`;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-fg">Model pricing</h1>
        <p className="text-sm text-fg-muted mt-1 max-w-2xl">
          USD per 1M tokens used to estimate usage cost. This page is read-only.{' '}
          <Link to="/usage" className="text-accent hover:underline">
            Back to Usage
          </Link>
          .
        </p>
      </div>

      {missingCount > 0 && (
        <Alert variant="info">
          {missingCount} model{missingCount === 1 ? '' : 's'} {missingCount === 1 ? 'has' : 'have'}{' '}
          no cost. Start a <Link to={globalHref}>Global agent</Link> to paste a price listing
          (Cursor docs, OpenRouter, or another reference), update rates, and recompute cost history.
        </Alert>
      )}

      <section className="rounded-xl border border-line bg-inset/50 overflow-hidden">
        <div className="px-4 sm:px-6 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-heading">Catalog</h2>
          <p className="text-xs text-faint mt-0.5">
            Built-in list prices plus instance overrides. Missing models are listed first.
          </p>
        </div>
        {loading ? (
          <p className="px-4 sm:px-6 py-8 text-sm text-faint">Loading pricing…</p>
        ) : sorted.length === 0 ? (
          <p className="px-4 sm:px-6 py-8 text-sm text-faint">No model usage recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint border-b border-line">
                  <th className="font-medium px-4 sm:px-6 py-2">Model</th>
                  <th className="font-medium px-3 py-2">Source</th>
                  <th className="font-medium px-3 py-2 text-right">Input</th>
                  <th className="font-medium px-3 py-2 text-right">Cache write</th>
                  <th className="font-medium px-3 py-2 text-right">Cache read</th>
                  <th className="font-medium px-3 py-2 text-right">Output</th>
                  <th className="font-medium px-4 sm:px-6 py-2 text-right">Usage rows</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const missing = row.source === 'missing';
                  return (
                    <tr
                      key={row.model_id}
                      className={`border-b border-line/80 last:border-0 ${
                        missing ? 'bg-info/10' : ''
                      }`}
                    >
                      <td className="px-4 sm:px-6 py-2.5">
                        <div
                          className="font-mono text-sm text-heading truncate max-w-[18rem]"
                          title={row.model_id}
                        >
                          {row.model_id}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                            missing ? 'bg-info/20 text-info' : 'bg-control text-fg-muted'
                          }`}
                        >
                          {sourceLabel(row.source)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">
                        {formatRate(row.price_input)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">
                        {formatRate(row.price_cache_write)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">
                        {formatRate(row.price_cache_read)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">
                        {formatRate(row.price_output)}
                      </td>
                      <td className="px-4 sm:px-6 py-2.5 text-right tabular-nums text-fg-muted">
                        {row.usage_rows || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
