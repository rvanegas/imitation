import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as readline from 'readline';
import { WebSocket } from 'ws';
import { SERVER_URL, SOCKET_PATH, STATE_DIR } from './config';

// A connection to the server, by whichever road: the deployed server's
// WebSocket, or a local server's Unix socket. Frames are JSON objects either way.
interface Conn {
  send(frame: object): void;
  close(): void;
}

interface Frame { type: string; text?: string; name?: string; token?: string }

interface Handlers {
  open(): void;
  frame(msg: Frame): void;
  close(): void;
  error(err: Error): void;
}

function connectSocket(h: Handlers): Conn {
  const socket = net.connect(SOCKET_PATH, h.open);
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try { h.frame(JSON.parse(line)); } catch { /* ignore malformed frames */ }
    }
  });
  socket.on('close', h.close);
  socket.on('error', h.error);
  return {
    send: (frame) => { socket.write(JSON.stringify(frame) + '\n'); },
    close: () => socket.end(),
  };
}

function connectWebSocket(h: Handlers): Conn {
  const ws = new WebSocket(SERVER_URL);
  ws.on('open', h.open);
  ws.on('message', (data) => {
    try { h.frame(JSON.parse(data.toString())); } catch { /* ignore malformed frames */ }
  });
  ws.on('close', h.close);
  ws.on('error', h.error);
  return {
    send: (frame) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame)); },
    close: () => ws.close(),
  };
}

// The deployed server knows a terminal by the token it issued when the
// terminal was linked to a Telegram account. Kept per server and per profile
// name, so two profiles can play each other from one machine. Mode 600: the
// token signs in as that player.
const TOKENS_FILE = path.join(STATE_DIR, 'terminal-tokens.json');

function readTokens(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch { return {}; }
}

function writeToken(key: string, token: string | null): void {
  const tokens = readTokens();
  if (token === null) delete tokens[key];
  else tokens[key] = token;
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(TOKENS_FILE, 0o600);  // the mode above applies only to a new file
}

export function start(profile: string, local: boolean): void {
  const tokenKey = `${SERVER_URL} ${profile}`;
  const where = local ? SOCKET_PATH : SERVER_URL;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.setPrompt(`[${profile}]> `);

  let ready = false;
  // Waiting for a link code typed at the prompt, rather than a game command.
  let linking = false;

  function askForLinkCode(): void {
    linking = true;
    console.log('Send /link to the Telegram bot, then enter the code it replies with.');
    rl.setPrompt('link code> ');
    rl.prompt();
  }

  // Print a server line above the current prompt line.
  function show(text: string): void {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`\n→ ${text.replace(/\n/g, '\n  ')}\n\n`);
    if (ready || linking) rl.prompt(true);
  }

  const conn = (local ? connectSocket : connectWebSocket)({
    open() {
      if (local) {
        conn.send({ type: 'login', name: profile });
        return;
      }
      const token = readTokens()[tokenKey];
      if (token) conn.send({ type: 'login', token });
      else askForLinkCode();
    },

    frame(msg) {
      switch (msg.type) {
        case 'ready': {
          ready = true;
          linking = false;
          if (msg.token) writeToken(tokenKey, msg.token);
          rl.setPrompt(`[${msg.name}]> `);
          console.log(`Connected to ${where} as ${msg.name}.`);
          console.log('Type /help for game commands, Ctrl-C to quit.\n');
          rl.prompt();
          return;
        }
        case 'nameUpdate':
          rl.setPrompt(`[${msg.name}]> `);
          return;
        case 'error':
          if (!ready && !local && !linking) {
            // A saved token the server no longer knows: link afresh.
            writeToken(tokenKey, null);
            show(msg.text ?? 'Sign-in refused.');
            askForLinkCode();
            return;
          }
          show(msg.text ?? '');
          return;
        default:
          // 'msg', and 'event' frames: a terminal shows only their text, and
          // an event sent for the app alone has none.
          if (msg.text) show(msg.text);
      }
    },

    close() {
      console.log('\nDisconnected.');
      process.exit(0);
    },

    error(err) {
      console.error(`Cannot connect to server at ${where}: ${err.message}`);
      if (local) console.error('Start the server first:  npm run dev server [--no-telegram|-t]');
      process.exit(1);
    },
  });

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    if (linking) { conn.send({ type: 'link', linkToken: text }); return; }
    if (!ready) { console.log('Waiting for server…'); rl.prompt(); return; }
    conn.send({ type: 'cmd', text });
  });

  rl.on('close', () => {
    conn.close();
    process.exit(0);
  });
}
