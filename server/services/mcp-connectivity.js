const PROBE_TIMEOUT_MS = 15_000;

function errorNeedsAuth(err) {
  const status = err?.code ?? err?.status ?? err?.statusCode;
  if (status === 401) return true;
  const message = String(err?.message || err || '');
  return /\b401\b|unauthorized|invalid_token|needs[-_ ]?auth/i.test(message);
}

function toolNames(result) {
  const tools = result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => tool?.name).filter(Boolean);
}

/**
 * Initialize an HTTP or SSE MCP server and list its tools.
 * @returns {Promise<{ ok: boolean, needs_auth: boolean, tools: string[], error?: string }>}
 */
export async function probeMcpServer({ transport, url, headers }) {
  const endpointUrl = url;
  const [{ Client }, httpMod, sseMod] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/client/sse.js'),
  ]);
  const client = new Client({ name: 'baguette', version: '0.0.1' });
  const requestInit = { headers: headers || {}, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) };
  const endpoint = new URL(endpointUrl);
  const transportImpl =
    transport === 'sse'
      ? new sseMod.SSEClientTransport(endpoint, { requestInit })
      : new httpMod.StreamableHTTPClientTransport(endpoint, { requestInit });
  try {
    await client.connect(transportImpl);
    const listed = await client.listTools();
    const names = toolNames(listed);
    return { ok: true, needs_auth: false, tools: names };
  } catch (err) {
    return {
      ok: false,
      needs_auth: errorNeedsAuth(err),
      tools: [],
      error: err?.message || 'Connection failed',
    };
  } finally {
    await client.close().catch(() => {});
    await transportImpl.close?.().catch(() => {});
  }
}

export function connectivityChecks(probe, url) {
  const connectDetail = probe.ok ? 'Handshake succeeded' : probe.error || 'Connection failed';
  const checks = [
    {
      id: 'connect',
      label: 'Connect',
      ok: probe.ok,
      detail: probe.needs_auth ? 'Authentication required' : connectDetail,
    },
  ];
  if (probe.ok) {
    const count = probe.tools.length;
    checks.push({
      id: 'tools',
      label: 'List tools',
      ok: true,
      detail: count === 1 ? '1 tool' : `${count} tools`,
    });
  }
  return {
    ok: probe.ok,
    needs_auth: !!probe.needs_auth,
    tools: probe.tools,
    base_url: url,
    checks,
  };
}
