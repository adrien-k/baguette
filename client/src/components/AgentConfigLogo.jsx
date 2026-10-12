import { resolveAgentConfigLogoId } from '@baguette/shared/agent-config-logo.js';
import { customAgentConfigLogoSrc } from '../utils/agent-config-custom-logos.js';
import LobeIconAvatar from './LobeIconAvatar.jsx';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

/** Logo for an agent configuration (custom Lobe mark or SDK default). */
export default function AgentConfigLogo({ sdk, logo = null, className = ICON_CLASS, size }) {
  const logoId = resolveAgentConfigLogoId(logo, sdk);
  const customSrc = customAgentConfigLogoSrc(logoId);
  if (customSrc) {
    return (
      <img
        src={customSrc}
        alt=""
        className={`${className} rounded-sm object-contain`}
        width={size}
        height={size}
        aria-hidden
      />
    );
  }
  return <LobeIconAvatar iconId={logoId} className={className} size={size} />;
}
