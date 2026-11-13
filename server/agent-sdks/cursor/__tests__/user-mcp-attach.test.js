import { describe, it, expect, vi } from 'vitest';
import { CursorAgentService } from '../agent-service.ts';

vi.mock('../../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../services/mcp/server.js', () => ({
  buildBaguetteToolList: vi.fn(async () => []),
  buildReviewerAgentTools: vi.fn(() => []),
}));

vi.mock('../../../services/mcp/lib/slack.js', () => ({
  loadConfiguredSlackApps: vi.fn(async () => []),
}));

const loadEnabledMcpServersForSession = vi.fn();

vi.mock('../../../services/user-mcp-runtime.js', () => ({
  loadEnabledMcpServersForSession: (...args) => loadEnabledMcpServersForSession(...args),
}));

describe('CursorAgentService user MCP servers', () => {
  it('sets AgentOptions.mcpServers from the session snapshot', async () => {
    loadEnabledMcpServersForSession.mockResolvedValue({
      docs: {
        type: 'http',
        url: 'https://mcp.example/mcp',
        headers: { Authorization: 'Bearer t' },
      },
    });
    const service = new CursorAgentService();
    service.openSessionStore = async () => ({});
    service.app = {
      get() {},
      service() {
        return {};
      },
    };
    const options = await service.buildAgentOptions(
      { id: 1, user_id: 2, session_path: '/tmp/worktree', repo_id: null },
      { apiKey: 'cursor-key', customTools: {}, agentConfigId: 1 }
    );
    expect(options.mcpServers.docs.url).toBe('https://mcp.example/mcp');
    expect(options.local.customTools).toEqual({});
  });
});
