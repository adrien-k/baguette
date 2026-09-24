import { useState } from 'react';
import { X, Repeat } from 'lucide-react';
import LoopScheduleFields from './LoopScheduleFields.jsx';
import { scheduleFromLoop, isScheduleComplete } from '../utils/loopSchedule.js';

export default function SendRegularlyModal({ onConfirm, onCancel, saving, defaultName = '' }) {
  const [name, setName] = useState(defaultName);
  const [schedule, setSchedule] = useState(() => scheduleFromLoop(null));
  const canSave = isScheduleComplete(schedule) && !saving;

  const handleConfirm = () => {
    if (!canSave) return;
    onConfirm({ name: name.trim() || null, schedule });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-amber-400" />
            <h3 className="text-white font-semibold">Send regularly</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-300 p-1 -m-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          Creates a loop that re-sends this prompt in this session on a schedule.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Loop label <span className="text-zinc-500 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nightly check"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>
          <LoopScheduleFields schedule={schedule} onChange={setSchedule} />
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSave}
            className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-medium rounded-lg transition-colors"
          >
            {saving ? 'Creating…' : 'Create loop'}
          </button>
        </div>
      </div>
    </div>
  );
}
