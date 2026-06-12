import { Transport } from '../../src/transport';
import { GameEvent } from '../../src/events';
import { UserId } from '../../src/types';

export class MockTransport implements Transport {
  private messages = new Map<UserId, string[]>();
  private events = new Map<UserId, GameEvent[]>();

  async send(userId: UserId, text: string, event?: GameEvent): Promise<void> {
    if (!this.messages.has(userId)) this.messages.set(userId, []);
    this.messages.get(userId)!.push(text);
    if (event) {
      if (!this.events.has(userId)) this.events.set(userId, []);
      this.events.get(userId)!.push(event);
    }
  }

  getEvents(userId: UserId): GameEvent[] {
    return this.events.get(userId) ?? [];
  }

  makeInviteLink(token: string, _userId?: UserId): string {
    return `test://join/${token}`;
  }

  getMessages(userId: UserId): string[] {
    return this.messages.get(userId) ?? [];
  }

  lastMessage(userId: UserId): string | undefined {
    const msgs = this.messages.get(userId);
    return msgs?.[msgs.length - 1];
  }

  findMessage(pred: (text: string) => boolean): string | undefined {
    for (const msgs of this.messages.values()) {
      const found = msgs.find(pred);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  clear(): void {
    this.messages.clear();
  }

  static tokenFromLink(link: string): string {
    return link.replace('test://join/', '');
  }
}
