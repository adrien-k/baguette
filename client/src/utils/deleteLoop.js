import toast from 'react-hot-toast';
import { loopsService } from '../feathers.js';
import { toastError } from './toastError.jsx';
import { loopDisplayTitle } from './loopSchedule.js';

/** Confirm, remove via API, toast result. Returns true when the loop was deleted. */
export async function deleteLoopWithConfirm(loop) {
  if (!loop?.id) return false;
  const label = loopDisplayTitle(loop);
  if (!window.confirm(`Delete loop "${label}"?`)) return false;
  try {
    await loopsService.remove(loop.id);
    toast.success('Loop deleted');
    return true;
  } catch (err) {
    toastError('Failed to delete loop', err);
    return false;
  }
}
