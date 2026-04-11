import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Transport } from './transport';
import { UserId } from './types';
import * as engine from './engine';
import { getOrCreateUserIdForTelegram } from './userProfiles';

function uid(ctx: { from: { id: number } }): UserId {
  return getOrCreateUserIdForTelegram(ctx.from.id);
}

export function setupTelegram(
  transport: Transport,
  onUsername: (name: string) => void,
): Telegraf {
  const { BOT_TOKEN } = process.env;
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');

  const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 5 * 60 * 1000 }); // 5 minutes for slow local models

  bot.telegram.getMe().then(me => onUsername(me.username!)).catch(() => {});

  // Normalise bot commands to lowercase so /Human and /HUMAN both work.
  bot.use((ctx, next) => {
    if (ctx.message && 'text' in ctx.message) {
      const cmdEntity = ctx.message.entities?.find(
        e => e.type === 'bot_command' && e.offset === 0
      );
      if (cmdEntity) {
        const t = ctx.message.text;
        (ctx.message as { text: string }).text =
          t.slice(0, cmdEntity.length).toLowerCase() + t.slice(cmdEntity.length);
      }
    }
    return next();
  });

  bot.start(async (ctx) => {
    onUsername(ctx.botInfo.username);
    const userId = uid(ctx);
    const payload = ctx.startPayload;
    if (!payload) {
      await engine.handleVariationSelect(userId, 'original', transport);
    } else if (payload === 'symmetric') {
      await engine.handleVariationSelect(userId, 'symmetric', transport);
    } else {
      await engine.handleJoin(userId, payload, transport);
    }
  });

  bot.command('help',    async (ctx) => engine.handleHelp(uid(ctx), transport));
  bot.command('invite',  async (ctx) => engine.handleInvite(uid(ctx), transport));
  bot.command('status',  async (ctx) => engine.handleStatus(uid(ctx), transport));
  bot.command('stop',    async (ctx) => engine.handleStop(uid(ctx), transport));
  bot.command('leave',   async (ctx) => engine.handleLeave(uid(ctx), transport));
  bot.command('setname', async (ctx) => {
    const name = ctx.message.text.split(/\s+/)[1] ?? '';
    await engine.handleSetName(uid(ctx), name, transport);
  });
  bot.command('restart', async (ctx) => {
    const args = ctx.message.text.split(/\s+/);
    await engine.handleRestart(uid(ctx), args[1] ?? '', args[2] ?? '', transport);
  });
  bot.command('human', async (ctx) => {
    const guess = ctx.message.text.split(/\s+/)[1] ?? '';
    await engine.handleHuman(uid(ctx), guess, transport);
  });
  bot.command('a', async (ctx) => engine.handleHuman(uid(ctx), 'A', transport));
  bot.command('b', async (ctx) => engine.handleHuman(uid(ctx), 'B', transport));
  bot.on(message('text'), async (ctx) => engine.handleMessage(uid(ctx), ctx.message.text, transport));

  return bot;
}
