const HEARTBEAT_MS = 30_000;

export class SseManager {
  constructor({ replay = false } = {}) {
    this._connections = new Map(); // channel → Set<res>
    this._eventLog = replay ? new Map() : null; // channel → string[] (raw SSE messages)
  }

  // channel = userId for Feathers, stateKey for dev proxy
  subscribe(req, res, channel) {
    if (this._eventLog) {
      const log = this._eventLog.get(channel);
      if (log) {
        for (const msg of log) {
          try {
            res.write(msg);
          } catch {
            /* already closed */
          }
        }
      }
    }

    if (!this._connections.has(channel)) this._connections.set(channel, new Set());
    this._connections.get(channel).add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      const conns = this._connections.get(channel);
      if (!conns) return;
      conns.delete(res);
      if (conns.size === 0) this._connections.delete(channel);
    });
  }

  // Send data to all connections in a channel; stores in replay log if enabled
  send(channel, data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    if (this._eventLog) {
      if (!this._eventLog.has(channel)) this._eventLog.set(channel, []);
      this._eventLog.get(channel).push(msg);
    }
    const conns = this._connections.get(channel);
    if (!conns) return;
    for (const res of conns) {
      try {
        res.write(msg);
      } catch {
        /* already closed */
      }
    }
  }

  // Send data to all connections across all channels
  sendAll(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const conns of this._connections.values()) {
      for (const res of conns) {
        try {
          res.write(msg);
        } catch {
          /* already closed */
        }
      }
    }
  }

  // End active connections for a channel; keeps replay log for late-joining subscribers
  closeChannel(channel) {
    const conns = this._connections.get(channel);
    if (conns) {
      for (const res of conns) {
        try {
          res.end();
        } catch {
          /* already closed */
        }
      }
      this._connections.delete(channel);
    }
  }

  // End connections and clear replay log (full cleanup)
  purgeChannel(channel) {
    this.closeChannel(channel);
    this._eventLog?.delete(channel);
  }
}
