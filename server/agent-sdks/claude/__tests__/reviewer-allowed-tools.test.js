import { describe, it, expect } from 'vitest';
import { buildReviewerAgentTools } from '../../../services/mcp/registries/reviewer_agent.js';

/** Keep in sync with REVIEWER_ALLOWED_TOOLS in agent-service.ts (mcp__baguette__ prefix). */
const REVIEWER_BAGUETTE_MCP_ALLOWED = new Set([
  'ListSkills',
  'ReadSkill',
  'CurrentSessionInfo',
  'CreateIssue',
  'ListIssues',
  'ReadIssue',
  'UpdateIssue',
  'CloseIssue',
]);

describe('reviewer Claude allowedTools vs MCP tool list', () => {
  it('includes every reviewer Baguette MCP tool (regression: CurrentSessionInfo)', () => {
    const tools = buildReviewerAgentTools({ id: 1, session_path: '/tmp/wt' }, { get: () => null });
    const mcpNames = tools.map((t) => t.name);
    for (const name of mcpNames) {
      expect(REVIEWER_BAGUETTE_MCP_ALLOWED.has(name)).toBe(true);
    }
    expect(mcpNames).toContain('CurrentSessionInfo');
  });
});
