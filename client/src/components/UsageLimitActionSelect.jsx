import { INPUT_CLASS } from '../utils/ui.js';
import { USAGE_LIMIT_ACTION_OPTIONS } from '../utils/usageLimitActions.jsx';
import LightChipDropdown from './LightChipDropdown.jsx';

/** What the agent does at a usage limit: stop, wait for the reset, or continue on credits. */
export default function UsageLimitActionSelect({ value, onChange, disabled = false }) {
  return (
    <LightChipDropdown
      layout="list"
      fullWidth
      matchTriggerWidth
      placement="bottom-end"
      value={value}
      onChange={onChange}
      options={USAGE_LIMIT_ACTION_OPTIONS}
      disabled={disabled}
      ariaLabel="Action at usage limit"
      triggerClassName={`${INPUT_CLASS} text-fg`}
    />
  );
}
