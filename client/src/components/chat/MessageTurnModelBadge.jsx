import AgentTurnModelLabel from '../AgentTurnModelLabel.jsx';

/** Turn model indicator on chat / queue rows. */
export default function MessageTurnModelBadge({
  agentType,
  model,
  modelParams,
  agentConfigId,
  className = 'text-faint font-normal',
}) {
  return (
    <AgentTurnModelLabel
      agentType={agentType}
      agentConfigId={agentConfigId}
      model={model}
      modelParams={modelParams}
      className={className}
      modelClassName="text-faint truncate max-w-[12rem] sm:max-w-xs"
    />
  );
}
