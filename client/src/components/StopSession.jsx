import { useState } from 'react';
import { Square } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastFeathersError } from '../utils/toastError.jsx';
import { COMPOSER_STOP_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { isAnyAgentRunning } from '../utils/sessionAgents.js';

export function isSessionStoppable(session) {
  if (!session || session.archived_at) return false;
  if (session.status === 'provisioning' || session.status === 'archiving') return true;
  return isAnyAgentRunning(session);
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
      toastFeathersError('Failed to stop session', err);
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
