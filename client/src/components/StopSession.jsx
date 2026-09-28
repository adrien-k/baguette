import { useState } from 'react';
import { Square, Loader2 } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

export function isSessionStoppable(session) {
  return !session?.archived_at && session?.status === 'running';
}

export default function StopSession({ session }) {
  const [stopping, setStopping] = useState(false);

  const handleClick = async (e) => {
    e.stopPropagation();
    if (stopping) return;
    setStopping(true);
    try {
      await sessionsService.stop(session.id);
    } catch (err) {
      toastError('Failed to stop session', err);
      setStopping(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={stopping}
      title={stopping ? 'Stopping…' : 'Stop session'}
      className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {stopping ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
      ) : (
        <Square className="w-3.5 h-3.5 shrink-0 fill-current" />
      )}
    </button>
  );
}
