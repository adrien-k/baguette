/**
 * A stand-in for Slack, for the e2e suite. Baguette reaches it through SLACK_API_URL.
 *
 * - Web API (`POST /api/<method>`): every call is recorded and answered with canned data.
 * - Socket Mode: `apps.connections.open` hands out `ws://…/socket`; the mock acts as Slack on that
 *   socket (hello, envelopes, acknowledgements).
 * - Control endpoints for the tests:
 *     GET|DELETE /__calls          recorded Web API calls (DELETE clears them)
 *     POST /__replies              { channel, ts, messages }  what conversations.replies returns
 *     POST /__history              { channel, messages }      what conversations.history returns
 *     POST /__socket/send          { app_token, payload }     pushes an events_api envelope
 *     GET  /__socket               { connections, acks }      connected app tokens, acked envelopes
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';

const port = Number(process.env.E2E_SLACK_PORT || 3011);

const person = (id, name, realName) => ({
  id,
  name,
  real_name: realName,
  profile: { display_name: name },
});
const PEOPLE = Object.fromEntries(
  [
    person('UJAN', 'jan', 'Jan Owner'),
    person('UEVA', 'eva', 'Eva Friend'),
    person('UBOB', 'bob', 'Bob Other'),
    person('UCAROL', 'carol', 'Carol NoModel'),
    person('USTRANGER', 'sam', 'Sam Stranger'),
  ].map((p) => [p.id, p])
);

let calls = [];
let counter = 0;
const replies = new Map(); // `${channel}:${ts}` -> messages
const history = new Map(); // channel -> messages
const sockets = new Map(); // app token -> websocket
const acks = [];
const nextTs = () => `1800000000.${String((counter += 1)).padStart(6, '0')}`;

function respond(method, args) {
  switch (method) {
    case 'chat.postMessage':
      return { channel: args.channel, ts: nextTs() };
    case 'users.info':
      return { user: PEOPLE[args.user] ?? { id: args.user, name: args.user } };
    case 'users.list':
      return { members: Object.values(PEOPLE) };
    case 'conversations.info':
      return {
        channel: { id: args.channel, name: `chan-${args.channel}`, is_private: false },
      };
    case 'conversations.replies':
      return { messages: replies.get(`${args.channel}:${args.ts}`) ?? [], has_more: false };
    case 'conversations.history':
      return { messages: history.get(args.channel) ?? [], has_more: false };
    case 'chat.getPermalink':
      return { permalink: `https://slack.test/${args.message_ts}` };
    case 'auth.test':
      return { team: 'E2E Workspace', team_id: 'TE2E', user_id: 'UBOT' };
    case 'apps.connections.open':
      return { url: `ws://127.0.0.1:${port}/socket` };
    default:
      return {};
  }
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });

const parseJson = (raw) => {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/__calls') {
    if (req.method === 'DELETE') calls = [];
    return send(200, calls);
  }
  if (url.pathname === '/__socket') return send(200, { connections: [...sockets.keys()], acks });
  if (url.pathname.startsWith('/__')) {
    const body = parseJson(await readBody(req));
    if (url.pathname === '/__replies') replies.set(`${body.channel}:${body.ts}`, body.messages);
    if (url.pathname === '/__history') history.set(body.channel, body.messages);
    if (url.pathname === '/__socket/send') {
      const socket = sockets.get(body.app_token);
      if (!socket) return send(404, { error: 'no socket for that app token' });
      socket.send(JSON.stringify({ type: 'events_api', ...body.envelope }));
    }
    return send(200, { ok: true });
  }

  const method = url.pathname.replace(/^\/api\//, '');
  const args = { ...Object.fromEntries(url.searchParams), ...parseJson(await readBody(req)) };
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  calls.push({ method, args, token });
  send(200, { ok: true, ...respond(method, args) });
});

const wss = new WebSocketServer({ server, path: '/socket' });
wss.on('connection', (socket) => {
  // Baguette opened this URL with the app token it got from apps.connections.open.
  const token = calls.findLast((c) => c.method === 'apps.connections.open')?.token ?? 'unknown';
  sockets.set(token, socket);
  socket.on('close', () => sockets.delete(token));
  socket.on('message', (raw) => {
    const message = parseJson(String(raw));
    if (message.envelope_id) acks.push(message.envelope_id);
  });
  socket.send(JSON.stringify({ type: 'hello', connection_info: { app_id: 'ASOCKET' } }));
});

server.listen(port, '127.0.0.1', () => process.stdout.write(`slack mock on ${port}\n`));
