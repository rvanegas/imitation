import * as net from 'net';
import * as fs from 'fs';
import { Transport } from './transport';
import { UserId } from './types';
import * as engine from './engine';
import { getName, getOrCreateUserIdByName, getTelegramId } from './userProfiles';
import { SOCKET_PATH, WS_PORT } from './config';
import { WebSocketTransport, startWebSocketServer } from './websocket';

class CombinedTransport implements Transport {
  private sockets = new Map<UserId, net.Socket>();
  private wsTransport: WebSocketTransport;
  private telegramSend: ((userId: UserId, text: string) => Promise<void>) | null = null;
  private botUsername = '';

  constructor(wsTransport: WebSocketTransport) {
    this.wsTransport = wsTransport;
  }

  setTelegramSend(fn: (userId: UserId, text: string) => Promise<void>): void {
    this.telegramSend = fn;
  }

  setBotUsername(name: string): void {
    this.botUsername = name;
  }

  register(userId: UserId, socket: net.Socket): void {
    this.sockets.set(userId, socket);
  }

  unregister(userId: UserId): void {
    this.sockets.delete(userId);
  }

  async send(userId: UserId, text: string): Promise<void> {
    if (this.wsTransport.has(userId)) {
      await this.wsTransport.send(userId, text);
      return;
    }
    const socket = this.sockets.get(userId);
    if (socket?.writable) {
      socket.write(JSON.stringify({ type: 'msg', text }) + '\n');
      return;
    }
    if (this.telegramSend) {
      await this.telegramSend(userId, text);
    }
  }

  makeInviteLink(token: string): string {
    if (this.botUsername) return `https://t.me/${this.botUsername}?start=${token}`;
    return token;
  }
}

export function start(telegram: boolean): void {
  const wsTransport = new WebSocketTransport();
  const transport = new CombinedTransport(wsTransport);
  engine.initSessions(transport);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bot: any = null;

  if (telegram) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setupTelegram } = require('./bot');
    bot = setupTelegram(transport, (name: string) => transport.setBotUsername(name));
    transport.setTelegramSend(async (userId, text) => {
      const chatId = getTelegramId(userId);
      if (chatId !== undefined) await bot.telegram.sendMessage(chatId, text);
    });
    bot.launch();
    console.log('Telegram bot running.');
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
        case 'a':       await engine.handleHuman(userId, 'A', transport); break;
        case 'b':       await engine.handleHuman(userId, 'B', transport); break;
        case 'invite':  await engine.handleInvite(userId, transport); break;
        case 'status':  await engine.handleStatus(userId, transport); break;
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
          userId = getOrCreateUserIdByName(name);
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
    console.log('Connect with:  npm run dev terminal <name>');
  });

  startWebSocketServer(WS_PORT, wsTransport, dispatch);

  function shutdown(): void {
    if (bot) bot.stop('SIGINT');
    server.close();
    if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
