import { createCurrentSessionInfoTool } from '../lib/current-session-info.js';

export function createCurrentSessionInfoMcpTool(ctx) {
  return createCurrentSessionInfoTool(ctx.getSession);
}
