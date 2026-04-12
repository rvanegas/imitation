import { WebSocketServer, WebSocket } from 'ws';
import { Transport } from './transport';
import { UserId } from './types';
import { getName, getOrAssignName, createAnonymousUser, setWsToken, getUserIdByWsToken } from './userProfiles';
import { isValidSessionToken } from './session';

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

  async send(userId: UserId, text: string): Promise<void> {
    const ws = this.sockets.get(userId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'msg', text }));
    }
  }

  makeInviteLink(token: string): string {
    return token;
  }
}

type Dispatch = (userId: UserId, text: string) => Promise<void>;

export function startWebSocketServer(
  port: number,
  transport: WebSocketTransport,
  dispatch: Dispatch,
): void {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    let userId: UserId | null = null;

    ws.on('message', async (data) => {
      let msg: { type: string; sessionToken?: string; token?: string; text?: string };
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
        ws.send(JSON.stringify({ type: 'error', text: String(err) }));
      }
    });

    ws.on('close', () => { if (userId !== null) transport.unregister(userId); });
    ws.on('error', () => { if (userId !== null) transport.unregister(userId); });
  });

  console.log(`WebSocket server listening on port ${port}`);
}
