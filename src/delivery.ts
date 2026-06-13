import { Transport } from './transport';
import { GameSession, UserId } from './types';

async function sendToSpectators(transport: Transport, session: GameSession, text: string): Promise<void> {
  const failed: UserId[] = [];
  await Promise.all(
    session.spectators.map(async (id: UserId) => {
      try {
        await transport.send(id, text);
      } catch {
        failed.push(id);
      }
    })
  );
  if (failed.length > 0) {
    session.spectators = session.spectators.filter(id => !failed.includes(id));
  }
}

export async function deliverToSpectators(
  transport: Transport,
  session: GameSession,
  senderLabel: string,
  human: string,
  prediction: string,
): Promise<void> {
  if (session.spectators.length === 0) return;
  const text = `${senderLabel}: ${human}\n${senderLabel} (imitation): ${prediction}`;
  await sendToSpectators(transport, session, text);
}
