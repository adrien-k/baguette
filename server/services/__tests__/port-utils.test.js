import net from 'net';
import { describe, it, expect, afterEach } from 'vitest';
import { getLoopbackHost, isPortListening } from '../port-utils.js';

function listenOn(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

describe('port-utils loopback', () => {
  const servers = [];

  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  it('detects a server bound to 127.0.0.1', async () => {
    const { server, port } = await listenOn('127.0.0.1');
    servers.push(server);
    expect(await getLoopbackHost(port)).toBe('127.0.0.1');
    expect(await isPortListening(port)).toBe(true);
  });

  it('detects a server bound to ::1 only', async () => {
    const { server, port } = await listenOn('::1');
    servers.push(server);
    expect(await getLoopbackHost(port)).toBe('::1');
    expect(await isPortListening(port)).toBe(true);
  });

  it('returns null when nothing is listening', async () => {
    const { server, port } = await listenOn('127.0.0.1');
    servers.push(server);
    server.close();
    await new Promise((r) => server.once('close', r));
    expect(await getLoopbackHost(port)).toBeNull();
    expect(await isPortListening(port)).toBe(false);
  });
});
