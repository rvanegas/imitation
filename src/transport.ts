import { UserId } from './types';

export interface Transport {
  send(userId: UserId, text: string): Promise<void>;
  makeInviteLink(token: string): string;
}
