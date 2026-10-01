import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import YamlCodeBlock from './YamlCodeBlock.jsx';

export default function BaguetteConfigModal({ sessionId, onClose }) {
  const [yaml, setYaml] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    setYaml(null);
    setMissing(false);
    sessionsService
      .baguetteYaml(sessionId)
      .then((data) => {
        if (cancelled) return;
        setYaml(data.yaml ?? null);
        setMissing(!!data.missing);
      })
      .catch((err) => {
        if (!cancelled) {
          setYaml(null);
          setMissing(false);
          toastError('Failed to load baguette config', err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!sessionId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-nav sm:border sm:border-strong sm:rounded-xl shadow-2xl w-full h-full sm:w-[min(960px,92vw)] sm:max-h-[88vh] sm:h-auto flex flex-col"
        role="dialog"
        aria-labelledby="baguette-config-modal-title"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-line shrink-0">
          <h2 id="baguette-config-modal-title" className="text-sm font-semibold text-heading">
            Baguette config
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-faint hover:text-secondary p-1 -m-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
          {loading ? (
            <p className="text-sm text-faint">Loading config…</p>
          ) : missing ? (
            <p className="text-sm text-faint">
              No <code className="text-secondary">.baguette.yaml</code> in this repository yet.
            </p>
          ) : yaml ? (
            <YamlCodeBlock
              source={yaml}
              className="bg-page/60 border border-line rounded-md p-3 max-h-[min(70vh,48rem)] overflow-y-auto"
            />
          ) : (
            <p className="text-sm text-faint">Config unavailable.</p>
          )}
        </div>
      </div>
    </div>
  );
}
