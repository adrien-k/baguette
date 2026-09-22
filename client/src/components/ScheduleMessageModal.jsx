import { useState, useEffect } from 'react';
import { X, Clock } from 'lucide-react';

export default function ScheduleMessageModal({ onConfirm, onCancel, scheduling }) {
  const [dateTime, setDateTime] = useState('');

  useEffect(() => {
    setDateTime('');
  }, []);

  const when = dateTime ? new Date(dateTime) : null;
  const canSchedule = Boolean(when && !Number.isNaN(when.getTime()) && when.getTime() > Date.now());

  const handleConfirm = () => {
    if (!canSchedule) return;
    onConfirm(when.toISOString());
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h3 className="text-white font-semibold">Schedule time</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-300 p-1 -m-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="block">
          <span className="text-zinc-400 text-sm mb-1.5 block">Send on</span>
          <input
            type="datetime-local"
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </label>
        <div className="flex gap-3 justify-end mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={scheduling}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={scheduling || !canSchedule}
            className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-medium rounded-lg transition-colors"
          >
            {scheduling ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
