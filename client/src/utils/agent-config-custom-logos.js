import lunarouteIcon from '../assets/lunaroute-icon.svg';

/** Bundled marks for ids in shared `CUSTOM_AGENT_CONFIG_LOGO_IDS` (not in @lobehub/icons). */
const CUSTOM_AGENT_CONFIG_LOGO_SRC = {
  LunaRoute: lunarouteIcon,
};

/** @param {string} logoId */
export function customAgentConfigLogoSrc(logoId) {
  return CUSTOM_AGENT_CONFIG_LOGO_SRC[logoId] ?? null;
}
