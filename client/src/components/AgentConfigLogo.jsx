import { resolveAgentConfigLogoId } from '@baguette/shared/agent-config-logo.js';
import LobeIconAvatar from './LobeIconAvatar.jsx';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

/** Logo for an agent configuration (custom Lobe mark or SDK default). */
export default function AgentConfigLogo({ sdk, logo = null, className = ICON_CLASS, size }) {
  const logoId = resolveAgentConfigLogoId(logo, sdk);
  return <LobeIconAvatar iconId={logoId} className={className} size={size} />;
}
