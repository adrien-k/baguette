import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';
import AgentConfigLogo from './AgentConfigLogo.jsx';
import Tooltip from './Tooltip.jsx';
import { AGENT_TYPE_LABELS } from '../utils/usageSeries.js';
import {
  messageModelDisplayName,
  messageModelLabel,
  messageModelParamsText,
} from '../utils/messageModelLabel.js';
import { useAgentConfigContext } from '../context/AgentConfigContext.jsx';
import { useAgentConfigModels } from '../hooks/useAgentConfigModels.js';

/**
 * Inline: agent type · config logo · model name (no params).
 * Hover: config label, SDK, full model + variant, params.
 */
export default function AgentTurnModelLabel({
  agentType,
  agentConfigId,
  model,
  modelParams,
  className = '',
  modelClassName = 'text-fg-muted font-mono truncate max-w-[14rem] sm:max-w-md',
}) {
  const { getConfig } = useAgentConfigContext();
  const { models } = useAgentConfigModels(agentConfigId);

  const config = getConfig(agentConfigId);
  const modelName = messageModelDisplayName({ model, models });
  const typeLabel =
    agentType != null && agentType !== '' ? (AGENT_TYPE_LABELS[agentType] ?? agentType) : null;
  const fullModelLabel = messageModelLabel({ model, modelParams, models });
  const paramsText = messageModelParamsText(modelParams, models, model);
  const sdkLabel = config?.sdk ? formatAgentSdkDisplayName(config.sdk) : null;

  if (!typeLabel && !modelName && !config) return null;

  const hasTooltipDetail =
    Boolean(config?.label) ||
    Boolean(sdkLabel) ||
    Boolean(paramsText) ||
    Boolean(fullModelLabel && fullModelLabel !== modelName);

  const inline = (
    <span
      className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs shrink-0 ${className}`}
    >
      {typeLabel ? <span className="text-fg-muted shrink-0">{typeLabel}</span> : null}
      <span className="inline-flex items-center gap-1 min-w-0">
        {config ? (
          <AgentConfigLogo
            sdk={config.sdk}
            logo={config.logo}
            className="w-3.5 h-3.5 shrink-0"
            size={14}
          />
        ) : null}
        {modelName ? <span className={modelClassName}>{modelName}</span> : null}
      </span>
    </span>
  );

  if (!hasTooltipDetail) return inline;

  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          {config?.label ? <div className="font-medium text-heading">{config.label}</div> : null}
          {typeLabel ? <div>{typeLabel}</div> : null}
          {sdkLabel ? <div>{sdkLabel}</div> : null}
          {fullModelLabel ? <div>{fullModelLabel}</div> : null}
          {paramsText ? <div className="text-faint whitespace-pre-wrap">{paramsText}</div> : null}
        </div>
      }
      wrap
      placement="top"
    >
      {inline}
    </Tooltip>
  );
}
