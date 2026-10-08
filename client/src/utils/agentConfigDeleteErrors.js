export function isAgentConfigInUseError(err) {
  return err?.code === 409 && err?.data?.code === 'agent_config_in_use';
}

export function agentConfigInUseReferences(err) {
  return err?.data?.references ?? null;
}
