import { X } from 'lucide-react';

export default function ClearReviewConfirmModal({ onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-white font-semibold">Review the entire change</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-zinc-500 hover:text-zinc-300 p-1 -m-1 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-zinc-400 text-sm mb-1">
          This clears reviewer chat history and resets the last-reviewed commit marker. The next
          review will evaluate the full session diff from the start.
        </p>
        <p className="text-zinc-500 text-xs mb-6">Issues on this tab are unchanged.</p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-medium rounded-lg transition-colors"
          >
            {loading ? 'Starting…' : 'Review entire change'}
          </button>
        </div>
      </div>
    </div>
  );
}
