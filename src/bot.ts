import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Transport } from './transport';
import { UserId } from './types';
import * as engine from './engine';

const { BOT_TOKEN } = process.env;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');

export const bot = new Telegraf(BOT_TOKEN);

let _botUsername = '';

class TelegramTransport implements Transport {
  async send(userId: UserId, text: string): Promise<void> {
    await bot.telegram.sendMessage(userId, text);
  }
  makeInviteLink(token: string): string {
    return `https://t.me/${_botUsername}?start=${token}`;
  }
}

const transport = new TelegramTransport();

export function initSessions(): void {
  bot.telegram.getMe().then(me => { _botUsername = me.username!; }).catch(() => {});
  engine.initSessions(transport);
}

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
  _botUsername = ctx.botInfo.username;
  const userId = ctx.from.id;
  const payload = ctx.startPayload;

  if (!payload) {
    await ctx.reply(
      'Which variation would you like to play?\n\n' +
      'Symmetric — each player alternates sending a message; the other guesses whether the message is human or AI.\n\n' +
      'Original Turing Test — the interrogator asks questions; the witness answers (with AI imitating the witness); the interrogator guesses, then roles swap.',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Symmetric', callback_data: 'var_symmetric' },
            { text: 'Original Turing Test', callback_data: 'var_original' },
          ]],
        },
      }
    );
  } else {
    await engine.handleJoin(userId, payload, transport);
  }
});

bot.action(/^var_(symmetric|original)$/, async (ctx) => {
  await ctx.answerCbQuery();
  _botUsername = ctx.botInfo!.username;
  const userId = ctx.from!.id;
  const variation = ctx.match[1] as 'symmetric' | 'original';
  await engine.handleVariationSelect(userId, variation, transport);
  await ctx.deleteMessage().catch(() => {});
});

bot.command('help', async (ctx) => {
  await engine.handleHelp(ctx.from.id, transport);
});

bot.command('setname', async (ctx) => {
  const name = ctx.message.text.split(/\s+/)[1] ?? '';
  await engine.handleSetName(ctx.from.id, name, transport);
});

bot.command('invite', async (ctx) => {
  await engine.handleInvite(ctx.from.id, transport);
});

bot.command('status', async (ctx) => {
  await engine.handleStatus(ctx.from.id, transport);
});

bot.command('restart', async (ctx) => {
  const args = ctx.message.text.split(/\s+/);
  await engine.handleRestart(ctx.from.id, args[1] ?? '', args[2] ?? '', transport);
});

bot.command('stop', async (ctx) => {
  await engine.handleStop(ctx.from.id, transport);
});

bot.command('leave', async (ctx) => {
  await engine.handleLeave(ctx.from.id, transport);
});

bot.command('human', async (ctx) => {
  const guess = ctx.message.text.split(/\s+/)[1] ?? '';
  await engine.handleHuman(ctx.from.id, guess, transport);
});

bot.on(message('text'), async (ctx) => {
  await engine.handleMessage(ctx.from.id, ctx.message.text, transport);
});
