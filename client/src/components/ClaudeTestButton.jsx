import { useState } from 'react';
import { PlugZap, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { apiFetch } from '../api.js';
import { toastError } from '../utils/toastError.jsx';

/**
 * "Test connection" button for the Claude gateway config (Settings → Agent → Claude).
 * Posts dirty form fields (falling back to the effective saved config server-side) to
 * `/api/settings/claude/test` and shows a per-check pass/fail breakdown.
 */
export default function ClaudeTestButton({ repoId = null, fields = {} }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const body = { ...fields };
      if (repoId) body.repo_id = repoId;
      const res = await apiFetch('/api/settings/claude/test', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResult(res);
    } catch (err) {
      toastError('Claude connection test failed', err);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={runTest}
        disabled={testing}
        className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-heading disabled:opacity-40 transition-colors"
      >
        <PlugZap className={`w-3.5 h-3.5 ${testing ? 'animate-pulse' : ''}`} />
        {testing ? 'Testing…' : 'Test connection'}
      </button>
      {result?.checks?.length ? (
        <div
          className={`mt-2 rounded-lg border px-3 py-2 space-y-1.5 ${
            result.ok ? 'border-success/40' : 'border-danger/40'
          }`}
        >
          {result.base_url ? (
            <p className="text-xs text-faint font-mono truncate">{result.base_url}</p>
          ) : null}
          {result.checks.map((check) => (
            <div key={check.id} className="flex items-start gap-1.5 text-xs">
              {check.ok === true ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-px" />
              ) : check.ok === false ? (
                <XCircle className="w-3.5 h-3.5 text-danger shrink-0 mt-px" />
              ) : (
                <MinusCircle className="w-3.5 h-3.5 text-faint shrink-0 mt-px" />
              )}
              <span
                className={
                  check.ok === true
                    ? 'text-secondary'
                    : check.ok === false
                      ? 'text-danger'
                      : 'text-faint'
                }
              >
                {check.label}
                {check.detail ? ` — ${check.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
