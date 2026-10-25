import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { WS_HOST } from './config';
import { WebSocketServer, WebSocket } from 'ws';
import { Transport } from './transport';
import { GameEvent } from './events';
import { UserId } from './types';
import { getName, getOrAssignName, createAnonymousUser, setWsToken, getUserIdByWsToken } from './userProfiles';
import { isValidSessionToken } from './session';
import { consumeLinkToken } from './linkTokens';

export class WebSocketTransport implements Transport {
  private sockets = new Map<UserId, WebSocket>();

  register(userId: UserId, ws: WebSocket): void {
    this.sockets.set(userId, ws);
  }

  unregister(userId: UserId): void {
    this.sockets.delete(userId);
  }

  has(userId: UserId): boolean {
    const ws = this.sockets.get(userId);
    return ws?.readyState === WebSocket.OPEN;
  }

  async send(userId: UserId, text: string, event?: GameEvent): Promise<void> {
    const ws = this.sockets.get(userId);
    if (ws?.readyState === WebSocket.OPEN) {
      const frame = event ? { type: 'event', event, text } : { type: 'msg', text };
      ws.send(JSON.stringify(frame));
    }
  }

  makeInviteLink(token: string): string {
    return `imitation://join/${token}`;
  }
}

type Dispatch = (userId: UserId, text: string) => Promise<void>;

// Written by bin/deploy at the root of the tree it ships; absent in a checkout.
const DEPLOYED_FILE = path.join(__dirname, '..', 'deployed.json');

function deployed(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYED_FILE, 'utf8'));
  } catch {
    return { commit: 'dev' };
  }
}

// Plain HTTP on the same port answers GET /healthz with the deployed commit;
// every other plain request is a 404. A WebSocket upgrade on any path is the
// game, so the app's wss://imitation.rvanegas.co/ws and a bare ws://host:8080
// both connect.
function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...deployed() }));
    return;
  }
  res.writeHead(404);
  res.end();
}

export function startWebSocketServer(
  port: number,
  transport: WebSocketTransport,
  dispatch: Dispatch,
): http.Server {
  const server = http.createServer(handleHttp);
  const wss = new WebSocketServer({ server });
  server.listen(port, WS_HOST);

  wss.on('connection', (ws) => {
    let userId: UserId | null = null;

    ws.on('message', async (data) => {
      let msg: { type: string; sessionToken?: string; token?: string; linkToken?: string; text?: string };
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (userId === null) {
        if (msg.type === 'bootstrap') {
          const sessionToken = (msg.sessionToken ?? '').trim();
          if (!sessionToken) {
            ws.send(JSON.stringify({ type: 'error', text: 'sessionToken required.' }));
            return;
          }
          if (!isValidSessionToken(sessionToken)) {
            ws.send(JSON.stringify({ type: 'error', text: 'Invalid or expired session token.' }));
            return;
          }
          const id = createAnonymousUser();
          const userToken = crypto.randomUUID();
          setWsToken(id, userToken);
          userId = id;
          transport.register(userId, ws);
          const name = getOrAssignName(id);
          ws.send(JSON.stringify({ type: 'ready', name, token: userToken }));
          await dispatch(userId, `/start ${sessionToken}`);
          return;
        }

        if (msg.type === 'login') {
          const token = (msg.token ?? '').trim();
          if (!token) {
            ws.send(JSON.stringify({ type: 'error', text: 'token required.' }));
            return;
          }
          const id = getUserIdByWsToken(token);
          if (id === undefined) {
            ws.send(JSON.stringify({ type: 'error', text: 'Invalid token.' }));
            return;
          }
          userId = id;
          transport.register(userId, ws);
          ws.send(JSON.stringify({ type: 'ready', name: getName(id) ?? '' }));
          await dispatch(userId, '/resync');  // replay pending state after a reconnect
          return;
        }

        if (msg.type === 'link') {
          const linkToken = (msg.linkToken ?? '').trim().toUpperCase();
          if (!linkToken) {
            ws.send(JSON.stringify({ type: 'error', text: 'linkToken required.' }));
            return;
          }
          const id = consumeLinkToken(linkToken);
          if (id === undefined) {
            ws.send(JSON.stringify({ type: 'error', text: 'Invalid or expired link token.' }));
            return;
          }
          const userToken = crypto.randomUUID();
          setWsToken(id, userToken);
          userId = id;
          transport.register(userId, ws);
          const name = getOrAssignName(id);
          ws.send(JSON.stringify({ type: 'ready', name, token: userToken }));
          return;
        }

        ws.send(JSON.stringify({ type: 'error', text: 'Authenticate first with bootstrap or login.' }));
        return;
      }

      if (msg.type !== 'cmd') return;
      const text = (msg.text ?? '').trim();
      if (!text) return;

      try {
        await dispatch(userId, text);
        if (text.toLowerCase().startsWith('/setname ')) {
          const newName = getName(userId);
          if (newName) ws.send(JSON.stringify({ type: 'nameUpdate', name: newName }));
        }
      } catch (err) {
        console.error(`[ws dispatch] error handling "${text}" for user ${userId}:`, err);
        ws.send(JSON.stringify({ type: 'error', text: String(err) }));
      }
    });

    ws.on('close', () => { if (userId !== null) transport.unregister(userId); });
    ws.on('error', () => { if (userId !== null) transport.unregister(userId); });
  });

  console.log(`WebSocket server listening on ${WS_HOST ?? '*'}:${port}`);
  return server;
}
