import net from 'net';

/** Loopback addresses Baguette probes and proxies (IPv4 first). */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];

function tryConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.on('connect', () => {
      socket.destroy();
      resolve(host);
    });
    socket.on('error', () => resolve(null));
  });
}

/**
 * Return which loopback address accepts TCP connections on `port`, or null if none.
 * Resolves to a host string (never rejects).
 */
export async function getLoopbackHost(port) {
  const results = await Promise.all(LOOPBACK_HOSTS.map((host) => tryConnect(port, host)));
  return results.find(Boolean) ?? null;
}

/**
 * Check whether a TCP port is listening on loopback (127.0.0.1 or ::1).
 * Resolves to true/false (never rejects).
 */
export async function isPortListening(port) {
  return (await getLoopbackHost(port)) != null;
}
