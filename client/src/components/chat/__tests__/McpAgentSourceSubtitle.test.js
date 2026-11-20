import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import McpAgentSourceSubtitle from '../McpAgentSourceSubtitle.tsx';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }) => `<a href="${to}" class="${className}">${children}</a>`,
}));

describe('McpAgentSourceSubtitle', () => {
  it('renders external MCP link to integrations settings', () => {
    const html = renderToStaticMarkup(
      createElement(McpAgentSourceSubtitle, {
        sender: { kind: 'external', label: 'Baguette MCP', settings_tab: 'integrations' },
      })
    );
    expect(html).toContain('From');
    expect(html).toContain('Baguette MCP');
    expect(html).toContain('/settings?tab=integrations');
  });

  it('renders session and agent links', () => {
    const html = renderToStaticMarkup(
      createElement(McpAgentSourceSubtitle, {
        sender: {
          kind: 'session',
          session_id: 42,
          session_label: 'Orchestrator',
          repo_id: 3,
          agent_id: 9,
          agent_ref: 1,
          agent_name: 'Primary',
        },
      })
    );
    expect(html).toContain('Orchestrator');
    expect(html).toContain('/repos/3/sessions/42');
    expect(html).toContain('Primary');
    expect(html).toContain('agent=9');
  });
});
