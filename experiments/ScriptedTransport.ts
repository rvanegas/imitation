import { Transport } from '../src/transport';
import { UserId } from '../src/types';

export class ScriptedTransport implements Transport {
  private messages = new Map<UserId, string[]>();

  async send(userId: UserId, text: string): Promise<void> {
    if (!this.messages.has(userId)) this.messages.set(userId, []);
    this.messages.get(userId)!.push(text);
  }

  makeInviteLink(token: string, _userId?: UserId): string {
    return `scripted://join/${token}`;
  }

  getMessages(userId: UserId): string[] {
    return this.messages.get(userId) ?? [];
  }

  lastMessage(userId: UserId): string | undefined {
    const msgs = this.messages.get(userId);
    return msgs?.[msgs.length - 1];
  }

  clear(): void {
    this.messages.clear();
  }

  static tokenFromLink(link: string): string {
    return link.replace('scripted://join/', '');
  }
}
