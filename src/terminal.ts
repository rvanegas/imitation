import * as readline from 'readline';
import { Transport } from './transport';
import { UserId } from './types';
import * as engine from './engine';
import { getName, setName } from './userProfiles';

class TerminalTransport implements Transport {
  async send(userId: UserId, text: string): Promise<void> {
    const name = getName(userId) ?? `user${userId}`;
    // Indent multi-line messages so they're clearly grouped.
    const indented = text.replace(/\n/g, '\n  ');
    process.stdout.write(`\n→ [${name}] ${indented}\n`);
  }
  makeInviteLink(token: string): string {
    return token; // In the terminal the token IS the invite.
  }
}

export function start(): void {
  // Virtual users: name → numeric id (1, 2, 3, …)
  const nameToId = new Map<string, UserId>();
  let nextId = 1;

  function getOrCreateUser(name: string): UserId {
    if (!nameToId.has(name)) {
      const id = nextId++;
      nameToId.set(name, id);
      setName(id, name);
    }
    return nameToId.get(name)!;
  }

  const transport = new TerminalTransport();
  engine.initSessions(transport);

  let activeUser: { name: string; id: UserId } | null = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  function prompt(): void {
    const label = activeUser ? activeUser.name : '?';
    rl.setPrompt(`[${label}]> `);
    rl.prompt();
  }

  function printHelp(): void {
    console.log(`
Terminal interface for the Imitation Game
==========================================
Meta commands (not sent to the game):
  :as <name>              Switch active user (creates user if new)
  :users                  List all registered users
  :help                   Show this help

Game commands (issued as the active user):
  /start symmetric        Create a Symmetric game and get an invite token
  /start original         Create an Original Turing Test game
  /start <token>          Join a game (or watch as spectator) via invite token
  /human A|B              Submit a guess
  /invite                 Show the session invite token
  /status                 Show turn, score, and spectators
  /stop                   End the game
  /leave                  Leave the session
  /restart <u1> <u2>      Restart with different players
  /setname <name>         Set your display name
  /help                   Show in-game help text
  <anything else>         Send a message as the active user
`);
  }

  rl.on('line', async (line: string) => {
    rl.pause();
    try {
      const input = line.trim();
      if (!input) { return; }

      // ── Meta commands ──────────────────────────────────────────────────
      if (input.startsWith(':as ')) {
        const name = input.slice(4).trim();
        if (!name) { console.log('Usage: :as <name>'); return; }
        const id = getOrCreateUser(name);
        activeUser = { name, id };
        console.log(`Active user: ${name} (id=${id})`);
        return;
      }

      if (input === ':users') {
        if (nameToId.size === 0) { console.log('No users yet.'); return; }
        for (const [name, id] of nameToId) {
          console.log(`  ${name} (id=${id})`);
        }
        return;
      }

      if (input === ':help') {
        printHelp();
        return;
      }

      // ── Require an active user for everything below ────────────────────
      if (!activeUser) {
        console.log('No active user. Use ":as <name>" to set one, or ":help" for more.');
        return;
      }

      const { id: userId } = activeUser;

      // ── Game commands & messages ───────────────────────────────────────
      if (input.startsWith('/')) {
        const parts = input.slice(1).split(/\s+/);
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
              console.log(
                'Usage:\n' +
                '  /start symmetric   — create a Symmetric game\n' +
                '  /start original    — create an Original Turing Test game\n' +
                '  /start <token>     — join via invite token'
              );
            }
            break;
          }
          case 'human':
            await engine.handleHuman(userId, args[0] ?? '', transport);
            break;
          case 'invite':
            await engine.handleInvite(userId, transport);
            break;
          case 'status':
            await engine.handleStatus(userId, transport);
            break;
          case 'stop':
            await engine.handleStop(userId, transport);
            break;
          case 'leave':
            await engine.handleLeave(userId, transport);
            break;
          case 'restart':
            await engine.handleRestart(userId, args[0] ?? '', args[1] ?? '', transport);
            break;
          case 'setname':
            await engine.handleSetName(userId, args[0] ?? '', transport);
            break;
          case 'help':
            await engine.handleHelp(userId, transport);
            break;
          default:
            console.log(`Unknown command: /${cmd}  (try :help)`);
        }
      } else {
        await engine.handleMessage(userId, input, transport);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      rl.resume();
      prompt();
    }
  });

  rl.on('close', () => {
    console.log('\nBye.');
    process.exit(0);
  });

  printHelp();
  prompt();
}
