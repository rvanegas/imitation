// WebSocket client for the imitation server.
// All messages are JSON frames (no newline framing needed over WebSocket).

export const SERVER_URL = 'ws://192.168.7.150:8080'; // update to your server's address

export type ServerMessage =
  | { type: 'ready'; name: string; token?: string }
  | { type: 'msg';   text: string }
  | { type: 'error'; text: string };

export type MessageHandler = (msg: ServerMessage) => void;

export class ImitationClient {
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private onDisconnect: () => void;
  private closing = false;

  constructor(onMessage: MessageHandler, onDisconnect: () => void) {
    this.onMessage = onMessage;
    this.onDisconnect = onDisconnect;
  }

  connect(onOpen?: () => void): void {
    this.closing = false;
    this.ws = new WebSocket(SERVER_URL);

    this.ws.onopen = () => onOpen?.();

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.onMessage(msg);
      } catch { /* ignore malformed frames */ }
    };

    this.ws.onclose = () => { if (!this.closing) this.onDisconnect(); };
    this.ws.onerror = () => { if (!this.closing) this.onDisconnect(); };
  }

  bootstrap(inviteToken: string, name: string): void {
    this.send({ type: 'bootstrap', inviteToken, name });
  }

  login(token: string): void {
    this.send({ type: 'login', token });
  }

  cmd(text: string): void {
    this.send({ type: 'cmd', text });
  }

  disconnect(): void {
    this.closing = true;
    this.ws?.close();
    this.ws = null;
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
