import { useState } from 'react';
import { Repeat } from 'lucide-react';
import LoopScheduleFields from './LoopScheduleFields.jsx';
import { scheduleFromLoop, isScheduleComplete } from '../utils/loopSchedule.js';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import Field from './Field.jsx';
import TextInput from './TextInput.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { TEXT_FAINT } from '../utils/ui.js';

export default function SendRegularlyModal({ onConfirm, onCancel, saving, defaultName = '' }) {
  const [name, setName] = useState(defaultName);
  const [schedule, setSchedule] = useState(() => scheduleFromLoop(null));
  const canSave = isScheduleComplete(schedule) && !saving;

  const handleConfirm = () => {
    if (!canSave) return;
    onConfirm({ name: name.trim() || null, schedule });
  };

  return (
    <Modal maxWidth="max-w-md">
      <ModalHeader title="Send regularly" icon={Repeat} onClose={onCancel} />
      <p className={`text-xs ${TEXT_FAINT} mb-4`}>
        Creates a loop that re-sends this prompt in this session on a schedule.
      </p>
      <div className="space-y-4">
        <Field
          className=""
          label={
            <>
              Loop label <span className={`${TEXT_FAINT} font-normal`}>(optional)</span>
            </>
          }
        >
          <TextInput
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly check"
          />
        </Field>
        <LoopScheduleFields schedule={schedule} onChange={setSchedule} />
      </div>
      <ModalActions>
        <button type="button" onClick={onCancel} disabled={saving} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canSave}
          className={PRIMARY_BUTTON_SIZED}
        >
          {saving ? 'Creating…' : 'Create loop'}
        </button>
      </ModalActions>
    </Modal>
  );
}
