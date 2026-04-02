import { Telegraf } from 'telegraf';
import { GameSession, PairedMessage } from './types';

export async function deliverMessages(
  bot: Telegraf,
  recipientId: number,
  messages: PairedMessage,
  imitationFirst: boolean
): Promise<void> {
  const [first, second] = imitationFirst
    ? [messages.imitation, messages.original]
    : [messages.original, messages.imitation];

  await bot.telegram.sendMessage(recipientId, `Message 1: ${first}`);
  await bot.telegram.sendMessage(recipientId, `Message 2: ${second}`);
}

export async function deliverReveal(bot: Telegraf, session: GameSession): Promise<void> {
  const reveal = session.imitationFirst
    ? 'Message 1 was always AI. Message 2 was always human.'
    : 'Message 1 was always human. Message 2 was always AI.';

  await bot.telegram.sendMessage(session.userA, reveal);
  await bot.telegram.sendMessage(session.userB, reveal);
}
