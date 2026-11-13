import { createCurrentSessionInfoTool } from '../lib/current-session-info.js';

export function createCurrentSessionInfoMcpTool(ctx) {
  return createCurrentSessionInfoTool(ctx.getSession, {
    getRepo: ctx.getRepo,
    getToken: ctx.getToken,
  });
}
