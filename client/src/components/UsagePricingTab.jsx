import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { usageModelPricingService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

function numOrEmpty(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function PricingInputs({ row, draft = {}, onChange, disabled }) {
  const fields = [
    ['price_input', 'Input', 'In'],
    ['price_cache_write', 'Cache write', 'C write'],
    ['price_cache_read', 'Cache read', 'C read'],
    ['price_output', 'Output', 'Out'],
  ];
  return (
    <div className="grid grid-cols-4 gap-1 sm:gap-2 min-w-0 w-full">
      {fields.map(([key, label, shortLabel]) => (
        <label key={key} className="flex min-w-0 flex-col gap-0.5 text-faint">
          <span className="text-[10px] sm:text-xs leading-tight truncate" title={label}>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
          <input
            type="number"
            min="0"
            step="any"
            disabled={disabled}
            value={draft[key] ?? numOrEmpty(row?.[key])}
            onChange={(e) => onChange(key, e.target.value)}
            className="w-full min-w-0 rounded-md border border-line bg-control px-1 sm:px-2 py-1 text-xs sm:text-sm text-heading tabular-nums disabled:opacity-60"
            placeholder="—"
          />
        </label>
      ))}
    </div>
  );
}

export default function UsagePricingTab() {
  const [rows, setRows] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [recomputingId, setRecomputingId] = useState(null);
  const [recomputingAll, setRecomputingAll] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    usageModelPricingService
      .find()
      .then((res) => setRows(res.data ?? []))
      .catch((err) => toastError('Failed to load model pricing', err));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setDraft = (modelId, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [modelId]: { ...(prev[modelId] ?? {}), [key]: value },
    }));
  };

  const saveRow = async (row) => {
    const draft = drafts[row.model_id] ?? {};
    const payload = {
      price_input: draft.price_input ?? row.price_input,
      price_output: draft.price_output ?? row.price_output,
      price_cache_write: draft.price_cache_write ?? row.price_cache_write ?? '',
      price_cache_read: draft.price_cache_read ?? row.price_cache_read ?? '',
    };
    setSavingId(row.model_id);
    try {
      await usageModelPricingService.patch(row.model_id, payload);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.model_id];
        return next;
      });
      load();
    } catch (err) {
      toastError(`Failed to save pricing for ${row.model_id}`, err);
    } finally {
      setSavingId(null);
    }
  };

  const recompute = async (modelId = null) => {
    if (modelId) setRecomputingId(modelId);
    else setRecomputingAll(true);
    try {
      const result = await usageModelPricingService.recompute(modelId ? { model_id: modelId } : {});
      const skipped = Number(result?.skipped_claude_rows ?? 0);
      const updated = Number(result?.updated_rows ?? 0);
      if (skipped > 0) {
        const parts = [];
        if (updated > 0) parts.push(`Updated ${updated} usage row${updated === 1 ? '' : 's'}.`);
        parts.push(
          `${skipped} Claude row${skipped === 1 ? '' : 's'} kept SDK billing (not recalculated).`
        );
        toast(parts.join(' '));
      } else if (updated > 0) {
        toast.success(`Updated ${updated} usage row${updated === 1 ? '' : 's'}.`);
      }
      load();
    } catch (err) {
      toastError(modelId ? `Failed to recompute ${modelId}` : 'Failed to recompute all costs', err);
    } finally {
      setRecomputingId(null);
      setRecomputingAll(false);
    }
  };

  const loading = rows === null;

  return (
    <section className="rounded-xl border border-line bg-inset/50 overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-heading">Model pricing</h2>
          <p className="text-xs text-faint mt-0.5 max-w-2xl">
            USD per 1M tokens. Edit any row to override list prices, then recompute stored usage
            costs for Cursor and Pi. Claude usage keeps SDK-reported costs and is not updated here.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || recomputingAll}
          onClick={() => recompute()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-control px-3 py-1.5 text-xs font-medium text-heading hover:bg-control/80 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${recomputingAll ? 'animate-spin' : ''}`} />
          Recompute all costs
        </button>
      </div>
      {loading ? (
        <p className="px-4 sm:px-6 py-8 text-sm text-faint">Loading pricing…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 sm:px-6 py-8 text-sm text-faint">No model usage recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line/80">
          {rows.map((row) => {
            const busy = savingId === row.model_id || recomputingId === row.model_id;
            return (
              <li
                key={row.model_id}
                className="px-4 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-start gap-4"
              >
                <div className="min-w-0 lg:w-48 shrink-0">
                  <div className="font-mono text-sm text-heading truncate" title={row.model_id}>
                    {row.model_id}
                  </div>
                  <div className="text-xs text-faint mt-1 capitalize">
                    {row.source}
                    {row.usage_rows
                      ? ` · ${row.usage_rows} usage row${row.usage_rows === 1 ? '' : 's'}`
                      : ''}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <PricingInputs
                    row={row}
                    draft={drafts[row.model_id]}
                    disabled={busy}
                    onChange={(key, value) => setDraft(row.model_id, key, value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveRow(row)}
                    className="rounded-lg border border-line bg-brand/90 text-white px-3 py-1.5 text-xs font-medium hover:bg-brand disabled:opacity-50"
                  >
                    {savingId === row.model_id ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    disabled={loading || busy || recomputingAll}
                    onClick={() => recompute(row.model_id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-control px-3 py-1.5 text-xs text-heading hover:bg-control/80 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${recomputingId === row.model_id ? 'animate-spin' : ''}`}
                    />
                    Recompute
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
