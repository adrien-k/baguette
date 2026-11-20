import UsageLimitActionSelect from '../UsageLimitActionSelect.jsx';
import UsageLimitInput from '../UsageLimitInput.jsx';
import { DEFAULT_USAGE_LIMIT_ACTION } from '../../utils/usageLimitActions.jsx';

export default function DefaultUsageLimitsFields({
  action,
  onActionChange,
  limitText,
  onLimitTextChange,
}) {
  const effectiveAction = action ?? DEFAULT_USAGE_LIMIT_ACTION;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-secondary mb-1">
          When a usage limit is reached
        </label>
        <UsageLimitActionSelect value={effectiveAction} onChange={onActionChange} />
      </div>
      {effectiveAction === 'continue' && (
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Overage Usage limit{' '}
            <span className="text-faint font-normal">(USD of credits — empty for unlimited)</span>
          </label>
          <UsageLimitInput value={limitText} onChange={onLimitTextChange} />
        </div>
      )}
    </div>
  );
}
