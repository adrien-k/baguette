import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfigureMcpServerBlock from '../ConfigureMcpServerBlock.tsx';

// feathers.js boots the browser client (window + SSE) at import time; the card
// only needs stubbed service methods.
vi.mock('../../../feathers.js', () => ({
  mcpServersService: { startOAuth: vi.fn() },
}));

/** Shape the Baguette MCP result pipeline hands to chat blocks. */
function toolResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

const SERVER_RESULT = toolResult({
  ok: true,
  created: false,
  session_enabled: true,
  settings_url: 'https://baguette.example/settings?tab=integrations',
  server: {
    id: 7,
    name: 'fabricate',
    transport: 'http',
    url: 'https://fabricate.example/api/mcp',
    description: 'Build realistic test fixtures when the task needs seeded data.',
    oauth_connected: false,
  },
});

function renderCard(props) {
  const html = renderToStaticMarkup(
    createElement(ConfigureMcpServerBlock, {
      args: { name: 'fabricate', url: 'https://fabricate.example/api/mcp' },
      ...props,
    })
  );
  return html;
}

describe('ConfigureMcpServerBlock', () => {
  it('shows a spinner while the tool call is still running', () => {
    const html = renderCard({ result: undefined });
    expect(html).toContain('MCP server');
    expect(html).toContain('animate-spin');
    expect(html).not.toContain('Connect with browser');
  });

  it('renders the saved server with description and a Connect button', () => {
    const html = renderCard({ result: SERVER_RESULT });
    expect(html).toContain('fabricate');
    expect(html).toContain('Build realistic test fixtures when the task needs seeded data.');
    expect(html).toContain('Enabled on this session');
    expect(html).toContain('Connect with browser');
    expect(html).not.toContain('Connected with OAuth');
  });

  it('links the authorization URL when the tool already started OAuth', () => {
    const html = renderCard({
      result: toolResult({
        ...JSON.parse(SERVER_RESULT.content[0].text),
        authorization_url: 'https://auth.example/authorize?state=state-1',
      }),
    });
    expect(html).toContain('https://auth.example/authorize?state=state-1');
    expect(html).toContain('Open authorization link');
  });

  it('marks an already-authorized server as connected without a Connect button', () => {
    const html = renderCard({
      result: toolResult({
        ...JSON.parse(SERVER_RESULT.content[0].text),
        server: { ...SERVER_RESULT.server, oauth_connected: true },
      }),
    });
    expect(html).toContain('Connected with OAuth');
    expect(html).not.toContain('Connect with browser');
  });

  it('shows the failure message for a rejected tool run', () => {
    const html = renderCard({
      result: toolResult({ ok: false, error: 'url is required to add an MCP server' }),
    });
    expect(html).toContain('error');
    expect(html).toContain('url is required to add an MCP server');
    expect(html).not.toContain('Connect with browser');
  });
});
