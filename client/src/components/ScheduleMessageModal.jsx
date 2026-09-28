import { useState } from 'react';
import { Clock } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import TextInput from './TextInput.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { TEXT_MUTED } from '../utils/ui.js';

function localDateInputValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ScheduleMessageModal({ onConfirm, onCancel, scheduling }) {
  const [date, setDate] = useState(() => localDateInputValue());
  const [time, setTime] = useState('');

  const when = date && time ? new Date(`${date}T${time}`) : null;
  const canSchedule = Boolean(when && !Number.isNaN(when.getTime()) && when.getTime() > Date.now());

  const handleConfirm = () => {
    if (!canSchedule) return;
    onConfirm(when.toISOString());
  };

  return (
    <Modal>
      <ModalHeader title="Schedule time" icon={Clock} onClose={onCancel} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={`${TEXT_MUTED} text-sm mb-1.5 block`}>Date</span>
          <TextInput
            type="date"
            value={date}
            min={localDateInputValue()}
            onChange={(e) => setDate(e.target.value)}
            className="py-2.5 text-heading"
          />
        </label>
        <label className="block">
          <span className={`${TEXT_MUTED} text-sm mb-1.5 block`}>Time</span>
          <TextInput
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="py-2.5 text-heading"
          />
        </label>
      </div>
      <ModalActions>
        <button
          type="button"
          onClick={onCancel}
          disabled={scheduling}
          className={GHOST_BUTTON_CLASS}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={scheduling || !canSchedule}
          className={PRIMARY_BUTTON_SIZED}
        >
          {scheduling ? 'Scheduling…' : 'Schedule'}
        </button>
      </ModalActions>
    </Modal>
  );
}
