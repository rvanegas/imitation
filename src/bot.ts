import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Transport } from './transport';
import { UserId } from './types';
import * as engine from './engine';
import { getOrCreateUserIdForTelegram } from './userProfiles';
import { BOT_TOKEN } from './config';
import { createLinkToken } from './linkTokens';

function uid(ctx: { from: { id: number } }): UserId {
  return getOrCreateUserIdForTelegram(ctx.from.id);
}

export function setupTelegram(transport: Transport): Telegraf {
  if (!BOT_TOKEN) throw new Error('bot_token is required in config.toml');

  let botUsername = '';
  const tgTransport: Transport = {
    send: (userId, text) => transport.send(userId, text),
    makeInviteLink: (token) => {
      const tgLink = botUsername ? `https://t.me/${botUsername}?start=${token}` : token;
      return `${tgLink}\nApp: imitation://join/${token}`;
    },
  };

  const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 5 * 60 * 1000 }); // 5 minutes for slow local models

  bot.telegram.getMe().then(me => { botUsername = me.username!; }).catch(() => {});

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
    botUsername = ctx.botInfo.username;
    const userId = uid(ctx);
    const payload = ctx.startPayload;
    if (!payload) {
      await engine.handleVariationSelect(userId, 'original', tgTransport);
    } else if (payload === 'symmetric') {
      await engine.handleVariationSelect(userId, 'symmetric', tgTransport);
    } else {
      await engine.handleJoin(userId, payload, tgTransport);
    }
  });

  bot.command('help',    async (ctx) => engine.handleHelp(uid(ctx), tgTransport));
  bot.command('link', async (ctx) => {
    const token = createLinkToken(uid(ctx));
    await ctx.reply(
      `Your link token:\n\n<code>${token}</code>\n\nEnter it in the iPhone app within 10 minutes. This token can only be used once.`,
      { parse_mode: 'HTML' },
    );
  });
  bot.command('reflection', async (ctx) => engine.handleReflection(uid(ctx), tgTransport));
  bot.command('invite',  async (ctx) => engine.handleInvite(uid(ctx), tgTransport));
  bot.command('status',  async (ctx) => engine.handleStatus(uid(ctx), tgTransport));
  bot.command('leave',   async (ctx) => engine.handleLeave(uid(ctx), tgTransport));
  bot.command('setname', async (ctx) => {
    const name = ctx.message.text.split(/\s+/)[1] ?? '';
    await engine.handleSetName(uid(ctx), name, tgTransport);
  });
  bot.command('restart', async (ctx) => {
    const args = ctx.message.text.split(/\s+/);
    await engine.handleRestart(uid(ctx), args[1] ?? '', args[2] ?? '', tgTransport);
  });
  bot.command('human', async (ctx) => {
    const guess = ctx.message.text.split(/\s+/)[1] ?? '';
    await engine.handleHuman(uid(ctx), guess, tgTransport);
  });
  bot.command('a', async (ctx) => engine.handleHuman(uid(ctx), 'A', tgTransport));
  bot.command('b', async (ctx) => engine.handleHuman(uid(ctx), 'B', tgTransport));
  bot.on(message('text'), async (ctx) => engine.handleMessage(uid(ctx), ctx.message.text, tgTransport));

  return bot;
}
