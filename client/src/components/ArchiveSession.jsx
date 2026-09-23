import { useState } from 'react';
import { Archive, Loader2 } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

export default function ArchiveSession({ session, onArchive }) {
  const [archiving, setArchiving] = useState(false);
  const isProvisioning = session.status === 'provisioning';
  const isArchiving = session.status === 'archiving';
  const blocked = archiving || isArchiving || isProvisioning;

  const handleClick = async (e) => {
    e.stopPropagation();
    if (blocked) return;
    setArchiving(true);
    try {
      await sessionsService.remove(session.id);
      onArchive?.();
    } catch (err) {
      toastError('Failed to archive session', err);
      setArchiving(false);
    }
  };

  const title = isProvisioning
    ? 'Session is still being set up'
    : archiving || isArchiving
      ? 'Archiving…'
      : 'Archive session';

  return (
    <button
      onClick={handleClick}
      disabled={blocked}
      title={title}
      className="p-1 text-zinc-500 hover:text-amber-500 hover:bg-zinc-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {archiving || session.status === 'archiving' ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
      ) : (
        <Archive className="w-3.5 h-3.5 shrink-0" />
      )}
    </button>
  );
}
