/**
 * Node HTTP adapter for Feathers v6 `createHandler`.
 *
 * Stock `toNodeHandler` does not abort the Web Request when the Node socket
 * closes, so SSE generators never run `finally` / `disconnect`. This adapter
 * ties `req`/`res` close to AbortController + body-reader cancel.
 *
 * Idle SSE streams also get `: heartbeat` comments so proxies/NATs do not
 * drop the connection (same keep-alive as the old `/api/events` SseManager).
 */

/** Match the old `SseManager` interval so idle SSE survives proxy timeouts. */
const SSE_HEARTBEAT_MS = 30_000;
const SSE_HEARTBEAT_FRAME = ': heartbeat\n\n';

const BUFFERED_CONTENT_TYPES = [
  'multipart/form-data',
  'application/x-www-form-urlencoded',
  'application/json',
];

async function incomingMessageToRequest(req, signal) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  const method = req.method || 'GET';
  const contentType = req.headers['content-type'] || '';
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
  const init = { method, headers, signal };

  if (!hasBody) {
    return new Request(url, init);
  }

  const needsBuffering = BUFFERED_CONTENT_TYPES.some((type) => contentType.includes(type));
  if (needsBuffering) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return new Request(url, {
      ...init,
      body: body.length > 0 ? body : undefined,
    });
  }

  return new Request(url, {
    ...init,
    body: req,
    duplex: 'half',
  });
}

function isSseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('text/event-stream');
}

function startSseHeartbeat(res, abortController, heartbeatMs) {
  if (heartbeatMs <= 0) return () => {};
  const heartbeat = setInterval(() => {
    if (abortController.signal.aborted || res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    try {
      res.write(SSE_HEARTBEAT_FRAME);
    } catch {
      clearInterval(heartbeat);
    }
  }, heartbeatMs);
  return () => clearInterval(heartbeat);
}

async function writeResponse(response, res, abortController, heartbeatMs) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const cancelReader = () => {
    reader.cancel().catch(() => {});
  };
  if (abortController.signal.aborted) {
    cancelReader();
  } else {
    abortController.signal.addEventListener('abort', cancelReader, { once: true });
  }

  const stopHeartbeat = isSseResponse(response)
    ? startSseHeartbeat(res, abortController, heartbeatMs)
    : () => {};

  try {
    while (!abortController.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    /* aborted or client gone */
  } finally {
    stopHeartbeat();
    try {
      reader.releaseLock();
    } catch {
      /* already cancelled */
    }
  }
  if (!res.writableEnded) res.end();
}

/**
 * @param {(request: Request, params?: object) => Promise<Response>} handler
 * @param {(req: import('http').IncomingMessage) => object} [getParams]
 * @param {{ heartbeatMs?: number }} [options]
 */
export function toAbortableNodeHandler(
  handler,
  getParams,
  { heartbeatMs = SSE_HEARTBEAT_MS } = {}
) {
  return async (req, res) => {
    const abortController = new AbortController();
    const onClose = () => {
      if (abortController.signal.aborted) return;
      abortController.abort();
    };
    // Do not listen to req 'close': GET bodies finish immediately, which would
    // abort SSE before the first chunk. Socket/res close mean the client is gone.
    const socket = req.socket;
    req.on('aborted', onClose);
    res.on('close', onClose);
    socket?.on('close', onClose);
    try {
      const request = await incomingMessageToRequest(req, abortController.signal);
      const params = typeof getParams === 'function' ? getParams(req) : {};
      const response = await handler(request, params);
      await writeResponse(response, res, abortController, heartbeatMs);
    } finally {
      req.off('aborted', onClose);
      res.off('close', onClose);
      socket?.off('close', onClose);
    }
  };
}
