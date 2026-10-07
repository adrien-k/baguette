import ClaudeIcon from './ClaudeIcon.jsx';
import CursorIcon from './CursorIcon.jsx';
import PiIcon from './PiIcon.jsx';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

/** Agent SDK mark for the session composer and settings. */
export default function AgentSdkIcon({ sdk, className = ICON_CLASS }) {
  if (sdk === 'cursor') return <CursorIcon className={className} />;
  if (sdk === 'pi') return <PiIcon className={className} />;
  return <ClaudeIcon className={className} />;
}
