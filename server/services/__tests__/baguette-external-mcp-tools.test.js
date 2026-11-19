import { describe, it, expect } from 'vitest';
import { EXTERNAL_MCP_EXCLUDED_TOOLS } from '../../../shared/session-scope.js';
import { buildBaseAgentTools } from '../mcp/registries/base_agent.js';
import { buildExternalMcpToolList } from '../baguette-account-mcp-tools.js';

const app = {
  service: (name) => {
    if (name === 'users') {
      return { get: async () => ({ id: 1 }) };
    }
    throw new Error(`unexpected service ${name}`);
  },
};

describe('buildExternalMcpToolList', () => {
  it('omits in-session-only orchestration tools', () => {
    const tools = buildExternalMcpToolList({ id: 1 }, app);
    const names = tools.map((t) => t.name);
    for (const name of EXTERNAL_MCP_EXCLUDED_TOOLS) {
      expect(names).not.toContain(name);
    }
  });

  it('still exposes cross-session steering and discovery', () => {
    const tools = buildExternalMcpToolList({ id: 1 }, app);
    const names = tools.map((t) => t.name);
    expect(names).toContain('CreateSession');
    expect(names).toContain('CreateSessionMessage');
    expect(names).toContain('SearchSessions');
    expect(names).toContain('ListAgents');
  });

  it('in-session base layer includes excluded tools for agents with callerSession', () => {
    const tools = buildBaseAgentTools({ id: 1 }, app);
    const names = tools.map((t) => t.name);
    expect(names).toContain('StartSubagent');
    expect(names).toContain('WatchSession');
  });
});
