import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { WebSocketTransport, startWebSocketServer } from '../src/websocket';

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
