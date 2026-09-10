class SseManager {
  constructor() {
    this._connections = new Map(); // userId → Set<res>
  }

  add(userId, res) {
    if (!this._connections.has(userId)) this._connections.set(userId, new Set());
    this._connections.get(userId).add(res);
  }

  remove(userId, res) {
    const conns = this._connections.get(userId);
    if (!conns) return;
    conns.delete(res);
    if (conns.size === 0) this._connections.delete(userId);
  }

  send(userId, service, event, data) {
    this._push(this._connections.get(userId), service, event, data);
  }

  sendAll(service, event, data) {
    for (const conns of this._connections.values()) {
      this._push(conns, service, event, data);
    }
  }

  _push(conns, service, event, data) {
    if (!conns?.size) return;
    const msg = `data: ${JSON.stringify({ service, event, data })}\n\n`;
    for (const res of conns) {
      try {
        res.write(msg);
      } catch {
        // connection already closed
      }
    }
  }
}

export default new SseManager();
