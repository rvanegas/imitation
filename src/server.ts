import * as net from 'net';
import * as fs from 'fs';
import { Transport } from './transport';
import { UserId } from './types';
import * as engine from './engine';
import { getName, setName, getUserIdByName } from './userProfiles';

const SOCKET_PATH = process.env.SOCKET_PATH ?? '/tmp/imitation.sock';

class ServerTransport implements Transport {
  private sockets = new Map<UserId, net.Socket>();

  register(userId: UserId, socket: net.Socket): void {
    this.sockets.set(userId, socket);
  }

  unregister(userId: UserId): void {
    this.sockets.delete(userId);
  }

  async send(userId: UserId, text: string): Promise<void> {
    const socket = this.sockets.get(userId);
    if (socket?.writable) {
      socket.write(JSON.stringify({ type: 'msg', text }) + '\n');
    }
  }

  makeInviteLink(token: string): string {
    return token;
  }
}

export function start(): void {
  const transport = new ServerTransport();
  engine.initSessions(transport);

  // Track in-memory name→id assignments for this server session.
  const nameToId = new Map<string, UserId>();
  let nextId = 1;

  function getOrCreateUser(name: string): UserId {
    if (nameToId.has(name)) return nameToId.get(name)!;
    // Reuse persisted ID from a previous run if the name is known.
    const persisted = getUserIdByName(name);
    if (persisted !== undefined) {
      nameToId.set(name, persisted);
      return persisted;
    }
    // Assign a new ID, skipping any already claimed by persisted users.
    while (getUserIdByName(getName(nextId) ?? '') !== undefined) nextId++;
    const id = nextId++;
    nameToId.set(name, id);
    setName(id, name);
    return id;
  }

  async function dispatch(userId: UserId, text: string): Promise<void> {
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);
      switch (cmd) {
        case 'start': {
          const arg = args[0]?.toLowerCase();
          if (arg === 'symmetric' || arg === 'original') {
            await engine.handleVariationSelect(userId, arg, transport);
          } else if (arg) {
            await engine.handleJoin(userId, arg, transport);
          } else {
            await transport.send(userId,
              'Usage:\n' +
              '  /start symmetric  — create a Symmetric game\n' +
              '  /start original   — create an Original Turing Test game\n' +
              '  /start <token>    — join via invite token',
            );
          }
          break;
        }
        case 'human':   await engine.handleHuman(userId, args[0] ?? '', transport); break;
        case 'invite':  await engine.handleInvite(userId, transport); break;
        case 'status':  await engine.handleStatus(userId, transport); break;
        case 'stop':    await engine.handleStop(userId, transport); break;
        case 'leave':   await engine.handleLeave(userId, transport); break;
        case 'restart': await engine.handleRestart(userId, args[0] ?? '', args[1] ?? '', transport); break;
        case 'setname': await engine.handleSetName(userId, args[0] ?? '', transport); break;
        case 'help':    await engine.handleHelp(userId, transport); break;
        default:
          await transport.send(userId, `Unknown command: /${cmd}`);
      }
    } else {
      await engine.handleMessage(userId, text, transport);
    }
  }

  // Remove stale socket file from a previous run.
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

  const server = net.createServer((socket) => {
    let userId: UserId | null = null;
    let buf = '';

    socket.on('data', async (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: { type: string; name?: string; text?: string };
        try { msg = JSON.parse(line); } catch { continue; }

        if (msg.type === 'login') {
          const name = (msg.name ?? '').trim();
          if (!name) {
            socket.write(JSON.stringify({ type: 'error', text: 'Name required.' }) + '\n');
            continue;
          }
          userId = getOrCreateUser(name);
          transport.register(userId, socket);
          socket.write(JSON.stringify({ type: 'ready', name: getName(userId) ?? name }) + '\n');
          continue;
        }

        if (userId === null || msg.type !== 'cmd') continue;
        const text = (msg.text ?? '').trim();
        if (!text) continue;

        try {
          await dispatch(userId, text);
        } catch (err) {
          socket.write(JSON.stringify({ type: 'error', text: String(err) }) + '\n');
        }
      }
    });

    socket.on('close', () => {
      if (userId !== null) transport.unregister(userId);
    });

    socket.on('error', () => {
      if (userId !== null) transport.unregister(userId);
    });
  });

  server.listen(SOCKET_PATH, () => {
    console.log(`Imitation server listening on ${SOCKET_PATH}`);
    console.log('Connect with:  npm run dev client <name>');
  });

  function shutdown(): void {
    server.close();
    if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
