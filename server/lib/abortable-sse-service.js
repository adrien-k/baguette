import { SseService } from 'feathers/http';

/**
 * Feathers `SseService` waits on an internal promise between events. Stock Node
 * `toNodeHandler` never aborts the Web Request on client disconnect, so that
 * wait never ends. This subclass stops the loop when `params.request.signal`
 * aborts (wired in `toAbortableNodeHandler`).
 */
export class AbortableSseService extends SseService {
  async find(connection) {
    const eventBuffer = [];
    const { app, path } = this;
    if (!app || !path) {
      throw new Error('Can not initialize SSE. Did you call app.setup()?');
    }

    let isActive = true;
    let pendingResolve = null;

    const publishHandler = (event, channel, hook, data) => {
      if (isActive && channel.connections.includes(connection)) {
        const eventData = channel.dataFor ? (channel.dataFor(connection) ?? data) : data;
        eventBuffer.push({
          event,
          data: eventData,
          path: hook.path,
        });
        if (pendingResolve) {
          pendingResolve();
          pendingResolve = null;
        }
      }
    };

    const stop = () => {
      if (!isActive) return;
      isActive = false;
      if (pendingResolve) {
        pendingResolve();
        pendingResolve = null;
      }
    };

    const signal = connection.request?.signal;
    if (signal?.aborted) {
      stop();
    } else {
      signal?.addEventListener('abort', stop, { once: true });
    }

    app.emit('connection', connection);
    app.addListener('publish', publishHandler);

    return (async function* abortableSseStream() {
      try {
        yield {
          event: 'connected',
          data: connection.query || {},
          path,
        };
        while (isActive) {
          while (eventBuffer.length > 0) {
            yield eventBuffer.shift();
          }
          if (!isActive) break;
          await new Promise((resolve) => {
            pendingResolve = resolve;
          });
        }
      } finally {
        stop();
        signal?.removeEventListener('abort', stop);
        app.removeListener('publish', publishHandler);
        app.emit('disconnect', connection);
      }
    })();
  }
}
