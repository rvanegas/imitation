import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { WebSocketTransport, startWebSocketServer } from '../src/websocket';
import { leaderboardUrl } from '../src/leaderboard';

let server: http.Server | null = null;

async function start(): Promise<number> {
  server = startWebSocketServer(0, new WebSocketTransport(), async () => {});
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe('the WebSocket server\'s HTTP side', () => {
  it('answers /healthz with the deployed commit, "dev" in a checkout', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, commit: 'dev' });
  });

  it('answers /leaderboard with its text, without a sign-in', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/leaderboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toMatch(/^(Leaderboard — Top players|No leaderboard data yet)/);
  });

  it('reads the leaderboard from the host the terminal plays on', () => {
    expect(leaderboardUrl('wss://imitation.twohands.co/ws')).toBe('https://imitation.twohands.co/leaderboard');
    expect(leaderboardUrl('ws://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/leaderboard');
  });

  it('404s any other plain request', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(404);
  });

  it('upgrades a WebSocket on /ws, the path the app uses behind Caddy', async () => {
    const port = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const reply = await new Promise<{ type: string; text: string }>((resolve, reject) => {
      ws.once('open', () => ws.send(JSON.stringify({ type: 'cmd', text: '/help' })));
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.once('error', reject);
    });
    ws.close();
    expect(reply.type).toBe('error');
    expect(reply.text).toMatch(/Authenticate first/);
  });
});

describe('WebSocketTransport', () => {
  // A stand-in socket: send() records frames; readyState is OPEN.
  function fakeSocket(): { ws: WebSocket; sent: string[] } {
    const sent: string[] = [];
    const ws = { readyState: WebSocket.OPEN, send: (s: string) => { sent.push(s); } } as unknown as WebSocket;
    return { ws, sent };
  }

  it('keeps a newer connection when the older one for the same player closes', async () => {
    const transport = new WebSocketTransport();
    const older = fakeSocket();
    const newer = fakeSocket();
    transport.register(7, older.ws);
    transport.register(7, newer.ws);

    transport.unregister(7, older.ws);
    await transport.send(7, 'still here');

    expect(transport.has(7)).toBe(true);
    expect(newer.sent).toHaveLength(1);
    expect(older.sent).toHaveLength(0);
  });

  it('forgets a player whose only connection closes', () => {
    const transport = new WebSocketTransport();
    const only = fakeSocket();
    transport.register(7, only.ws);
    transport.unregister(7, only.ws);
    expect(transport.has(7)).toBe(false);
  });
});
