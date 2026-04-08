import * as net from 'net';
import * as readline from 'readline';

const SOCKET_PATH = process.env.SOCKET_PATH ?? '/tmp/imitation.sock';

export function start(name: string): void {
  const socket = net.connect(SOCKET_PATH, () => {
    socket.write(JSON.stringify({ type: 'login', name }) + '\n');
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.setPrompt(`[${name}]> `);

  let ready = false;
  let buf = '';

  socket.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: { type: string; text?: string; name?: string };
      try { msg = JSON.parse(line); } catch { continue; }

      if (msg.type === 'ready') {
        ready = true;
        const assignedName = msg.name!;
        rl.setPrompt(`[${assignedName}]> `);
        console.log(`Connected as ${assignedName}.`);
        console.log('Type /help for game commands, Ctrl-C to quit.\n');
        rl.prompt();
        continue;
      }

      // Print incoming message above the current prompt line.
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      const indented = (msg.text ?? '').replace(/\n/g, '\n  ');
      process.stdout.write(`\n→ ${indented}\n\n`);
      if (ready) rl.prompt(true);
    }
  });

  socket.on('close', () => {
    console.log('\nDisconnected.');
    process.exit(0);
  });

  socket.on('error', (err) => {
    console.error(`Cannot connect to server at ${SOCKET_PATH}: ${err.message}`);
    console.error('Start the server first:  npm run dev server [--no-telegram|-t]');
    process.exit(1);
  });

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    if (!ready) { console.log('Waiting for server…'); rl.prompt(); return; }
    socket.write(JSON.stringify({ type: 'cmd', text }) + '\n');
  });

  rl.on('close', () => {
    socket.end();
    process.exit(0);
  });
}
