import ClaudeIcon from './ClaudeIcon.jsx';
import CursorIcon from './CursorIcon.jsx';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

/** Claude or Cursor mark for the current agent SDK. */
export default function AgentSdkIcon({ sdk, className = ICON_CLASS }) {
  if (sdk === 'cursor') return <CursorIcon className={className} />;
  return <ClaudeIcon className={className} />;
}
