import { BadRequest } from 'feathers/errors';

export const AGENT_CONFIG_DELETED_MESSAGE = 'Agent configuration was deleted';

/** @param {{ deleted_at?: string | null } | null | undefined} row */
export function throwIfAgentConfigDeleted(row) {
  if (row?.deleted_at) {
    throw new BadRequest(AGENT_CONFIG_DELETED_MESSAGE);
  }
}
