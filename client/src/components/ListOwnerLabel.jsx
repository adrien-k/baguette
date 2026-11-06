import Tooltip from './Tooltip.jsx';
import UserAvatar from './UserAvatar.jsx';

/** Owner avatar for list rows; username is in the tooltip. */
export default function ListOwnerLabel({ owner, className = '' }) {
  if (!owner?.username) return null;
  return (
    <Tooltip content={owner.username}>
      <span className={`inline-flex shrink-0 ${className}`.trim()} aria-label={owner.username}>
        <UserAvatar user={owner} size="sm" />
      </span>
    </Tooltip>
  );
}
