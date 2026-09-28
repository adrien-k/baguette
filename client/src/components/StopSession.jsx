import { useState } from 'react';
import { Square } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { COMPOSER_STOP_BUTTON_CLASS } from '../utils/buttonStyles.js';

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
      title="Stop"
      className={COMPOSER_STOP_BUTTON_CLASS}
    >
      <Square className="w-3.5 h-3.5 fill-current" />
    </button>
  );
}
